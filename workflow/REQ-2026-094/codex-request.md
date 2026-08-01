# REQ-2026-094 phase-1 리뷰 요청 — 매니페스트 어휘 + 복원 판정(순수)

## 배경

"승인은 실제로 있었는데 매니페스트 행이 비어 버린" 티켓은 하류 전부가 거부해 종결 불가가 된다.
설계는 r03 승인 상태다. 이 phase는 **순수 부분만** 넣는다 — 어휘(매니페스트 `reconstructed` 표시)와
복원 가능성 판정(W1~W4). 사용자에게 보이는 효과는 phase-2(doctor D27 + `--approvals` 배선)에서 붙는다.

## 변경 요약 (4파일 — 코드 2 · 테스트 2)

**`lib/evidence.ts`**
- `MANIFEST_KEYS`에 `reconstructed`·`evidence_basis` 추가(**허용 화이트리스트일 뿐 필수화 아님**).
- 복원 행(`reconstructed:true`) 규칙: `consumed_at`·`user_commit_confirmed`가 **없어야** 하고,
  `evidence_basis`는 비어 있으면 안 된다. phase 전용(design 행 금지).
- 원본 행(부재/`false`) 규칙 **무변경**: 두 필드 여전히 필수 + `evidence_basis` 금지.
- `ManifestEntry`의 `consumed_at`·`user_commit_confirmed`를 선택으로 완화(복원 행 표현용).

**`lib/reconstruct.ts`** — `planApprovalRestore()` 순수 판정 신설. W1(HEAD `approval_evidence`)·
W2(아카이브 blob sha 일치)·W3(tree가 `approved_tree`와 같은 HEAD 조상 커밋이 **정확히 하나**)·
W4(선택 교차검증)가 모두 성립할 때만 후보. 후보 행에는 `consumed_at`·`user_commit_confirmed`가 **없다**.

**테스트** — 어휘/호환 6건 + 판정 표 9건. 전체 스위트 그린(49파일 **2419**건, +15) · typecheck 0.

## 설계 r01 observation 2건 반영

1. **W4 교차검증 강화** — `approved_tree`뿐 아니라 **`consumed_by_commit_sha`가 W3으로 결정된 커밋과
   같은지도** 비교한다. 테스트로 두 방향 모두 고정했다.
2. (phase-2 e2e에서 복원 후 `req:rebind`·완료 경로까지 검증하라는 관찰은 **phase-2에서** 반영한다.
   계획 문서의 가드 목록보다 강한 검증을 넣는 것이라 설계 변경이 아니다.)

## 🔴 설계 문구와 다른 판단 하나 — 확인 부탁

설계 DEC-4a는 "직전 REQ에서 `CLOSE_PROOF_KEYS`가 필수 키 목록을 겸해 지뢰가 있었으니 `validateManifest`가
필수 키를 어떻게 강제하는지 **구현 시 반드시 확인**하라"고 적었다. 확인한 결과 **매니페스트에는 그런
필수 키 루프가 없었다** — `MANIFEST_KEYS`는 순수 화이트리스트이고, 필수성은 필드별 타입 검사
(`if (!isValidIsoInstant(e.consumed_at))` 등)가 만든다. 그래서 키 추가만으로는 기존 행이 깨지지 않는다.

대신 실제 위험은 다른 자리였다: `consumed_at`·`user_commit_confirmed`의 **필드별 검사**가
부재를 무효로 본다. 그 둘을 복원 행에서만 분기시켰다. 회귀 가드 1번이 이것을 고정한다.

## 리뷰 포인트

**P1. 복원 행에서 두 필드를 "부재 허용"이 아니라 "부재 강제"로 했다.** 값이 있으면 거부한다.
근거: 복원본에 `consumed_at`이 있으면 그 값은 반드시 지어낸 것이고, 한 번 기록되면 원본과 구별되지
않는다. 너무 엄격한가? (`--run`으로 복원한 뒤 나중에 진짜 값을 알게 되는 경로가 있는가?)

**P2. `ManifestEntry` 타입 완화의 파급.** `consumed_at`·`user_commit_confirmed`를 optional로 바꿨다.
이 타입을 **읽는** 코드가 그 부재를 견디는가? typecheck는 통과했지만, 런타임에서 `entry.consumed_at`을
무조건 문자열로 쓰는 자리가 있으면 복원 행에서 깨진다. **이것이 이 phase에서 가장 불안한 지점이다** —
전체 스위트는 그린이지만 복원 행이 아직 만들어지지 않으므로 그 경로가 실행되지 않았을 수 있다.
(설계 D3의 불확실성과 같은 것이고, phase-2 e2e가 실증할 예정이다.)

**P3. W3의 전제.** `req:commit`이 인덱스를 커밋하므로 source 커밋의 tree == `approved_tree`라고 봤다.
0개·2개 이상이면 거부한다. 부기 커밋(ledger·state checkpoint)이 사이에 끼면 tree가 달라지므로 충돌
가능성이 낮다고 판단했는데, 빈 phase(코드 변경 0)나 rebase 후 tree 재사용에서 문제가 되는가?

**P4. `evidence_basis`의 내용.** `<ticket>/state.json#approval_evidence` 같은 **경로+앵커** 표기를 썼다.
close-proof는 순수 경로만 쓴다. 앵커를 붙인 것이 어휘를 흐리는가, 아니면 "그 파일의 어느 부분이
근거인지"를 말해 주는 편이 나은가?

**P5. phase 경계.** 이 phase만으로는 사용자 효과가 0이다(어휘와 순수 함수뿐). 리뷰 가능한 단위로
적절한가, 아니면 phase-2와 합쳤어야 하는가?
