# REQ-2026-094 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

- `lib/evidence.ts` — `MANIFEST_KEYS`(허용키 화이트리스트) · `validateManifest`(모르는 키 거부) ·
  `parseManifestEntries` · `evidencedPhaseIdsFromManifest`. **`reconstructed` 표시가 없다** —
  복원된 행이 원본으로 위장된다.
- `lib/close-proof.ts` — 대조군. `reconstructed`+`evidence_basis`로 원본/복원본을 **이미 구별**한다.
- `lib/reconstruct.ts` — 복원 가능성 매트릭스(순수). 범위가 **close-proof 한정**이고
  "HEAD-committed immutable evidence가 행의 **모든** 필드를 명확·모호없이 결정할 때만" 낸다.
- `req-doctor.ts` — D26이 **매니페스트에 행이 있는 phase만** 결속을 본다. 행 자체가 없는 phase는 안 본다.
- `req-commit.ts` `consumeState` — `consumed_approvals[]`에 `{approved_tree, phase_id,
  consumed_by_commit_sha, approval_consumed_at}`를 append하고 `approval_evidence`를 **제거**한다.

## 핵심 설계 결정

### DEC-1 — 신호는 "증인 불일치"다. `missingPlanned`가 아니다

리포트는 `close-migrate`의 `missingPlanned`(계획된 phase 중 증거 없는 것)를 doctor에 넣자고 제안했다.
**채택하지 않는다** — 진행 중인 정상 티켓은 미래 phase에 증거가 없는 것이 **정상**이라 전부 오탐이 된다.
그 술어는 "이 티켓이 완료를 주장할 자격이 있는가"를 묻는 **종결 시점 전용**이다.

대신 **어느 시점에도 비정상인 사실**을 신호로 쓴다.

> **phase P에 대해 "승인이 있었다"는 HEAD 증거가 있는데, HEAD 매니페스트에 P의 승인 행이 없다.**

두 종류의 승인 증거를 본다(둘 다 HEAD-committed `state.json`에서).

| 증인 | 뜻 | 매니페스트 행이 없으면 |
|---|---|---|
| `consumed_approvals[]`에 P 항목 | 도구가 P의 승인을 **소비**했다 | 🔴 확정 불일치 — 소비는 evidence-finalize **뒤**에만 일어난다 |
| `approval_evidence.phase_id === P` | P의 승인이 **미소비 상태로 커밋**됐다 | ⚠️ 비정상 — 정상 경로에서는 소비 전 state를 커밋하지 않는다 |

정상 진행 중 티켓은 둘 중 어느 것도 만들지 않는다(승인 직후 `state.json`은 dirty scratch이고,
`req:commit`이 매니페스트와 소비 기록을 **함께** 커밋한다). → **오탐 0**이 구조적으로 보장된다.

### DEC-2 — doctor는 **WARN**이지 FAIL이 아니다 (D27)

FAIL로 두면 doctor가 게이트라 `req:commit`이 막힌다. 그런데 이 상태의 티켓은 **이미** 막혀 있고,
반대로 이 검사가 오작동하면 **건강한 저장소를 새로 브릭**한다. 진단이 스스로 새 교착을 만들면 안 된다.

전례가 같은 방향이다: D20(자산 skew)·D24(setup 마커)가 WARN이다. 그리고 REQ-2026-084의 `block` 기본값이
0.13.1에서 `warn`으로 정정된 이력이 있다 — 진행을 막는 기본값은 비쌌다.

메시지는 **무엇이 어긋났는지 + 다음에 할 수 있는 일**을 함께 낸다(R4: 막다른 길 없음).

### DEC-3 — 복원의 필수 조건: 필드를 **하나도 지어내지 않는다**

`00-requirement.md` §2가 실측으로 보인 것: `consumed_approvals` 중심의 3증인만으로는 `approved_at`을
**지어내야** 한다. 그래서 1차 증인을 바꾼다 — **HEAD-committed `state.json.approval_evidence`** 다.
그것이 승인 절반(`response_path`·`response_sha256`·`review_base_sha`·`approved_tree`·
`phase_design_ref`·`approved_at`)을 **원본 값 그대로** 담는다.

복원은 다음이 **모두** 성립할 때만 낸다.

| # | 증인 | 결정하는 것 |
|---|---|---|
| **W1** | HEAD `state.json.approval_evidence` (kind=phase, phase_id=P) | 승인 절반 전부 |
| **W2** | HEAD에 `W1.response_path` 아카이브가 있고 그 blob의 sha256 == `W1.response_sha256` | 아카이브 실재·무결성 |
| **W3** | tree가 `W1.approved_tree`와 같은 **HEAD 조상 커밋이 정확히 하나** | `consumed_by_commit_sha` |
| **W4**(선택) | `consumed_approvals[]`의 P 항목 | 있으면 W1·W3와 **일치해야** 한다(교차검증) |

W3이 핵심이다 — `req:commit`은 인덱스를 커밋하므로 source 커밋의 tree가 곧 `approved_tree`다.
**검증 가능한 사실**이지 추정이 아니다. 0개·2개 이상이면 **거부**한다(모호하면 복원하지 않는다).

**결정되지 않는 것이 둘 남는다**: `consumed_at`(소비가 일어난 적이 없거나 시각이 유실) ·
`user_commit_confirmed`. → DEC-4.

### DEC-4 — 복원 행은 `reconstructed`로 표시하고, **모르는 필드는 비운다**

`MANIFEST_KEYS`에 `reconstructed`·`evidence_basis`를 더한다(close-proof와 **같은 어휘**).

- 복원 행: `reconstructed: true` + 비어있지 않은 `evidence_basis`(경로·식별자 목록, 본문 없음).
- 🔴 그 행에 한해 `consumed_at`·`user_commit_confirmed`의 **부재를 허용**한다.
  값을 넣으면 거짓이 된다 — 복원 시각을 `consumed_at`으로 쓰는 것은 "언제 소비됐는가"에 대한 **오답**이다.
  **모른다는 것을 모른다고 기록**하는 편이 정확하다.
- 원본 행(`reconstructed` 부재 또는 `false`)의 규칙은 **하나도 바뀌지 않는다** — 두 필드 여전히 필수.

#### 🔴 DEC-4a — 기존 커밋 행 호환 (REQ-2026-093 DEC-3a와 같은 함정)

`MANIFEST_KEYS`는 **허용 화이트리스트**이고 `validateManifest`는 모르는 키를 거부한다. 새 키 2개는
**선택**이며 **키가 아예 없는 기존 커밋 행은 그대로 유효**해야 한다. 직전 REQ에서 같은 자리에 지뢰가
있었다(`CLOSE_PROOF_KEYS`가 필수 키 목록을 겸해, 그냥 추가하면 기존 행이 전부 invalid가 됐다).
`validateManifest`가 필수 키를 어떻게 강제하는지 **구현 시 반드시 확인**하고, 부재==미복원본으로 읽는다.

### DEC-5 — 명령은 `req:reconstruct`를 **확장**한다(새 verb 아님)

이미 "HEAD 증거로 결정될 때만 복원"이라는 원칙과 dry-run 기본·`reconstructed:true` 강제를 갖고 있다.
같은 원칙의 두 번째 대상이므로 어휘를 나누지 않는다. `--approvals`로 대상을 지정한다
(기본은 현행 close-proof — 무회귀).

### DEC-6 — 복원은 승인을 **부여하지 않는다**(R6)

복원 행은 `commit_allowed`·`approved_diff_hash`를 건드리지 않는다. 매니페스트에 **기록을 옮겨 적을 뿐**이며,
그 뒤 티켓은 정상 게이트(`req:rebind`·완료 판정)를 그대로 통과해야 한다. 복원이 게이트 우회로가 되면
이 도구의 존재 이유가 사라진다.

### DEC-7 — 복원 불가일 때 **다음 행동을 준다**(R4)

거부 메시지는 (i) 어느 증인이 없는지 정확히 지목하고, (ii) `req:close --abandon`(REQ-2026-093에서 배포)을
탈출구로 안내한다. "복원할 수 없습니다"로 끝나면 리포트가 지적한 막다른 길이 그대로 남는다.

## Phase별 구현

`02-plan.md` 참조. phase-1 = 매니페스트 어휘 + 순수 술어, phase-2 = doctor D27 + 명령 배선, phase-3 = 문서.

## 변경 파일

| phase | 파일 | 내용 |
|---|---|---|
| 1 | `scripts/req/lib/evidence.ts` | `reconstructed`·`evidence_basis` 어휘 + 복원 행 검증 규칙(DEC-4·4a) |
| 1 | `scripts/req/lib/reconstruct.ts` | 승인 행 복원 가능성 판정(순수, W1~W4) |
| 1 | `tests/unit/evidence-module.test.ts`·`reconstruct.test.ts` | 어휘·호환·판정 표 |
| 2 | `scripts/req/req-doctor.ts` | D27 WARN(DEC-1·2) |
| 2 | `scripts/req/req-reconstruct.ts` | `--approvals` 배선 + 거부 안내(DEC-5·7) |
| 2 | `tests/unit/req-doctor.test.ts`·`reconstruct.test.ts` | 실 git e2e·오탐 대조군 |
| 3 | `docs/troubleshooting.md`·`.en.md` · `CHANGELOG.md` | 문서 |

## 하위호환·안전

- **순수 추가**다. 기존 매니페스트 행·검증·게이트는 무변경(R5). 새 키 2개는 선택이고 부재가 정상이다.
- **doctor는 WARN만** 추가한다 — 새로 막히는 것이 없다(DEC-2).
- **복원은 기본 dry-run**이고, 증인이 완비되지 않으면 아무것도 쓰지 않는다.
- 스키마 파일 변경 없음 → `commitgate sync` 불요.
- 🔴 **옛 버전이 복원 행을 만나면** `validateManifest`가 모르는 키(`reconstructed`)를 거부해 그 티켓을
  corrupt로 본다 → fail-closed. 다운그레이드는 지원 대상이 아니지만 방향이 안전 쪽임을 확인해 둔다.
