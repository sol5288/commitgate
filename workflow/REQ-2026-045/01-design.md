# REQ-2026-045 설계 — 재리뷰 장기화 원인분류 측정

> 정본 결정은 SSOT: `corpus-freeze.md`(커밋 `77a1f81`) §3·§8. 본 문서는 그 결정을 코드/문서에 어떻게 반영할지 기록한다. freeze의 수치·규칙은 **복제하지 않고 참조**한다.

## 현재 상태 (변경 대상)

- `ReviewCallLogRow`(`scripts/req/review-codex.ts:564`) — 현 필드: `ticket_id·review_kind·phase_id·archive_round·outcome·findings_count·observations_count·timestamp·policy_version·review_model·review_reasoning_effort`. **내용배제 경계**(`review-codex.ts:585`): `findings[].detail`·`observations[].detail`·`next_action`·`file` 등 **본문은 담지 않는다**(개수만).
- `buildReviewCallLogRow`(`review-codex.ts:592`) — 순수 함수(verdict + 컨텍스트 → 행, 개수만 추출).
- `appendReviewCallLog`(`review-codex.ts:620~`) — **실패를 삼킨다**(측정≠게이트, R8). 로그는 `.gitignore`(`workflow/.review-calls.jsonl`).
- 라이브 호출부(`review-codex.ts:1905~`): 프롬프트 조립(`assembleReviewPrompt`)·`.review-preview.txt` 기록·`callReviewer`·`reviewBaseSha`·`reviewTree` 이미 계산됨 → 새 필드 값의 **원천이 이미 그 자리에 있다**.
- 근거: `corpus-freeze.md`(커밋됨) — 완전 코퍼스 **9 series·재리뷰 전이 32**·무결성 41/41·승인 8/8 manifest 일치·`review_base_sha` series 내 불변.

## 핵심 설계 결정

### DEC-1 — LOCKED (freeze §8, 재확인)
분모 = **검증된 eligible 전이 32**. 후속 REQ **우선화 조건**(자동 구현 트리거 아님): B(②≥8/32 & target≥3) / oracle(③b≥8/32 & 최빈) / builder(①+③a≥17/32) / ④(≥4/32 & target≥2) / **inconclusive(coverage<24/32)**. 결과 **3-값, "기각" 금지**(absence≠evidence of absence, 선택편향 하). 태깅행 = **단일 `primary_cause` + 복수 `secondary_codes`** + `origin_response_sha`+finding_index → 후속 response_sha+finding_index · 변경 근거 · 판정 근거 1~2문장 · 2인 라벨 · 제3검토자/hold. **finding-content-blinded**(태깅 착수 前 락 — 이미 완료).

### DEC-2 — 태깅 대상
완전 전이 **전수(32)**. 소규모라 표본 불필요.

### DEC-3 — 새 로그 필드 (측정 계측; 전부 개수/해시, 내용배제 유지)
| 필드 | 타입 | 원천 | 의미 |
|---|---|---|---|
| `prompt_bytes` | number | `Buffer.byteLength(assembledPrompt, 'utf8')` | 조립 프롬프트 **UTF-8 바이트** 길이(내용 아님). ⚠️ JS `.length`=UTF-16 code unit이라 비-ASCII(한국어) 프롬프트에서 바이트≠length → 반드시 `Buffer.byteLength(…,'utf8')` |
| `review_duration_ms` | number | `callReviewer` 직전~직후 경과 | codex 호출 소요 |
| `previous_findings_count` | number | `previousFindingsToClose` 스냅샷 findings 수(없으면 0) | 전달한 직전 finding 수 |
| `assembled_prompt_sha256` | string | 조립 프롬프트 SHA-256 | 전송 프롬프트 **동일성 표지**(원문 미복제) |
| `review_base_sha` | string \| null | `reviewBaseSha` | 재구성 좌표(리뷰 바인딩) |
| `review_tree` | string \| null | `reviewTree`(staged tree OID) | 재구성 좌표 |

- 로그측정 백로그 **⑫⑬⑭** 정렬: ⑫=`prompt_bytes`, ⑬=`review_duration_ms`, ⑭=`previous_findings_count`(정확 매핑은 리뷰서 확정).
- **정직성**: 이 필드들은 "완전 재현성"이 아니라 **진단·재구성 보조**다(LLM 리뷰어 확률적·diff 밖 파일도 읽음). **승인 증거로 승격하지 않는다** — 로그는 계속 측정 전용·gitignore·fail-closed.

### DEC-4 — 분석 문서
`workflow/REQ-2026-045/03-analysis.md`(phase-3 신규). `corpus-freeze.md`=불변 근거, `03-analysis`=태깅·결정.

### DEC-5 — 이중 태깅의 자율 실행
2인 독립 태깅 + 제3검토자/hold가 원칙(freeze §8). 자율 실행에서 태거-1 = 이 에이전트, **태거-2·adjudication은 사람 단계**. → phase-3 자율 산출 = **단일 분류기 1차 태깅 + 명시적 hold 플래그**(불확실=primary 미확정)와 잠긴 임계값 적용의 **잠정(PROVISIONAL) 결정**. 자율 산출은 **PROVISIONAL로 명시**하고, **REQ 완료 게이트 = 사람 2차 독립 태깅 + adjudication(또는 hold 기반 3-값 확정)**이다 — 잠정 산출을 최종 결정으로 종료하지 않는다(완료 기준·잠긴 절차 계약). 2차 태깅/조정이 필요한 판단 지점은 잠정 산출 후 **AWAIT_HUMAN으로 정지·보고**(우회 금지).

### DEC-6 — phase 순서
`phase-1 corpus-audit` = **완료**(`corpus-freeze.md` 커밋). `phase-2 observability`(코드) → `phase-3 analysis`(문서). 임계값은 freeze §8에 이미 락(cohort 크기는 outcome-neutral).

### DEC-7 — risk
**LOW**(측정층·게이트/state/exit 무변경·append-only 필드). `state.json` risk_level=LOW 유지.

## Phase별 구현

- **phase-2-observability**: `ReviewCallLogRow` 인터페이스에 DEC-3 필드 추가 → `buildReviewCallLogRow`가 호출부에서 전달받아 채움(순수성 유지, 새 인자로 주입) → 라이브 호출부에서 `prompt_bytes`·duration·prompt_sha·base/tree 전달 → 단위테스트(필드 고정·**내용배제 회귀**·측정≠게이트 회귀).
- **phase-3-analysis**: `03-analysis.md`에 32 전이 태깅(primary/secondary·finding_index·근거) → 잠긴 임계값 → 분기 결정(3-값). **선택편향 한계**(freeze §7) 명시, **REQ-032 심층표본** 포함. (DEC-5: 자율=1차 태깅+hold.)

## 변경 파일

- `scripts/req/review-codex.ts` — `ReviewCallLogRow`·`buildReviewCallLogRow`·라이브 호출부 배선. **게이트 판정·state 전이·exit code·`processResponse`·`classifyReview`는 무변경.**
- 테스트(해당 spec) — 새 필드 pure-fn 고정 + 내용배제 회귀 + 게이트 무변경 회귀.
- `workflow/REQ-2026-045/03-analysis.md` — phase-3 신규.

## 하위호환·안전

- 로그 필드 추가는 **append-only** — 로그는 gitignore·**비계약**(외부 소비자 없음)이라 기존 파싱 무영향.
- `buildReviewCallLogRow` **순수성 유지**(새 값은 인자로), `appendReviewCallLog` **실패 삼킴 유지**.
- 게이트 판정·`state` 전이·exit code **무변경** — 회귀 테스트로 확인(리뷰 판정 경로 미접촉).
- 새 필드는 **개수/해시만** — 내용배제 회귀로 프롬프트·finding 본문 미포함 확인. `assembled_prompt_sha256`·`prompt_bytes`는 원문을 로그에 남기지 않는다(해시·길이만).
- `previous_findings_count`는 스냅샷 **개수**만(본문 아님).
- `prompt_bytes`는 **UTF-8 바이트**(`Buffer.byteLength(…,'utf8')`) — JS `.length`(UTF-16 code unit)와 다르므로 **비-ASCII(한국어) 프롬프트를 포함한 pure-fn 테스트로 고정**(측정 계약 정합).
