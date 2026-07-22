# REQ-2026-048 리뷰 요청 — design 증거 영속화 (P1)

## 배경

CommitGate는 `state.json`을 의도적으로 커밋하지 않으므로(작업 상태 캐시), 저장소의 감사 정본은 **`approvals.jsonl` + 커밋된 응답 아카이브**뿐이다. 그런데 그 정본을 만드는 경로가 비대칭이다 — **phase 증거는 매 `req:commit --run`이 자동 커밋**하고 `expectedArchivePaths`가 needs-fix까지 포함하는 반면, **design 증거는 수동 `--finalize-design`에만 의존**하고 그마저 승인 아카이브 1건만 stage한다(`req-commit.ts:642`).

그리고 **커밋된 매니페스트를 확인하는 게이트가 없다**: D13은 `state.design_approved`(미커밋 스크래치)를, D17은 **온디스크** 아카이브를 보므로 untracked로도 통과하고, D10은 현재 티켓 `responses/` untracked 아카이브를 스크래치로 허용하며, `req:next` DONE도 매니페스트를 안 본다. `--finalize-design`은 어떤 도구 출력·문서·스킬에서도 안내되지 않는다.

**실측 결과**: 소비자 hermes REQ-2026-001은 전 phase 커밋·머지 후 fresh clone에 design 아카이브 0건·매니페스트 design 행 0건·committed `state.json`의 `design_approved=false`였다(브랜치 전환이 미커밋 `state.json`을 덮어써 승인 바인딩까지 소실). 이 저장소 자신도 REQ-2026-045/046/047에서 같은 고아를 만들었다. 코덱스 판정 **확정·P1**이며 본 REQ는 그 지시를 설계로 옮긴 것이다.

## ⚠️ 리뷰어 필독 — phase 경계(선행 phase는 이미 커밋됨)

phase별로 따로 커밋한다. **현재 staged diff에 없다고 해서 저장소에 없는 것이 아니다.**

- **phase-1(커밋 `09ad1f8`, 통합됨)** — 매니페스트 모델·검증과 그 런타임 의존(`archiveBaseName`·`isValidIsoInstant`·`isConfinedArchivePath`)을 leaf `scripts/req/lib/evidence.ts`로 이동, `req-commit`·`review-codex`·`req-doctor`가 re-export. 동작 변경 0(기존 테스트 무수정 그린). `tests/unit/evidence-module.test.ts`가 leaf 불변식을 고정.
- **phase-2 이후** — 아래 변경 요약의 순서대로. 각 phase는 앞 phase의 산출물을 **전제**로 하며 그 코드는 이 diff에 없다.

## 변경 요약

5 phase, 코드 변경은 phase당 ≤8파일.

1. **phase-1** — 매니페스트 모델·헬퍼를 신규 leaf `scripts/req/lib/evidence.ts`로 이동, `req-commit.ts`는 re-export(DEC-1). **동작 변경 0** — 기존 테스트 무수정 그린이 성공 기준.
2. **phase-2** — design 매니페스트 행에 선택 필드 `archive_inventory: [{response_path, sha256}]` + 검증 + finalize가 **인벤토리 전량 stage**(DEC-2).
3. **phase-3** — 성공한 `review-codex --kind design --run`이 evidence를 자동 커밋(DEC-3). 멱등. **커밋 실패는 승인 판정을 뒤집지 않고** 복구 명령 안내. `--finalize-design`은 같은 구현을 부르는 복구 경로로 유지. 실패 주입 테스트(DEC-5).
4. **phase-4** — `req:new` marker + `req:next`가 DONE 직전 **HEAD의 Git blob**으로 매니페스트·아카이브·SHA 검증 → 미충족 시 **BLOCKED + 복구 명령**(DEC-4). `req:doctor`·일반 `req:commit`에는 **FAIL 게이트를 넣지 않는다**. legacy(marker 부재)는 기존 DONE 호환.
5. **phase-5** — 문서(한/영)·CHANGELOG·버전.

명시적 비변경: **phase 증거 경로**(이미 자동·needs-fix 포함) · **승인 판정 로직** · **`state.json`의 캐시 지위** · **`req:doctor` 체크 목록/레벨**.

## 리뷰 포인트

1. **DEC-1 순환 회피가 실제로 성립하는가** — `lib/evidence.ts`가 `review-codex`에서 `import type`만 가져와 런타임 간선이 단방향(`review-codex → lib/evidence`, `req-commit → lib/evidence`)이 되는 설계가 맞는가. 타입을 lib로 **이관**하고 `review-codex`가 재수출하는 편이 더 나은가(더 큰 변경이지만 진짜 leaf가 된다).
2. **DEC-2 인벤토리의 검증 경계** — 행 최상위 `response_path`는 "approved만"을 유지하고 `archive_inventory`만 needs-fix를 허용하는 비대칭이 옳은가. 인벤토리를 통해 **다른 라운드·타 티켓 아카이브를 주입**할 여지는 없는가(각 항목 confinement + sha 검증으로 충분한가).
3. **DEC-3 실패 정책** — "커밋 실패가 승인 판정을 뒤집지 않는다"가 옳은 방향인가. 반대로 fail-closed(승인 무효)로 하면 리뷰 1회를 버리게 되는데, 그 대가와 "승인됨·미커밋" 창을 DONE 게이트로만 막는 선택 중 어느 쪽이 이 프로젝트의 보장 범위에 맞는가.
4. **DEC-4 게이트 위치** — terminal `req:next`에만 fail-closed를 두는 것이 충분한가. `req:next`를 안 쓰고 직접 명령을 부르는 운영자는 이 게이트를 통과하지 않는데, 그 경로를 어떻게 볼 것인가(수용 가능한 잔여 리스크인가).
5. **marker 도입 방식** — `state.json`은 커밋되지 않는 캐시인데 marker를 거기 두면 **스캐폴드 커밋본에만 남고 이후 변경은 미커밋**이다. 신규/legacy 판별에 그 정도로 충분한가, 아니면 마커를 커밋되는 곳(예: 매니페스트 첫 행·티켓 문서)에 둬야 하는가.
6. **phase 경계** — 5 phase 분해가 리뷰 면적 대비 적절한가. 특히 phase-1(순수 이동)의 "기존 테스트 무수정 그린" 기준이 이동 정확성의 오라클로 충분한가.
7. **놓친 축** — 실패 주입 4종(커밋 실패·재시도·중복·부분 상태) 외에 고정해야 할 시나리오가 있는가.
