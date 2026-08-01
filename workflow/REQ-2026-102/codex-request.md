# REQ-2026-102 리뷰 요청 — phase-1-legacy-honesty

## 배경

소비자(yammy-sales, 0.17.0)가 개선 2건을 제기했다. **재현은 둘 다 성공했으나 각각의 전제가
실측으로 반증**돼, 제안된 조치는 채택하지 않고 **문구 정직성**만 고쳤다.

**개선-1(legacy에서 doctor 상시 FAIL)** — 리포터 주장은 "legacy는 조치가 없는데 doctor만 FAIL한다".
🔴 실측: `legacy` 축이 둘이고 겹치지 않는다. intake legacy(`evidence_durability_required`, HEAD) vs
review legacy(`review_series_model_version`, 워킹). **리포터 저장소 124티켓에서 둘 다 legacy는 0건,
intake만 legacy가 4건**(리포터가 든 REQ-001·002·003·062 바로 그것). 리뷰를 막는 것은
`isLegacyTicket`뿐이고 그 게이트는 `req-next.ts:764`·`review-codex.ts:2517` 두 곳 — **intake-legacy는
그 경로를 막지 않는다.** 즉 그 4건은 리뷰 승인 → `commit_allowed` → `req:commit`까지 간다.
`req:commit`이 doctor를 exit≠0 throw 하드 게이트로 spawn하므로 면제·WARN강등은 **main 커밋을 연다.**
→ **동작 무변경**.

**진짜 결함(우리 책임)** — `req-close.ts:154`의 `legacy 티켓은 req:new intake를 막지 않으므로
**탈출구가 필요 없습니다**`는 REQ-2026-097 **이전** 문장이다. REQ-097이 종결에 새 효용(브랜치 축
면제)을 붙이며 거짓이 됐다. REQ-098·100과 같은 결함 class.

**개선-2(`req:*`에 `--help`)는 미채택** — 루트 도움말이 나열하는 8개 명령이 **전부 `--help`를 구현**하며
`req:*`는 그 목록에 없다(거짓 진술 아님). 리포터의 심각도 근거("`--message-file`은 CHANGELOG로만")도
사실이 아니다(`req-next.ts:432`가 커밋 직전 명령 형태로 안내 + `AGENTS.md` 명령표 + docs 4곳).
usage 10개는 parseArgs와 갈라질 드리프트 표면 10개를 새로 만든다.

설계 r01 승인(findings 0).

## 변경 요약 (이번 staged diff)

| 파일 | 변경 |
|---|---|
| `scripts/req/req-doctor.ts` | **DEC-2** 입력 타입에 `'legacy'`(비면제 값) · **DEC-3** `isExemptTerminal`(exhaustive allow-list) · **DEC-4** `legacyNote`를 **한 곳에서 생성**해 D2/D3/D11이 공유 · `main()` 매핑 |
| `scripts/req/req-close.ts` | **DEC-5** legacy 거부 사유 정정(참인 부분 유지, 거짓 결론 교체, 없는 명령 미안내) |
| `tests/unit/req-doctor.test.ts` | DEC-6 ①~⑤ |
| `tests/unit/doctor-terminal-wiring.test.ts` | DEC-6 ⑦ 배선 e2e |
| `tests/unit/req-close.test.ts` | DEC-6 ⑥ |
| `CHANGELOG.md` | 미배포 0.18.0 절에 흡수 + 확인표 |

**런타임 동작 변경 0** — 면제 집합·레벨·조건 전부 불변. `exempt`가 기존 `terminal` 자리를 그대로
대체하므로 분기 구조가 안 바뀐다. 바뀌는 것은 **FAIL 메시지 문구**와 `req:close` 거부 사유뿐이다.

## 실측 검증

**도그푸딩**(이 저장소의 실제 legacy 티켓 REQ-2026-001):
```
FAIL D2: state.branch(...) != current(...) (legacy 티켓 — durability marker가 없어 종결을
  검증할 수 없습니다. 아직 진행 중이면 자기 feature 브랜치에서 작업하세요.
  이미 끝난 티켓이면 현재 이 FAIL을 해소할 수단이 없습니다.)
```
FAIL은 유지되고 사유가 붙는다.

**변이 검사 3종 — 전부 잡혔다**

| # | 변이 | 결과 |
|---|---|---|
| ① | `exempt`에서 `!== 'legacy'` 제거(= 리포터 제안 (a)) | 순수 2건 + **배선 e2e 1건** 실패 |
| ② | 정직 문장을 "자세한 내용은 문서를 참고하세요"로 교체 | 순수 1건 + **배선 e2e 1건** 실패 |
| ③ | 타입에 새 비면제 값 `'corrupt'` 추가(핸들링 없이) | **tsc 실패**(`never` 대입) — fail-open 차단 확인 |

(②의 1차 시도는 구문을 깨 `no tests`가 나와 **무효 검사**였다 — 구문이 유효한 형태로 다시 했다.)

**게이트**
- `npx tsc --noEmit` → exit 0 · `npm run docs:lint` → exit 0
- **변경 범위 단위 그린**: `req-doctor`·`doctor-terminal-wiring`·`req-close` **175/175**
- 전체 스위트는 **통합 직전 1회**(REQ-100 규칙)

## 리뷰 포인트

1. **DEC-1(리포터 제안 거절)이 옳은가.** 근거 연쇄는 "intake-legacy ≠ review-legacy → 리뷰 가능 →
   커밋 가능 → 브랜치 축이 지킬 것이 있다"이다. 끊긴 고리가 있는가.

2. **DEC-4 문구의 정직성.** "이미 끝난 티켓이면 현재 이 FAIL을 해소할 수단이 없습니다"라고 쓴다.
   불친절해 보이지만 없는 조치를 찾게 만드는 것보다 낫다고 판단했다(REQ-094 교훈). 반대로 이
   문장이 실제로는 있는 경로를 부정하는 것은 아닌가 — 내가 못 본 우회가 있는가.

3. **DEC-2의 타입 확장.** `CloseProofEvent | 'legacy' | null`에서 `'legacy'`는 CloseProofEvent가
   아닌데 같은 필드에 섞인다. 별도 필드로 쪼개면 `terminal='dev-complete' & legacy=true` 같은
   모순 조합이 타입으로 표현 가능해지므로 하나로 뒀다(REQ-097 DEC-2와 같은 거래). 옳은가.

4. **DEC-3의 fail-open을 리뷰 前에 닫았다.** 초안은 `exempt = terminal !== null && terminal !== 'legacy'`
   (deny-list)였는데, 새 **비면제** 값을 타입에 추가하면 그 값이 **조용히 면제 쪽으로 새는** 구조였다.
   **exhaustive allow-list**(`switch` + `never` 대입)로 바꿨다 — 실측 확인: 타입에 `'corrupt'`를
   추가하면 `error TS2322: Type '"corrupt"' is not assignable to type 'never'`로 **컴파일이 깨진다.**
   이 처리가 충분한가 — `default`에서 `never`를 소비하는 방식이 런타임에도 안전한가.

5. **`req:close` 문구.** 참(intake 무차단)과 갭(종결 표시 경로 없음)을 함께 말한다. 사용자가 이
   메시지만 보고 자기 상황을 정확히 이해할 수 있는가.

6. **개선-2 미채택 판단.** 위 근거로 거절했다. `req:*`가 dispatcher에서 실제로 받아들여지고
   `AGENTS.md`가 명령으로 문서화한다는 점에서, "도움말 목록에 없다"가 충분한 근거인가.
