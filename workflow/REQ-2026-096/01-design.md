# REQ-2026-096 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

### 갈라진 두 술어

| 위치 | 상수 | 문자 집합 |
|---|---|---|
| [req-next.ts:250](../../scripts/req/req-next.ts) | `CLI_SAFE_ARG_RE` | `[A-Za-z0-9][A-Za-z0-9._-]*` |
| [req-next.ts:253](../../scripts/req/req-next.ts) | `PHASE_ID_RE` = `CLI_SAFE_ARG_RE` (별칭) | 위와 동일 |
| [req-next.ts:256](../../scripts/req/req-next.ts) | `REQ_ID_RE` = `CLI_SAFE_ARG_RE` (별칭) | 위와 동일 |
| [lib/scratch.ts:151](../../scripts/req/lib/scratch.ts) | `ARCHIVE_NAME_RE` (module-private) | `[A-Za-z0-9][A-Za-z0-9-]*` + `-rNN-...` |

`archiveBaseName`([lib/evidence.ts:45](../../scripts/req/lib/evidence.ts))은 phase id 를 그대로 base 로 쓴다 —
무해화 지점이 없다. 따라서 `PHASE_ID_RE` 가 허용하고 `ARCHIVE_NAME_RE` 가 거부하는 문자(`.`·`_`)가
그대로 파일명에 들어가고, 그 파일은 이후 어떤 술어에도 걸리지 않는다.

### 검출 순서가 뒤집혀 있다 (돈이 먼저 나간다)

phase id 가 시스템을 지나는 실제 순서:

1. 사람이 `02-plan.md` 분해를 `state.json` 의 `phases[]` 에 채운다 — **검증 없음**.
2. `req:review-codex --phase <id>` — `parseArgs`([review-codex.ts:2376](../../scripts/req/review-codex.ts))는
   빈 값·선행 `-` 만 본다. `resolvePhaseTarget`([review-codex.ts:1788](../../scripts/req/review-codex.ts))은
   **`phases[]` 멤버십만** 본다. → **유료 Codex 호출이 나간다.**
3. 승인 → `archiveFileName(archiveBaseName('phase', id), ...)` 로 아카이브가 **쓰인다**.
4. 그 다음에야 D10·evidence chore·`validateManifest` 가 그것을 **인식하지 못한다**.
5. `req:next` 의 `phaseModelProblems`([req-next.ts:351](../../scripts/req/req-next.ts))가 유일한 자동 진단인데
   이미 3번이 지난 뒤다.

`resolvePhaseTarget` 은 **이미 같은 실패 유형을 한 번 막고 있다** — `phases[]` 가 빈 경우에 대한 주석:
*"막지 않으면 호출은 나가고 예산은 쓰이고 승인은 못 쓴다(REQ-2026-067에서 실제로 1회 낭비)"*.
BUG-1 은 정확히 그 유형이며, 같은 함수에서 막는 것이 일관된다.

### 회귀 가드가 결함 쪽을 잠그고 있다

[tests/unit/req-next.test.ts:299-301](../../tests/unit/req-next.test.ts) —

```ts
it('실제 사용 중인 phase id 형식은 안전하다', () => {
  for (const id of ['phase-1a-persona-install', 'phase-2-req-next', 'p1', 'phase-3b.entrypoint_uninstall'])
    expect(PHASE_ID_RE.test(id)).toBe(true)
})
```

`phase-3b.entrypoint_uninstall` 은 REQ-2026-010 phase 2(`fdd20de`)에서 들어왔다. 실측: **이 저장소의
`workflow/*/responses/` 에 `_` 나 `.` 를 base 에 가진 아카이브는 0건이다.** 즉 "실제 사용 중"이라는
설명은 사실이 아니었고, 이 테스트는 **교착을 만드는 계약을 고정**하고 있었다. 수정 대상이다.

### 마이그레이션이 필요 없는 이유(실측 근거)

잘못된 phase id 로는 `expectedArchivePaths=[]` 라 evidence-finalize 가 아무것도 stage 하지 못하고,
`validateManifest` 는 `isConfinedArchivePath=false` 로 행을 거부한다. → **커밋된 증거가 원리적으로 존재할 수 없다.**
저장소 실측(아카이브 0건)도 이와 일치한다. 복구할 커밋 데이터가 없으므로 데이터 마이그레이션은 범위 밖이고,
워킹트리에 남은 untracked 고아 아카이브만 안내로 처리한다.

## 핵심 설계 결정

### DEC-1 — 아카이브 base 문자 집합을 `lib/scratch.ts` 의 단일 원천으로 승격

`ARCHIVE_NAME_RE` 와 base 규칙이 **한 리터럴에서 파생**되게 한다.

```ts
/** 아카이브 base(=phase id 또는 'design')에 허용되는 문자 — 파일명 규칙과 phase id 계약의 단일 원천. */
const ARCHIVE_BASE_BODY = '[A-Za-z0-9][A-Za-z0-9-]*'
export const ARCHIVE_BASE_RE = new RegExp(`^${ARCHIVE_BASE_BODY}$`)
const ARCHIVE_NAME_RE = new RegExp(`^${ARCHIVE_BASE_BODY}-r\\d{2,}-(approved|needs-fix)\\.json$`)
```

- 🔴 설계 D7 의 "정규식 보간 금지"는 **런타임 값** 보간을 금지한 것이다(`isTicketDirName` 이 문자열 분해를
  쓰는 이유). 여기서 결합하는 것은 **모듈 내부 리터럴 상수 하나뿐**이며 외부 입력이 닿지 않는다. 이 구분을
  코드 주석에 남긴다.
- 위치 근거: `lib/scratch.ts` 는 이미 "정반대인 두 사실을 한 파일에 둔다"를 의도로 삼는 파일이다
  (파일 헤더). 갈라지면 안 되는 두 술어를 여기 함께 두는 것이 같은 처방이다.
- `lib/scratch.ts` 는 leaf(포르셀린만 의존)이므로 `req-next`·`review-codex` 양쪽이 순환 없이 import 한다.
  `req-next.ts` 는 이미 `./lib/scratch` 를 import 한다([req-next.ts:31](../../scripts/req/req-next.ts)).

### DEC-2 — `PHASE_ID_RE` 를 `ARCHIVE_BASE_RE` 에서 파생(`CLI_SAFE_ARG_RE` 별칭 해제)

```ts
// phase id는 argv 토큰이자 **아카이브 파일명 base**다. 후자가 더 좁으므로 후자가 계약이다.
export const PHASE_ID_RE = ARCHIVE_BASE_RE
```

불변식: **아카이브 안전 ⊂ CLI 안전.** `[A-Za-z0-9-]` 는 `[A-Za-z0-9._-]` 의 진부분집합이므로
좁히기만 할 뿐 CLI 안전성은 유지된다. 이 포함관계를 테스트로 고정한다(DEC-6).

### DEC-3 — `CLI_SAFE_ARG_RE`·`REQ_ID_RE` 는 무변경

`CLI_SAFE_ARG_RE` 는 CLI 인자 일반 계약이고 `.` 이 필요한 값이 있다. `REQ_ID_RE` 는
[req-next.ts:377](../../scripts/req/req-next.ts) 한 곳에서만 쓰이며 REQ id 는 아카이브 base 가 되지 않는다.
좁힐 이유가 없고, 좁히면 무관한 실패를 만든다.

### DEC-4 — 유료 호출 **전** 차단: `resolvePhaseTarget` 에 문자 집합 검사 추가

`kind==='phase'` 이고 해소된 `phaseId` 가 `ARCHIVE_BASE_RE` 를 만족하지 않으면 `ok:false` 로 반환한다.
호출부([review-codex.ts:2502](../../scripts/req/review-codex.ts))가 `throw` 하므로 **codex 호출·state 변경·
아카이브 쓰기 어느 것도 일어나지 않는다.**

- 배치 위치는 멤버십 검사 **직후**(레거시 분기 포함 — 레거시라도 phaseId 가 확정되면 검사한다).
- 근거는 같은 함수의 REQ-2026-067 선례와 동일: 승인해도 커밋할 수 없는 리뷰는 시작하지 않는다.

### DEC-5 — 메시지는 **왜**와 **어떻게**를 말한다

두 지점(`resolvePhaseTarget`, `phaseModelProblems`)의 문구는 다음을 포함한다:

- 거부된 id 와 허용 형식.
- **왜**: 승인 아카이브 파일명(`<base>-rNN-approved.json`)의 base 로 그대로 쓰이기 때문.
- **어떻게**: `02-plan.md` 와 `state.json` 의 `phases[].id` 에서 `_`·`.` 를 `-` 로 바꾼다.
- 워킹트리에 이미 쓰인 고아 아카이브(`<옛id>-rNN-*.json`)가 있으면 **지운다** — 그 라운드는 인식되지
  않으므로 리뷰를 다시 받아야 한다. (커밋된 증거는 존재할 수 없다 — 위 근거 참조.)

기존 `phaseModelProblems` 문구는 `${String(PHASE_ID_RE)}` 를 그대로 박아 넣고 있어 파생 변경 후에도
자동으로 새 형식을 보여준다. 다만 사유가 "선행 `-`·공백" 뿐이라 아카이브 사유를 **추가**한다.

### DEC-6 — 회귀는 property 로 고정

`tests/unit/scratch.test.ts` 에 추가:

1. **왕복 property** — `PHASE_ID_RE.test(x)` 인 샘플 전부에 대해
   `isArchiveFileName(archiveFileName(archiveBaseName('phase', x), 1, 'approved')) === true`
   그리고 `isConfinedArchivePath(...) === true`, `expectedArchivePaths([...]).length === 1`.
   샘플은 **테스트 내부 리터럴**로 고정한다(SUT 상수로 기대값을 만들면 tautology — REQ-B 교훈).
2. **포함관계** — `ARCHIVE_BASE_RE` 를 만족하는 샘플은 `CLI_SAFE_ARG_RE` 도 만족한다.
3. **음성** — `phase_1`·`phase.1` 은 이제 `PHASE_ID_RE` 를 통과하지 못한다.
4. **호출 전 차단** — `resolvePhaseTarget(state, 'phase', 'phase_1')` 이 `ok:false` 이고 메시지에
   아카이브 사유가 들어간다.

[req-next.test.ts:299-301](../../tests/unit/req-next.test.ts)의 `phase-3b.entrypoint_uninstall` 은
안전 목록에서 제거하고, 같은 파일에 "이제 거부된다"는 음성 케이스로 옮긴다.

## Phase별 구현

**단일 phase** — 변경이 하나의 불변식(두 술어 통일)에 묶여 있고 코드 5파일이라 분할 이득이 없다.
docs-only 막 phase 를 두면 diff-scoped 리뷰가 앞 phase 를 못 봐 오탐이 나는 기존 문제
(REQ-2026-037·082 교훈)를 피한다.

## 변경 파일

| 파일 | 변경 |
|---|---|
| [scripts/req/lib/scratch.ts](../../scripts/req/lib/scratch.ts) | `ARCHIVE_BASE_BODY`/`ARCHIVE_BASE_RE` 도입, `ARCHIVE_NAME_RE` 를 그것에서 파생(DEC-1) |
| [scripts/req/req-next.ts](../../scripts/req/req-next.ts) | `PHASE_ID_RE` 파생 전환(DEC-2), `phaseModelProblems` 문구 보강(DEC-5) |
| [scripts/req/review-codex.ts](../../scripts/req/review-codex.ts) | `resolvePhaseTarget` 문자 집합 가드(DEC-4·5) |
| [tests/unit/scratch.test.ts](../../tests/unit/scratch.test.ts) | property·포함관계·음성·호출전차단 (DEC-6) |
| [tests/unit/req-next.test.ts](../../tests/unit/req-next.test.ts) | 결함을 고정하던 케이스 정정 (DEC-6) |
| [docs/ssot-design/00-document-control.md](../../docs/ssot-design/00-document-control.md) | base 문자 집합 명시 |
| [docs/ssot-design/03-domain-and-data-model.md](../../docs/ssot-design/03-domain-and-data-model.md) | `base` = phase id 서술에 문자 제약 추가 |
| [docs/ssot-design/08-architecture-and-module-spec.md](../../docs/ssot-design/08-architecture-and-module-spec.md) | §2.4 scratch 공개 심볼 목록에 `ARCHIVE_BASE_RE` 추가 |
| [CHANGELOG.md](../../CHANGELOG.md) | Unreleased 항목 |

## 하위호환·안전

- **좁히는 변경이다.** 이전에 통과하던 `_`·`.` phase id 가 이제 거부된다. 그러나 그런 id 는
  **애초에 커밋 가능한 승인을 만들 수 없었다**(위 실측 근거) — 동작하던 워크플로를 깨지 않는다.
  바뀌는 것은 실패 **지점과 메시지**뿐이다: 추적 불가능한 D10 교착 → 호출 전 명확한 거부.
- **`design` base 는 영향 없다.** `archiveBaseName('design', …)` 은 phaseId 를 무시하고 리터럴
  `'design'` 을 쓴다. 레거시 폴백 `'phase'` 도 안전 문자만 쓴다.
- **`ARCHIVE_NAME_RE` 의 매칭 동작은 바뀌지 않는다** — 같은 문자 집합을 문자열로 조립할 뿐이다.
  기존 아카이브 전부가 계속 인식된다(회귀 테스트가 기존 케이스를 유지한다).
- **안전 속성 강화 방향**이므로 게이트가 약해지는 경로는 없다. `resolvePhaseTarget` 은 `ok:false` 가
  `throw` 로 이어지는 fail-closed 경로다.
