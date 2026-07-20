# REQ-2026-044 설계 — Quality Overlay v2 companion skill

> 정본 결정은 SSOT(`docs/companion-skills-req-plan.md` D1~D9 · `docs/ssot-design/04`). 본 문서는 그 결정을
> 현재 코드/구조에 **5번째 companion skill 추가**로 어떻게 반영할지 기록한다. 정본의 알고리즘·상수·상세 oracle을 복제하지 않는다.

## 현재 상태(변경 대상)

companion skill 전달 파이프라인은 **이미 존재·검증됨**(REQ-2026-020~024). 5번째 스킬 추가는
새 설치 코드가 아니라 **기존 하드코딩 목록 6곳 + 신규 자산 1개 + 발견 포인터 1줄 + 문서**의 문제다.

| 영역 | 정본 위치 | 5번째 추가 시 |
|---|---|---|
| 설치 SSOT 배열 | `bin/init.ts:108-113` `KIT_COMPANION_SKILLS` | 1개 엔트리 추가(→ seed-once·confinement·uninstall 자동 전파) |
| seed-once(force-immune) | `bin/init.ts:459-496` `planCompanionSkills` | 코드 무변경(신규 dest 자동 처리) |
| confinement·symlink 거부 | `planCompanionSkills` lstat + 기존 축 | 코드 무변경 |
| gitignore WARN/strict | `bin/init.ts:1174-1183` `companionAtRisk` | 코드 무변경 |
| uninstall | `bin/uninstall.ts:33,234-237`(`KIT_COMPANION_SKILLS` import) | 코드 무변경(배열 파생) |
| sync | `bin/sync.ts`(companion 미접촉) | 무변경 |
| payload | `package.json` `files`에 `"skills"` glob 존재 | **무변경**(신규 디렉터리 자동 포함) |
| 테스트 하드코딩 목록 | `package-payload.test.ts:135` · `init.test.ts:2280/2518/2535/2770` · `uninstall.test.ts:946` · `migrate.test.ts:327` · `scripts/smoke.mjs:23-28` | 각 목록에 `commitgate-quality` 추가 |
| 사용자 문서 | `docs/agent-prompt.md`/`.en.md` 스킬 표(테스트가 `.toContain(name)` 고정) | 행 추가 |
| 발견 포인터 | 현재 **어떤 always-loaded 진입점도 companion을 명시하지 않음** | 신규 최소 패턴(DEC-5) |

## 핵심 설계 결정

### DEC-1 — 스킬은 5개 area를 **원칙 수준**으로 담는 우산이고, 실행 루프는 형제 스킬을 참조한다

`commitgate-quality`는 요구 area 1~5를 모두 담되 **중복 최소화**한다.

- **자체 소유(어느 기존 스킬도 안 다룸)**: ① 정본 경계(SSOT 비복제·참조), ② 설계 품질(가정 API 실증·조합 검증·추적성), ③ 계획 품질(작은 수직 슬라이스·phase 필수 필드·검증 명령 실증).
- **원칙 + 형제 스킬 포인터**: ④ Test-First → `commitgate-tdd`의 Red→Green→Refactor 루프, ⑤ 버그 진단 → `commitgate-diagnosing-bugs`의 재현·최소화·가설·계측 루프, (요구 정제) → `commitgate-discovery`.

근거: ④⑤의 단계별 실행 루프를 자체 복제하면 형제 스킬과 **내부 중복**이 생기고 drift 부채가 된다(overlay 자체의 SSOT 비복제 원칙과 모순). 우산 스킬은 "언제 어떤 방법을 적용하는가 + 게이트 경계"를 소유하고, 깊은 루프는 형제가 소유한다. 요구의 "필수 내용 5개 area"는 **모두 원칙으로 존재**하므로 충족된다.

### DEC-2 — Pocock 파생물로 취급: 설치 파일에 MIT 고지 + baseline SHA 동행

`commitgate-quality`는 기존 파생 스킬(`tdd`·`diagnosing-bugs`·`discovery`)과 **같은 방법론 계열의 알아볼 수 있는 표현**(seam·red/green·동어반복·델타디버깅·수직 슬라이스)을 재사용하고 형제 스킬을 참조하므로, `skills/ATTRIBUTION.md`의 판단 기준(특정 표현·순서·조어는 파생물)에 따라 **파생물로 취급**한다.

- 설치되는 `SKILL.md` 본문에 **MIT 고지 전문 + `Copyright (c) 2026 Matt Pocock` + baseline SHA `d574778…`** 를 동행(`package-payload.test.ts`의 `UPSTREAM_MIT`/`UPSTREAM_SHA` 불변식 유지).
- `skills/ATTRIBUTION.md` 대응표에 행 추가: `commitgate-quality` ← `grilling`+`domain-modeling`+`tdd`+`diagnosing-bugs`(합성). 개별 적응 내용은 SKILL.md `## 출처·라이선스`에.
- **정직성**: 과다 귀속은 Pocock에 무해하고 과소 귀속은 라이선스 위험이므로 보수적으로 귀속한다.
- **적응 vs 원저작 구분(리뷰 observation 반영)**: SKILL.md `## 출처·라이선스` 절과 ATTRIBUTION 행은 **Pocock에서 적응한 부분**(Test-First·버그 진단 표현·조어)과 **CommitGate 원저작 합성 부분**(정본 경계·설계/계획 품질)을 명확히 구분 표기해, 원저작 내용의 출처가 Pocock으로 오인되지 않게 한다.

> ⚠️ 리뷰 포인트: 이 스킬을 파생물로 볼지(귀속 유지) 원저작으로 볼지(테스트를 파생/원저작으로 분리)는 이 REQ의 유일한 실질 쟁점. 보수적 귀속을 기본으로 하되 Codex 판정에 맡긴다.

### DEC-3 — model-invocation 허용(전제 게이트로 적용 시점 제한)

`disable-model-invocation`을 **설정하지 않는다**(`discovery`만 사용자 호출형). 모델이 설계·AGENT에서 스스로 읽어야 하기 때문. 대신 본문 `## 전제`가 area a/b/c에서만 유효함을 명문화하고, `RUN`/`AWAIT_HUMAN`/`DONE`/`BLOCKED`에서는 즉시 `req:next`로 복귀하도록 한다(`commitgate-tdd`의 전제 게이트와 동형). → `package-payload.test.ts:246`의 "non-discovery는 disable 금지" 분기에 해당.

### DEC-4 — 테스트 하위셋 편입

`commitgate-quality`를 `COMPANION_SKILLS`(마스터)에 넣는다. body-guard(D11: `npm run` 하드코딩 0·HEAD 이동 git 0·숨은 승인 게이트 0)를 **반드시 통과**해야 하므로 AGENT 계열 body-guard 하위셋에 편입한다. 각 하위셋(`AGENT_SKILLS`·`INVESTIGATION`)의 정확한 단언을 Phase 1에서 읽고 스킬이 그 단언을 만족하도록 편입 위치를 확정한다(추측 금지 — 정본은 `tests/unit/package-payload.test.ts`).

### DEC-5 — 발견 포인터: Claude Code 진입점 1줄, 계약(AGENTS)은 불변

요구 B는 "Quick Start **또는** Claude Code 진입점"을 허용한다. 제약 #8(계약 정본 비대화 금지)을 최대로 지키기 위해 **`templates/CLAUDE.template.md`(항상 로드되는 `CLAUDE.md`, 기존 진입점 포인터 §line 27 인근)에 한 줄만** 추가한다. `AGENTS.template.md`(계약)와 byte-identical quickstart 블록(`bin/quickstart.ts`가 관리)은 **건드리지 않는다**.

- 문안: "설계·계획 작성 또는 AGENT 구현 시 `.claude/skills/commitgate-quality/SKILL.md`를 읽어 방법을 적용하되, 다음 행동·승인·커밋은 `req:next`와 `AGENTS.md`만 따른다."
- **범위**: 새 설치(seed-once)에만 자동 도달. 기존 설치는 `docs/agent-prompt`(명시 경로)로 발견 — 정직하게 문서화. 기존 설치로의 backfill 자동화는 **비목표**(후속 옵션).
- Codex가 "새 설치만으론 불충분"으로 판단하면 quickstart 블록(양 파일 + `quickstart.ts` byte-identity) 확장으로 승격하는 대안을 재리뷰. 기본은 최소 표면.

### DEC-6 — 강제력의 정직한 표기

스킬 본문·문서는 "우회 불가" 같은 절대 표현을 쓰지 않는다. 경계는 협조적 텍스트 수준임을 명시(SSOT: `docs/ssot-design/04-user-roles-and-permissions.md`). 자동 발견은 native·호출은 model-decided(확률적)임을 숨기지 않는다.

### DEC-7 — 권한 경계는 협력적 지침 + **존재 검증**(정적 스캐너 아님)

`commitgate-quality`는 **협력적 지침**이다. 권한·증적 경계의 **실제 강제는 CommitGate 실행 게이트**(`req:review-codex`/`req:commit`/`req:doctor`·staged-tree 승인 바인딩 D9·`state.json` 스크래치 취급 D10)이며, 스킬 텍스트가 아니다(SSOT: `docs/ssot-design/04-user-roles-and-permissions.md`).

따라서 이 REQ는 **모든 스킬 문장·셸 문법을 검사하는 일반 정적 스캐너를 만들지 않는다.** 임의의 우회 문법(`git -C <path> add -u`·`printf … > state.json`·`cp … responses/`)을 텍스트 정규식으로 완전 차단하려는 것은 품질 오버레이의 범위를 벗어나고(무한 arms-race·완전성 불가), CommitGate 실행 게이트가 이미 그 강제를 담당한다. 직전 설계의 negative 정적 스캐너(A~D 정규식 + 우회 fixture)는 **폐기**한다.

검증은 **존재(presence)만** 한다:

- **(positive) 필수 경계 문구가 `commitgate-quality` 본문에 존재**(regression: 삭제·약화 시 실패). `## 경계` 절이 다음을 담는다.
  - `` `git commit`·`git push`·`req:commit` 직접 호출 금지.`` → 단언 `/(git commit|git push)[^\n]*(금지|하지 않는다)/` · `/req:commit[^\n]*(금지|하지 않는다|직접 호출)/`
  - `` `state.json`·`responses/`를 직접 수정하거나 스테이징하지 않는다.`` → 단언 `/(state\.json|responses)[^\n]*(직접 수정|수정하거나)[^\n]*(않는다|금지)/` · `/(state\.json|responses)[^\n]*스테이징[^\n]*(않는다|금지)/`
  - `` 다음 행동은 `req:next`가 정본이다.`` → 단언 `/req:next[^\n]*(정본|계산)/`
- **기존 D11 targeted 가드는 상속**: `commitgate-quality`가 `COMPANION_SKILLS`에 들면 기존 D11(`npm run` 하드코딩 0·HEAD 이동 git 0·숨은 승인 게이트 0)이 자동 적용된다. 이는 이미 존재하는 **좁은** 가드이지 신규 일반 스캐너가 아니다 — **확장하지 않는다**.
- **문서 명문화(DEC-6 연장)**: agent-prompt·guarantees 문서가 "이 스킬은 **강제가 아니라 방법**이며, 실제 강제는 **CommitGate 게이트**"임을 명시한다.

**후속(별도 REQ)**: 사람 예외 기록(`review_exception_confirmed`)이 현재 `state.json` 수동 편집이라 자동 안전장치와 충돌한다. 현재 `AWAIT_HUMAN`·series·회차를 검증하고 원자적으로 기록하는 `req:review-exception` 전용 명령을 **별도 REQ**로 다룬다 — 안전 게이트 상태 전이 변경이므로 이 Quality Overlay REQ에 섞지 않는다.

→ 완료 기준 3(권한 불변식 비침범)은 **경계 문구 존재(협력적 지침) + CommitGate 게이트가 실제 강제**로 보장한다(텍스트 스캐너가 아님). Phase 1에 배치(스킬 자산과 같은 phase).

## Phase별 구현

3 phase 수직 슬라이스. 각 phase 종료 시 **전체 스위트 green** 유지(교차-phase 테스트 파손 방지 — `package-payload.test.ts`의 doc-containment가 스킬 추가와 같은 phase에서 문서와 함께 움직이도록 배치). 상세는 `02-plan.md`.

- **Phase 1** — 스킬 자산 + payload 계약(귀속 + agent-prompt 문서 동반).
- **Phase 2** — 설치/uninstall/migrate/smoke 배선 + 카운트 문자열.
- **Phase 3** — 발견 포인터(CLAUDE 진입점) + 문서 카운트/CHANGELOG.

## 변경 파일

**신규**
- `skills/commitgate-quality/SKILL.md`

**수정**
- `skills/ATTRIBUTION.md`(대응표 행)
- `bin/init.ts`(`KIT_COMPANION_SKILLS` 1엔트리 + help "4종"→"5종")
- `templates/CLAUDE.template.md`(발견 포인터 1줄)
- `docs/agent-prompt.md`·`docs/agent-prompt.en.md`(스킬 표 행 + 경계/귀속 언급)
- `docs/quick-start.md`·`docs/quick-start.en.md`(카운트), `docs/guarantees.md`·`.en.md`(카운트)
- `scripts/smoke.mjs`(배열 + "4종"→"5종")
- 테스트: `tests/unit/package-payload.test.ts` · `tests/unit/init.test.ts` · `tests/unit/uninstall.test.ts` · `tests/unit/migrate.test.ts`
- `CHANGELOG.md`(Unreleased)

**무변경(확인)**: `package.json` `files`(skills glob) · `bin/sync.ts` · `bin/uninstall.ts`(배열 파생) · `AGENTS.template.md` · quickstart 블록.

## 하위호환·안전

- **무해성**: 스킬 미설치·미채택 시 핵심 워크플로 완전 동일(설치 코드 무변경, 배열 1엔트리·문서·테스트만).
- **seed-once 불변**: 기존 `planCompanionSkills`가 신규 dest에 자동 적용 — `--force`에도 사용자 편집 보존. init.test.ts에 quality 케이스로 회귀 검증.
- **confinement/symlink**: 기존 축이 신규 dest 자동 커버 — init.test.ts에 symlink 거부 케이스 추가.
- **계약 불변**: `AGENTS.template.md`·`req:next` 로직·5 kind 의미 무변경.
- **payload**: `npm pack` 목록에 신규 디렉터리 자동 포함(payload 테스트로 확인). dot-prefix 금지 유지.
- **ko/en 의미 일치**: agent-prompt·quick-start·guarantees 양쪽 동시 갱신.
