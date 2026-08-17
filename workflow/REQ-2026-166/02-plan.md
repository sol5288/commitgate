# REQ-2026-166 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님). 큰 phase는 런타임 분할(예: B→B1/B2/B3)로 검수 면적을 줄인다.

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**. 아래는 비용을 줄이기 위한 실행 시점 권고다.
> - **phase 진행 중**: 변경한 소스를 import하는 테스트만(빠른 피드백). 예: `grep -rl "<변경한 모듈>" tests/`
> - **통합(main 병합) 직전 1회**: **전체 스위트**. 범위 한정은 이것을 **대체하지 않는다** — 영향 분석은 놓친 회귀를 통과시킨다.

## Phase 1 — 자산 축의 설치 신호 전제 (DEC-1) (`phase-1-install-signal-prelude`)

**책임**: 설치가 아닌 디렉터리에서 자산 축이 `action` 을 내지 않게 한다. 정상 설치본의 판정은 불변.

**입력**: `lib/setup-gate.collectInstallSignals` (기존·재구현 금지) · `assetPrelude` 의 현행 순서.

**산출물**
| 파일 | 변경 |
|---|---|
| `scripts/req/lib/upgrade-status.ts` | `UpgradeStatusInput.installSignals` 추가 · `assetPrelude` 4단 판정 |
| `bin/check.ts` | `collectUpgradeStatusInput` 이 `collectInstallSignals(root, cfg.ticketRoot)` 를 채운다 |
| `tests/unit/upgrade-status.test.ts` | `healthy()` 에 신호 채움 · G4 양방향 |
| `tests/unit/check-install-signal-wiring.test.ts` (신규) | G5 — 빈 임시 디렉터리 실측 배선 |

**선행 조건**: 없음(설계 승인 완료).

**독립 검증**
```
npx tsc --noEmit -p tsconfig.json
npx vitest run tests/unit/upgrade-status.test.ts tests/unit/check-install-signal-wiring.test.ts
```
리뷰어가 직접 재현할 수 있는 실측: 빈 디렉터리를 만들고 `node bin/commitgate.mjs check --dir <빈 곳>` →
C7 에 `action` 이 0 이어야 한다(수정 前에는 `review-persona` 1건).

**Exit**: typecheck0 · 위 두 파일 그린 · Codex phase 리뷰 승인.

## Phase 2 — `req:*` 사용법 표면 (DEC-2) (`phase-2-req-verb-help`)

**책임**: `VERB_MODULES` 의 `req:*` 전부가 `-h`/`--help` 로 사용법을 낸다(exit 0). 다음에 추가될 verb 도
가드에 자동으로 걸린다.

**입력**: `bin/dispatch.mjs` 의 `VERB_MODULES`(등록부) · 각 verb 파서가 **실제로** 해석하는 플래그 ·
`req:delegate` 의 현행 출력 형태.

**산출물**
| 파일 | 변경 |
|---|---|
| `scripts/req/lib/verb-help.ts` (신규) | `REQ_VERB_HELP`(구조) · `renderVerbHelp` · `wantsHelp` · `helpGate` |
| `scripts/req/req-*.ts` · `review-codex.ts` (12) | `main` 첫 줄에 `if (helpGate('<verb>', argv)) return` |
| `tests/unit/verb-help.test.ts` (신규) | G1(등록부 파생) · G3(**파싱 결과 차이**로 수용 확인 + 앵커 2종) |
| `tests/e2e/verb-help-cli.test.ts` (신규) | G2 — `bin/commitgate.mjs` spawn |

🔴 `req:delegate` 는 기존 **내용**을 그대로 옮긴다(문구 개선 아님) — 정본이 두 곳이 되지 않게.
   줄 정렬은 공용 렌더러를 따르므로 바이트 동일은 요구하지 않는다.
🔴 `req:review-codex` 는 인자 검사보다 **앞**에 둔다(실측: 파싱 前에 죽는다).

**선행 조건**: phase-1 승인(파일이 겹치지 않지만 리뷰 면적을 나눈다).

**독립 검증**
```
npx tsc --noEmit -p tsconfig.json
npx vitest run tests/unit/verb-help.test.ts tests/e2e/verb-help-cli.test.ts
node bin/commitgate.mjs req:confirm --help    # exit 0 · 사용법
```
G3 는 실행이 아니라 **파싱**으로 확인한다(부작용 없음). 문서의 플래그는 파싱 결과를 바꾸고, 상존하지
않는 이름은 바꾸지 않아야 한다 — `req:review-codex` 의 파서가 permissive 하다는 실측 때문에 "거부"가
아니라 "차이"가 기준이다(설계 G3 참조). 파서 계약 엄격화는 **이 REQ 의 범위가 아니다**.

**Exit**: typecheck0 · 위 두 파일 그린 · Codex phase 리뷰 승인.

## Phase 3 — 배포 부기 (`phase-3-release-notes`)

**책임**: 사용자에게 보이는 변화를 CHANGELOG 에 적고 버전을 올린다.

**산출물**: `CHANGELOG.md` · `package.json`/`package-lock.json`(patch bump).

**선행 조건**: phase-1·2 승인.

**Exit**: typecheck0 · Codex phase 리뷰 승인.

## 완료
- 게이트 해당분(typecheck·해당 시 lint) · **통합 직전 전체 스위트 1회** · 사용자 main 머지(별도 승인).
