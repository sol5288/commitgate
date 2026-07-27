# REQ-2026-071 계획 — phase 분해

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

## Phase 1 — 게이트가 `stopGate`를 받는다 (`phase-1-confirm-scope`)

범위(DEC-3·DEC-5·DEC-7): `scripts/req/lib/evidence.ts`(타입) · `scripts/req/req-commit.ts`의
`userConfirmGate`·`consumeState` · `tests/unit/req-commit.test.ts`.

순서:
1. `UserCommitConfirmed.scope?: 'phase' | 'req' | 'delivery'` — **선택 필드**.
   🔴 부재는 **가장 좁은 `phase`**로 읽는다(하위호환 — 넓게 읽으면 과거 확인이 의도보다 많은 것을 덮는다).
2. `userConfirmGate(state, stopGate, completesReq)` — 🔴 요구 scope와 **정확히 일치**하는 확인만 유효(DEC-4b):
   - `'phase'` → **현행과 완전히 동일**(회귀 가드로 고정).
   - `'req'`·`'merge'` → HIGH여도 **차단하지 않는다**(확인은 종결 지점 — DEC-1).
3. `consumeState`: `scope:'phase'`만 커밋마다 소비. 넓은 scope는 남긴다(DEC-6).
4. 테스트:
   - 🔴 `'phase'` + HIGH + 확인 없음 → 차단(**현행 무회귀**)
   - 🔴 `'phase'` + HIGH + 유효 확인 → 통과, 그리고 **소비된다**(다음 phase가 다시 요구)
   - 🔴 `'req'`/`'merge'` + HIGH + 확인 없음 → **차단하지 않는다**(첫 phase에서 막히면 종결에 못 간다)
   - 🔴 넓은 scope 확인은 커밋으로 **소비되지 않는다**
   - 🔴 **우회 음성 테스트(r03 P1)**: `stopGate:'phase'` + HIGH + `scope:'req'` 확인 → **차단**.
     넓은 확인이 phase 게이트를 통과시키면 소비되지도 않아 이후 모든 phase가 무확인으로 진행된다 —
     `phase`가 보장하려던 "매 phase 신선한 확인"이 정상 경로로 사라진다.
   - 🔴 `stopGate:'req'` + `scope:'delivery'` 확인 → **차단**(반대 방향도 정확 일치)
   - 🔴 **`merge`↔`delivery` 대응 양방향**: `REQUIRED_CONFIRM_SCOPE.merge === 'delivery'` ·
     `scope`에 `'merge'` 값이 **없다** · `req:confirm --scope merge`가 거부된다.
     `merge`는 "언제 멈추는가"의 이름이고 `delivery`는 "무엇을 승인했는가"의 이름이다 —
     승인 대상은 묶음(delivery set)이지 병합 행위가 아니다. 대응은 표 하나가 SSOT다.
   - `risk_level` 부재·`'Low'`·`MEDIUM` → 자동 진행 안 함(DEC-7 무변경)

5. 🔴 **호출부 배선은 하지 않는다**(phase-1 r01 P1). 지금 `stopGate`를 넘기면 `req`/`merge` 사용자에게
   "`req:confirm`으로 기록하라"는 메시지가 나오는데 **그 명령이 phase-2까지 없다** — 마지막 phase에서
   막히고 빠져나갈 길이 없다. 호출부는 기본값(`'phase'`)을 그대로 쓰고, 배선은 phase-3에서 한다.
   순수 함수와 그 테스트만 이 phase에서 착륙한다(행동 변화 0).

Exit: typecheck 0 · `npm test` green(**행동 변화 없음**) · 수용기준 1·5·6·7 · Codex 승인.

## Phase 2 — `req:confirm` verb (`phase-2-confirm-verb`)

범위(DEC-3): `scripts/req/req-confirm.ts` 신규 · `bin/dispatch.mjs` · 테스트.

순서:
1. 🔴 **지금은 확인을 기록하는 도구 경로가 없다** — `state.json` 손편집뿐이고, 그것이 REQ-2026-019가
   폐기된 표면(시각 날조)과 같다. 이 명령이 그것을 대체한다.
2. `--scope phase|req|delivery` · `--method "<승인 문장>"` · `--run`.
   🔴 시각은 **실제 시계**. 🔴 넓은 scope는 "아직 없는 변경까지 미리 승인"임을 출력에 명시한다.
3. setup 게이트 · state checkpoint 커밋(다른 state 변경 verb와 동일).
3b. 🔴 verb 등록은 `VERB_MODULES` **한 곳**이다 — `STAGE_B_REQ_VERBS`는 거기서 파생된다(`bin/init.ts`).
   **실측(2026-07-27)**: 임시 repo에 devDependency 선언 후 `init` → `scripts.req:confirm` 주입 확인
   (req:* 10개). 같은 오독이 REQ-2026-069에서도 나와, 파생 지점에 **하드코딩이 아니라는 주석**을 달았다.
4. 테스트: 시각이 주입 가능한 seam으로 분리되어 고정 검증 · `--method` 누락 거부 ·
   scope enum 밖 거부 · 기록 형식이 `userConfirmProblem`을 통과.

Exit: typecheck 0 · `npm test` green · 수용기준 4b·6·7 · Codex 승인.

## Phase 3 — 종결 지점 배선 (`phase-3-terminal-wiring`)

범위(DEC-2·DEC-4·DEC-6): `scripts/req/req-commit.ts`(completesReq 전달·소비) ·
`bin/delivery.ts`(integrate 자격) · 테스트.

순서:
1. `req:commit`이 `userConfirmGate`에 **이 커밋이 REQ를 완성시키는지**를 넘긴다.
   판정은 `computeDevCompleteProof`의 결과를 **재사용**한다 — 별도 판정을 두면 갈라진다.
2. `delivery integrate` 자격에 HIGH member의 `scope:'delivery'` 확인을 더한다(기존 자격 검사와 같은 자리).
3. 소비(DEC-6): `phase`는 커밋마다 · `req`는 `dev-complete` 발행 시 · `delivery`는 `approve`에서.
4. 🔴 음성 테스트: `req` + HIGH + 마지막 phase + 확인 없음 → **차단** · 중간 phase는 통과.
5. 🔴 **`merge` 종결 경로 양방향**: HIGH member + `scope:'delivery'` 확인 → `integrate` **통과** ·
   확인 없음 또는 `scope:'phase'`/`'req'` → **거부**하고 delivery HEAD 불변.

Exit: typecheck 0 · `npm test` green · 수용기준 2·3·4 · Codex 승인.

## Phase 4 — 안내·문서 (`phase-4-guidance-docs`)

범위(DEC-5): `req-next.ts` 종단 안내 · docs 한/영 · CHANGELOG.

순서:
1. `req:next`가 HIGH일 때 `stopGate`에 맞는 `req:confirm` 명령을 안내한다.
2. 🔴 **넓은 확인의 의미**와 **미완성 REQ 손 push는 도구 밖**이라는 한계를 명시한다.
3. CHANGELOG에 **안전 속성 변경**임을 앞세운다.

Exit: `docs:lint` green · Codex 승인.

## 완료
- 게이트 해당분 · 사용자 main 통합(B1 사전 승인 — 반영 시 우회 사실·CI 사후 검증 보고).
