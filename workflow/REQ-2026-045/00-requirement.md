# REQ-2026-045 요구사항 — 재리뷰 장기화 원인분류 측정 (resume 판단의 A단계)

## 무엇을 / 왜

CommitGate 재리뷰가 장기화(4R+)되는 **원인을 증거로 분류**하고, 원인에 따라 어느 개선(Review Context Ledger / 검증 도구 위임 / builder 품질·phase 분할 / 사람 disposition)을 후속 REQ로 추진할지 **결정 근거**를 만든다. 부수적으로, 향후 같은 분석을 값싸게 하도록 측정 로그(`.review-calls.jsonl`)에 지원 수치 필드를 추가한다.

**왜**: 같은 REQ 연속 검수에 codex `resume`(세션 유지)을 넣자는 제안이 있었으나 **게이트에는 넣지 않기로 확정**했다 — 리뷰어 입력이 저장소 밖 가변 스레드에 좌우되면 감사·재현이 붕괴하고(격리·증거 성격 위반), goalpost drift는 이미 관측돼 되돌린 결정이며(REQ-2026-013 P4), LLM 리뷰어는 확률적이라 세션 유지가 수렴을 보장하지 않는다. 대신 **먼저 측정**해 장기화의 실제 원인을 알고 원인에 맞는 레버를 고른다. resume은 이 결과와 무관하게 게이트 밖 자문 전용으로만 남는다.

**경계 한 줄**: 이 REQ는 **측정·분석**이다. 게이트 판정·상태 전이·exit code를 바꾸지 않는다.

## 완료 기준 (검증 가능)

1. 원인분류 코퍼스가 freeze되고(완전/불완전 판정·분모 고정) 근거가 `workflow/REQ-2026-045/corpus-freeze.md`(커밋 `77a1f81`, SHA-256 `138098a9…de3b`)에 고정돼 있다. **이 문서는 잠긴 근거로 수정하지 않는다.**
2. `.review-calls.jsonl` 행(`ReviewCallLogRow`)에 측정 지원 필드가 추가되고 값이 실제 해소값과 일치한다(pure-function 단위테스트로 고정). 특히 `prompt_bytes`는 **UTF-8 바이트 길이**(`Buffer.byteLength(…,'utf8')`)로 정의하고 **비-ASCII(한국어) 프롬프트를 포함한 테스트**로 고정한다. 새 필드는 **개수/해시만** — 내용배제 경계 유지.
3. `buildReviewCallLogRow`는 순수 함수로 유지되고 `appendReviewCallLog`는 계속 실패를 삼킨다(측정≠게이트, R8). 로그는 계속 `.gitignore` 대상.
4. 완전 코퍼스의 재리뷰 전이가 5버킷 루브릭으로 태깅되고 **잠긴 임계값**으로 후속 REQ 우선화 결정이 **기계적으로** 도출·문서화된다. 결과는 **3-값**(지원됨 / 근거 부족→stateless 유지 / 결론 불가)이며 **"기각" 결론은 두지 않는다**. 이 최종 결정은 freeze §8이 요구하는 **2인 독립 태깅 + (필요 시) adjudication**을 거친 태깅에서 도출한다 — 자율 실행의 **단일 태거 1차 태깅은 잠정(PROVISIONAL)**이며 그 자체로 REQ 완료를 구성하지 않는다.
5. 게이트 판정·`state` 전이·exit code **무변경**이 회귀로 확인된다.
6. `tsc --noEmit` 0 · eslint 0 · `vitest run` 그린 · `req:doctor` 통과. CommitGate REQ 워크플로 준수(설계 승인 전 구현 금지, 사람 통제점 정지).

## 범위 (MVP)

- **측정 계측(코드)**: `ReviewCallLogRow`에 지원 필드 추가 — `prompt_bytes`·`review_duration_ms`·`previous_findings_count`·`assembled_prompt_sha256`·`review_base_sha`·`review_tree`. 전부 개수/해시.
- **원인분류 분석(문서)**: 완전 코퍼스(freeze 확정)의 재리뷰 전이 32를 5버킷 태깅 → 잠긴 임계값으로 분기 결정.
- 근거 코퍼스(freeze)는 **이미 커밋됨**(phase-1 산출물).

## 비목표 (경계)

- 게이트 판정·`state` 전이·exit code 변경.
- **resume 구현·배선** — C는 게이트 밖 자문 전용(로컬 지속·세션부재 fail-closed·`--last` 금지)이며 이 REQ에서 구현하지 않는다.
- **Review Context Ledger·검증 도구 위임 구현** — 이 REQ는 "무엇을 지을지"의 결정 근거만. 각 레버는 별도 후속 REQ.
- 자동 분류기(정규식/스캐너)로 버킷 판정 — 판단 + 응답 아카이브다(REQ-2026-044 DEC-7 "정적 스캐너 폐기" 상속).
- `approvals.jsonl`·MANIFEST·승인 증거 변경.
- `corpus-freeze.md` 수정(잠긴 근거).

## 근거·불변식

- 실증 근거의 SSOT = `corpus-freeze.md`(커밋됨). 이 REQ 문서는 그 수치를 복제하지 않고 **참조**한다.
- 측정≠게이트: 새 필드·태깅은 로그·문서 층이며 리뷰 판정/exit/state를 좌우하지 않는다.
- 내용배제: 프롬프트·diff·finding **본문**을 로그에 복제하지 않는다(개수/해시만).

## 미결 (→ 01-design DEC)

- **DEC-1**: LOCKED(freeze §8) — 분모 32 전이·우선화 조건표·3-값 결과·primary/secondary 태깅.
- **DEC-2**: 태깅 대상 = 완전 전이 전수 vs 표본.
- **DEC-3**: 새 필드 정확 집합·명칭(로그측정 ⑫⑬⑭ 매핑).
- **DEC-4**: 분석 문서 위치·형식.
- **DEC-5**: 이중 태깅(2인)의 자율실행 처리 — 단일 분류기 + hold vs 사람 2차.
- **DEC-6**: phase 순서(corpus-audit 완료 → observability → analysis).
- **DEC-7**: risk 등급(현재 state=LOW).
