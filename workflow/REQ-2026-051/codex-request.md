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

## phase-2 구현 노트(이번 staged diff)

- `withAttemptRecorded`에 `onAttemptOpened` 콜백을 추가해 attempt 확정·영속 **직후, 외부 호출 직전**에 원장 `attempt-opened`를 남긴다. **콜백의 무결성 예외는 전파된다**(r02에서 fail-closed로 수정 — 아래 참조). 쓰기 실패는 `appendLedgerRowToDisk` 내부에서 삼킨다(D6).
- 판정 완료 시점(측정 로그 append 직전)에 `attempt-closed`를 남긴다. `outcome`은 `ReviewOutcome`을 그대로 넣는다 — 캐스트하지 않아 두 타입이 갈라지면 빌드가 깨진다.
- `appendLedgerRowToDisk`(신규, 삼킴): `appendLedgerRow`가 `conflict`면 덮지 않고 경고, `duplicate`면 no-op.
- **게이트 상호작용 발견·수정**: 원장은 리뷰 중 `responses/`에 쓰이는 도구 산출물이라 D10 clean-tree 가드(pre/post)에 걸린다. `state.json`과 **같은 범주**이므로 SSOT인 `reviewScratchPaths`에 exact 경로로 추가했다. `responses/**` 전체를 여는 게 아니라 원장 한 경로만 — rename/카피는 여전히 차단(REQ-012 D8 보존). 이 발견은 게이트가 자기 설계 결함을 잡은 사례다.
- `designEvidenceStagePaths`에 `ledgerExists` 4번째 인자(기본 false, 3-arg 무회귀). 원장이 있을 때만 합류 — 없는 pathspec으로 커밋이 실패하지 않게.
- **phase-1 모듈 변경 포함**: 리뷰어 phase-1 observation(`attempt-closed`의 outcome·lifecycle null 허용)을 반영해 교차필드 제약을 추가했다. phase-1은 이미 승인·커밋됐으므로 이 순수 모듈 변경이 phase-2 diff에 들어온다.

**구현 중 사고와 수정**(정직하게 남긴다):
- 자연키 구분자로 원시 NUL 바이트가 소스에 박혀 git이 파일을 binary로 취급했다 → `String.fromCharCode(31)`로 바꾸고 소스 위생 테스트로 재발을 잠갔다(phase-1).
- near-e2e 테스트에서 픽스처가 `.review-calls.jsonl`을 gitignore하지 않아 2회차 리뷰가 D10에 걸렸다 → 실제 설치본과 동일하게 픽스처에 `workflow/.gitignore` 시드.

검증: typecheck 0 · 전체 1451 green(+34). near-e2e 5건이 opened/closed 순서·미완 관측·D6 삼킴·멱등을 실제 main() 경로로 고정한다.

## r02 반영 (P1: D5/D6 뭉갬)

r01 지적이 정확했다 — `appendLedgerRowToDisk`가 읽기·검증 손상과 쓰기 실패를 **둘 다 삼켜** D5(무결성 fail-closed)를 우회했다. 이건 내가 이 티켓 codex-request의 리스크 #4로 스스로 플래그한 지점이었다.

수정: 두 단계를 분리했다.
- **읽기·파싱·검증**(기존 원장 `readFileSync` + `appendLedgerRow`의 `conflict`) → **전파**(throw). `attempt-opened`가 외부 호출 **전**에 부르므로, 손상된 원장은 리뷰를 시작조차 못 한다(D10 pre-review 게이트와 같은 자리).
- **새 행 쓰기**(mkdir/write) → 삼킴(D6). 순수 I/O 실패가 판정·exit code를 뒤집지 않는다.
- `withAttemptRecorded`의 `onAttemptOpened` 주변 try/catch를 **제거**했다 — 그게 있으면 fail-closed가 죽는다.

정상 경로 정합: attempt-opened가 무결성을 확인하고 유효한 행 하나만 append하므로, attempt-closed의 재검증은 협조적 단일 worktree 전제에서 통과한다. closed에서 전파가 발화하는 것은 "일어나선 안 될" 손상뿐이고, 그때 크게 실패하는 편이 옳다.

테스트 추가: ① 손상 원장 → `appendLedgerRowToDisk` throw(단위) ② 쓰기 실패 → throw 안 함(단위) ③ 손상 원장 커밋 후 리뷰 → **외부 호출 0건**으로 fail-closed(near-e2e). 전체 1453 green.

## r03 반영 (P1: archive path·sha 중복)

r02 지적이 정확했다 — `attempt-closed`에 `archive_path`·`archive_sha256`을 담은 것이 이 REQ의 헤드라인 원칙("🔴 approvals.jsonl을 중복하지 않는다")을 스스로 어겼다. 그 경로·해시는 이미 `approvals.jsonl`의 `archive_inventory`가 단일 출처로 보관하고, 두 사본은 갈라질 수 있다.

수정: 두 필드를 스키마·직렬화·검증·배선·테스트에서 **전부 제거**했다. 아카이브 존재 여부는 `outcome`이 이미 알려 준다(approved/needs-fix=아카이브됨, blocked/invalid=아님). 특정 아카이브 파일과의 연결이 필요하면 `archive_inventory`(단일 출처)를 본다.

> **요구사항 해석**: 00-requirement 최소 기록 목록의 "증거 archive path/hash"는 이 비중복 원칙에 **위임**한다 — 원장은 그것을 복제하지 않고 `archive_inventory`(단일 출처)가 보관한다. 00 문서 자체는 편집하지 않는다(design 승인 baseline 해시를 깨면 phase 리뷰의 `designValid`가 무효화된다). 헤드라인 원칙과 최소 목록 항목이 충돌할 때 헤드라인(비중복)이 우선이라는 것은 01-design D4가 이미 명시한다.

**⭐ dogfood가 스키마 진화 통찰을 드러냈다**: r03에서 키를 제거하자 이 티켓의 **미커밋** 원장(이전 라운드에 옛 스키마로 쌓임)이 D5 fail-closed에 걸려 리뷰가 멈췄다 — 게이트가 설계대로 작동한 것이다. 미커밋 scratch라 삭제·재생성으로 해결했다. 이로부터 원칙을 코드에 못박았다: **릴리스 후 스키마 변경은 additive-only**(키 제거 금지). 이 REQ는 릴리스 전이라 제거가 안전하다(야생에 옛 원장 없음). `LEDGER_KEYS` 주석에 근거를 남겼다.

## phase-3 구현 노트(이번 staged diff)

- `req-commit.ts`의 phase evidence-finalize `git add` pathspec에 원장을 합류(존재 시). design 경로의 `ledgerExists`와 대칭 — 없는 pathspec으로 `git add`가 실패해 증거 커밋이 무산되지 않게 `existsSync` 가드.
- **phase-2 순서 버그 발견·수정**(phase-3 e2e가 드러냄): `attempt-closed` append가 `durableDesignEvidence` 커밋 **뒤**에 있어, design 승인 리뷰의 closed 행(outcome=approved — 가장 중요한 행)이 그 커밋에 실리지 못하고 미커밋으로 남았다. closed append를 durable 커밋 **앞**으로 옮겼다. ⑱ e2e(HEAD에 opened+closed 둘 다 committed)가 이 순서를 고정한다.
- `docs/guarantees.{md,en.md}`에 원장 보장을 추가.

near-e2e 3건: ⑱ design 승인 → 원장이 HEAD에 committed · ⑲ 실 `git check-ignore`로 kit gitignore 아래에서 원장 미무시(codex-response는 무시되는 양성 대조) · ⑳ 커밋된 원장 무결성(자연키 중복 0). 전체 1456 green · docs:lint 통과.

## 리뷰 포인트

1. **원장이 정말 필요한가 — `approvals.jsonl`과 중복 아닌가.** 설계는 "아카이브가 보여줄 수 없는 5가지"로 한계효용을 정당화한다. 그 5가지가 실제로 `archive_inventory`·아카이브 파일명·`consumed_at`으로 복원 불가한 것이 맞는가. 하나라도 복원 가능하다면 그만큼 스키마를 줄여야 한다.

2. **2-이벤트 모델이 옳은가.** 한 행을 나중에 갱신하는 대신 `attempt-opened`/`attempt-closed`를 쓴다. 원장 크기가 2배가 되는 대가로 append-only와 "미완 attempt 관측"을 얻는다. 이 교환이 타당한가, 아니면 단일 행 + 별도 완료 마커가 나은가.

3. **D3의 비대칭(값은 열고 키는 닫는다)이 안전한가.** 모르는 `lifecycle` 값은 통과시키고 모르는 top-level 키는 거부한다. 후속 REQ(C)가 값을 추가할 때 구버전 검증기가 막지 않게 하려는 의도인데, 이 관대함이 오염 경로가 되지는 않는가.

4. **D6과 D5가 모순되지 않는가.** 쓰기 실패는 삼키고(D6) 읽기 손상은 fail-closed다(D5). 경계가 실제로 분리 가능한가 — 예컨대 append 도중 부분 기록으로 파일이 손상되면 어느 쪽 규칙이 적용되는가.

5. **미커밋 구간을 남긴 것이 정직한 범위 설정인가.** 승인이 한 번도 없는 티켓의 attempt 행은 여전히 커밋되지 않는다. 이 REQ는 그것을 B2로 미루고 인수 기준에서 뺐다. 이 분할이 "해결한 척"이 아닌가, 아니면 여기서 최소한의 무엇이라도 해야 하는가.

6. **phase 경계.** phase-1(순수 모듈)·phase-2(design 경로)·phase-3(phase 경로)이 독립 커밋·독립 리뷰 가능한가. phase-2와 phase-3이 서로를 요구하지 않는다는 주장이 맞는가.

7. **D8 가드의 실효성.** 원장이 gitignore로 조용히 사라지는 것은 REQ-2026-025/047에서 두 번 난 실패 계열이다. 실제 `git check-ignore` 호출로 잠그는 것이 충분한가.
