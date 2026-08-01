# REQ-2026-094 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

- `lib/evidence.ts` — `MANIFEST_KEYS`(허용키 화이트리스트) · `validateManifest`(모르는 키 거부) ·
  `evidencedPhaseIdsFromManifest`. 🔴 **이 REQ는 여기에 진단용 순수 술어 하나만 더한다.**
- `lib/reconstruct.ts` — 복원 가능성 매트릭스(순수). 범위가 **close-proof 한정**이고
  "HEAD-committed immutable evidence가 행의 **모든** 필드를 명확·모호없이 결정할 때만" 낸다.
  🔴 승인 행은 그 조건을 **만족시킬 수 없다**(DEC-3) — 그래서 이 모듈은 손대지 않는다.
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

두 종류의 승인 증거를 본다(둘 다 HEAD-committed `state.json`에서). 🔴 **확실성이 서로 다르다** —
경고 근거로 쓸 수 있는 것은 첫 번째뿐이다(DEC-1a).

| 증인 | 뜻 | 매니페스트 행이 없으면 |
|---|---|---|
| `consumed_approvals[]`에 P 항목 | 도구가 P의 승인을 **소비**했다 | 🔴 확정 불일치 — 소비는 evidence-finalize **뒤**에만 일어난다 |
| `approval_evidence.phase_id === P` | P의 승인이 **미소비 상태로 커밋**됐다 | ⚠️ **모호** — 아래 DEC-1a |

### 🔴 DEC-1a — 진단은 `consumedWithoutRow` **하나만** 경고한다 (phase-2 실측 후 정정)

설계 초안은 "두 신호 모두 정상 진행 중에는 생기지 않으므로 오탐 0이 구조적으로 보장된다"고 적었다.
**그 주장은 틀렸다.** 이 저장소의 실제 커밋으로 반증했다.

REQ-2026-092의 `a3b4c99`(`req:confirm` state checkpoint — **완전히 정상인 진행 중 커밋**)에서:

```
approval_evidence : SET (phase-2-docs, kind=phase)
매니페스트 phase 행: phase-1-staged-guard 뿐
→ pendingWithoutRow = ['phase-2-docs']   ← 정상인데 경고가 뜬다
```

원인은 우리가 **권장하는 순서** 그 자체다: HIGH 티켓은 마지막 phase 리뷰 **전에** `req:confirm`을
돌려야 D9 stale을 피하는데(REQ-2026-092 실측), 그 체크포인트가 미소비 `approval_evidence`를 커밋한다.

HEAD만 보고 "진행 중"과 "유실"을 구별할 방법이 없다. 그래서 **비대칭**으로 간다.

| 신호 | 진단(D27) |
|---|---|
| `consumedWithoutRow`(확정) | ✅ 경고 |
| `pendingWithoutRow`(모호) | ❌ **침묵** |

진단은 확실할 때만 말해야 한다 — 정상 워크플로에서 뜨는 경고는 곧 무시되고, 그러면 진짜 신호도 함께
묻힌다. (초안은 이 침묵을 "복원 명령이 대신 본다"로 보완하려 했으나 DEC-3에서 복원 자체가 폐기됐다.
`pendingWithoutRow`는 이제 **어디에도 쓰이지 않으므로 술어에서 제거**한다 — 죽은 신호를 남기지 않는다.)

### DEC-2 — doctor는 **WARN**이지 FAIL이 아니다 (D27)

FAIL로 두면 doctor가 게이트라 `req:commit`이 막힌다. 그런데 이 상태의 티켓은 **이미** 막혀 있고,
반대로 이 검사가 오작동하면 **건강한 저장소를 새로 브릭**한다. 진단이 스스로 새 교착을 만들면 안 된다.

전례가 같은 방향이다: D20(자산 skew)·D24(setup 마커)가 WARN이다. 그리고 REQ-2026-084의 `block` 기본값이
0.13.1에서 `warn`으로 정정된 이력이 있다 — 진행을 막는 기본값은 비쌌다.

메시지는 **무엇이 어긋났는지 + 다음에 할 수 있는 일**을 함께 낸다(R4: 막다른 길 없음).

### 🔴 DEC-3 (개정) — 복원은 **하지 않는다.** 정직하게 불가능하다

초안의 DEC-3~DEC-7(복원 조건 W1~W4 · `reconstructed` 어휘 · `--approvals` 명령 · 승인 미부여 ·
거부 안내)은 **전부 철회한다.** 근거는 `00-requirement.md` §2.2의 실측이다.

두 증인이 **상호 배타적**이다 — `consumeState`가 소비와 동시에 `approval_evidence` 키를 제거한다.

| 상태 | 가진 증인 | 왜 복원 불가 |
|---|---|---|
| **소비됨**(D27이 잡는 유실) | `consumed_approvals`만 | `approved_at`·`response_path`·`response_sha256`이 **영구 소실** — 지어내야 한다 |
| **미소비**(손커밋) | `approval_evidence`만 | 게이트 통과를 증명할 수 없다 → 행을 쓰면 **fail-closed 우회로**(R6 위반) |

설계 r03 P1이 두 번째 칸을 지목했다: 미소비 증거로 매니페스트 행을 쓰면, 정상 HIGH 티켓에서
`req:confirm` 체크포인트가 남긴 pending evidence만으로도 "완료된 phase"가 기록된다.
`req:commit`을 거치지 않은 승인이 완료 증거가 되는 것이라, **정상 지원 명령이 게이트 우회로가 된다.**

이것은 고칠 수 있는 결함이 아니라 **증거 모델의 의도된 성질**이다. 매니페스트 행이 유일한 durable
기록이고 `approval_evidence`는 그 행이 생기면 역할이 끝나 지워진다. 행을 잃으면 정보가 사라진다.

**그래서 이 REQ는 진단만 남긴다.** 유실된 승인의 정직한 해법은 둘뿐이고, 진단이 그것을 안내한다:

1. 그 phase를 **게이트를 통해 다시 수행**한다(진짜 증거가 새로 생긴다).
2. 끝낼 수 없으면 **`req:close --abandon`**(REQ-2026-093에서 배포)으로 종결한다.

### DEC-3a — phase-1이 넣은 복원 어휘를 **되돌린다**

phase-1(`f172505a`)이 매니페스트에 `reconstructed`·`evidence_basis`를 더하고 `planApprovalRestore`를
만들었다. 쓰는 곳이 없어졌으므로 **제거**한다 — 쓰이지 않는 신호를 남기면 죽은 기능이 되고, 다음 사람이
"복원할 수 있나 보다"라고 오해한다(REQ-2026-093에서 발견한 `human-resolution` 미배선과 같은 함정).

🔴 **제거가 안전한 이유**: phase-1은 feature 브랜치에만 있고 **배포된 적이 없다.** 어떤 소비자 저장소에도
그 키를 가진 커밋된 행이 존재하지 않으므로, 화이트리스트에서 빼도 기존 행이 거부되지 않는다.
(릴리스 후였다면 스키마 축소는 금지다 — 옛 행이 "알 수 없는 키"로 거부돼 fail-closed가 된다.)

## Phase별 구현

`02-plan.md` 참조. phase-1(커밋됨) = 복원 어휘·판정 — **DEC-3a에 따라 phase-2에서 되돌린다**.
phase-2 = 진단 술어 + D27 + phase-1 되돌리기. phase-3 = 문서.

## 변경 파일

| phase | 파일 | 내용 |
|---|---|---|
| 1 (커밋됨) | `lib/evidence.ts`·`lib/reconstruct.ts` + 테스트 | 복원 어휘·판정 — **phase-2가 되돌린다**(DEC-3a) |
| 2 | `scripts/req/lib/evidence.ts` | `approvalWitnessMismatch` 진단 술어 **추가** + phase-1 복원 어휘 **제거** |
| 2 | `scripts/req/lib/reconstruct.ts` | `planApprovalRestore` **제거**(원복) |
| 2 | `scripts/req/req-doctor.ts` | D27 WARN(DEC-1·1a·2) + 정직한 안내(DEC-3) |
| 2 | `tests/unit/req-doctor.test.ts`·`evidence-module.test.ts`·`reconstruct.test.ts` | D27·오탐 대조군·원복 |
| 3 | `docs/troubleshooting.md`·`.en.md` · `CHANGELOG.md` | 문서 |

## 하위호환·안전

- 🔴 **최종 순변화는 읽기 전용 진단 하나뿐**이다. 매니페스트 어휘·검증·게이트는 **한 글자도 바뀌지
  않는다**(R5) — phase-1이 넣은 것을 phase-2가 되돌리기 때문이다.
- **doctor는 WARN만** 추가한다 — 새로 막히는 것이 없다(DEC-2).
- **쓰기 명령을 하나도 추가하지 않는다.** 이 REQ는 아무것도 커밋하지 않는다.
- 스키마 파일 변경 없음 → `commitgate sync` 불요.
- phase-1의 어휘 제거는 **배포 전**이라 안전하다(DEC-3a).
