# REQ-2026-045 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity**: phase 1개는 리뷰 가능한 크기(코드 변경 8파일 이하 권고). 초과 시 req:doctor D18 WARN.

> **phase-1 corpus-audit = 완료(pre-committed)**: 근거 `corpus-freeze.md`(커밋 `77a1f81`) — 완전 코퍼스 **9 series·재리뷰 전이 32**·무결성 41/41·승인 8/8 manifest 일치. 별도 코드 없음. **잠긴 근거로 수정하지 않는다.**

## Phase 2 — observability (`phase-2-observability`)

범위: `ReviewCallLogRow`에 측정 지원 필드 추가(`prompt_bytes`·`review_duration_ms`·`previous_findings_count`·`assembled_prompt_sha256`·`review_base_sha`·`review_tree`) + `buildReviewCallLogRow` 값 배선(호출부에서 인자 주입, 순수성 유지) + 라이브 호출부 배선(01-design DEC-3). 전부 개수/해시 — **내용배제 유지**. append-only(하위호환). **게이트 판정·state·exit·`processResponse`·`classifyReview` 미접촉.**

Exit: eslint 0 · typecheck 0 · vitest 그린 · 내용배제 회귀 · 게이트 무변경 회귀 · `prompt_bytes` UTF-8 바이트(비-ASCII 프롬프트 테스트) · Codex phase 리뷰 승인.

## Phase 3 — retrospective-analysis (`phase-3-analysis`)

범위: `03-analysis.md` 신설 — 완전 코퍼스 **32 전이**를 5버킷 태깅(단일 `primary_cause` + `secondary_codes` + `finding_index` 쌍·변경 근거·판정 근거; 불확실=hold) → 잠긴 임계값(freeze §8) 적용 → 분기 결정(**3-값**: 지원됨 / 근거 부족→stateless 유지 / 결론 불가). **선택편향 한계**(freeze §7) 명시, **REQ-032 심층표본** 포함.

⚠️ **DEC-5**: 2인 독립 태깅·adjudication은 사람 단계 → 자율 실행은 **단일 분류기 1차 태깅(PROVISIONAL) + hold 표기**까지. 잠정 산출을 최종 결정으로 종료하지 않는다.

Exit(자율 phase-3): 잠정 태깅표(primary/secondary·hold)·잠정 3-값 분기 문서화 · **"PROVISIONAL — 최종 아님" 명시** · 선택편향 한계 · Codex phase 리뷰 승인.
**REQ 최종 결정 게이트(freeze §8 계약)**: 사람 **2차 독립 태깅 + 필요 시 adjudication**(또는 hold 기반 3-값 확정)이 완료돼야 최종 결정으로 확정. 자율 실행은 잠정 산출 후 여기서 **AWAIT_HUMAN 정지·보고**한다(우회 금지).

## 완료

- 게이트 해당분(unit·typecheck·lint) · `req:doctor` · 사용자 main 머지(별도 승인).
- 산출물 = 측정 계측(코드) + 후속 REQ 선택 결정 기록(문서). **최종 결정은 2인 태깅·adjudication 확정 후**(자율 단일 태거 산출은 잠정). Ledger/도구 위임/resume은 **이 REQ에서 구현하지 않음**.
