# REQ-2026-140 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**. 아래는 비용을 줄이기 위한 실행 시점 권고다.
> - **phase 진행 중**: 변경한 소스를 import하는 테스트만(빠른 피드백). 예: `grep -rl "<변경한 모듈>" tests/`
> - **통합(main 병합) 직전 1회**: **전체 스위트**. 범위 한정은 이것을 **대체하지 않는다** — 영향 분석은 놓친 회귀를 통과시킨다.

🔴 **DEC-9**: phase 1~4는 `auto`를 **사용자에게 노출하지 않는다**(스키마 enum·setup 선택지 불변).
그래서 그 구간의 어떤 커밋도 문서와 모순되지 않는다. 노출과 문서 정정은 **phase-5의 같은 커밋**이다.

## Phase 1 — `auto` 타입 + 통합-지연 술어 (`phase-1-auto-type-and-predicate`)

범위:
- `StopGate`에 `'auto'` 추가 · `AUTO_APPROVE_OF.auto = 'low-only'` · `isStopGate`.
- `defersToIntegration(sg)` 술어 도입, 실측 8곳 치환:
  `req-commit.ts:132` · `req-confirm.ts:161` · `req-next.ts:868·1011·1155` · `bin/delivery.ts:460·465·467`.
- `requiredConfirmScope` 오버로드·`userConfirmGate`·doctor D28·D32가 `auto`를 `merge`와 같게 처리.
- 🔴 **스키마 enum·`bin/setup.ts` 선택지는 변경하지 않는다**(DEC-9).

Exit:
- `npx tsc --noEmit` 0
- 🔴 **소스 가드**: `stopGate` 문맥의 `=== 'merge'` 리터럴 비교가 술어 정본 파일 밖에 남지 않는다
- 🔴 **등가 테스트**: 같은 입력에 `merge`·`auto`가 같은 판정(커밋 게이트·확인 scope·delivery 멤버 판정)
- 🔴 **스키마가 여전히 `auto`를 거부한다**(노출 미착수 확인 — DEC-9의 오라클)
- `npx vitest run tests/unit/policy-snapshot.test.ts tests/unit/req-commit.test.ts tests/unit/req-doctor.test.ts tests/unit/confirm-verb.test.ts tests/unit/delivery.test.ts tests/unit/req-next.test.ts`
- Codex 승인.

## Phase 2 — 위임 레코드 모델(순수) (`phase-2-delegation-model`)

범위: `scripts/req/lib/delegation.ts` — 행 타입 3종 · JSONL 파싱(손상 행 **fail-closed**) · fold ·
`delegationVerdict` · `DelegationDenyReason` union + `Record<DelegationDenyReason, string>` 안내 매핑.

범위에 **DEC-4a**(scope ↔ 병합 범위 결속) 판정 포함 — 귀속 계산은 `verifyRangeDeep` 분류를 재사용한다.

Exit:
- 거부 사유 **전수 발화** 테스트(사유마다 그 사유가 실제로 나오는 입력)
- 🔴 `trunk-branch-mismatch`와 `trunk-moved`가 **서로 독립**으로 발화(같은 SHA·다른 이름 / 같은 이름·다른 SHA)
- 🔴 **DEC-4a**: 티켓 A 위임 + 범위에 B 커밋 → `scope-out-of-range` · 귀속 **판정 불가** 커밋 1개만 있어도 거부
- 손상 행·미지 `kind`가 통과하지 않음
- 만료 판정이 **주입된 시각**으로 결정(테스트가 시계를 고정할 수 있어야 한다)
- Codex 승인.

## Phase 3 — `req:delegate` verb (`phase-3-delegate-verb`)

범위: 발급·철회·status · 원장 append + 커밋 · **시각·SHA·만료를 도구가 읽음** · 승인 문장 verbatim ·
`--allow-push`/`--allow-bypass`/`--high-risk` · dispatch·help 배선.

Exit:
- 실 git 픽스처 왕복(발급→status→철회)
- 🔴 **DEC-5a**: 플래그 없이 발급하면 `local_merge=true` · `origin_push=false` · `bypass_protection=false`
- `--sentence` 누락·빈 문자열은 거부(권한 근거가 비면 발급하지 않는다)
- Codex 승인.

## Phase 4 — `integrate` 배선 (`phase-4-integrate-auto`)

범위: 위임 요구 · **DEC-5 불변식 5항** · CAS 선점 · fail-closed 매트릭스 전 항목 ·
`origin_push`/`bypass_protection` 분리 실행 · 원장 `performed`·최종 보고의 bypass 사용 사실.

Exit (사용자 명시 테스트):
- `auto` + 유효 위임 + 검증 SHA 일치 → 최종 integrate RUN
- `auto` + 위임 없음 → `AWAIT_HUMAN`
- trunk/feature SHA 변경 → 중단 · 위임된 delivery 구성 변경 → 중단
- 🔴 **같은 SHA를 가리키는 다른 trunk 이름으로 바꿔치기** → `trunk-branch-mismatch`로 중단
- 🔴 **한 브랜치에 두 티켓이 쌓인 상태**에서 한쪽 위임만으로 통합 시도 → `scope-out-of-range`로 중단
  (이 저장소의 현재 체인이 그 모양이므로 픽스처가 인위적이지 않다)
- push/bypass 권한 **각각 분리** 검사 · 권한 소비 후 재실행 → 중단
- HIGH · `hardCap` · BLOCKED는 위임이 있어도 중단
- `phase`/`req`/`merge` 무회귀
- 🔴 **소비 커밋 `C`가 strict에서 `bookkeeping`으로 분류됨을 실제 `verify-range`로 확인**(주장 아님)
- Codex 승인.

## Phase 5 — 노출 + 문서 (`phase-5-expose-and-docs`)

범위: config 스키마 enum에 `auto` · `bin/setup.ts` 선택지와 `STOP_GATE_HIGH_NOTICE`의 `auto:` 절 ·
`req:next` 종단 행동 · README(ko/en) · `docs/configuration*.md`의 **"없습니다" 절 정정** ·
`docs/workflow*.md` · 폐기 문구 등재 · CHANGELOG · 비용·`hardCap`·push·bypass·**철회 방법** 명시.

Exit: `npm run docs:lint` · `docs-stale-claims` + **폐기 문구 변이 검사** · `setup` 고지 매핑 테스트 갱신 ·
Codex 승인.

## 완료
- 게이트 해당분 · **통합 직전 전체 스위트 1회** · `verify-range --strict` ·
  🔴 **사람 승인으로 main 머지** — 이 REQ는 자기가 만든 `auto` 경로로 통합하지 않는다(설계 참조).
