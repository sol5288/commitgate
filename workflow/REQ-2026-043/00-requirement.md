# REQ-2026-043 요구사항

리뷰 게이트 모델·reasoning effort를 리뷰 호출 로그에 기록(감사·재현성)

## 배경 — 관측된 갭

소비 저장소 감사(외부 프로젝트 점검)에서 드러난 사실: **어떤 모델이 커밋을 승인(gate)했는지가 저장소 어디에도 기록되지 않는다.**

- `.review-calls.jsonl`(측정 로그) 행에는 model 필드가 없다. `policy_version`은 persona 본문 해시일 뿐 모델과 무관하다([review-codex.ts:558](../../scripts/req/review-codex.ts#L558)).
- `approvals.jsonl`(원장)의 MANIFEST에도, 아카이브된 응답 JSON에도 model 필드가 없다.
- `req.config.json`의 `reviewModel`/`reviewReasoningEffort`가 `null`이면 `-c` override가 생략되어 **codex가 저장소 밖 `~/.codex/config.toml`을 상속**한다([adapters.ts:186-191](../../scripts/req/lib/adapters.ts#L186)). 즉 게이트 모델이 저장소 밖 가변 파일에 좌우되면서 **무기록**으로 바뀔 수 있다.

결과: 특정 커밋을 승인한 모델 설정을 저장소만으로 재구성할 수 없고(재현성 부재), 미핀 상태에서 모델이 조용히 약한 모델로 드리프트해도 흔적이 없다(감사 부재).

## 목표

완료된 매 review-call 로그 행에 **commitgate가 해당 리뷰에 대해 해소·전달한** 리뷰 모델과 reasoning effort를 기록한다. 그래서 리뷰가 어떤 모델 설정으로 돌았는지가 로컬 감사 로그에서 확인 가능해진다.

## 범위 (MVP — 사용자 확정)

- **로그 기록만**: `.review-calls.jsonl` 행(`ReviewCallLogRow`)에 `review_model`·`review_reasoning_effort` 두 필드 추가.
- 값의 원천 = **해소된 config**(`cfg.reviewModel`·`cfg.reviewReasoningEffort`) — codex 어댑터에 실제로 흘러가는 그 값([review-codex.ts:1942-1943](../../scripts/req/review-codex.ts#L1942)).

## 비목표 (경계)

- `approvals.jsonl`·MANIFEST·승인 증거(state) **무변경** — 원장/해싱/하위호환 파장을 피한다(후속 REQ 여지).
- config가 `null`(미핀)일 때 **codex가 실제 상속한 모델을 역추적하지 않는다** — codex `--json` 이벤트 파싱은 형식 결합이라 범위 밖. `null` 기록 = "commitgate 미핀(전역 상속)"이라는 정직한 신호로 충분.
- 게이트 동작·exit code·state 머신 **무변경**. 로그는 여전히 gitignore된 측정 전용·fail-closed.

## 필드 의미론 (정직성 경계)

`review_model`·`review_reasoning_effort` = **commitgate가 이 리뷰에 대해 핀한 값**. 핀(비-null)이면 codex가 `-c`로 강제받은 정확한 값. 미핀(`null`)이면 "commitgate 미핀 → codex 전역 상속"을 뜻하며, **codex가 실제 실행한 모델을 주장하지 않는다.** 이 경계 덕에 필드는 항상 참이다.

## 수용 기준

1. 새 로그 행이 `review_model`·`review_reasoning_effort`를 담고, 값은 `cfg.reviewModel`/`cfg.reviewReasoningEffort`(핀 시 정확 모델/effort, 미핀 시 `null`)와 일치한다.
2. `buildReviewCallLogRow`는 순수 함수로 유지되고 단위 테스트로 두 필드를 고정한다.
3. `appendReviewCallLog`는 계속 실패를 삼킨다(측정≠게이트, R8). 로그는 계속 `.gitignore` 대상.
4. `tsc --noEmit` 0 · eslint 0 · `vitest run` 그린.
