# REQ-2026-013 리뷰 요청 (R15 — 범위 재설정: P1+P4만)

## 배경

다운스트림 2차 요청서로 착수. 리뷰 codex 호출이 전역 `ultra`를 상속해 11~13분·토큰 과다·수렴 안 됨. 원인 P1~P4를 코드에서 대조·실측 확정.

**범위 재설정(R14 후)**: 설계 리뷰 14라운드에서 지적이 전부 **P2(timeout)·P3(오류 진단)** 에 집중됐다 — Windows `cmd.exe` wrapper의 프로세스-트리 종료, 비밀-안전 오류 추출이 본질적으로 어렵다. 반면 **P1(모델 고정)·P4(stateless)는 안정**적이고 다운스트림 핵심 고통을 해결한다. 그래서 **P2·P3을 후속 REQ로 분리**하고 이번은 **P1+P4만** 출하한다. (P2/P3의 R1~R14 설계 작업은 이 REQ git 이력에 보존.)

## 변경 요약 (config 키 2)

- **P1 모델·추론강도 고정**: config `reviewModel`(slug, 기본 `gpt-5.6-terra`)·`reviewReasoningEffort`(enum `minimal|low|medium|high|xhigh`+null, 기본 `high`). codex 인자 exec·resume 양쪽에 `-c model=`·`-c model_reasoning_effort=` 주입. `null`=전역 상속 탈출구(`!== undefined` 병합 보존). override 존중은 bogus-model live 검증.
- **P4 재리뷰 stateless**: `isResume=false`(항상 새 스레드), 무조건 `previous_codex_result` 라인 제거(대상-무관 오염), 직전 same-target NEEDS_FIX findings를 bounded 스냅샷으로 `state.last_review`에 additive 기록·주입(승인 경계·read 검증·G2 marker 보존).

## 리뷰 포인트

1. **범위 분리의 타당성**: P2(timeout)·P3(오류 진단)을 후속으로 분리하고 P1+P4만 출하하는 것이 맞는가? P1이 핵심(전역 ultra 상속)을 해결하고, timeout 없는 부트스트래핑을 사람 감시로 커버하는 것이 수용 가능한가?
2. **`-c` 주입·null 병합**: exec·resume 양쪽 `-c` 주입, `!== undefined` 병합으로 null 탈출구, enum에 null 포함이 견고한가?
3. **stateless 연속성**: 무조건 `previous_codex_result` 제거 + same-target 게이팅 스냅샷만으로 대상 간 오염이 없고 closure가 유지되는가?
4. **`last_review` additive**: 기존 marker(compare_hash 등) 보존 + findings/elided_count additive가 `req:next` G2를 불변으로 두는가? read 시점 검증·경계가 충분한가?
5. **override 존중 검증**: bogus-model live(exec·resume)가 "도구가 인자를 넘김"을 넘어 "codex가 존중함"을 증명하는 올바른 방법인가?

## 확정된 방향 (사용자)

범위 = P1+P4(P2·P3 후속) · D3 코어 기본 gpt-5.6-terra 유지 · D4 공식 enum+null · stateless 전용(resume opt-in 후속).
