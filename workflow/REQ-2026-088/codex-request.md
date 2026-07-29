# REQ-2026-088 리뷰 요청

## 배경

소비 repo(yammy) 0.13.1 감사에서 나왔다. `REQ-2026-086`이 설계를 3회 승인받으면서 앞선 두 phase가
**옛 design_ref에 묶인 채** 남았다. `computeDevCompleteProof`는 모든 phase가 현재 design_ref에 결속돼야
발행하므로, 남은 phase를 마쳐도 티켓이 닫히지 않고 다음 `req:new`까지 막힌다.

🔴 그런데 **판정에 필요한 데이터는 이미 커밋된 매니페스트에 전부 있는데** `req:next`는 아무 말도 하지 않는다.
벽에 부딪힌 뒤에야(=`req:new`가 차단될 때) 알게 된다. REQ-2026-085의 D25와 같은 병이다.

## 변경 요약

**알리는 시점만** 추가한다. 판정 술어(`splitUnboundPhases`)와 안내 생성기(`recoveryGuidance`)는
이미 있는 것을 **그대로** 쓴다.

- `req:next`: 액션(`kind`/`detail`/`command`)은 **건드리지 않고** `diagnostics`에만 안내를 얹는다.
- `req:doctor`: D26(WARN 상한).

## 리뷰 포인트

- 🔴 **아무것도 막지 않는가**: `req:next`의 `kind`가 어떤 경우에도 바뀌지 않는가. D26이 어떤 입력에서도 FAIL이 아닌가. 진행 중 결속이 끊긴 것은 그 자체로 오류가 아니다 — 막으면 REQ-2026-087이 되돌린 실수(진행을 막는 정지)의 반복이고, D26이 FAIL이면 **재결속에 필요한 남은 phase를 커밋조차 못 하는 교착**이 된다.
- **재구현 금지**: 판정·안내가 intake·`req:close --migrate`와 **같은 함수**에서 나오는가. 별도 구현이면 REQ-2026-072가 고친 "한쪽이 권한 명령을 다른 쪽이 거부" 상태가 재발한다.
- **판정 원천**: 커밋된 매니페스트(HEAD blob)를 보는가. 워킹트리 사본은 evidence-finalize 도중일 수 있다.
- **노이즈**: 결속이 온전한 티켓에 문구가 **하나도** 추가되지 않는가. 항상 뜨는 안내는 무시된다.
- **레거시 처리**: `phase_design_ref`가 없는 phase에 `req:rebind`를 권하지 않는가(막다른 길 추가 금지) — `recoveryGuidance`의 migrate 분기에 위임했는가.
- **무회귀**: `committedManifestText` 미지정(legacy 호출)이면 현행과 완전히 동일한가. `resolveNextCore`로 옮긴 본문이 로직 변경 없이 이름만 바뀌었는가.
