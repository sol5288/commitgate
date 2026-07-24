# REQ-2026-052 리뷰 요청

## 배경

REQ-051(B1)은 원장을 승인 시에만 커밋한다 — `attempt-opened`는 외부 호출 전 워킹트리에 쓰이지만 다음 durable checkpoint(승인)에서야 커밋된다. NEEDS_FIX 후 폐기·브랜치 전환 시 원장이 소실될 수 있다. 이 REQ는 "원장이 있다"(working tree)와 "원장이 durable하다"(HEAD committed blob)를 구분하고, scratch state가 사라져도 HEAD만으로 티켓 상태·req:new 허용·재구성 여부를 판별 가능하게 한다.

개선 6건(A·B1·B2·C·D·E) 중 **B2**다. lifecycle 실패 분류·예산 규칙(C), 예외 명령(D), lockfile 축소(E)는 범위 밖.

## 변경 요약

- **DEC-A**: pre-call 원장 커밋. `attempt-opened`를 외부 호출 **전** 커밋해 durable화. **1 커밋/호출**(opened만; closed는 다음 커밋에 편승 — 유실돼도 opened가 "예산 사용·미확정" 증명). 2 커밋/attempt를 비용 분석 후 기각.
- **DEC-A2**: pre-call 커밋을 `captureGitBinding` **전**으로. 안 그러면 `afterTree===reviewTree` 오판·`reviewBaseSha` 어긋남 → review-codex 흐름 재구성.
- **DEC-B**: 커밋되는 `responses/ticket-close.jsonl`(append-only, 원장과 별도). 6-상태를 committed 사실에서 **파생**(legacy·reconstructed·series-terminal·developing·needs-recovery·dev-complete·integrated). "개발 완료"≠"통합 완료".
- **DEC-C**: req:new가 committed proof만으로 티켓 스캔 → 미종결 durable 티켓이면 fail-closed. legacy는 표시만.
- **DEC-D**: `req:reconstruct` — immutable archive+approvals로 검증가능 사실만, reconstructed 표시, 추정 금지, 사람 확인.

## r01 반영 (P1 3건)

r01 지적 3건 모두 유효해 반영했다.

1. **legacy 판정이 state.json marker에 의존 vs DEC-E scratch 모순** → **DEC-A4 신설**: state.json의 두 역할을 분리. `req:new`가 커밋하는 **scaffold state.json**(marker 포함, HEAD blob에 실존 — 확인함)이 marker 정본이자 불변이고, 런타임 갱신분만 scratch다. legacy 판정은 HEAD scaffold marker만 본다.
2. **needs-recovery가 워킹 승인을 입력으로 씀 vs HEAD-only 원칙** → **6-상태 파생을 HEAD-committed 4종만 입력으로 재정의**. needs-recovery = HEAD durable 원장의 `attempt-closed(approved)`와 HEAD 증거의 불일치(워킹 승인 아님). 승인 closed 자체가 유실됐으면 `developing`(예산 사용·미확정)으로 떨어져 역시 req:new fail-closed.
3. **phase-3 선행이 phase-1만인데 ⑱이 phase-2 산출물 사용** → phase-3 선행을 **phase-2로 정직하게 선언**.

## r02 반영 (P1: integrated 파생 불가 + 상태 개수)

r02 P1이 정확했다 — `integrated`는 4종 HEAD blob으로 파생 불가(ancestry 정보 없음). 상태 모델을 재구조화했다:
- **기본 상태 5개(순수·배타·완결)**: `legacy` > `series-terminal` > `dev-complete` > `needs-recovery` > `developing`. 항상 정확히 하나.
- **오버레이 2개**: `reconstructed`(close proof blob·순수) · `integrated`(git-ancestry·순수 아님·**상태 보고 전용, req:new 게이트 무관**).
- observation(7개 나열·reconstructed 게이트 정책 부재)도 반영: 기본/오버레이 분리로 개수 정합, 게이트 표에 오버레이 무관 규칙 명시.

## 리뷰 포인트

1. **1 커밋/호출이 정말 하한인가.** DEC-A는 각 외부 호출이 opened를 호출 전 durable화해야 하므로 매 호출 선커밋이 불가피하다고 논증한다. 더 적은 커밋으로 같은 보장(요구 #1: 외부 호출 직전 durable opened가 process 종료 후 HEAD에서 보임)을 낼 대안이 있는가. off-HEAD 저장은 "HEAD blob 기준" 원칙 위반으로 배제했는데 타당한가.

2. **closed 유실 허용이 요구를 어기지 않는가.** closed는 다음 커밋에 편승하고, 없으면 유실된다. 요구는 "closed 유실돼도 opened로 '예산 사용·미확정' 판별 가능"이면 충족이라 본다. 이 해석이 맞는가, 아니면 closed도 durable해야 하는 경로가 있는가.

3. **DEC-A2 재구성의 안전성.** recordAttempt+opened 커밋을 `captureGitBinding` 앞으로 옮긴다. 예산·terminal·예외 게이트 순서와 R9(반환 state 계보) 불변식이 보존되는가. pre-call 커밋이 design 문서·phase 코드 staged 항목을 인덱스에 보존한다는 주장(pathspec 커밋)이 `afterTree===reviewTree`·phase의 `captureIndexHash` 바인딩과 정합하는가.

4. **6-상태 파생이 완결·배타적인가.** DEC-B 표의 상태들이 겹치거나 빈 구간을 남기지 않는가. 특히 `developing`↔`needs-recovery` 경계, `dev-complete`↔`integrated` 구분(도구가 integrated를 선언하지 않는다는 결정)이 옳은가.

5. **req:new 게이트가 정상 흐름을 막지 않는가.** DEC-C 표에서 `dev-complete`(미병합)를 허용한다. 단일 worktree 경계에서 이게 두 미병합 브랜치를 유발하지 않는가. 반대로 `developing` 차단이 정당한 재개(같은 티켓 이어가기)를 막지 않는가.

6. **재구성이 사실을 지어내지 않는가.** DEC-D는 archive_inventory로 "라운드가 아카이브됐다"만 유도하고 소실된 opened·예외 소비·실패 원인은 unknown으로 둔다. 이 경계가 "검증 불가능한 값을 만들지 않는다"(요구 #8)를 충족하는가.

7. **phase 경계.** phase-1(순수)·phase-2(pre-call 커밋)·phase-3(dev-complete·게이트)·phase-4(재구성)가 독립 커밋·독립 리뷰 가능한가. phase-2/3이 서로를 요구하지 않는다는 주장이 맞는가(phase-3 near-e2e가 phase-2 산출물을 입력으로 쓰는 것은 순서 선호이지 컴파일 의존이 아님).

8. **비목표 준수.** lifecycle 값(`completed`)을 바꾸지 않고, state.json을 커밋 정본으로 승격하지 않으며, 게이트 판정 로직을 바꾸지 않는다. 설계가 이를 어기지 않는가.
