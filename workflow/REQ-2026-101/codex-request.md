# REQ-2026-101 리뷰 요청 — phase-1-drift-detection

## 배경

사용자 문제("적용한 프로젝트에서 변경 하나마다 수십분~1시간")를 소비자 2곳
(`44_yammy_sales`·`45_MBTI_kiosk`)의 `review-ledger.jsonl` **109개 티켓**으로 실측했다.
티켓 소요 중앙값 **36.7분 / 103.6분**, 그중 Codex 리뷰 왕복은 9~14%뿐이고 **리뷰 라운드 사이
(수정+테스트)가 86~91%**다. 지렛대는 그 축 하나이고 REQ-2026-100이 규칙(테스트 실행 계층)을 만들었다.

같은 조사에서 **tsx 기동 제거는 반증**됐다(482→73ms로 기동 비용은 실재하나 CLI 스폰 파일이 50중 4 =
스위트의 2.2%, 소비자 명령에선 tsx 11% < npx 37%, 티켓 시간 기준 0.2% 미만). 그래서 이 REQ는
그 규칙의 **전달**을 다룬다.

설계 r01 승인(findings 0).

## 변경 요약 (이번 staged diff)

| 파일 | 변경 |
|---|---|
| `bin/quickstart.ts` | **DEC-1** `missingQuickstartFiles`(부재만) → `quickstartBackfillTargets`(`planQuickstart` 파생, `insert`/`replace` 구분). **DEC-7** 판정 불가 시 `undefined` |
| `scripts/req/req-doctor.ts` | **DEC-2** D21이 부재/드리프트 분기 문구(드리프트엔 덮어쓰기 경고). **DEC-3** WARN 상한 유지. 입력 타입 교체 |
| `templates/CLAUDE.template.md` · `AGENTS.template.md` | **DEC-5** Quick Start 블록 7번 항목(계층 한 줄) — **양쪽 동시** |
| `tests/unit/quickstart.test.ts` | 기존 부재 테스트를 새 계약으로 이전 + 드리프트 5종(왕복 포함) |
| `tests/unit/req-doctor.test.ts` | D21 문구 분기 · WARN 상한 · 판정 불가 OK |
| `CHANGELOG.md` | Unreleased + 확인할 파일 표 |

**쓰기 동작 변경 0** — `injectQuickstart`·`planQuickstart`·`--apply`는 손대지 않았다.
바뀐 것은 **누가 그 계획을 보는가**(진단)와 블록 내용이다.

## 핵심 — 기계는 있었고 탐지만 없었다

`injectQuickstart`(:104)는 처음부터 낡은 블록을 **치환**했고(`updated`), `planQuickstart`(:189)는
파일별 `replace`를 계산했다. 그런데 D21의 유일한 입력은 마커 **부재만** 보는 함수였다.
→ 블록을 개정해도 기존 소비자는 신호를 못 받았고, 신호가 없으니 아무도 갱신하지 않았다.
지금까지 블록을 **한 번도 개정하지 않아** 드러나지 않았을 뿐이다. 이 REQ가 처음 개정하므로 함께 닫는다.

## 실측 검증

**변이 검사 2종 — 둘 다 잡혔다**

| # | 변이 | 결과 |
|---|---|---|
| ① | 진단에서 `replace`를 빼기(= 옛 동작) | `quickstart.test.ts` 2건 실패(드리프트·왕복) |
| ② | D21을 `WARN`→`FAIL` | `req-doctor.test.ts` 2건 실패(WARN 상한) |

**도그푸딩 — 실제 소비자 파일 사본**(`44_yammy_sales`의 `AGENTS.md`·`CLAUDE.md`, 원본 미접촉):

```
진단  → [{CLAUDE.md, replace}, {AGENTS.md, replace}]
--apply → ～ 블록 상이 → 교체 (2개 파일 갱신)
재진단 → []                                  ← 왕복 성립
갱신된 AGENTS.md에 "전체 스위트는 통합 직전 1회" 존재 확인
```

**범위 실행이 실제 결함을 잡았다**: `init.test.ts`가 `CLAUDE.template.md`↔`AGENTS.template.md`의
Quick Start 블록 **바이트 동일성**을 강제한다. 처음에 한쪽만 고쳐 실패했고 양쪽을 맞췄다.
(이 REQ가 세우려는 계층 실행 방식이 자기 결함을 잡은 사례다.)

**게이트**
- `npx tsc --noEmit` → exit 0
- `npm run docs:lint` → exit 0
- **변경 범위 단위 그린**: `quickstart`·`req-doctor`·`package-payload` **251/251**,
  `init.test.ts -t "Quick Start"` **5/5**
- 전체 스위트는 **통합 직전 1회**(REQ-100 규칙 적용)

## 리뷰 포인트

1. **DEC-1의 파생이 실제로 이원화를 없앴는가.** `quickstartBackfillTargets`가 `planQuickstart`를
   그대로 쓰므로 "진단이 지목한 파일 = `--apply`가 쓰는 파일"이 정의상 성립한다고 주장한다.
   왕복 테스트가 그것을 고정하는데, 이 오라클로 충분한가 — 깨질 수 있는 조합이 남아 있는가.

2. **DEC-7의 `undefined` 처리.** `shippedQuickstartBlock()` throw와 `planQuickstart` throw를 둘 다
   삼켜 `undefined`(→ D21 OK)로 만든다. 진짜 결함(템플릿 파손)을 조용히 숨기는 것 아닌가 —
   D19/D20/D24 선례("미계산·조회 불가 → OK")를 따랐고 이 검사가 advisory라 게이트가 서 있지
   않다고 판단했다. `package-payload` 테스트가 템플릿 존재를 별도로 지키는 것도 근거로 봤다.

3. **문구(DEC-2).** 부재/드리프트를 나눠 쓰고 해소 명령은 한 번만 붙인다. 드리프트에는
   "마커 안쪽 수정은 덮어써집니다"를 넣었다. 사용자가 이 문구만 보고 **무엇을 잃는지** 알 수 있는가.

4. **DEC-8(반복 WARN 억제 안 함).** 갱신 전까지 매 `req:commit`마다 WARN이 뜬다. D24 선례를 따랐고
   해소가 명령 한 줄이라 억제할 만큼 비싸지 않다고 봤다. WARN 피로 위험을 감수할 만한가.

5. **템플릿 이중화.** 같은 블록이 `CLAUDE.template.md`·`AGENTS.template.md` 두 곳에 복제돼 있고
   테스트가 동일성을 강제한다. 이번엔 양쪽을 고쳤지만, 복제 자체를 없애는 것이 맞는가
   (범위 밖으로 두었다 — 판단을 구한다).

6. **하위호환.** `missingQuickstartFiles` export를 제거했다(참조처는 doctor 1곳 + 테스트뿐이었다).
   내부 함수라 문제없다고 봤는데 맞는가.
