# REQ-2026-050 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

**persona 배포 경로.** `workflow/review-persona.md`가 패키지 자산이다. `init`이 `KIT_COPY_RELPATHS`로 대상 repo에 복사하되 기존 파일은 `--force` 없으면 스킵한다. `loadReviewPersona`가 fail-closed로 읽고(거부 조건 3개: 부재·빈 내용·symlink), `assembleReviewPrompt`가 프롬프트 **첫 블록**으로 넣는다. 본문 형식 제약은 없다.

**design 점검 관점.** persona의 `### REVIEW_KIND: design` 목록은 6항목(요구사항·인수 기준 / 00·01·02 문서 간 모순 / 정상 경로 계약 위반 / 테스트 oracle / 보안·fail-closed / 문서·help 호환성)이다. phase 분해 품질을 심사할 항목이 없다.

**sync의 persona 축.** `planSync`가 `AssetStatus` 5종으로 판정한다 — `unmanaged-null`·`unmanaged-custom`(미접촉) / `new`(부재 복원) / `in-sync` / `preserved-differs`. 마지막이 이 REQ의 대상이고, 현재 정책은 **미접촉**이다. 코드 주석이 근본 제약을 이미 기록한다:

> 🔴 다름 → 절대 덮지 않는다(사용자 편집 보존). **manifest 없이 stale-kit과 편집을 구별 못 함**(design-r02 P1).

즉 "무단 덮어쓰기 금지"는 이미 충족돼 있다. 없는 것은 **명시적 opt-in 갱신 경로**다.

## 핵심 설계 결정

### D1. design 점검 관점에 phase 분해 3항목 추가

`### REVIEW_KIND: design` 목록에 추가한다.

- `02-plan.md`의 각 phase가 **책임 계약·입력·산출물·선행 phase·독립 검증 명령**을 선언하는가
- 선언된 선행 phase만 충족되면 각 phase가 **독립 커밋·독립 리뷰**되는가
- 후속 phase가 있어야만 현재 phase의 인수 기준이 성립하는 **숨은 결합**이 없는가

계획은 이미 권위 아티팩트로 프롬프트에 전문 포함되므로 **입력을 늘리지 않는다** — 심사 기준만 추가한다.

### D2. 🔴 P1 정의는 불변 — 분해 관점은 탐색 하한이지 차단 기준 확대가 아니다

persona는 점검 목록을 "탐색의 **하한**"으로 이미 정의한다. D1 항목도 같은 지위다. 분해 결함이 `findings`가 되려면 기존 P1 3요소(카테고리·정상 경로·증거)를 **그대로** 만족해야 하고, 아니면 `observations`다. 이 문장을 D1 바로 뒤에 명시한다.

**이유가 이 REQ의 존재 이유와 같다.** 분해 관점이 차단 기준으로 읽히면 리뷰어가 분해 취향으로 차단하기 시작하고, 그것이 정확히 우리가 고치려는 미수렴을 **재생산**한다. persona 자신의 문장 — *"차단과 비차단의 경계를 흐리면 승인이 영영 나지 않고, 그것은 리뷰의 실패다"* — 가 이 결정의 근거다.

### D3. kit 관리 마커 도입

persona 본문 첫 줄에 마커를 둔다.

```
<!-- commitgate:persona v1 -->
```

용도는 하나다 — sync가 대상 파일이 **kit이 배포한 기본 persona 계보인지** 판정할 근거. markdown 주석이라 프롬프트에 들어가도 리뷰 의미에 영향이 없고, `loadReviewPersona`의 거부 조건 3개 어디에도 걸리지 않는다.

### D4. `sync --persona` 판정 확장 — 마커는 **차단 조건이 아니라 경고 강도**다

| 대상 파일 | status | 기본 동작 | `--persona-apply` |
|---|---|---|---|
| shipped와 동일 | `in-sync` | 미접촉 | — |
| 마커 有 · 다름 | **`managed-drift`**(신규) | 미접촉 + 실제 내용 diff | 백업 후 교체 |
| 마커 無 · 다름 | `preserved-differs`(기존 식별자 유지) | 미접촉 + 실제 내용 diff + **강한 경고** | 백업 후 교체 |

**🔴 마커 유무로 교체 경로를 막지 않는다.** 마커 게이팅은 pre-050 설치분 **전체**의 갱신 경로를 봉쇄해 요구사항 4(기존 프로젝트를 위한 명시적 opt-in 갱신 경로)를 정상 경로에서 위반한다. 0.9.8이 깐 기본 persona에는 마커가 없으므로, 마커를 요구하면 정책이 기존 사용자에게 **영영 도달하지 못한다**.

**그러면 구별 불가 문제는 어떻게 처리되나.** "pre-050 kit 사본인지 사용자 작성분인지" 판정을 **도구가 하지 않는다** — 사용자가 한다. 그것이 "diff를 보여주고 사용자 선택을 요구한다"의 의미다. 도구는 판단에 필요한 것을 전부 제공하고 되돌릴 수단을 남긴다:

1. 적용 전 **실제 내용 diff**(D5)
2. 기본 미접촉 — 아무것도 안 하면 아무 일도 안 일어난다
3. **이중 플래그** opt-in(`--persona --persona-apply`)
4. 교체 전 **백업**(D6)

**마커가 하는 일.** 경고 강도를 가른다. 마커가 없으면 "이 파일은 당신이 직접 쓴 것일 수 있습니다"를 명시한다. 교체 후에는 shipped 본문(마커 포함)이 들어가므로 이후부터는 `managed-drift`로 판정된다 — 마이그레이션 1회로 계보가 정리된다.

**미접촉이 유지되는 경우.** `unmanaged-null`(persona 비활성)·`unmanaged-custom`(custom 경로)은 그대로다. kit 관리 경로의 파일이 아니므로 이 REQ의 대상이 아니다.

### D5. 실제 내용 diff — 생산 방식과 표시 계약

**요약이 아니라 내용 diff여야 한다.** 사용자가 자기 편집분과 shipped를 비교하지 못한 채 `--persona-apply`를 고르면 그것은 "정보에 기반한 선택"이 아니다.

**생산은 git에 위임한다** — `git diff --no-index --no-color -- <shipped> <target>`.

- 새 의존성 0. `diff` 라이브러리를 넣지도, LCS를 손수 구현하지도 않는다. `bin/sync.ts`는 이미 `assertGitWorkTree`를 import하므로 git은 이 명령의 하드 전제다.
- **exit code 의미론**: `--no-index`는 내용이 다르면 **1**을 낸다. 0·1을 정상으로 받고 **2 이상만 오류**로 throw한다. 기존 `createGitAdapter().exec`는 non-zero에서 throw하므로 **쓸 수 없다** — 0/1을 허용하는 별도 러너를 쓰고, 테스트가 stub할 수 있게 주입 가능하게 둔다.
- 동기 구현 유지(launcher가 `runCli`를 await 없이 호출한다 — 헤더 경고).

**표시 계약**

- `managed-drift`·`preserved-differs` **둘 다**, **`--apply` 여부와 무관하게**(dry-run 포함) diff를 인쇄한다. dry-run에서 봐야 적용 여부를 고를 수 있다.
- `--persona-apply` 경로에서는 diff를 **교체보다 먼저** 인쇄한다(적용 전 표시).
- 출력 상한 200행. 초과하면 절단 표시와 함께 **shipped 원본의 절대경로**를 인쇄해 사용자가 자기 도구로 전체를 비교할 수 있게 한다.

**🔴 diff 생산 실패 = 교체 금지(fail-closed).** git 부재·exit≥2 등으로 diff를 만들지 못하면 `--persona-apply`가 있어도 교체하지 않는다. 근거를 보여줄 수 없으면 선택을 받을 수 없다.

### D6. 백업 없는 교체 없음

`--persona-apply`는 교체 전에 `workflow/review-persona.md.bak`을 쓴다. **백업 쓰기가 실패하면 교체하지 않는다**(fail-closed). 기존 `.bak`은 덮어쓴다 — 직전 상태 1세대만 보장하며 이를 출력에 명시한다.

### D7. 하위호환 — 새 플래그는 전부 opt-in

`--persona` 없으면 persona 축은 계획에 들어가지도 않는다(현행 유지). `--persona-apply`는 `--persona`를 **함의하지 않는다** — 둘을 함께 줘야 한다. 우발적 교체를 막기 위한 의도적 중복이다.

## Phase별 구현

### phase-1-persona-criteria

- 책임 계약: 기본 persona 본문이 phase 분해 심사 기준과 P1 불변 문구, kit 마커를 갖는다(D1·D2·D3).
- 입력: 현재 `workflow/review-persona.md`.
- 산출물: 개정된 persona + 존재 계약 테스트.
- 선행 phase: 없음.
- 독립 검증: `npm test -- review-persona` · `npm run typecheck`.

### phase-2-sync-managed-drift

- 책임 계약: `sync --persona`가 마커 유무로 2분기하고, 적용 전 실제 내용 diff를 보여주며, opt-in 교체가 백업·diff 이중 fail-closed로 동작한다(D4·D5·D6·D7).
- 입력: phase-1이 도입한 마커.
- 산출물: `planSync`/`renderPlan`/CLI 인자 확장 + git 위임 diff 러너 + 회귀 테스트 + 문서.
- 선행 phase: phase-1(마커가 있어야 판정이 성립).
- 독립 검증: `npm test -- sync` · `npm run typecheck` · 임시 git 저장소 fixture로 3분기 실동작.

## 변경 파일

| phase | 파일 |
|---|---|
| 1 | `workflow/review-persona.md` · `tests/unit/review-persona.test.ts`(신규) |
| 2 | `bin/sync.ts` · `tests/unit/sync.test.ts` · `docs/upgrade.md` · `docs/upgrade.en.md` · `docs/configuration.md` · `docs/configuration.en.md` |

## 하위호환·안전

- **기존 프로젝트**: `sync --persona`의 기본 동작이 변하지 않는다(파괴적 쓰기 0건). 마커 없는 persona는 자동 경로가 없다.
- **신규 프로젝트**: `init`이 개정된 persona를 복사하므로 정책이 자동 적용된다.
- **dogfooding**: phase-1이 이 저장소 자신의 persona를 바꾼다. 따라서 phase-2의 리뷰는 새 기준으로 심사되고, 이 문서의 `## Phase별 구현` 절 자체가 D1 기준을 만족해야 한다. 의도된 자기적용이다.
- **fixture 불변**: `44_yammy_sales`는 읽기 전용 분석 대상이다. migration 실동작 검증은 임시 git 저장소로 하고, 그 저장소에 파일 변경 0건임을 완료 보고에 포함한다.
