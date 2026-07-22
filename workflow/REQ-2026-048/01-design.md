# REQ-2026-048 설계 — design 증거 영속화 (P1)

> 정본: 코덱스 판정·지시(확정·P1). 본 문서는 그 지시를 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

- **매니페스트 모델·헬퍼가 `scripts/req/req-commit.ts`에 있다** — `MANIFEST_KEYS`(:43), `ManifestEntry`(:72), `buildManifestEntry`(:90), `serializeManifestLine`(:119), `validateManifest`(:128), `expectedArchivePaths`(:203), `manifestHasConsumed`(:340).
- **import 방향은 `req-commit` → `review-codex`** (loadState·validateVerdict·ApprovalEvidence 등). 따라서 `review-codex`가 `req-commit`을 import하면 **순환**이 된다 — 흡수(완료기준 2)를 그대로 하면 그 순환이 생긴다.
- **`finalizeEvidenceAndConsume`(phase)** 는 `expectedArchivePaths(...)`로 그 phase의 **needs-fix + approved 전부**를 stage한다(:201 주석). **`designFinalize`** 는 `git add responsePath, approvals.jsonl`(:642) — **승인 아카이브 1건만**.
- **design 승인 지점**: `review-codex.ts:1398-1404` — `design_approved=true`일 때 `design_approval_evidence`를 부착한다. 여기가 흡수의 자연스러운 지점이다.
- **`validateManifest`는 extra field를 금지**한다(:150, 주입 차단) → 새 필드는 `MANIFEST_KEYS` 등재와 형식 검증이 함께 필요하다. 행 최상위 `response_path`는 **`-approved.json`만** 허용된다(:156-163).
- **`req:next`** 의 `NextKind`에 `DONE`·`BLOCKED`가 이미 있다(:86). DONE 판정은 매니페스트를 보지 않는다.

## 핵심 설계 결정

### DEC-1 — 공유 leaf 모듈 `scripts/req/lib/evidence.ts` 추출
매니페스트 모델·검증과 **design evidence 내구화**를 이 모듈로 옮긴다. `req-commit.ts`는 **re-export**로 하위호환을 유지한다(기존 테스트·참조 무변경).

- 🔴 **`import type`만으로는 부족하다 — 런타임 의존도 함께 옮겨야 한다**(구현 착수 중 확인한 사실). 현재 매니페스트 코드는 **런타임 함수** `archiveBaseName`(`review-codex.ts:1621`)·`isValidIsoInstant`(`review-codex.ts:1104`)와 `isConfinedArchivePath`(`req-doctor.ts:197`)에 의존한다. 이것들을 그대로 두고 `review-codex`가 `lib/evidence`를 import하면 **런타임 순환**(`review-codex → lib/evidence → review-codex`)이 생긴다.
- 따라서 함께 이동한다: `archiveBaseName` · `isValidIsoInstant` · `isConfinedArchivePath` · 그리고 `req-commit`의 비공개 보조(`SHA256_RE`·`GIT_OID_RE`·`escapeRegExp`·`userConfirmProblem`). 원래 모듈(`review-codex`·`req-doctor`·`req-commit`)은 **re-export**로 기존 시그니처를 그대로 유지한다 → 외부 참조·테스트 무변경.
- 결과적으로 `lib/evidence.ts`의 **런타임 import는 `lib/scratch.ts`(leaf)뿐**이고, 타입만 `review-codex`에서 `import type`으로 가져온다(컴파일 시 소거 → 간선 없음). 런타임 간선은 `review-codex → lib/evidence`, `req-doctor → lib/evidence`, `req-commit → lib/evidence`로 **전부 단방향**이다. `lib/scratch.ts`가 leaf로 남은 것과 같은 규율이다(scratch.ts:13-15).
- **호출자 계약은 한 문장**: `durableDesignEvidence(...)` 는 "승인된 design evidence를 내구화한다"만 노출한다. 호출자는 매니페스트 형식·stage 목록·멱등 판정을 알지 못한다.

### DEC-2 — `archive_inventory`로 needs-fix까지 영속화
design 매니페스트 행에 **선택 필드** `archive_inventory: [{ response_path, sha256 }]` 를 둔다. 그 라운드의 design 아카이브 **전부(needs-fix 포함)** 를 기록하고, finalize는 **그 목록의 파일을 stage·commit**한다.

- **왜 파일명 sweep이 아닌가**: 디스크 스캔은 실행 시점 디렉터리 상태에 의존해 **재현 불가**다(나중에 파일이 늘거나 지워지면 결과가 달라진다). 매니페스트에 경로+sha로 박으면 **사후 감사에서 재검증**할 수 있고 DONE 게이트(DEC-4)가 그 목록을 그대로 오라클로 쓴다.
- **검증**: `MANIFEST_KEYS`에 `archive_inventory` 추가. 각 항목은 `response_path`가 **현재 티켓 `responses/` 직계 아카이브**(`isConfinedArchivePath`)이고 `sha256`이 64hex여야 한다. 🔴 **인벤토리는 needs-fix 이름을 허용**한다 — 행 최상위 `response_path`의 "approved만" 규칙(:156-163)은 **그대로 유지**한다(둘은 의미가 다르다: 최상위=소비된 승인, 인벤토리=그 승인에 이르는 라운드 전체).
- **하위호환**: 필드 부재 = **매니페스트 검증상 유효**(기존 행·기존 티켓 무회귀). 🔴 단 **marker가 켜진 신규 티켓에서는 design 행에 `archive_inventory`가 없으면 DONE 게이트가 무조건 BLOCKED**다(design r01 관찰 1) — 검증의 관대함(legacy 호환)과 완료 판정의 엄격함(신규)을 분리해 둘 다 고정한다.
- 인벤토리에는 **승인 아카이브도 포함**한다(자기 자신 포함) — DONE 게이트가 목록 하나만 보면 되도록.
- **수집 범위(결정적 정의, design r01 관찰 2)**: 인벤토리 = **승인 시점**에 현재 티켓 `responses/` **직계**에 존재하는 **design 아카이브 전부**(`archiveBaseName('design', null)` 매처 — `design-rNN-(approved|needs-fix).json`, needs-fix 포함). round(rNN) 오름차순으로 정렬해 **디렉터리 읽기 순서에 비의존**하게 만든다(`expectedArchivePaths`와 동일 기법). sha는 그 시점의 파일 내용으로 계산한다.
  - **재승인(2번째 design 행)**: 그 시점의 전부를 다시 담으므로 이전 라운드를 **포함**한다. 각 행이 "그 승인 시점의 완전한 상태"라는 의미로 일관되고, DONE 게이트는 **가장 마지막 design 행**을 본다. stale 아카이브를 골라내는 별도 규칙을 두지 않는다 — 그 판단은 재현 불가능한 휴리스틱이 되기 쉽다.
  - 타 kind(phase) 아카이브는 매처가 걸러 내므로 인벤토리에 들어가지 않는다.

### DEC-3 — design 승인 경로 흡수(정상 경로에서 수동 단계 제거)
`review-codex --kind design --run`이 **승인으로 끝나면** 그 자리에서 `durableDesignEvidence(...)`를 호출해 아카이브+매니페스트를 evidence commit한다.

- 🔴 **멱등은 온디스크가 아니라 `HEAD` 기준으로 정의한다**(design r01 P1-2). 온디스크 매니페스트에 엔트리가 있다는 이유로 skip하면, **매니페스트 append·stage까지 되고 `git commit`만 실패한 부분 상태**에서 재시도가 영구히 skip되어 HEAD 증거를 **결코 복구하지 못하고** DONE 게이트가 영영 BLOCKED가 된다. 판정 순서는 다음과 같다:

  | 온디스크 엔트리 | HEAD에 내구화됨(엔트리 + 인벤토리 blob·sha 일치) | 동작 |
  |---|---|---|
  | 없음 | — | append → stage(인벤토리 전량 + 매니페스트) → commit |
  | 있음 | 예 | **진짜 no-op** |
  | 있음 | 아니오 | **append 없이** stage → commit **재시도**(부분 상태 복구) |

  즉 "이미 기록됨"의 판정 기준은 **커밋된 blob**이다. 온디스크 중복 append만 막고, 커밋 재시도는 막지 않는다.
- 🔴 **커밋 실패는 승인 판정을 뒤집지 않는다**. 기록 실패가 게이트 결정을 바꾸면 그것이 계약 위반이다(측정 로그 R8과 같은 취지). 실패 시 **경고 + 복구 명령**(`req:commit <id> --finalize-design --run`)을 출력하고 종료 코드는 승인 경로 그대로 둔다. 그 "승인됨·미커밋" 창은 **DEC-4의 DONE 게이트가 잡는다**.
- **`--finalize-design`은 유지**하되 정상 절차에서 안내하지 않는다 — 중단·실패 복구 전용. 두 경로가 **같은 `durableDesignEvidence`** 를 호출하므로 동작이 갈라질 수 없다.

### DEC-4 — `req:next` DONE 직전 **커밋된 blob** 검증 (신규 티켓 전용)

🔴 **marker도 `HEAD`에서 읽는다 — 워킹트리 `state.json`을 신뢰하지 않는다**(design r01 P1-1). marker를 비커밋 캐시에서 읽으면, 캐시 재생성·브랜치 전환으로 marker가 사라진 신규 티켓이 **legacy로 오인**되어 HEAD에 design 증거가 없어도 DONE이 나온다(완료기준 6 위반).

- `req:new`는 스캐폴드 `state.json`에 `evidence_durability_required: true`를 심고, **그 스캐폴드를 커밋한다**(기존 동작). 따라서 marker는 **`git show HEAD:<ticketRel>/state.json`** 의 blob에 영속한다 — 이후 런타임 변경분이 커밋되지 않아도, 워킹 파일이 지워져도 **HEAD blob은 남는다**.
- 판별 규칙(보수적):

  | HEAD blob의 `state.json` | 판정 |
  |---|---|
  | 읽힘 · marker=true | **신규 → 엄격 검증**(미충족 시 BLOCKED) |
  | 읽힘 · marker 부재/false | legacy → 기존 DONE 호환 |
  | **읽기 불가·파손** | 🔴 **엄격(BLOCKED)** — 완료 선언은 검증 가능한 상태에서만 한다. 티켓 스캐폴드가 커밋돼 있지 않다는 뜻이므로 어차피 DONE 대상이 아니다 |

- **워킹 `state.json`의 marker는 판정에 쓰지 않는다**(있어도 무시). 판정 입력은 HEAD blob 하나뿐이라 소실로 우회할 표면이 없다.

모든 phase가 끝나 DONE을 내기 직전:

1. **`HEAD`의 blob**에서 `approvals.jsonl`을 읽는다(`git show HEAD:<ticketRel>/responses/approvals.jsonl` — **온디스크 금지**. D17이 온디스크를 봐서 이 갭이 조용했다).
2. design 행이 있는지, 그 행의 `response_path`와 `archive_inventory` 항목이 **HEAD에 blob으로 존재**하고 **sha가 일치**하는지 확인한다.
3. 미충족이면 `DONE` 대신 **`BLOCKED`** + 복구 명령을 반환한다.

- 🔴 **`req:doctor`·일반 `req:commit`에는 넣지 않는다.** doctor는 `req:commit`의 하드 게이트라 FAIL이면 기존 소비자의 모든 커밋이 벽돌이 된다. 이 검사는 **terminal `req:next` 완료 판정에서만** fail-closed다.
- **legacy 호환**: marker가 없으면 검사하지 않고 **기존 DONE 그대로**. 신규 티켓에만 적용되므로 기존 소비자 무회귀.
- **BLOCKED를 고른 이유**: `AWAIT_HUMAN`은 "사람 승인을 받으라"인데 여기 필요한 것은 승인이 아니라 **복구 실행**이다. `BLOCKED`가 정확한 의미이고 이미 진단 채널로 쓰인다(:182).

### DEC-5 — 실패 주입 테스트
`durableDesignEvidence`를 **git 어댑터 주입**으로 테스트 가능하게 두고 고정한다: ①아카이브 기록 후 `git commit` 실패 → 승인 판정 불변·복구 안내 출력 ②실패 후 `--finalize-design` 재시도로 정상 복구 ③중복 실행 시 매니페스트 중복 행 없음 ④부분 상태(매니페스트만 append되고 커밋 실패)에서 재실행이 무결성 오류를 내지 않음.

## Phase별 구현

- **phase-1-evidence-module** — DEC-1. 순수 이동 + re-export. **동작 변경 0**(기존 테스트가 그대로 그린이어야 한다).
- **phase-2-archive-inventory** — DEC-2. 필드·검증·인벤토리 빌더 + `designFinalize`가 인벤토리 전량 stage.
- **phase-3-absorb-approval-path** — DEC-3 + DEC-5. 승인 경로 흡수·멱등·실패 주입 테스트.
- **phase-4-done-gate** — DEC-4. marker(`req:new`) + `req:next` HEAD-blob 검증 → BLOCKED.
- **phase-5-docs-release** — 문서(워크플로·문제해결 한/영)·CHANGELOG·버전.

## 변경 파일

| Phase | 파일 |
|---|---|
| 1 | `scripts/req/lib/evidence.ts`(신규) · `scripts/req/req-commit.ts` · 관련 테스트 |
| 2 | `scripts/req/lib/evidence.ts` · `scripts/req/req-commit.ts` · `tests/unit/req-commit.test.ts` |
| 3 | `scripts/req/lib/evidence.ts` · `scripts/req/review-codex.ts` · `tests/unit/req-review-codex.test.ts` |
| 4 | `scripts/req/req-new.ts` · `scripts/req/req-next.ts` · `scripts/req/lib/evidence.ts` · `tests/unit/req-next.test.ts` |
| 5 | `docs/*`(한/영) · `CHANGELOG.md` · `package.json` |

각 phase 코드 변경 ≤8파일(D18 권고 충족).

## 하위호환·안전

- **phase 증거 경로 무변경** — `finalizeEvidenceAndConsume`·`expectedArchivePaths`는 건드리지 않는다.
- **`archive_inventory` 부재 = 유효** — 기존 `approvals.jsonl`이 검증에서 깨지지 않는다.
- **marker 부재 티켓은 DONE 동작 불변** — 신규 티켓에만 새 게이트가 붙는다.
- **`req:doctor` 체크 목록 무변경** — 새 FAIL도 새 WARN도 추가하지 않는다.
- **승인 판정 불변** — 커밋 실패가 리뷰 결과·exit code·`design_approved`를 바꾸지 않는다.
- `req-commit.ts`의 기존 export는 re-export로 **시그니처 그대로** 유지되어 외부 참조·테스트가 깨지지 않는다.
