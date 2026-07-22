# REQ-2026-048 요구사항 — design 증거 영속화 갭 (P1)

## 무엇을 / 왜

CommitGate는 `state.json`을 **의도적으로 커밋하지 않는다**(작업 상태 캐시 — `req-commit.ts:566`). 따라서 저장소에 남는 감사 정본은 **`approvals.jsonl` 매니페스트 + 커밋된 응답 아카이브**뿐이다. 그런데 그 정본을 만드는 경로가 phase와 design 사이에 **비대칭**이다:

- **phase 증거**: 매 `req:commit --run`의 `evidence-finalize`가 **자동** 커밋한다. 게다가 `expectedArchivePaths`는 그 phase의 **needs-fix까지 포함**해 실패 라운드도 영속화한다(`req-commit.ts:201`).
- **design 증거**: 별도 수동 `req:commit --finalize-design`에만 의존하고, 그마저 `dev.response_path`(**승인 아카이브 1건**)만 stage한다(`req-commit.ts:642`). design **needs-fix 아카이브는 자동 커밋 경로가 아예 없다.**

그리고 **어떤 게이트도 "커밋된 매니페스트"를 확인하지 않는다** — D13은 `state.design_approved`(미커밋 스크래치)를, D17은 **온디스크** 아카이브를 보므로 untracked 파일로도 통과하고(`req-doctor.ts:410-421`), D10은 현재 티켓 `responses/`의 untracked 아카이브를 스크래치로 허용하며, `req:next`의 DONE 판정도 매니페스트를 보지 않는다. `--finalize-design`은 `req:next`·docs·companion skill·소비자 `AGENTS.md` **어디에서도 안내되지 않는다**.

**결과**: REQ가 "전 phase 커밋 + main 머지"에 도달해도 design 증거가 **커밋 이력에 전혀 남지 않을 수 있고**, 아무 게이트도 불평하지 않는다. 소비자 hermes(REQ-2026-001)에서 실측됐다 — fresh clone에 design 아카이브 0건·매니페스트 design 행 0건·committed `state.json`의 `design_approved=false`. 브랜치 전환이 미커밋 `state.json`을 덮어써 **design 승인 바인딩 자체가 소실**되기도 했다. 이 저장소 자신도 REQ-2026-045/046/047에서 같은 고아를 만들었다(코덱스 판정 **확정·P1**).

**경계 한 줄**: 이 REQ는 **design 증거를 커밋 이력에 확실히 남긴다**. 승인 판정 로직·리뷰 결과·phase 증거 경로는 바꾸지 않는다.

## 완료 기준 (검증 가능)

1. **정본 유지**: design verdict 아카이브와 `approvals.jsonl`은 계속 **Git 커밋된 감사 정본**이다. `state.json`은 캐시일 뿐 정본이 아니며 이 REQ도 커밋하지 않는다.
2. **승인 경로 흡수**: 성공한 `req:review-codex --kind design --run`이 **승인 아카이브와 매니페스트 행을 자동 evidence commit**으로 남긴다. 정상 절차나 에이전트 안내가 수동 실행을 요구하지 않는다.
3. **`--finalize-design` 유지**: 제거하지 않는다. 승인 직후 프로세스 중단·커밋 실패를 위한 **멱등 복구 경로**로만 남는다. 두 경로가 **같은 구현**을 공유한다.
4. **아키텍처**: `req-commit`과 `review-codex`가 **서로 import하지 않는다**. 매니페스트 검증·design evidence 커밋은 **공유 깊은 모듈**에 있고, 호출자는 "승인된 design evidence를 내구화한다"만 안다.
5. **needs-fix 포함**: design manifest 행에 **`archive_inventory: [{response_path, sha256}]`** 를 두고, **그 목록의 모든 아카이브를 함께 stage·commit**한다. 단순 파일명 sweep에 의존하지 않는다.
6. **DONE 게이트(신규 티켓 전용)**: 모든 phase가 끝나 `req:next`가 DONE을 내기 **직전**, **`HEAD`의 Git blob**에서 매니페스트 design 행·아카이브·SHA를 검증한다. 없으면 `DONE` 대신 **`BLOCKED` + 복구 명령**을 반환한다.
   - 🔴 **신규/legacy 판별 marker도 `HEAD` blob에서 읽는다** — 워킹 `state.json`(비커밋 캐시)의 marker는 판정에 쓰지 않는다. 캐시 소실로 신규 티켓이 legacy로 오인돼 게이트가 우회되면 안 된다. HEAD blob을 읽을 수 없으면 **보수적으로 엄격(BLOCKED)** 이다.
   - marker가 켜진 티켓의 design 행에 **`archive_inventory`가 없으면 BLOCKED**다(매니페스트 검증 자체는 필드 부재를 허용하되, 완료 판정은 엄격).
7. **벽돌 금지**: 이 검사를 `req:doctor`나 일반 `req:commit`의 **FAIL 게이트로 넣지 않는다**. terminal `req:next`의 완료 판정에서만 fail-closed이며, **marker가 없는 legacy 티켓은 기존 DONE과 호환**된다.
8. **부분 상태 복구**: 멱등 판정은 **`HEAD` 기준**이다. 매니페스트 append·stage까지 되고 `git commit`만 실패한 상태에서 재시도하면 **중복 append 없이 stage·commit을 다시 수행**해 HEAD 증거를 복구한다. 온디스크 엔트리 존재만으로 skip하지 않는다.
9. **실패 주입 테스트**: 아카이브 작성 후 커밋 실패 · 재시도 복구 · 중복 실행 · 부분 상태에서 상태가 어긋나지 않음을 고정한다.
10. `tsc --noEmit` 0 · 전체 단위 그린 · `req:doctor` PASS · 각 phase Codex 리뷰 승인. (참고: 로컬 전체 스위트가 환경에 따라 장시간 무출력으로 멎을 수 있다 — 그 경우 **CI 9 job이 정본**이다.)

## 범위 (MVP)

- 공유 evidence 모듈 추출 · `archive_inventory` · design 승인 경로 흡수 · `req:next` DONE 게이트(신규 티켓) · 실패 주입 테스트 · 문서/CHANGELOG.

## 비목표 (경계)

- **phase 증거 경로 변경** — 이미 자동이고 needs-fix까지 포함한다. 건드리지 않는다.
- **승인 판정·리뷰 로직 변경**(`classifyReview`·`applyVerdict`의 승인 여부 결정).
- **`state.json`을 커밋 대상으로 승격** — 캐시라는 결정을 뒤집지 않는다.
- **`req:doctor`/`req:commit`에 FAIL 게이트 추가** — 기존 소비자 벽돌화 금지.
- **hermes REQ-2026-001 등 legacy 티켓 소급 복구** — 도구가 갖춰진 뒤 별도 판단(증거 날조 금지).
- `main` 하드코드 / `trunkBranch` 분리 — 이후 P2.

## 근거·불변식

- **커밋되지 않은 증거는 증거가 아니다.** D17이 온디스크 아카이브로 통과한다는 사실이 이 갭을 조용하게 만들었다 — 새 게이트는 반드시 **커밋된 blob**을 본다.
- 승인 직후 커밋이 실패해도 **승인 판정을 뒤집지 않는다**(기록 실패가 게이트 판정을 바꾸면 그것이 계약 위반이다). 대신 그 창을 DONE 게이트가 잡고 `--finalize-design`이 복구한다.
- 새 필드·게이트는 **additive**이며 marker 없는 기존 티켓의 동작을 바꾸지 않는다.
