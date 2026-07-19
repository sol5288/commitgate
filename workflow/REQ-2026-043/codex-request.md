# REQ-2026-043 리뷰 요청

## 배경

리뷰 게이트가 어떤 모델·reasoning effort로 돌았는지가 저장소 어디에도 기록되지 않는다. `.review-calls.jsonl`의 `policy_version`은 persona 해시일 뿐 모델과 무관하고, `req.config.json`의 `reviewModel`이 `null`이면 codex가 저장소 밖 `~/.codex/config.toml`을 상속해 게이트 모델이 무기록으로 바뀔 수 있다(감사·재현성 부재).

## 변경 요약

측정 로그 행(`ReviewCallLogRow`)에 `review_model`·`review_reasoning_effort` 두 필드를 추가한다. 값 = commitgate가 해당 리뷰에 해소·전달한 `cfg.reviewModel`/`cfg.reviewReasoningEffort`(핀 시 정확값, 미핀 시 `null`). `policy_version`이 "전송 persona와 동일 배선"인 것과 같은 원칙(단일 배선).

- `scripts/req/review-codex.ts`: 타입 2필드 · `buildReviewCallLogRow` args 2개 · 호출 지점 cfg 2값 전달.
- `tests/unit/req-review-codex.test.ts`: 빌더 핀/미핀 두 케이스 assert.

로그는 gitignore된 측정 전용이라 커밋 산출물·원장 해시·게이트 판정에 영향 0(순수 additive, fail-closed 유지).

## 리뷰 포인트

1. **정직성 경계**: 미핀 시 `null` 기록이 "commitgate 미핀(전역 상속)"만 뜻하고 codex 실제 실행 모델을 주장하지 않는다는 의미론이 명확한가? 필드명이 오해를 부르지 않는가?
2. **원천 선택**: 해소된 config(`cfg.*`)를 기록하는 것이 codex `--json` 이벤트 파싱보다 옳은 MVP 경계인가? (형식 결합 회피 vs 실제 실행 모델 미포착의 트레이드오프)
3. **하위호환**: gitignore된 JSONL에 필드 추가가 순수 additive임이 맞는가? 로그를 읽는 소비자(있다면) 중 strict 리더가 없는가?
4. **경계 준수**: approvals.jsonl·MANIFEST·state·게이트 exit/판정을 건드리지 않았는가(측정≠게이트 R8 유지)?
