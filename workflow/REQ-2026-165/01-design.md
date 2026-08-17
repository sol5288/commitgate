# REQ-2026-165 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

`bin/check.ts` 는 `runChecks(inp)`(순수) + `collectInputs(dir)`(수집) 구조다. C1~C6 을 낸다.
업그레이드 축의 술어는 **다섯 곳**에 흩어져 있고 전부 이미 export 돼 있다:

| 축 | 술어 | 위치 | 무게 |
|---|---|---|---|
| `mixed-install` | `classifyInstallMode(scripts)` | `req-doctor.ts` | 2119줄 |
| `workflow-gitignore` | `unprotectedRepoRootScratch(paths, gitFn)` | `req-doctor.ts` | 〃 |
| `managed-blocks` | `quickstartBackfillTargets(root)` | `bin/quickstart.ts` | 587줄·가벼움 |
| `vendored-schema` | `sha256File` 비교 | `bin/init.ts` | **semver 동반** |
| `review-persona` | `planSync(...)` | `bin/sync.ts` → `init` | **semver 동반** |

## 핵심 설계 결정

### DEC-1 — 판정은 `scripts/req/lib/upgrade-status.ts`(신규)에 모으고 **술어는 재사용**한다

```ts
export type AxisState =
  | { kind: 'ok'; detail: string }
  | { kind: 'action'; detail: string }   // 조치 필요 — remedy 를 함께 낸다
  | { kind: 'unknown'; detail: string }  // 판정 불가 — "부족"이 아니다
  | { kind: 'manual'; detail: string }   // 도구가 판정할 수 없다(caret) — 사람이 확인

export interface AxisReport { axis: UpgradeAxis; state: AxisState }
export function evaluateUpgradeAxes(input: UpgradeStatusInput): AxisReport[]
```

🔴 **`UPGRADE_AXES` 를 순회한다**(REQ-2026-164 등록부). 목록을 다시 적지 않으므로 축을 늘리면 출력이
자동으로 따라온다 — 이 REQ 의 완료 기준 2 가 그것이다.

🔴 **술어를 재구현하지 않는다.** 각 축의 판정은 위 표의 기존 함수를 그대로 부른다. `check` 가 자기
판정을 새로 쓰면 `doctor` 와 갈라져 *"doctor 는 괜찮다는데 check 가 막는"* 상태가 생긴다.

### DEC-2 — 판정과 **입력 수집을 분리**한다(`check` 의 기존 구조 그대로)

`evaluateUpgradeAxes` 는 **순수**다. 파일·git 접근은 `collectUpgradeStatusInput(dir)` 가 한다.
`bin/check.ts` 가 그것을 불러 `CheckInputs` 에 실어 보내고, `runChecks` 는 지금처럼 순수하게 남는다.

🔴 이 저장소가 `check`·`doctor` 양쪽에서 지켜 온 형태다 — 순수 판정은 live 의존 없이 전 분기를 테스트할 수 있다.

### DEC-3 — `check` 는 축을 **C7 한 항목**으로 낸다(항목 폭발 금지)

축마다 `C7`·`C8`… 을 만들지 않는다. 항목 id 는 **에이전트가 소비하는 안정 계약**이고(기존 테스트가
`['C1'…'C6']` 순서를 고정한다), 축은 등록부에서 늘어나므로 id 를 축에 묶으면 **축을 늘릴 때마다
소비자 계약이 깨진다**.

`C7` 하나가 축별 줄을 본문에 담는다:

```
[WARN] C7: 업그레이드 축 3건 조치 필요 · 4건 정상 · 1건 사람 확인
  - req-scripts        : req:delegate·req:repolicy 없음 → npx commitgate sync --apply --scripts
  - managed-blocks     : CLAUDE.md 블록 드리프트 → npx commitgate quickstart --apply
  - caret-range        : 진단 없음 — 설치 범위를 사람이 확인
```

🔴 **level 은 WARN 상한**(요구 제약). 업그레이드가 안 끝났다는 이유로 exit 1 이 되면 CI·에이전트가 죽는다.

### DEC-4 — 무게: `check` 는 **온디맨드 CLI** 라 doctor 와 제약이 다르다

`req-doctor` 가 `bin/init.ts` import 를 금지한 이유는 **매 커밋 게이트로 spawn** 되기 때문이다
(`req:commit` 이 하드 게이트로 부른다). `check` 는 어디서도 spawn 되지 않고 사람이 부를 때만 돈다 —
그래서 `sync`/`init` 계열을 끌어와도 그 근거가 적용되지 않는다.

🔴 그래도 **`req-doctor` 를 통째로 끌어오지는 않는다.** 필요한 두 술어(`classifyInstallMode` ·
`unprotectedRepoRootScratch`)는 순수하고 doctor 와 무관한 성격이므로 `scripts/req/lib/install-shape.ts`
로 **옮기고 re-export** 한다(이 저장소가 `successorSlug` 를 leaf 로 내릴 때 쓴 방식 — 기존 호출부·테스트 무손상).

### DEC-5 — `docs/` 를 npm 패키지에 **넣지 않는다**

`check` 가 축·상태·조치를 전부 말하므로 문서는 보조다. `files` 를 늘리면 tarball 이 커지고, 무엇보다
**설치본의 문서가 stale 해질 새 축**이 생긴다(설치 시점 사본 vs 릴리스 — REQ-2026-038 이 겪은 그 문제).
정본은 GitHub 에 두고 `check` 출력이 그 링크를 낸다.

## Phase별 구현

| phase | 내용 |
|---|---|
| 1 | `lib/install-shape.ts` 로 두 술어 이동 + re-export(동작 불변) |
| 2 | `lib/upgrade-status.ts` 순수 판정 + 입력 수집 |
| 3 | `bin/check.ts` C7 배선 + help + 실경로 테스트 |
| 4 | 문서(정본 표에 "확인 방법 = `commitgate check`" 반영) + CHANGELOG |

## 변경 파일

- 신규: `scripts/req/lib/install-shape.ts` · `scripts/req/lib/upgrade-status.ts` + 각 테스트
- 수정: `scripts/req/req-doctor.ts`(re-export) · `bin/check.ts` · `docs/upgrade.md`·`.en.md` · `CHANGELOG.md`

## 하위호환·안전

- **C1~C6 의 id·순서·의미 불변** — C7 은 뒤에만 붙는다(기존 테스트가 그 계약을 고정한다).
- **exit 계약 불변** — 축은 WARN 상한이라 FAIL 0 이면 여전히 exit 0.
- **doctor 동작 불변** — 술어 이동은 re-export 로 호출부·테스트를 그대로 둔다.
- **`check` 는 여전히 읽기 전용** — 조치를 실행하지 않고 명령을 안내만 한다.
