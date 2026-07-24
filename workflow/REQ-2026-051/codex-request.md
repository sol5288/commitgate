# REQ-2026-051 리뷰 요청

## 배경

`state.json`은 scratch로 설계돼 커밋되지 않는다(의도). 그 결과 런타임 원장이 미커밋으로 남고, 다음 티켓의 `req:new`가 clean tree를 요구하는 순간 폐기된다.

소비자 저장소에서 실제로 발생했다 — 한 REQ가 design 승인 + phase 3건 승인 + 커밋 5개를 마쳤는데 `state.json`이 생성 시점(`phase: INTAKE`·`design_approved: false`·`phases: []`)으로 되돌아갔다. **이 저장소도 같다** — REQ-2026-049의 `state.json`은 `phases: []`·`review_series: 0`이고, 직전 REQ-2026-050은 수동 `chore(req)` 커밋으로 겨우 보존했다. 그 수동성이 문제의 본질이다.

이 REQ는 개선 6건(A·B1·B2·C·D·E) 중 **B1**이다. durable-close proof·`req:new` 게이트·legacy 처리는 **B2**, lifecycle 실패 분류와 예산 차감 규칙은 **C**, 구조화 예외 사유는 **D**, lockfile 프롬프트 축소는 **E**다. 이 티켓의 범위가 아니다.

## 변경 요약

**phase-1** — `scripts/req/lib/review-ledger.ts` 신규(순수). 행 스키마·직렬화·파싱·검증·멱등 append.
**phase-2** — `review-codex.ts`가 attempt 확정 직후 `attempt-opened`, 판정 완료 시 `attempt-closed`를 남긴다. design 승인 커밋에 원장 합류.
**phase-3** — evidence-finalize pathspec에 원장 합류. `git check-ignore` 회귀 가드. 재실행 멱등.

핵심 결정:

- **중복 구현 회피**: `approvals.jsonl`의 `archive_inventory`가 아카이브된 전 라운드를 이미 sha256과 함께 담는다. 원장은 그것을 다시 적지 않고, **아카이브가 보여줄 수 없는 5가지**(아카이브 없는 시도·예외 소비·종결 사유·lineage·재구성 여부)만 담는다.
- **append-only를 지키려 행을 갱신하지 않고 두 개 쓴다**(`attempt-opened` / `attempt-closed`). 부수 효과로 "예산은 깎였는데 완료되지 않은 호출"이 **원장 구조 자체로** 관측된다 — 별도 필드가 필요 없다.
- **쓰기 실패는 게이트를 흔들지 않는다**(삼키고 경고). 반면 **읽기·검증의 손상은 숨기지 않는다**(fail-closed).
- **프롬프트/응답 본문 미저장** — 해시까지만. 응답 본문은 이미 아카이브에 있다.

## 리뷰 포인트

1. **원장이 정말 필요한가 — `approvals.jsonl`과 중복 아닌가.** 설계는 "아카이브가 보여줄 수 없는 5가지"로 한계효용을 정당화한다. 그 5가지가 실제로 `archive_inventory`·아카이브 파일명·`consumed_at`으로 복원 불가한 것이 맞는가. 하나라도 복원 가능하다면 그만큼 스키마를 줄여야 한다.

2. **2-이벤트 모델이 옳은가.** 한 행을 나중에 갱신하는 대신 `attempt-opened`/`attempt-closed`를 쓴다. 원장 크기가 2배가 되는 대가로 append-only와 "미완 attempt 관측"을 얻는다. 이 교환이 타당한가, 아니면 단일 행 + 별도 완료 마커가 나은가.

3. **D3의 비대칭(값은 열고 키는 닫는다)이 안전한가.** 모르는 `lifecycle` 값은 통과시키고 모르는 top-level 키는 거부한다. 후속 REQ(C)가 값을 추가할 때 구버전 검증기가 막지 않게 하려는 의도인데, 이 관대함이 오염 경로가 되지는 않는가.

4. **D6과 D5가 모순되지 않는가.** 쓰기 실패는 삼키고(D6) 읽기 손상은 fail-closed다(D5). 경계가 실제로 분리 가능한가 — 예컨대 append 도중 부분 기록으로 파일이 손상되면 어느 쪽 규칙이 적용되는가.

5. **미커밋 구간을 남긴 것이 정직한 범위 설정인가.** 승인이 한 번도 없는 티켓의 attempt 행은 여전히 커밋되지 않는다. 이 REQ는 그것을 B2로 미루고 인수 기준에서 뺐다. 이 분할이 "해결한 척"이 아닌가, 아니면 여기서 최소한의 무엇이라도 해야 하는가.

6. **phase 경계.** phase-1(순수 모듈)·phase-2(design 경로)·phase-3(phase 경로)이 독립 커밋·독립 리뷰 가능한가. phase-2와 phase-3이 서로를 요구하지 않는다는 주장이 맞는가.

7. **D8 가드의 실효성.** 원장이 gitignore로 조용히 사라지는 것은 REQ-2026-025/047에서 두 번 난 실패 계열이다. 실제 `git check-ignore` 호출로 잠그는 것이 충분한가.
