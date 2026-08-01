# REQ-2026-096 요구사항

## 배경 — 소비자 버그 리포트(yammy-sales, 0.16.0)

phase id 가 `_` 또는 `.` 를 포함하면 **도구가 쓴 승인 아카이브를 도구 자신이 인식하지 못한다.**
`req:next` 는 그런 id 를 통과시키는데(`PHASE_ID_RE`), 아카이브 파일명 술어(`ARCHIVE_NAME_RE`)는
같은 문자를 거부한다. 두 술어의 문자 집합이 어긋나 있다.

- [scripts/req/req-next.ts:250-253](../../scripts/req/req-next.ts) — `PHASE_ID_RE = CLI_SAFE_ARG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/` (`.`·`_` **허용**)
- [scripts/req/lib/scratch.ts:151](../../scripts/req/lib/scratch.ts) — `ARCHIVE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9-]*-r\d{2,}-(approved|needs-fix)\.json$/` (`.`·`_` **불허**)
- [scripts/req/lib/evidence.ts:45](../../scripts/req/lib/evidence.ts) — `archiveBaseName` 은 phase id 를 **무해화 없이** base 로 쓴다.

## 실측 재현 (0.16.0 = 현재 HEAD, 순수 함수 직접 호출)

| phase id | `PHASE_ID_RE` | 쓰이는 아카이브 | `isArchiveFileName` | `isAllowedResponsesScratch` | `isConfinedArchivePath` | `expectedArchivePaths` |
|---|---|---|---|---|---|---|
| `phase-1-ok` | true | `phase-1-ok-r01-approved.json` | true | true | true | 1건 |
| `phase_1` | **true** | `phase_1-r01-approved.json` | false | false | false | **[]** |
| `phase.1` | **true** | `phase.1-r01-approved.json` | false | false | false | **[]** |

리포터의 출력과 일치한다.

## 영향 — "승인이 났는데 커밋할 수 없는" 교착

1. `isAllowedResponsesScratch=false` → `req:doctor` **D10** 이 그 untracked 아카이브를
   "unstaged/untracked 존재"로 계산 → 워킹트리가 영원히 더럽다 → 리뷰·커밋 차단.
2. `expectedArchivePaths=[]` → evidence chore 커밋이 아무것도 stage 하지 않는다 → 승인 아카이브가 끝내 커밋되지 않는다.
3. `isConfinedArchivePath=false` → `validateManifest` 가 `response_path 비confined` 로 거부 → `approvals.jsonl` 행을 쓸 수 없다.

REQ-2026-092/093/094 가 없애려던 교착과 **같은 형태**이되 **원인 경로가 달라** 그 예방 게이트에 걸리지 않는다.

## 왜 현실적으로 밟게 되는가

- `PHASE_ID_RE` 가 `_`·`.` 를 **명시적으로 허용**하고 어디에서도 경고하지 않는다.
- `phase_1_schema` 같은 snake_case 는 계획서에서 흔한 표기다.
- 증상이 D10(워킹트리 더러움)으로 나타나 원인이 phase id 문자라는 것을 사용자가 추적하기 매우 어렵다.

## 추가 관찰 — 돈이 먼저 나간다 (리포트에 없음)

리뷰 호출 경로에는 문자 집합 검증이 **전혀 없다**. [review-codex.ts:2376-2379](../../scripts/req/review-codex.ts)
의 `--phase` 파싱은 "비어있지 않고 `-` 로 시작하지 않는가"만 본다. `resolvePhaseTarget`
([review-codex.ts:1788](../../scripts/req/review-codex.ts))도 **phases[] 멤버십만** 본다.

따라서 순서는 이렇다: **유료 Codex 호출이 나가고 → 승인이 나고 → 아카이브가 쓰이고 → 그 다음에야
아무도 그것을 인식하지 못한다.** `req:next` 의 진단(`phaseModelProblems`)은 그 뒤에 온다.

이는 REQ-2026-067 이 이미 한 번 밟은 실패 유형과 동일하다 —
`resolvePhaseTarget` 의 주석: *"막지 않으면 **호출은 나가고 예산은 쓰이고 승인은 못 쓴다**(REQ-2026-067에서 실제로 1회 낭비)"*.

## 요구사항

- **R1** — `req:next` 가 통과시키는 phase id 로 도구가 쓴 아카이브는 도구의 **모든** 술어가 인식해야 한다.
  또는 그런 phase id 를 **애초에 거부**해야 한다. (두 술어가 갈라질 수 있는 구조 자체를 없앤다.)
- **R2** — 거부는 **유료 리뷰 호출 전에** 일어나야 한다. 승인 후 교착으로 나타나면 안 된다.
- **R3** — 거부 메시지는 **왜**(아카이브 파일명 규칙)와 **어떻게 고치는지**를 말해야 한다.
- **R4** — `CLI_SAFE_ARG_RE` 자체는 좁히지 않는다. 그 상수는 CLI 인자 일반 계약이고 `.` 이 필요한 값
  (예: 모델명 `gpt-5.6-terra`)이 있다. `REQ_ID_RE`([req-next.ts:377](../../scripts/req/req-next.ts) 단독 사용)도 무변경.
- **R5** — 회귀 가드는 **property** 로 고정한다: `PHASE_ID_RE.test(x)` 인 모든 x 에 대해
  `isArchiveFileName(archiveFileName(archiveBaseName('phase', x), 1, 'approved')) === true`.

## 범위 밖

- **자동 마이그레이션은 하지 않는다.** 근거: 잘못된 phase id 로는 `expectedArchivePaths=[]` 라
  evidence-finalize 가 아무것도 stage 하지 못하고, `validateManifest` 가 비confined 로 거부한다
  → **커밋된 증거가 존재할 수 없다.** 복구할 커밋된 데이터가 원리적으로 없으므로 안내로 족하다.
  (워킹트리에 남은 untracked 고아 아카이브 처리는 R3 의 메시지가 다룬다.)
- BUG-2(종결 티켓에서 `req:doctor` 가 항상 FAIL)는 원인 경로·리스크가 독립이라 **별도 REQ**.
