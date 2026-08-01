# REQ-2026-100 리뷰 요청 — phase-1-tiering-contract

## 배경

사용자 제기: **"다른 프로젝트에 적용하고 나면 매 변경건마다 스위트·CI에 수십분~1시간이 걸린다."**

실측 결론은 예상과 달랐다. **CommitGate는 테스트를 강제한 적이 없다** — `req:doctor`·`req:commit`에
테스트 실행 코드 0줄, config 스키마에 테스트 설정 0개, `init`은 CI를 심지 않는다. 씨앗은
[req-new.ts:286](../../scripts/req/req-new.ts)이 **모든 소비자의 `02-plan.md`**에 심는
`Exit: eslint0·typecheck0 · 단위 그린`이다 — 범위·시점이 없어 "매 phase 전체 스위트"로 부푼다.
이 저장소에서 실제로 그랬다(2026-08-01 세션: REQ 4건에 전체 5회·1475초).

설계는 r01 승인(findings 0). 배경·실측 전문은 `00-requirement.md`·`01-design.md`.

## 변경 요약 (이번 staged diff)

| 파일 | 변경 |
|---|---|
| `scripts/req/req-new.ts` | **DEC-4** 스캐폴드에 계층 블록 추가, `Exit:`를 `typecheck0 · 변경 범위 단위 그린`으로, `eslint0` 제거 |
| `AGENTS.template.md` | **DEC-5** §1-1 "테스트를 언제 돌리는가" 신설 — 계층표 + "게이트는 테스트를 실행하지 않는다" |
| `docs/development.md`·`.en.md` | **DEC-6** 거짓 문장 정정 + `--changed` 실측 근거 추가 |
| `tests/unit/docs-stale-claims.test.ts` | **DEC-6** 거짓 문장 **한/영** `STALE_CLAIMS` 등재 |
| `tests/unit/req-new.test.ts` | **DEC-7** 스캐폴드 계층 문구 e2e 고정(실제 `req:new --run` 후 생성된 `02-plan.md`를 읽음) |
| `CHANGELOG.md` | Unreleased — 🔴 **기존 소비자에게 닿는 유일한 경로**라 실질 전달물 |

**런타임 동작 변경 0.** 게이트는 여전히 테스트를 실행하지 않는다. 바뀌는 것은 새로 생성되는
`02-plan.md`의 문구와 문서뿐이다.

## 이 REQ의 핵심 주장

**"덜 돌리기"가 아니라 "시점 옮기기"다.** 전체 스위트는 회귀 판정의 권위로 유지되고, main에
도달하는 경로에는 전량 검증이 그대로 남는다. 기존 `docs/development.md`의 거부 근거
("변경분만 돌리면 영향 분석이 놓친 회귀를 통과시킨다")를 **뒤집지 않고 실측으로 강화**했다.

## 실측 검증

**① 비용 구조** — 순수 18파일 524 tests **6.1초** vs 스폰 32파일 1930 tests **~289초**(테스트당 180배).

**② `--changed` 무용** — `--changed HEAD~1` → 50파일 **전부**, **513초**(전체 295초보다 느림).
루트 파일(`package.json`)이 전 그래프 무효화 + 그래프 폭(`review-codex.ts`←17파일).

**③ 범위 한정 15배** — REQ-099의 실제 변경 → 역의존 7파일 428 tests **20초**.

**④ `stopGate` 비종속** — `docs/configuration.md:15`가 "통합(main 병합) 승인은 **어느 값에서나**
필요합니다"라고 못박으므로 기준점이 세 값 모두에서 존재한다.

**변이 검사 2종 — 둘 다 잡혔다**:

| # | 변이 | 결과 |
|---|---|---|
| ① | `docs/development.md`에 거짓 문장 복원 | `docs-stale-claims.test.ts` 실패(해당 항목 지목) |
| ② | 스캐폴드에서 "통합 직전 1회" 문구 제거 | `req-new.test.ts`의 REQ-100 e2e 실패 |

복구 후 `grep -c MUTATION` = 0 확인.

**게이트(실행 명령)**
- `npx tsc --noEmit` → exit 0
- `npm run docs:lint` → exit 0
- **변경 범위 단위 그린**(이 REQ가 세우는 규칙을 자기 자신에 적용):
  `npx vitest run tests/unit/req-new.test.ts tests/unit/docs-stale-claims.test.ts tests/unit/package-payload.test.ts tests/unit/quickstart.test.ts`
  → **156/156 통과, 15초**
- 전체 스위트는 **통합 직전 1회**로 미룬다(DEC-2 적용).

## 리뷰 포인트

1. **자기 적용의 정당성.** 이 phase는 "전체 스위트를 통합 직전으로 미룬다"는 규칙을 **자기 자신에**
   적용해 전체를 돌리지 않았다. 이것이 정당한가, 아니면 규칙을 세우는 REQ만큼은 전체를 돌려야
   하는가. (범위 선정 근거: 변경한 소스는 `req-new.ts`와 문서뿐이고, `req-new.ts`의 역의존은
   `req-new.test.ts`, 문서 축은 `docs-stale-claims`·`package-payload`·`quickstart`다.)

2. **스캐폴드 문구가 정직한가.** "게이트는 테스트를 **실행하지 않는다**"를 계획서 맨 위에 적었다.
   사실이지만, 읽는 사람이 "그럼 안 돌려도 되네"로 읽을 위험은 없는가 — 바로 아래 계층표가
   그것을 막는다고 판단했다.

3. **`eslint0` 제거(DEC-4).** 이 저장소에 eslint 스크립트가 없음을 확인했다. 그러나 스캐폴드는
   **소비자 저장소**에 심긴다 — 소비자에는 있을 수 있다. `Exit:`에서 빼고 `## 완료`에만
   "해당 시 lint"로 남겼는데, 이 처리가 맞는가.

4. **전달 경로의 한계.** `AGENTS.md`는 `sync` 대상이 아니므로 **기존 소비자에게는 CHANGELOG로만**
   전달된다. CHANGELOG에 "기존 저장소는 표를 직접 옮기세요"를 명시했다. 이 정도로 충분한가,
   아니면 `doctor` WARN 같은 능동 통지가 필요한가(그러면 범위가 크게 는다).

5. **DEC-2의 안전 논증.** "phase 커밋의 회귀는 feature 브랜치에 머물고 통합 직전 전량 검증이
   잡는다" — 반례가 있는가.

6. **누락된 표면.** `docs/workflow.md`는 테스트를 언급하지 않고 `bin/quickstart.ts`도 무관함을
   확인했다. 계층을 적어야 하는데 빠뜨린 문서가 있는가.
