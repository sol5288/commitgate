# REQ-2026-044 리뷰 요청 — 설계(design)

## 배경

CommitGate 패키지에 Claude Code용 5번째 companion skill `commitgate-quality`(Quality Overlay v2)를 추가한다.
Superpowers 방법론의 장점 중 **요구 정제·설계/계획 품질·Test-First·증거 기반 검증**만 방법론 텍스트로 흡수하고,
Superpowers 플러그인·스킬·런타임은 설치·실행·의존성 추가하지 않는다. companion 전달 파이프라인은
이미 존재·검증됨(REQ-2026-020~024)이라 이번 작업은 **5번째 스킬 추가**(하드코딩 목록 6곳 + 자산 1 + 포인터 1줄 + 문서)다.

## Phase 분해 (phase 리뷰 경계 — 리뷰어 주의)

이 REQ는 4 phase 수직 슬라이스로 분해된다(phase-4는 통합 前 사람 리뷰의 P1 수정 — 상태별 계약 명확화, `00/01` 불변). **각 phase 리뷰는 그 phase의 staged diff만 판정한다.**
다른 phase가 소유한 산출물이 현재 phase diff에 없는 것은 결함이 아니다 — 그 phase에서 검증된다.

- **phase-1-skill-asset**: `skills/commitgate-quality/SKILL.md`(신규) · `skills/ATTRIBUTION.md` · `docs/agent-prompt.md`/`.en.md` · `tests/unit/package-payload.test.ts`(payload·MIT·frontmatter·경계문구 존재 oracle). 범위 = **스킬을 패키지 payload에 넣고 계약을 고정.** 설치·발견 포인터는 여기 없어야 정상이다.
- **phase-2-install-wiring**: `bin/init.ts`의 `KIT_COMPANION_SKILLS` +1엔트리 · `init/uninstall/migrate.test.ts` · `scripts/smoke.mjs`. 범위 = **스킬을 실제 설치 경로에 배선**(설치는 phase-1이 아니라 **여기서** 검증). seed-once·confinement·uninstall은 배열 파생으로 자동 전파.
- **phase-3-discovery-docs**: `templates/CLAUDE.template.md` 발견 포인터 1줄 + 설치 산출물 oracle(`tests/unit/init.test.ts`) · 문서 카운트 · `CHANGELOG.md`. 범위 = **새 세션 발견 포인터**(CLAUDE 포인터는 phase-1이 아니라 **여기서** 검증).
- **phase-4-state-flow-fix**(통합 前 리뷰 P1): `skills/commitgate-quality/SKILL.md`(5-kind 문구 분리) · `tests/unit/package-payload.test.ts`(5-kind 회귀 oracle) · `init/migrate/uninstall.test.ts`·`smoke.mjs`(P2 stale "4종/4개"→5, smoke 진단 `/4`→동적). 범위 = **`req:next`의 5개 kind(`RUN`/`AGENT`/`AWAIT_HUMAN`/`DONE`/`BLOCKED`)의 상이한 계약 의미를 SKILL.md에서 분리**(기존 "일괄 즉시 req:next" 뭉갬 수정 — AGENT는 작업 수행 후 재조회) + 수량 표기 정합. **DEC-7(협력적 지침)의 상태별 계약 명확화이며 `00/01`의 요구·설계 결정을 바꾸지 않는다.**

## 변경 요약 (설계)

- **신규 자산**: `skills/commitgate-quality/SKILL.md` — area 1~3(정본 경계·설계 품질·계획 품질)은 자체 소유, area 4~5(Test-First·버그 진단)와 요구 정제는 원칙 + 형제 스킬(`commitgate-tdd`/`diagnosing-bugs`/`discovery`) 참조(DEC-1).
- **설치**: `bin/init.ts:108-113` `KIT_COMPANION_SKILLS`에 1엔트리 추가만으로 seed-once·confinement·symlink 거부·gitignore 경고·uninstall이 **자동 전파**(설치 코드 무변경). `package.json` `files`는 `skills` glob이라 무변경.
- **발견 포인터**(DEC-5): `templates/CLAUDE.template.md`(항상 로드되는 CLAUDE.md)에 1줄. **`AGENTS.template.md`(계약)·quickstart 블록은 불변**(제약 #8). 새 설치만 자동 도달, 기존 설치는 `docs/agent-prompt`(명시 경로)로 발견 — 정직 문서화.
- **권한 경계(DEC-7) — 협력적 지침 + 존재 검증**: 스킬 본문에 필수 경계 문구(직접 커밋/push/`req:commit` 금지·`state.json`/`responses/` 직접 수정·stage 금지·`req:next` 정본)가 **존재**함만 검증한다. **모든 셸 문법 우회를 잡는 일반 정적 스캐너는 만들지 않는다**(범위 초과·완전성 불가). 실제 강제는 CommitGate 실행 게이트(SSOT `04`). 문서가 "방법이지 강제 아님"을 명시. 사람 예외 기록 전용 명령(`req:review-exception`)은 별도 REQ.
- **테스트/문서**: 6개 하드코딩 목록(`package-payload`·`init`·`uninstall`·`migrate`·`smoke`) + agent-prompt ko/en 표 + 카운트 문자열.
- 3 phase 수직 슬라이스, 각 phase 종료 시 전체 스위트 green.

## 리뷰 포인트 (중점)

1. **DEC-2(유일한 실질 쟁점) — 귀속**: `commitgate-quality`를 Pocock 파생물로 취급해 설치 파일에 MIT 고지 + baseline SHA를 동행시키고 `COMPANION_SKILLS` 불변식(MIT/SHA 요구)에 편입하는 것이 타당한가? 이 스킬은 방법론 계열 표현(seam·red/green·동어반복·델타디버깅)을 재사용하고 형제 스킬을 참조한다. 보수적 귀속(과소 귀속 회피)을 기본으로 하되, 원저작 합성 부분이 상당하므로 "테스트를 파생/원저작으로 분리"하는 대안도 가능하다. 어느 쪽이 옳은가?
2. **권한 불변식(DEC-7, 스코프 정정됨)**: 스킬이 `req:next`의 5 kind 의미·`state.json`/`responses` 비스테이징·직접 커밋 비호출 경계를 침범하지 않는가? 이 REQ는 **협력적 지침 + 경계문구 존재 검증**으로 한정하고 일반 정적 스캐너를 폐기했다(직전 5R P1이 스캐너 완전성 문제였음 — 게이트가 실제 강제이므로 텍스트로 우회 완전차단을 약속하지 않는 것이 정합). 이 스코프가 타당한가?
3. **정본(SSOT) 비복제**: 01-design이 알고리즘·상수·상세 oracle을 복제하지 않고 경로·라인·DEC로 참조하는가? 스킬 본문이 area 4/5를 형제 스킬로 참조(DEC-1)하는 것이 "필수 내용 5개 area" 요구를 충족하는가, 아니면 자체 서술이 필요한가?
4. **발견 포인터 최소성(DEC-5)**: 계약(AGENTS) 불변 + CLAUDE 1줄이 요구 B("새 세션이 적용 시점을 안다")를 충족하는가, 아니면 기존 설치 backfill(quickstart 블록 확장)까지 이번 범위여야 하는가?
5. **phase 경계·green 유지**: doc-containment 단언을 Phase 1에 문서와 함께 두어 교차-phase 파손을 피하는 배치가 타당한가?
6. **Phase 4 delta(이번 재리뷰의 변경분)**: 통합 前 사람 리뷰에서 P1 발견 — 스킬이 `req:next`의 여러 kind를 한 줄로 "즉시 `req:next`"로 뭉갬. 올바른 계약은 **5개 kind 각각**이다: `RUN`=출력 명령 실행 후 재조회, `AGENT`=phase 작업 수행·`git add` 후 재조회, `AWAIT_HUMAN`=정지·승인 문장, `DONE`=완료 보고·통합/릴리즈 비추정, `BLOCKED`=재시도 금지·사람 보고. 02-plan에 Phase 4(5-kind 분리 + 회귀 oracle + 수량/진단 정합)를 추가했다. 이 phase 계획이 `AGENTS.md` 계약과 정합하며, `00-requirement.md`·`01-design.md`의 요구·설계 결정을 바꾸지 않고 **문구 명확화·수량 정합에 한정**되는가? 회귀 oracle이 "5개 kind 올바른 행동 + 뭉갠 문구 부재"를 실제로 검증하는가?

정본 계약은 `AGENTS.template.md`, 다음 행동 정본은 `req:next`. 이 스킬은 그 아래 방법론 자산이다.
