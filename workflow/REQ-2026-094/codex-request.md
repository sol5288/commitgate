# REQ-2026-094 phase-2 리뷰 요청 — 진단(D27) + phase-1 복원 어휘 원복

## 배경

설계 r03 P1이 복원 명령의 fail-closed 우회로를 지목했고, 조건을 조이다 **복원 자체가 정직하게
불가능함**이 확정됐다(두 증인의 상호 배타성 — `consumeState`가 소비와 동시에 `approval_evidence`를
제거한다). 사용자가 **진단만 남기고 복원 폐기**를 결정했고, 설계는 r04로 재승인됐다.

이 phase는 **한 커밋 안에서** 두 가지를 한다: 진단(D27)을 넣고, phase-1(`f172505a`)이 넣은
복원 어휘를 **되돌린다**(설계 r04 observation이 같은 커밋에서 끝내라고 요구).

## 변경 요약 (6파일)

**`lib/evidence.ts`**
- `consumedApprovalsWithoutRow()` 진단 술어 **추가** — "소비 기록은 있는데 매니페스트 행이 없는 phase".
- phase-1이 넣은 `reconstructed`·`evidence_basis` 어휘와 복원 행 검증 분기 **제거**(원복).

**`lib/reconstruct.ts`** — `planApprovalRestore` 및 관련 타입·import **제거**(원복).

**`req-doctor.ts`** — **D27 WARN**. 안내가 **정직한 두 경로**만 준다(phase 재수행 / `req:close --abandon`).
🔴 존재하지 않는 복원 명령을 언급하지 않는다.

**테스트 3파일** — phase-1 테스트 원복 + D27 가드 4건.

## 원복 완결성 (실측)

| 확인 | 결과 |
|---|---|
| `MANIFEST_KEYS`의 `reconstructed`·`evidence_basis` | **0건** |
| `planApprovalRestore` (lib·CLI) | **0건** |
| `--approvals` 플래그 | **없음** |
| `req-reconstruct.ts`의 `approvals` 문자열 | 1건 — `approvals.jsonl` 경로(정상) |

전체 스위트 그린(49파일 **2408**건) · typecheck 0 · 이 저장소 `req:doctor`에서 `OK D27`(오탐 없음).

## 🔴 이 phase의 핵심 계약

**최종 순변화는 읽기 전용 진단 하나뿐이다.** 매니페스트 어휘·검증·게이트는 phase-1 이전과 동일하다.
쓰기 명령을 하나도 추가하지 않는다.

## 리뷰 포인트

**P1. 원복이 완전한가.** phase-1이 만든 것 중 남은 것이 있는가? 특히 `ManifestEntry` 타입의
`consumed_at`·`user_commit_confirmed` optional 완화가 되돌아갔는지(필수로 복귀) 봐 달라.
남으면 복원 행이 없는데 타입만 느슨해져 **런타임 계약이 조용히 약해진다.**

**P2. D27의 신호가 정말 "확정"인가.** `consumeState`는 `finalizeEvidenceAndConsume` 안에서 매니페스트
append **뒤에** 호출된다. 따라서 "소비 기록 있음 + 행 없음"은 증거 유실이라고 봤다. 이 추론이
깨지는 정상 경로가 있는가? (`--finalize` 복구 경로·멱등 재시도에서 순서가 달라지는가?)

**P3. 안내 문구가 정직하면서도 과하지 않은가.** "이 기록은 복구할 수 없습니다"라고 단정하고
이유를 붙였다. 사용자가 도구 결함으로 오해하지 않겠는가? 반대로 너무 단정적이어서 실제로는 가능한
경로(예: reflog·백업)를 막지는 않는가?

**P4. 테스트가 "말하지 않는 것"을 고정하는가.** 가드 4번이 `req:reconstruct`·`--approvals` 문자열이
메시지에 **없음**을 단언한다. 부재를 단언하는 테스트가 적절한가, 아니면 취약한가?

**P5. 술어의 조회 범위.** `evidencedPhaseIdsFromManifest`를 **design 결속 인자 없이** 부른다.
"행이 있기라도 한가"만 묻기 때문이고 결속은 D26 소관이라고 봤다. 이 분업이 맞는가?

**P6. phase-1 커밋이 이력에 남는 것.** 되돌렸지만 `f172505a`는 히스토리에 있다. 나중에 이력을 읽는
사람이 "복원 기능이 있었다가 사라졌다"고 오해할 수 있다. CHANGELOG(phase-3)에서 어떻게 다루는 것이
좋은가 — 아예 언급하지 않는 편이 나은가, 아니면 폐기 이유를 남기는 편이 나은가?
