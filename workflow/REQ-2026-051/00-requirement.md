# REQ-2026-051 요구사항

커밋되는 append-only 리뷰 원장 + design·phase 승인 자동 내구화

## 배경 — 관측된 손실

`state.json`은 **scratch로 설계**되어 `req:commit`이 스테이징하지 않는다([req-commit.ts](../../scripts/req/req-commit.ts) `finalizeEvidenceAndConsume`: *"state.json은 scratch 유지(커밋 안 함)"*). 이는 의도된 설계지만, 그 결과 런타임 원장이 커밋되지 않은 채 남고 **다음 티켓의 `req:new`가 clean tree를 요구하는 순간 폐기된다**.

- 소비자 저장소에서 실제로 발생했다 — 한 REQ가 design 승인 + phase 3건 승인 + 커밋 5개를 마쳤는데 `state.json`이 생성 시점 상태(`phase: INTAKE`·`design_approved: false`·`phases: []`)로 되돌아갔다. 아카이브와 `approvals.jsonl`은 살아남았고 **원장만** 사라졌다.
- **이 저장소도 같은 상태다.** REQ-2026-049의 `state.json`은 티켓 생성 시점만 커밋됐고 현재 `phases: []`·`review_series: 0`이다. REQ-2026-050은 수동 `chore(req)` 커밋으로 겨우 보존했다 — 그 수동성이 문제의 본질이다.

## 무엇이 이미 내구적인가 (중복 구현 금지)

`approvals.jsonl`의 `archive_inventory`가 **아카이브된 모든 라운드**를 `response_path` + `sha256`으로 이미 기록한다. needs-fix 라운드도 포함된다. 따라서 원장은 그것을 다시 적지 않는다.

## 원장이 담아야 하는 것 — 아카이브가 보여줄 수 없는 것만

| # | 항목 | 왜 아카이브로 안 되나 |
|---|---|---|
| 1 | **아카이브를 남기지 않은 시도** | attempt는 외부 호출 **전**에 기록되고 아카이브는 유효 응답에만 생긴다. 호출 실패·무효 응답은 예산만 깎고 흔적이 없다 — 소비자 저장소에서 실측 1건(attempts 4 vs 아카이브 3) |
| 2 | **사람 예외 소비** | `review_exception_confirmed`는 소비 후 `null`로 지워진다. 6~8회차가 예외를 썼다는 사실이 어디에도 안 남는다 |
| 3 | **series 종결 사유** | `approved` / `human-resolution`(+ 사유 노트) 구분이 scratch에만 있다 |
| 4 | **lineage** | `successor_of`(대체 REQ 계보)가 scratch에만 있다 |
| 5 | **재구성 여부** | 사후 복원한 기록을 원본과 구별할 수단이 없다 |

## 요구사항

1. `state.json`은 **런타임 캐시로 계속 유지**한다. 정본으로 승격하지 않는다.
2. 커밋되는 **append-only** 원장을 둔다. 기존 행을 재작성·삭제하지 않는다.
3. **프롬프트 전문을 저장하지 않는다.** 해시까지만 기록한다.
4. 최소 기록: ticket · series · attempt · review kind · phase · 예외 소비 여부 · lifecycle · outcome · 증거 archive path/hash · timestamp · reconstructed 여부.
5. design 승인과 phase evidence-finalize에서 **자동 내구화**한다 — 사람이 기억해야 하는 수동 단계를 만들지 않는다.
6. crash/recovery 후에도 **중복 행이 생기지 않고 승인 증거가 누락되지 않는다**(멱등).

## 비목표

- **durable-close proof · `req:new` 게이트 · legacy/reconstructed 처리 절차는 이 REQ가 아니다**(후속 REQ). 여기서는 원장 스키마에 `reconstructed` 필드를 두는 것까지만 한다.
- **lifecycle의 실패 분류**(`pre_dispatch_failed`·`dispatch_confirmed`·`dispatched_unknown`)와 예산 차감 규칙 변경은 이 REQ가 아니다(후속 REQ). 여기서는 그 값을 담을 **자리와 확장 규칙**만 정의한다.
- `.review-calls.jsonl`(gitignore된 측정 로그)를 대체하거나 커밋 대상으로 바꾸지 않는다.

## 인수 기준

- 원장 파일이 git에 의해 무시되지 않는다(회귀 가드).
- 같은 attempt를 두 번 기록해도 행이 늘지 않는다.
- 기존 행과 내용이 충돌하는 재기록은 조용히 덮지 않고 **fail-closed**로 드러난다.
- design 승인·evidence-finalize 커밋에 원장이 함께 실린다.
- 호출이 실패해 완료 기록이 없는 attempt가 원장에서 **식별 가능**하다.
