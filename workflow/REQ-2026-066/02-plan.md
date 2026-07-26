# REQ-2026-066 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

## Phase 1 — 레코드 스키마 + 순수 판정 (`phase-1-model`)

범위(설계 DEC-4·DEC-6): `scripts/req/lib/delivery.ts` 신규 · `tests/unit/delivery.test.ts` 신규. 코드 2파일.
**IO·git·verb 없음** — 순수 함수만. 행동 변화 0.

순서:
1. 레코드 타입 + `schema_version` + **필수/선택 키 분리**를 처음부터 둔다(DEC-4).
   🔴 REQ-2026-064가 원장에서 겪은 함정(허용 키 == 필수 키 → 키 추가가 기존 파일을 전부 무효화)을
   신규 스키마가 반복하지 않는다.
2. 파싱·검증(`deliveryRecordProblems`) — 손상은 조용히 넘기지 않는다.
3. 🔴 **terminal 재귀 판정**(DEC-6): `integrated` 또는 (`superseded` + 유일 direct successor +
   order가 뒤 + 재귀 terminal + leaf가 `integrated`).
   테스트로 고정할 것: 순환(`R1→R2→R1`) 거부 · `superseded`만의 체인 거부 · successor 2개 거부 ·
   order 역행 거부 · 정상 체인(`R1→R2(integrated)`) 통과.
4. 🔴 불변식 판정 `canBegin(record)` — **두 조건을 함께** 본다(DEC-2c):
   `state === 'open'` **AND** 활성 member 없음.
   활성 member만 보면 빈 묶음을 seal한 뒤 `begin`이 통과해 **닫힌 묶음에 REQ가 추가된다**.
   음성 테스트: `sealed`·`approved` 상태에서 `canBegin`이 false인지 단언한다.
5. `integrate` 전제 판정(순수): `delivery_base_sha` 일치 + 조상 여부는 **입력으로 받는다**
   (git 호출은 phase-2).
6. 🔴 **`deliveryGateVerdict(record)` 순수 함수**(DEC-8a) — `sealed` && 모든 member terminal 이면
   `await-human`, 아니면 `continue`. **네 호출처(integrate·seal·status·req:next)가 이 하나를 공유**한다.
   각자 판정하면 갈라진다.

Exit: typecheck 0 · `npm test` green · 수용기준 3·8 충족 · Codex phase 리뷰 승인.

## Phase 2 — verb + git 오케스트레이션 (`phase-2-verbs`)

범위(설계 DEC-1~DEC-3·DEC-7·DEC-9): `bin/delivery.ts` 신규 · `bin/dispatch.mjs` ·
`tests/unit/delivery-verbs.test.ts` 신규. 코드 3파일.

순서:
1. 🔴 **첫 작업은 실측 spike**(설계 §미측정-1): 임시 repo에서 `git merge --no-ff --no-commit`이
   fast-forward 가능 상황에 `MERGE_HEAD`를 세우는지, 그 상태에서 파일을 수정·`git add`하고 커밋하면
   **하나의 merge commit**이 되는지 확인한다. 결과를 커밋 메시지에 남긴다.
2. `create`/`begin`/`status` — delivery ref·레코드를 **직접 읽고** 도구가 브랜치를 이동한다(DEC-7).
   현재 위치에 의존하지 않으므로 수동 checkout 이탈이 불변식을 깨지 않는다.
3. 🔴 **`integrate`의 첫 검증은 통합 자격**(DEC-2b) — 위상 검증보다 **앞**이다.
   활성 member의 REQ가 feature ref에 **`dev-complete` close-proof + 커밋된 design 승인 증거**를 갖고,
   증거 무결성이 통과하며, **그 증거 이후의 코드 커밋이 없어야** 한다.
   이것이 없으면 `create`→`begin`→**미승인 변경 커밋**→`integrate`가 리뷰 게이트를 통째로 우회한다.
   `--force` 류 우회는 만들지 않는다.
4. `integrate` 위상 단계 — DEC-2의 6단계. 🔴 기대 상태와 어긋나면 **write 0건 BLOCKED**,
   자동 rebase·충돌 해결 금지, 중간 실패는 `git merge --abort`.
5. `begin --successor-of` — parent 종결 증거를 **feature ref 기준**으로 검증하고, delivery에
   **정규화 사본**을 커밋한다(DEC-5). 🔴 **미승인 feature 변경은 delivery에 병합하지 않는다.**
6. 레코드는 delivery ref에서만 읽는다(DEC-3). feature의 사본은 지우지 않는다 —
   지우면 integrate가 delete/modify 충돌을 내 무충돌 불변식을 스스로 깬다.
7. 테스트: 수용기준 1·2·4·5·6·7 — 실제 임시 git repo에서 구동.
   🔴 **필수 음성 테스트 2건**:
   ① `create`→`begin`→**미승인 변경 커밋**→`integrate`가 **거부**되고 delivery HEAD·레코드가
      **변하지 않는지**. 이 시나리오가 통과하면 리뷰 게이트가 뚫린 것이다.
   ② `seal` 후 `begin`이 **거부**되는지(그리고 `approve` 후에도) — 닫힌 묶음에 member가 추가되면
      "사용자가 닫는다"와 "닫힌 전체에 대해 정지"가 동시에 무너진다.

Exit: typecheck 0 · `npm test` green · spike 실측 기록 · Codex phase 리뷰 승인.

## Phase 3 — seal/approve/reopen + stopGate merge + 문서 (`phase-3-gate`)

범위(설계 DEC-8·DEC-10·DEC-11): `bin/delivery.ts` · `config.ts` · `workflow/req.config.schema.json` ·
`scripts/req/req-next.ts` · 테스트 · 문서. 코드 5파일 + docs.

순서:
1. `seal`/`approve`/`reopen` — 확인 문구 통제점 + 레코드 커밋. 🔴 시각은 **실제 시계**.
   `approve`는 `sealed` && 모든 member terminal일 때만. `reopen`은 append-only 이벤트를 남긴다.
2. `stopGate` enum에 `merge` 추가(스키마 **2벌 동시**).
3. 🔴 **게이트를 전이 지점에서 낸다**(DEC-8a): `integrate`가 마지막 member를 반영했고 `sealed`면,
   그리고 `seal`이 모든 member terminal 상태에서 실행되면, **그 자리에서 `AWAIT_HUMAN`을 출력**한다.
   `req:next` 종단 분기도 같은 판정을 하지만 **유일한 발생지가 아니다** — 마지막 integrate 뒤 seal한
   사용자는 `req:next`를 다시 부를 이유가 없어 게이트를 영영 못 본다(design r01 P1).
   판정은 phase-1의 `deliveryGateVerdict` 하나를 공유한다.
   🔴 레코드는 **delivery ref에서** 읽는다 — feature 사본으로 판정하면 조기 정지한다(DEC-3).
4. `setup`의 `stopGate` 질문이 3지선다가 된다(enum 파생이라 자동).
5. 문서(한/영) + CHANGELOG. 🔴 **p1~p3가 한 릴리스로만 공개된다**는 제약을 적는다.
6. 🔴 **병합 실행은 하지 않는다**는 경계를 문서에 명시(C6·DEC-11).

수용 테스트(수용기준 9): **마지막 integrate → seal** 순서와 **seal → 마지막 integrate** 순서
**양쪽**에서 `AWAIT_HUMAN`이 나오는지 확인한다. 한쪽만 검증하면 전이 지점을 한 곳만 배선해도 통과한다.

Exit: `docs:lint` green · typecheck 0 · `npm test` green · 수용기준 9·10 충족 · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(unit·typecheck·docs:lint) · 사용자 main 통합(별도 승인).
- 🔴 **p1~p3를 한 릴리스로만 공개한다** — `create`/`begin`만 배포되면 통합 불가한 묶음이 만들어진다.
