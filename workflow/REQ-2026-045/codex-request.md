# REQ-2026-045 리뷰 요청

## 배경

resume(세션 유지 재리뷰)를 게이트에 넣을지 검토 → **무-게이트 확정**(감사·재현 붕괴·drift 재발·LLM 확률성). 대신 재리뷰 장기화의 **원인을 측정**하고 원인별 레버를 후속 REQ로 추진한다. 실증 근거 코퍼스는 `corpus-freeze.md`(커밋 `77a1f81`, SHA `138098a9…de3b`)에 고정·잠금.

## 변경 요약 (설계)

- `00/01/02`: **측정 계측**(`ReviewCallLogRow` 지원 필드 6종·개수/해시) + **원인분류 분석**(완전 코퍼스 32 전이 5버킷 태깅·잠긴 임계값·3-값 결과)의 요구·설계·계획.
- 근거(`corpus-freeze.md`)는 커밋됨(불변). **DEC-1은 freeze §8에 락**.
- phase-1 corpus-audit = 완료(freeze). phase-2 observability(코드) → phase-3 analysis(문서).

## 리뷰 포인트

- **측정≠게이트** 경계·**내용배제**가 설계에 반영됐는가(새 필드가 개수/해시만·게이트/state/exit 무변경·append-only).
- 분석의 **3-값 결과**·**선택편향 한계**·**태깅 스키마**(primary/secondary·finding_index·2인/hold)가 근거(freeze)와 정합하는가.
- **범위**: resume·Review Context Ledger·검증 도구 위임 구현이 비목표로 명확한가.
- DEC-5(자율 태깅 = 단일 분류기 1차 + hold, 2차/조정은 AWAIT_HUMAN)가 타당한가.
