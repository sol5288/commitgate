# REQ-2026-010 리뷰 요청

## 리뷰어 역할 (PM)

너는 이 프로젝트의 **PM**이다. 이 개선건의 **적절성과 완성도**를 확보할 책임이 있다.

- 아래 리뷰 요청서를 검토하고 이후 액션에 대한 지시를 내려라.
- **Builder(Claude)가 짜 놓은 리뷰 프레임에 갇히지 마라.** 아래 "리뷰 포인트"는 심사 범위의 **하한**이지 상한이 아니다. 요청서가 묻지 않은 결함도 스스로 분석해 지적하라.
- 개발 부채가 남지 않도록 하라. 지금 넘어가면 나중에 갚아야 하는 것을 식별하라.

**단, 판정은 `machine.schema.json` 필드로만 낸다:**

- `findings[]` = **이 변경을 지금 승인하면 안 되는 이유**만. 지적이 1건이라도 있으면 `commit_approved=no`(워크플로가 모순으로 거부한다).
- `observations[]` = 비차단 의견 — 스타일 취향, 범위 밖 개선, 후속 티켓 후보. 승인 판정에 영향 없음.
- 결함이 없으면 `findings` 없이 승인하고, 하고 싶은 말은 `observations`에 남겨라.
- `next_action` = Builder가 다음에 할 일.

리뷰 종류/범위는 프롬프트의 **REVIEW_KIND**를 따른다. design=설계문서 00/01/02(구현 diff 없음 정상), phase=staged diff.

> 이 페르소나 블록이 `codex-request.md`에 손으로 들어간 것은 이번이 **마지막**이다. phase-1b가 이것을 `review-codex.ts`의 프롬프트 조립 단계로 옮긴다 — 그게 이 티켓의 요지다.

---

## 현재 phase 리뷰: `phase-4-docs-version` (마지막)

phase-3b(`52d01ea`)까지 승인·커밋됐다. 남은 것은 문서와 버전이다.

staged 변경 (4파일 + `codex-request.md`):
- `README.md` / `README.en.md` — Quick Start를 **"긴 프롬프트 붙여넣기"에서 "요구사항만 입력"**으로 교체. 진입점 표 · `req:next` 루프 표(kind·exit) · "페르소나는 도구가 주입" 절 · 설치 표에 신규 파일 5종 · `--no-agent-entrypoints` · 명령표에 `req:next` · 설정표에 `reviewPersonaPath`.
- `package.json` / `package-lock.json` — `0.3.1` → **`0.4.0`**. `description`에 `next` 추가.

### 이것이 이 티켓의 목적이었다

README의 Quick Start가 요구하던 **60줄짜리 프롬프트**가 사라졌다. 그 안에 있던 세 가지가 각각 도구로 내려갔다.

| 사라진 프롬프트 조각 | 지금 어디에 있나 |
|---|---|
| "일반 구현으로 처리하지 말고 CommitGate를 써라" + 요구사항 4칸 | `.claude/skills`·`.claude/commands`·`.cursor/rules`·`CLAUDE.md` (phase-3a) |
| "PM으로서 리뷰하라 / 리뷰 프레임에 갇히지 마라" | `review-codex.ts`가 `workflow/review-persona.md`를 프롬프트 첫 블록으로 주입 (phase-1a/1b) |
| "끊지 말고 끝까지 진행하라" + 통제점 목록 | `req:next`가 `RUN`/`AGENT`/`AWAIT_HUMAN`/`DONE`/`BLOCKED`로 계산 (phase-2) |

### 계획서와의 편차 (의도적, 판단 요청)

`02-plan.md`의 phase-4는 "`package.json` + `package-lock.json` — `0.4.0` (**분리 커밋**)"이라고 적었다. **그대로 할 수 없다.** `req:commit`은 phase 승인 1건당 source 커밋을 **정확히 1개** 만든다(그다음 evidence-finalize 커밋). 분리 커밋을 하려면 `phase-5-version-bump`를 추가해야 하는데, 그러면 `02-plan.md`를 수정해야 하고 그건 **design 바인딩 해시를 깨뜨려** 설계 재승인(D13)이 필요하다.

그래서 문서와 버전을 **한 커밋**에 넣었다. 이 판단이 옳은지 봐 달라. 대안은 (a) 이대로 진행, (b) design 재리뷰를 감수하고 phase 분리, (c) 버전 bump를 후속 티켓으로.

### 실행한 검증 (증거)

- `npm run typecheck` → 0 · `npm test` → **637/637 green**
- `npm run smoke` → pack tarball 설치본의 `commitgate` bin 실행 OK (init dry-run + uninstall planner)
- `npm pack --dry-run --json`(격리 캐시) → `commitgate@0.4.0`, 23파일, 98,053 B

### phase-4 R1 지적 반영 (라운드 1 → 2)

| # | 지적 | 반영 |
|---|---|---|
| P2 (README.md) | Command Cheat Sheet가 **실행 불가능한 bare `req:*`**를 공개 명령처럼 안내한다. 설치되는 것은 PATH 실행 파일이 아니라 `package.json` 스크립트다. 표를 따라 `req:next 2026-002`를 치면 command not found | 표의 6항목 전부를 `npm run req:* -- …` 실제 호출 형태로 교체. "PATH 실행 파일이 아니라 `package.json` 스크립트이며 npm은 `--` 구분자가 필요하다"를 명시하고 npm/pnpm/yarn 3형태 예시 추가 |
| P2 (README.en.md) | 영문도 동일 | 동일 수정 |

**이 결함은 내 변경 이전부터 있었지만**(기존 표가 `req:new <slug> --run` 형식), `req:next`를 같은 형식으로 추가하면서 확산시켰다. 그리고 이 phase의 목적이 "긴 프롬프트를 지우고 README만 보고 진행 가능하게" 만드는 것이므로 정확히 급소다.

부수: 제거 절차의 "빈 디렉터리(`scripts/`·`workflow/`)" 문구에 `.claude/`·`.cursor/` 추가(양쪽 README) — `uninstall` 출력은 phase-3b에서 이미 갱신했는데 문서가 뒤처져 있었다.

**README 주장과 실제 코드 대조**(재검증):
- `NEXT_EXIT_CODES` = `{"RUN":0,"AGENT":0,"BLOCKED":2,"AWAIT_HUMAN":10,"DONE":11}` — README 표와 일치
- `DEFAULTS.reviewPersonaPath` = `"workflow/review-persona.md"` — 설정표와 일치
- `commitgate --help`에 `--no-agent-entrypoints` 존재

### 이 phase의 리뷰 포인트

- **`AGENTS.template.md`의 명령표도 bare `req:*`다**: 이 phase의 staged에 없다(3a에서 커밋됨). 같은 결함인가, 아니면 그 문서는 "명령 이름 목록"이라 허용되는가? 후속으로 미뤄도 되는가?
- **버전이 minor인 것이 옳은가**: public 계약에 **추가**된 것 — `req.config.json`의 `reviewPersonaPath` 키, `package.json`에 주입되는 `req:next` 스크립트, init이 까는 파일 5종. **제거·변경**된 것은 없다. `machine.schema.json`(verdict)은 불변이라 `MACHINE_SCHEMA_VERSION`은 `1.1` 유지. 그런데 `review-codex.ts`가 persona 부재 시 **throw**하게 됐다 — 기존 설치본에서 `--force` 없이 업그레이드하면 스크립트가 안 바뀌므로 무해하지만, **major로 봐야 할 breaking**은 아닌가?
- **`0.4.0`의 breaking 후보를 빠뜨리지 않았는가**: `ResolvedConfig`에 필수 필드 2개(`reviewPersonaPath`, `reviewPersonaPathAbs`)가 추가됐다. `loadConfig`를 직접 import하는 외부 코드가 있다면 타입이 바뀐다. `DEFAULTS`도 키가 늘었다. semver 관점에서 minor가 맞는가?
- **README가 실제 동작과 일치하는가**: `req:next` 예시 출력(`RUN`/명령 렌더링), exit 표(0/0/10/11/2), `--no-agent-entrypoints`, `reviewPersonaPath: null`. 하나라도 실제와 다르면 사용자가 막힌다.
- **README.en.md의 `req:next` 예시 출력이 한국어인 것**: 도구가 한국어로 출력하므로 실제와 일치한다. 영어 README에 그대로 두는 것이 맞는가, 번역해서 **실제와 다르게** 만드는 것보다 나은가?
- **제거 절차 문서가 신규 파일을 반영하는가**: "빈 디렉터리(`scripts/`·`workflow/`)" 문구가 `.claude/`·`.cursor/`를 빠뜨리지 않았는가? (`uninstall` 출력은 phase-3b에서 갱신했다)
- **계획서 편차**(위)를 어떻게 처리해야 하는가.
- 범위 이탈: tag·publish·release·main 반영 **미수행**. `templates/`·`bin/`·`scripts/` 미변경.

---

## 이전 phase 리뷰: `phase-3b-entrypoint-uninstall` (승인됨, `52d01ea`)

phase-3a(`f66d45c`)까지 승인·커밋됐다. 진입점은 이제 설치되지만 **제거 계획(planner)은 그것을 모른다.**

staged 변경 (코드 3파일 + `codex-request.md`):
- `bin/uninstall.ts` — `tool` 분류를 `{destRel, srcRel}` 매핑으로 재작성(진입점 3종 + `AGENTS.commitgate.md`), `CLAUDE.md`를 `ambiguous`로, 잔여물 경고에 `.claude/`·`.cursor/` 추가.
- `bin/init.ts` — **phase-3a observation 반영**(아래).
- `tests/unit/uninstall.test.ts` — 8건 신설 + "전부 제거" 픽스처를 SSOT 기반으로 갱신.

### 왜 `tool` 분류를 고쳐야 했나

기존 코드는 원본을 `join(PACKAGE_ROOT, rel)`로 찾았다 — **`src === dest`를 가정**한다. 진입점은 `templates/claude-skill.md` → `.claude/skills/commitgate/SKILL.md`이고, `AGENTS.commitgate.md`의 원본은 `AGENTS.template.md`다. 그대로 두면 원본을 못 찾아 바이트가 같은데도 `differs`로 오분류하고, 제거 후보에서 빠진다.

`KIT_SCHEMA_RELPATHS`(schemaPath 축)는 여전히 건드리지 않았다.

### 분류 결정

| 대상 | 분류 | 근거 |
|---|---|---|
| 진입점 3종 | `tool` (removable, 편집 시 `review`) | CommitGate 전용 경로 — 바이트 비교로 origin 판별 가능 |
| `AGENTS.commitgate.md` | `tool` (원본 = `AGENTS.template.md`) | init이 놓은 사본. 사본이 없는 정상 설치에서는 `absent` |
| `CLAUDE.md` | `ambiguous` (자동 제거 금지) | `AGENTS.md`와 같은 계층 — 부재 시에만 생성, `--force`로도 미덮어씀. 사용자 파일일 수 있다 |

### phase-3a observation 반영 (init.ts)

> "이미 `AGENTS.commitgate.md`가 존재하는 경우 `--force` 없이 보존하면서 경고 문구는 설치된 사본처럼 읽힐 수 있으므로, 후속 정리에서 경고 문구 분기를 검토하라."

경고를 3분기로 나눴다: 새로 설치 / 기존 사본 보존(`--force`로 덮어쓰기 안내) / dry-run 예정. 편집한 사본을 그대로 둔 사용자가 "새 템플릿을 받았다"고 오해하지 않게 한다. **`bin/init.ts`가 이 phase 범위에 들어온 이유가 이것이다**(계획서상 3b는 uninstall만이었다).

### 실행한 검증 (증거)

- `npm run typecheck` → 0 · `npm test` → **637/637 green**(uninstall 40건)
- **실 sandbox**: tarball 설치 → `commitgate uninstall` 계획 확인
  - `rm -f`에 진입점 3종 포함, 코어 10종과 함께 13개
  - `CLAUDE.md`·`AGENTS.md`는 "자동 제거 대상이 아닙니다"로 keep, `rm .*CLAUDE.md` **0건**
  - `rm -rf` 1건은 문서화된 npx 캐시 정리(`$(npm config get cache)/_npx`)로 repo와 무관 — `.claude/`·`.cursor/` 통삭제 제안 없음
  - 잔여물 경고에 `.claude/`·`.cursor/` 반영
- **읽기 전용 계약 유지**: `bin/uninstall.ts`에 fs 쓰기 API 식별자가 없다는 기존 구조 테스트 통과.

### 이 phase의 리뷰 포인트

- **`src≠dest` 매핑에 빠진 소비 지점이 있는가**: `tool` 분류 외에 `unknownKitFiles`·`renderPlan`·`scaffoldCommits`가 여전히 `src===dest`를 가정하지 않는가?
- **`AGENTS.commitgate.md`를 `tool`로 둔 것이 옳은가**: 사용자가 그것을 `AGENTS.md`에 병합하고 **편집**했다면 `differs` → `review`가 된다. 그런데 이 파일은 "병합 후 지우라"고 안내된 **임시 파일**이다. `ambiguous`가 더 맞지 않는가?
- **`CLAUDE.md`를 `ambiguous`로 둔 것이 옳은가**: `AGENTS.md`는 Codex가 읽는 계약이라 보수적으로 다뤘다. `CLAUDE.md`도 같은 무게인가, 아니면 진입점 3종처럼 `tool`이어야 하는가? 판단 기준이 "CommitGate 전용 경로인가"라면 `CLAUDE.md`는 전용이 아니다 — 그 기준이 일관되게 적용됐는가?
- **미분류 파일 보호가 `.claude/` 아래에도 필요한가**: `scripts/req/` 안의 미지 파일은 `unknownKitFiles`로 보호한다. `.claude/skills/commitgate/` 안에 사용자가 다른 파일을 넣었다면? 지금은 아무 보호가 없다.
- **`init.ts` 변경이 이 phase에 들어온 것이 정당한가**: 3a의 observation을 3b에서 처리했다. 별도 티켓이어야 하는가?
- **픽스처 갱신이 단언을 약화시키지 않는가**: "전부 제거" 테스트가 `KIT_AGENT_ENTRYPOINTS.map(e=>e.dest)`를 쓴다. 하드코딩을 없앤 것이 의도("전부 제거")를 보존하는가?
- 범위 이탈: README·버전 미변경(4), `templates/` 미변경.

---

## 이전 phase 리뷰: `phase-3a-entrypoint-install` (승인됨, `f66d45c`)

phase-1a(`e4a3796`)·1b(`acee2eb`)·2(`fdd20de`)가 승인·커밋됐다. 페르소나는 도구가 주입하고(이 프롬프트 첫 블록), `req:next`가 다음 행동을 계산한다 — **이 phase의 대상도 `req:next`가 지목했다.**

이 phase는 P1(진입점)을 설치한다. **본문 SSOT는 `AGENTS.md`이고 여기 깔리는 것은 얇은 포인터다.** 계약 본문을 복제하면 REQ-2026-009에서 겪은 것과 같은 drift 부채가 된다.

staged 변경 (코드 8파일 + `codex-request.md`):
- `templates/claude-skill.md` → `.claude/skills/commitgate/SKILL.md` (Claude Code 자동 발동 후보)
- `templates/claude-command.md` → `.claude/commands/req.md` (`/req` 명시 호출)
- `templates/cursor-rule.mdc` → `.cursor/rules/commitgate.mdc` (`alwaysApply`)
- `templates/CLAUDE.template.md` → `CLAUDE.md` (**부재 시에만**, `--force`로도 미덮어씀)
- `AGENTS.template.md` — `<!-- commitgate:contract -->` 마커 + 명령표에 `req:next` + "페르소나는 도구 주입" 명시
- `bin/init.ts` — `KIT_AGENT_ENTRYPOINTS`(src≠dest) · `copyEntrypoints` · `assertEntrypointPathsUsable`(preflight) · 마커 경고 · `--no-agent-entrypoints`
- `package.json` — `files[]`에 `templates`
- `tests/unit/init.test.ts` — 13건 신설

### 설계 대비 구현

| 설계 | 구현 |
|---|---|
| D8 `src≠dest` | `copyInto`(레이아웃 재현)를 쓸 수 없어 명시 매핑 복사기 `copyEntrypoints` 신설. 중첩 `.claude/skills/commitgate/`는 `mkdirSync(recursive)` |
| D8 preflight | `assertEntrypointPathsUsable`이 **쓰기 전에** 경로 중간 컴포넌트가 파일인지 검사. `mkdirSync`가 apply 중 ENOTDIR로 죽으면 앞의 파일은 이미 복사돼 **부분 설치**가 된다 |
| D7 마커 | `AGENTS_CONTRACT_MARKER`. init이 만드는 `AGENTS.md`엔 포함, 기존 파일에 없으면 **경고**(설치는 계속 — 비파괴 원칙) |
| D7 opt-out | `--no-agent-entrypoints`. 이 경우 preflight도 건너뛴다(`.claude`가 파일이어도 코어 설치는 성공) |
| `CLAUDE.md` 정책 | `AGENTS.md`와 동일 — 부재 시에만 생성. **`--force`로도 덮어쓰지 않는다**(사용자 파일) |

### 실행한 검증 (증거)

- `npm run typecheck` → 0 · `npm test` → **622/622 green**(init 42건)
- `npm pack --dry-run --json`(격리 캐시) → 23파일, `templates/` 4종 포함
- **실 sandbox**: pack tarball → 임시 git repo `npm i -D` → `commitgate` 실행 → `.claude/skills/commitgate/SKILL.md`·`.claude/commands/req.md`·`.cursor/rules/commitgate.mdc`·`CLAUDE.md`·`AGENTS.md`(마커 포함) 생성 확인. 주입 스크립트 5개(`req:next` 포함).
- **실 sandbox opt-out**: `--no-agent-entrypoints` → `.claude`/`.cursor`/`CLAUDE.md` 미생성, `scripts/req` 정상.
- **실 sandbox 마커 경고**: 마커 없는 기존 `AGENTS.md` → 경고 출력, 파일 미변경, 설치 계속.

### phase-3a R1 지적 반영 (라운드 1 → 2)

| # | 지적 | 반영 |
|---|---|---|
| P2 | 마커 없는 기존 `AGENTS.md`는 이 phase의 **명시 지원 경로**인데, 그때 설치되는 포인터 4종이 모두 "`AGENTS.template.md`를 참조하라"고 지시한다. 그런데 그 파일은 **패키지 안에만** 있고 대상 repo에 복사되지 않으며, `npx commitgate`는 `node_modules/commitgate/`도 남기지 않는다. 사용자는 참조할 파일을 찾을 수 없다 — **복구 지시가 막다른 길** | 마커가 없을 때 init이 계약 템플릿을 **`AGENTS.commitgate.md`로 대상 repo에 함께 설치**한다(`KIT_AGENTS_CONTRACT_COPY_REL`). 포인터 4종의 문구를 그 파일명으로 교체. 경고 메시지도 "사본을 설치했으니 병합 후 지우라"로 실행 가능하게 |

**정책 정합**: 마커가 있으면(정상) 사본을 만들지 않는다(잡음 방지). init이 `AGENTS.md`를 새로 만드는 경우에도 불필요(마커 포함). `--no-agent-entrypoints`면 포인터가 없으므로 경고도 사본도 없다. 기존 `AGENTS.commitgate.md`는 `--force` 없이 덮어쓰지 않는다.

회귀 7건 + **테스트가 포인터 본문을 직접 검사**한다: 4종 전부 `AGENTS.commitgate.md`를 참조하고 `AGENTS.template.md`(패키지 내부 파일)를 **참조하지 않는지**. 이 단언이 R1의 재발을 막는다.

**실 sandbox 재확인**: 마커 없는 `AGENTS.md`를 미리 둔 repo에 tarball 설치 → 경고 출력 + `AGENTS.commitgate.md` 생성(첫 줄이 마커) + `AGENTS.md` 미변경 + `SKILL.md`의 `AGENTS.template.md` 참조 0건.

이 결함의 형태는 phase-2 R3~R5와 같다: **도구가 내는 지시는 실행 가능해야 한다.** 그때는 렌더링한 명령이었고, 지금은 문서가 가리키는 파일이다.

### 이 phase의 리뷰 포인트

- **preflight가 부분 설치를 정말 막는가**: `assertEntrypointPathsUsable`이 `runInit`의 어느 지점에 있는가? 코어 복사(`copyInto`)보다 **앞**인가? 권한 오류(EACCES)·경합은 여전히 apply 중에 터지는데, 그건 수용 가능한가?
- **`--force` 시맨틱이 일관되는가**: 진입점 3종은 `--force`로 갱신되고, `CLAUDE.md`·`AGENTS.md`는 안 된다. 이 비대칭이 정당한가? 사용자가 `.cursor/rules/commitgate.mdc`를 편집했다면 `--force`가 그것을 날린다 — `AGENTS.md`와 같은 취급이어야 하지 않나?
- **포인터가 본문을 복제하지 않는가**: 테스트가 "승인 문장 2개가 없음"만 확인한다. 충분한가? 포인터가 계약을 **잘못 요약**하는 부분은 없는가(예: `AWAIT_HUMAN`에서 멈추라는 지시가 `AGENTS.md`의 통제점 표와 모순되지 않는가)?
- **마커 판정이 견고한가**: `includes()` 문자열 검사다. 주석 안에 우연히 그 문자열이 있으면? 마커가 코드블록 안에 있으면? 과잉 단순한가?
- **`.claude/`·`.cursor/`를 남의 repo에 심는 것이 월권은 아닌가**: opt-out이 있지만 **기본이 설치**다. 반대(기본 미설치 + `--agent-entrypoints`)여야 하지 않는가? `npx commitgate`를 다시 돌리는 기존 사용자에게 갑자기 파일 3개가 생긴다.
- **Claude Code 스킬 frontmatter가 유효한가**: `name`/`description`만으로 자동 발동이 되는가? `description`이 너무 광범위해("코드를 커밋하게 되는 모든 작업") 오발동하지 않는가?
- **Cursor `.mdc` frontmatter**(`alwaysApply: true`)가 실제 Cursor 버전에서 유효한가? 검증한 근거가 있는가, 아니면 추정인가?
- 범위 이탈: `bin/uninstall.ts` 미변경(3b), 버전 bump 미수행, README 미변경(4).

---

## 이전 phase 리뷰: `phase-2-req-next` (승인됨, `fdd20de`)

phase-1a(`e4a3796`)·phase-1b(`acee2eb`)가 승인·커밋됐다. persona는 이제 도구가 주입한다 — **이 프롬프트의 첫 블록이 그것이다.**

이 phase는 P3("끊지 말고 이어서")를 프롬프트가 아니라 **상태기계**로 내린다. `req:next`가 `state.json` + git 상태에서 다음 행동을 계산해 한 줄로 알려준다.

staged 변경 (코드 7파일 + `codex-request.md`):
- `scripts/req/req-next.ts` (신규) — 순수 `resolveNext(input): NextAction` + IO만 하는 `main()`. `--json`.
- `scripts/req/review-codex.ts` — `captureIndexHash`(읽기 전용 인덱스 신원) + `LastReviewMarker`/`recordLastReview` + `resolveReviewOutcome(compareHash?)` + `main()` 배선.
- `bin/init.ts` / `package.json` — `req:next`를 5번째 주입 스크립트로.
- `tests/unit/req-next.test.ts` (신규, 55건) — 판정표 10분기 + G1/G2(outcome 5행) + allowlist + no-write 회귀 + exit 계약 + CLI.
- `tests/unit/req-review-codex.test.ts` — `last_review` 4 outcome·count 증가/리셋·errors 상한·**D9 불변 회귀**·`captureIndexHash`.
- `tests/unit/init.test.ts` — 주입 스크립트 5개.

### 설계 대비 구현 요약

| 설계 | 구현 |
|---|---|
| D6 판정표 10분기 | `resolveNext` — 1 `commit_allowed` → 2 문서 미인덱스 → 3 design stale → 4 신규 phase 분해 → 5~7 legacy → 8~10 tracked → fallback `BLOCKED` |
| 진행도 정본 = `consumed_approvals[].phase_id` | `nextPhaseId()`. `phases[].approved`는 sticky(`applyVerdict`가 되돌리지 않음)라 쓰지 않는다. **sticky 회귀 테스트 있음** |
| G1 (D10 전제) | `findUnstagedOrUntracked` **재사용**(복제 없음). 미통과 → `AGENT` |
| G2 (outcome-aware) | `needs-fix`→AGENT · `blocked`→BLOCKED(+`--fresh-thread` 자동 지시 안 함) · `invalid` count=1→RUN, ≥2→BLOCKED+errors · `approved`→방어적 BLOCKED · 바인딩 변경 시 전부 RUN |
| D6-1 읽기 전용 | `createReadOnlyGit`이 **런타임에** allowlist를 강제(`write-tree`·`add`·`commit` 등 실행 전 throw) + 모든 호출에 `--no-optional-locks` prepend |
| D6-2 `last_review` 자문 | `resolveReviewOutcome`이 모든 outcome에서 기록. `compare_hash`=design→designHash / phase→`captureIndexHash`. `errors`는 invalid에서만(20×500 상한) |
| `blocked_review` 미참조 | `resolveNext`가 읽지 않는다. 강제는 `shouldShortCircuitBlockedReview`에 잔존 |

### 실행한 검증 (증거)

- `npm run typecheck` → 0 · `npm test` → **566/566 green**
- **`--no-optional-locks`의 전제 실증**: stat cache가 dirty한 repo에서 평범한 `git status`는 `.git/index`를 **다시 쓴다**(sha 3a14caa5… → cbbf2e17…). `--no-optional-locks`를 붙이면 안 쓴다. R2 P2-B가 옳았다.
- **no-write 회귀가 위양성이 아님을 확인**: 처음엔 `req:next` 서브프로세스가 크래시해도 "아무것도 안 썼으니" 통과하는 구조였다. `r.status===0` + stdout JSON `kind==='RUN'` 단언을 넣어 실제 판정까지 갔음을 고정했다(실행 시간 684ms→2722ms로 확인).
- **이 티켓 자신에게 실행**: `npm run req:next -- 2026-010` → `AGENT phase-2-req-next 구현` (phase-1a/1b는 consumed, staged 없음). 정확.

### phase-2 R1 지적 반영 (라운드 1 → 2)

| # | 지적 | 반영 |
|---|---|---|
| P2 | `nextPhaseId()`가 `consumed_approvals[].phase_id`를 Set으로 만들어 `phases[]`를 훑으므로, **중복 id**가 있으면 소비 1건이 같은 id의 모든 항목을 소비 처리한다. `phases=[p1,p1]` + `consumed=[p1]` + clean → `pending=null` → **조용한 `DONE`**. fail-closed `BLOCKED`여야 한다 | **`phaseModelProblems(state)` 신설**, `resolveNext`의 **0번 분기**(살아 있는 승인보다도 먼저)에서 검사. 손상된 state에서 "커밋을 승인하라"고 말하면 엉뚱한 phase가 소비될 수 있으므로 `commit_allowed=true`보다 앞이다 |

**같은 실패 class의 인접 구멍도 함께 막았다**(지적받지 않았으나 자체 발견): `readPhases`가 `{id: string}`이 아닌 항목을 걸러내므로, `phases[]`의 항목이 전부 malformed면 배열이 **비어 보이고** `pending=null`이 된다. 그런데 `rawLen>0`이라 레거시 분기로도 가지 않아 역시 조용한 `DONE`이 된다. `parsed.length !== rawLen`을 같은 함수에서 잡는다.

회귀 테스트 6건: Codex의 재현 시나리오 그대로(중복 id + 소비 1건 → `BLOCKED`) · 중복 id가 `commit_allowed=true`보다 먼저 막히는지 · malformed 항목 · 전부 malformed · 정상 `phases[]`는 문제 없음 · 빈 배열/부재는 여기서 판단하지 않음(레거시 분기 보존).

### phase-2 R2 지적 반영 (라운드 2 → 3)

| # | 지적 | 반영 |
|---|---|---|
| P2-1 | `phases`가 **배열이 아니면**(`{id:'p1'}`·`null`) `Array.isArray` 실패로 `rawLen=0` → **레거시로 오분류**. 소비 이력만 있고 clean이면 조용히 `DONE` | `phaseModelProblems`가 `raw === undefined`(부재=레거시)와 `!Array.isArray(raw)`(손상)를 **구분**한다. 후자는 `BLOCKED` |
| P2-2 | `id: ''`는 `readPhases`를 통과하지만 `--phase` 인자로 쓸 수 없다. `reviewCmd`의 `if (phaseId)`가 falsy라 `--phase`를 빠뜨린 `RUN`을 지시하고, 그 명령은 `resolvePhaseTarget`이 "대상 모호"로 죽인다 | `phaseModelProblems`가 `id.trim() === ''`을 잡는다. 더불어 `reviewCmd`를 `phaseId !== null`로 고쳐 "레거시(null)"와 "빈 문자열"이 같은 falsy로 뭉개지지 않게 했다 |

회귀 4건 추가: `phases:{id:'p1'}` + 레거시 모양 → `BLOCKED`(전엔 `DONE`) · `phases:null` → `BLOCKED` · `id:''` + staged → `BLOCKED`(전엔 `--phase` 없는 `RUN`) · 공백만인 id.

**R1과 R2의 공통 형태**: `nextPhaseId`가 `null`을 반환하면 "전부 소비됨"으로 읽히는데, `phases`를 신뢰할 수 없으면 그 `null`은 거짓말이다. `phases` **부재**와 **빈 배열**만이 정상적인 "여기서 판단하지 않음"이고, 나머지 모든 이상 형태는 `BLOCKED`다.

### phase-2 R3 지적 반영 (라운드 3 → 4)

| # | 지적 | 반영 |
|---|---|---|
| P2 | `phaseModelProblems`가 non-empty만 확인해 **downstream CLI에 전달 불가능한 id**를 통과시킨다. `id:'--bad'` → `--phase --bad`를 지시하는데 `review-codex`의 `parseArgs`는 값이 `-`로 시작하면 값 누락으로 throw한다. 공백 포함 id는 `.join(' ')` 렌더링에서 argv가 깨진다. **`req:next`가 실행 불가능한 `RUN`을 지시한다** | `PHASE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/` 신설(= `config.ts`의 designDocs basename 계약과 동일). `phaseModelProblems`가 non-empty이면서 이 패턴에 안 맞는 id를 `BLOCKED`로 진단한다 |

회귀 6건: `--bad` · `-x` · 공백 포함 · 따옴표 · 슬래시 → 전부 `BLOCKED` · 실제 사용 중인 id(`phase-1a-persona-install` 등)는 통과.

**R1~R3를 관통하는 것**: `req:next`의 계약은 "다음 행동을 알려준다"가 아니라 **"실행 가능하고 옳은 다음 행동만 알려준다"**이다. `RUN`을 내보내면 그 명령은 반드시 성공 가능해야 하고(G1의 D10 전제, R3의 argv 안전성), `DONE`을 내보내면 정말로 끝났어야 한다(R1/R2의 `phases` 무결성). 확신할 수 없으면 `BLOCKED`.

### phase-2 R4 지적 반영 (라운드 4 → 5)

| # | 지적 | 반영 |
|---|---|---|
| P2 | R3에서 `phase_id`의 argv 안전성은 막았지만 **`reqId`는 같은 구멍이 남아 있다.** `main()`은 CLI 인자가 아니라 `state.id.replace(/^REQ-/, '')`를 쓴다. `state.id='REQ-2026-010 bad'` → `... -- 2026-010 bad --kind phase ...`에서 `bad`가 REQ id로 읽혀 **엉뚱한 티켓을 대상으로 한다.** `REQ---bad` → `--bad` → unknown option | `CLI_SAFE_ARG_RE`(`/^[A-Za-z0-9][A-Za-z0-9._-]*$/`)를 **하나의 계약**으로 두고 `PHASE_ID_RE`·`REQ_ID_RE`가 이를 공유한다. `reqIdProblems()`를 0번 분기에 합쳐 `RUN`/`AWAIT_HUMAN` 렌더링 **전에** `BLOCKED`로 막는다 |

회귀 6건: 공백 포함(다른 티켓 대상) · strip 후 선행 대시 · 세미콜론 · 따옴표 → 전부 `BLOCKED`(`command` 미렌더링) · **argv-불안전 reqId가 `AWAIT_HUMAN`(커밋 승인)보다도 먼저 막히는지** · 정상 id는 통과.

**R3와 R4는 같은 결함이 다른 필드에 있던 것이다.** `req:next`가 렌더링하는 명령의 **모든 argv 토큰**(positional REQ id, `--phase` 값)이 같은 안전 계약을 통과해야 한다. 하나만 막으면 나머지로 샌다.

### phase-2 R5 지적 반영 (라운드 5 → 6)

| # | 지적 | 반영 |
|---|---|---|
| P2-1 | `--ticket <dir>`로 비표준 위치의 티켓을 읽어도 렌더링된 명령은 `req:review-codex -- <reqId>`라, 그대로 실행하면 **기본 위치의 다른 티켓**을 리뷰한다 | `NextTarget = {kind:'req', reqId} \| {kind:'ticket', ticketDir}` 신설. `main()`이 **사용자가 지목한 방식 그대로** 보존하고, `reviewCmd`/`commitCmd`가 `targetArgs()`로 되돌려 준다 |
| P2-2 | 기본 위치로 읽었는데 `state.id`가 `REQ-2026-999`로 손상돼 있으면 `CLI_SAFE_ARG_RE`를 통과하고 **다른 티켓을 대상으로 하는** 명령을 낸다 | `targetProblems()`가 `kind:'req'`에서 **identity 검증**: `state.id === 'REQ-' + 요청한 reqId`. `main()`이 이제 `state.id`가 아니라 **CLI 요청**에서 reqId를 만든다 |

부수: `--ticket` 경로도 argv 토큰이므로 `CLI_SAFE_PATH_RE`(슬래시 허용, 공백·따옴표·선행 `-` 금지)로 검증한다. `renderAction`의 첫 인자는 이제 **표시 전용**(`state.id`)이고 argv에 쓰이지 않는다.

회귀 10건: `--ticket`이 `RUN`·`AWAIT_HUMAN` 명령에 보존되는지 · `--ticket` 모드에서는 identity를 강제하지 않는지(아카이브 위치 허용) · `REQ-2026-999`/`REQ-bad` 불일치가 `RUN`을 만들지 않는지 · 불일치가 `AWAIT_HUMAN`보다도 먼저 막히는지 · CLI-불안전 `--ticket` 경로 4종.

**R3 → R4 → R5의 상승**: argv 토큰 하나(`--phase`) → 모든 argv 토큰(`reqId` 포함) → **명령이 가리키는 대상 자체**. `req:next`가 내는 `RUN`은 (a) 실행 가능하고 (b) 방금 판정한 그 티켓을 대상으로 해야 한다. 어느 하나라도 보장 못 하면 `BLOCKED`.

### phase-2 R6 지적 반영 (라운드 6 → 7)

| # | 지적 | 반영 |
|---|---|---|
| P2 | R5의 `CLI_SAFE_PATH_RE` 화이트리스트가 **정상 경로를 막는다**(false BLOCKED). `D:\proj\...\REQ-2026-010`(콜론)·`/tmp/.../REQ-2026-010`(선행 `/`)·`./workflow/...`(선행 `.`)가 전부 차단된다. `review-codex`/`req:commit`의 `--ticket` 파서는 이런 값을 받는다 | 화이트리스트 폐기. **denylist**로 전환: `UNSAFE_CLI_PATH_CHARS`(공백류·따옴표·백틱·`$;&\|<>()*?!#~^%{}[]`)와 선행 `-`만 막는다. `ticketPathProblems()`로 분리 |

**이 지적이 중요한 이유**: R1~R5는 전부 "너무 느슨해서 위험하다"였는데, R6은 **"너무 빡빡해서 못 쓴다"**이다. fail-closed를 밀다 보면 정상 입력을 막는 반대 방향 결함이 생긴다. 페르소나가 요구한 "완성도"에는 두 방향이 다 들어 있다.

회귀 11건: **정상 경로 6종**(repo-상대·dot-relative POSIX/Windows·POSIX 절대·Windows drive 절대·UNC)이 `RUN`을 내고 `--ticket`이 그대로 보존되는지 + 절대경로가 `AWAIT_HUMAN` 명령에도 보존되는지 · **불안전 8종**(공백·선행 대시·따옴표·세미콜론·명령 치환·백틱·파이프·빈 문자열)이 `BLOCKED`인지.

실전 확인: `npm run req:next -- --ticket "D:/1_projects/61_commitgate/workflow/REQ-2026-010"` → 정상 판정(false BLOCKED 없음).

### G1의 실전 확인

이 라운드 직전 `req-next.ts`를 수정하고 `git add` 하기 전에 `req:next`를 돌렸더니 `RUN`이 아니라 `AGENT`("워킹트리에 unstaged/untracked 변경이 있어 리뷰(D10)가 실패한다")를 냈다. G1이 설계대로 동작한다 — 그 상태에서 `RUN`을 따랐다면 `review-codex`가 D10 precondition에서 즉시 죽었을 것이다.

### 이 phase의 리뷰 포인트

- **판정 순서가 정말 상호배타적·완전한가**: 빠진 상태 조합은? 특히 `design_approved=true`인데 `design_approved_hash=null`, `consumed_approvals`에 `phases[]`에 없는 id가 있는 경우(orphan). 0번 분기가 그 orphan도 잡아야 하는가?
- **G2의 `sameTarget` 판정**: `lr.phase_id ?? null`과 `cand.phaseId` 비교가 legacy(`phaseId=null`)에서 옳은가? `compare_hash`가 `null`인 마커와 `cand.compareHash=null`이 **매치되면 안 되는데** 코드가 `cand.compareHash !== null`로 막고 있다 — 이 방향이 맞는가(fail-forward)?
- **읽기 전용이 정말 닫혔는가**: `createReadOnlyGit`의 `gitSubcommand`가 `-c` 값 소비를 올바로 하는가(`-c write-tree status` → `status`). 우회 가능한 argv 형태가 있는가? `--no-optional-locks`가 **모든** 경로에 붙는가(`captureDesignBinding`·`captureIndexHash` 주입 포함)?
- **`last_review`가 정말 자문인가**: `req:doctor`·`req:commit`·`applyVerdict` 어디서도 읽지 않는가? `approved_diff_hash`가 tree OID로 남는 회귀 테스트가 충분한가?
- **exit 10/11 신설의 위험**: CI가 `req:next`를 돌리면 실패로 읽힌다. 문서(주석)만으로 충분한가, 아니면 `--exit-zero` 같은 안전장치가 필요한가?
- **`resolveNext`가 순수한가**: git·fs를 부르지 않는가? `main()`이 `captureDesignBinding` throw를 `null`로 흡수하는데, 그 흡수가 **다른 실패**(예: git 손상)까지 삼켜 2번 분기로 오분류하지 않는가?
- **레거시 판정**: `'approval_evidence_required' in state`(존재 여부)와 `=== true`의 3분기가 옳은가? `false`면 `BLOCKED`인데 과한가?
- 범위 이탈: `templates/`·`.claude/`·`.cursor/` 미착수, 버전 bump 미수행, `machine.schema.json` 불변.

---

## 이전 phase 리뷰: `phase-1b-persona-inject` (승인됨, `acee2eb`)

> **이 프롬프트의 첫 블록이 `workflow/review-persona.md`라면, 이 phase는 이미 스스로를 증명한 것이다.** 그 블록은 Builder가 붙여넣은 것이 아니라 `review-codex.ts`가 조립한 것이다.

phase-1a(`e4a3796`)가 persona 파일과 설치 축을 커밋했다. 이제 **소비**를 켠다.

staged 변경 (코드 9파일 + `codex-request.md`):
- `scripts/req/lib/config.ts` — `reviewPersonaPath`를 `RawConfig`/`ResolvedConfig`/`DEFAULTS`/`CONFIG_SCHEMA`에 추가. **confinement 적용**(`assertRelative`+`assertUnderRoot`) — `handoffPath`는 면제인데 이것은 아니다. 파생 `reviewPersonaPathAbs`.
- `workflow/req.config.schema.json` — 동일 키(기존 드리프트 가드 테스트가 `CONFIG_SCHEMA`와의 일치를 강제).
- `scripts/req/review-codex.ts` — `ReviewPromptInput.persona` + **첫 블록**(D1). `loadReviewPersona(pathAbs)` 신설: `null`→`null`, 파일 존재→본문, **경로 있는데 부재→throw**(D3). `main()`에서 호출.
- `req.config.json.sample` — 키 추가.
- `bin/uninstall.ts` — 설정 축 info(`reviewPersonaPath ≠ 기본 경로`), `schemaPath` 축과 대칭. phase-1a 리뷰의 observation(`ToolArtifact` 주석이 '스키마' 중심)도 함께 정정.
- `tests/unit/req-config.test.ts` — 기본값·confinement 5종·`null` 비활성·커스텀 경로 + **D4**(init이 이 키를 config에 주입하지 않음, 신규/병합 2케이스).
- `tests/unit/req-review-codex.test.ts` — persona 첫 블록(phase·design) · `undefined`/`null`/`''`/공백 생략 · 순수성 · `loadReviewPersona` 4종(부재 에러가 경로+복구법 2개를 담는지 포함).
- `tests/unit/uninstall.test.ts` — 설정 축 info 표기/미표기.
- `tests/unit/req-commit.test.ts` — **`cfgStub`에 신규 필수 필드 2개 추가.** `ResolvedConfig`에 필드를 넣으면 모든 스텁이 따라와야 한다(typecheck가 강제). 이것 때문에 코드 파일이 9개가 되어 **D18 WARN**이 뜬다 — 계획서의 8파일 추정이 이 강제 파급을 놓쳤다.

**실행한 검증** (증거):
- `npm run typecheck` → 0 · `npm test` → 488/488 green
- **이 repo 자신의 프롬프트**: `.review-preview.txt`의 persona 인덱스 = `0`, 순서 `persona < Review Context < REVIEW_BASE_SHA < REVIEW_KIND < request` 확인
- **fail-closed 실증**: `workflow/review-persona.md`를 치우고 실행 → `리뷰어 페르소나 문서 없음: <경로>` + 복구법 2개 출력하며 throw
- **비활성 실증**: `reviewPersonaPath: null` → 생략(프롬프트 18,193자 → 16,625자), throw 없음

### phase-1b R1 지적 반영 (라운드 1 → 2)

| # | 지적 | 반영 |
|---|---|---|
| P2 | 기본 활성 상태에서 `workflow/review-persona.md`가 0바이트/공백-only면 `loadReviewPersona`가 성공 반환하고 `assembleReviewPrompt`의 `persona.trim()`이 블록을 조용히 생략한다. **persona 없이 리뷰가 exit 0으로 통과** — `reviewPersonaPath: null` 명시를 요구한 D3/D4 계약과 같은 실패 양식 | `loadReviewPersona`가 non-null 경로의 **공백-only 본문을 throw**로 거부(`리뷰어 페르소나 문서가 비어 있음: <경로>` + 복구법 2개). 단위 테스트 4건 추가(0바이트·개행만·공백/탭/개행·에러 메시지). **실증**: `: > workflow/review-persona.md` 후 실행 → throw 확인 |

이 지적은 내가 아래 리뷰 포인트에 **의심으로 적어 둔 바로 그 구멍**이었고, 페르소나를 도구가 주입한 첫 리뷰에서 확정됐다. `existsSync`만 보고 내용을 보지 않으면 fail-closed 계약이 **파일 하나 비우는 것으로 무너진다.** 비활성 경로는 이제 `reviewPersonaPath: null` 하나뿐이다.

### phase-1b R2 지적 반영 (라운드 2 → 3)

| # | 지적 | 반영 |
|---|---|---|
| P2 | `loadConfig`의 confinement는 config의 **문자열 경로**만 검사하는데 `readFileSync`는 **symlink를 따라간다**. `workflow/review-persona.md`를 repo 밖 민감 파일로 향하는 링크로 바꾸면, 문자열 경로는 root 하위라 `loadConfig`를 통과하고 그 파일 내용이 **프롬프트 첫 블록으로 Codex에 전송**된다. D2 계약 우회 + 유출 | `loadReviewPersona`가 읽기 직전 **realpath 기준으로 재검증**한다: (a) `realpathSync(target)`이 `realpathSync(root)` 하위인가 (b) `statSync().isFile()`인가. 둘 중 하나라도 아니면 throw. `rootAbs`도 realpath로 정규화 — 임시 디렉터리처럼 root 자체가 symlink 경유(`/tmp`→`/private/tmp`)일 때 문자열 비교가 거짓 음성을 내기 때문 |

**회귀 테스트 3건**: repo 밖 symlink → throw(`/repo 밖/`) + 반환값이 `null`임을 직접 확인(유출 부재) · root 하위 symlink는 허용(repo-내부 자원) · 디렉터리 경로 → throw. Windows에서 `symlinkSync`는 권한이 필요해 `it.runIf(canSymlink)`로 가드했고, **이 머신에서는 실제로 실행됐음을 확인**했다(skip 아님).

**실제 익스플로잇 재현**: persona를 repo 밖 `fake-secret.txt`로 향하는 symlink로 교체 → `리뷰어 페르소나 문서가 repo 밖을 가리킵니다(symlink?)` throw, `.review-preview.txt`에 비밀 문자열 **0건**.

이 결함의 성격이 R1과 같다. **경로 검증과 실제 읽기가 다른 대상을 본다**는 것 — R1은 "존재하는가"만 보고 내용을 안 봤고, R2는 "문자열이 root 하위인가"만 보고 링크 해소 후를 안 봤다.

### 이 phase의 리뷰 포인트

- **fail-closed가 정말 닫혀 있는가**: `loadReviewPersona`가 `null`(의도적 비활성) / 부재 / 빈 내용 셋을 구분해 뒤 둘을 throw하는가? **다른 우회로가 남아 있는가?** (예: persona 파일이 디렉터리인 경우, 심볼릭 링크, 읽기 권한 없음 → `readFileSync` throw로 fail-closed인가?)
- **confinement 비대칭이 정당한가**: `reviewPersonaPath`에 confinement를 걸고 `handoffPath`는 면제한 근거가 코드 주석과 일치하는가? `null` 분기가 `assertRelative`를 건너뛰는 것이 맞는가?
- **CONFIG_SCHEMA의 `minLength: 1`이 union 타입에서 의도대로 동작하는가**: `{type:['string','null'], minLength:1}`에서 `null`은 통과하고 `''`는 거부되는가? AJV 의미론을 확인했는가?
- **D4의 혼합 버전 논증이 지금 코드와 일치하는가**: init이 이 키를 주입하지 않으므로, `--force` 없는 업그레이드로 남은 **구 `review-codex.ts`**가 `additionalProperties:false`에 안 걸린다. 이 주장이 `bin/init.ts`의 실제 병합 코드와 맞는가?
- **`assembleReviewPrompt`의 순수성이 유지됐는가**: persona를 **본문 문자열**로 받고 경로로 받지 않는다. 파일 I/O가 새로 들어가지 않았는가?
- **D18 WARN(9파일)이 정당한가**: `req-commit.test.ts` 스텁 수정을 별도 phase로 뺐어야 하는가, 아니면 타입 변경과 같은 커밋에 있어야 하는가?
- **persona 본문이 리뷰어를 실제로 바꾸는가**: 지금 너에게 주어진 첫 블록이 그 문서다. 그 지시가 `findings`/`observations` 경계를 명확히 하는가, 아니면 과잉 지적을 유도하는가? **이 리뷰 자체가 그 검증이다.**
- 범위 이탈: `req:next`·`templates/` 미착수, 버전 bump 미수행, `machine.schema.json` 불변 확인.

---

## 이전 phase 리뷰: `phase-1a-persona-install` (승인됨, `e4a3796`)

design은 R6에서 승인됐다(`responses/design-r06-approved.json`). 지금은 **staged diff만** 심사한다. 설계·계획 정본은 커밋된 `01-design.md`(D3-1)·`02-plan.md`(Phase 1a)에 있다.

**이 phase가 하는 일**: persona 파일을 **깔기만** 한다. 소비(fail-closed 주입)는 phase-1b다. 이 순서 자체가 design R1 P1의 해법이다 — 반대로 하면 신규 설치본의 모든 리뷰가 멈춘다.

staged 변경 (8파일):
- `workflow/review-persona.md` (신규) — D5 매핑표대로. 가드레일 포함.
- `scripts/req/lib/config.ts` — `DEFAULT_REVIEW_PERSONA_RELPATH` 상수 **추가만**. `DEFAULTS`·`CONFIG_SCHEMA`는 미변경(1b).
- `bin/init.ts` — `KIT_COPY_RELPATHS = [...KIT_SCHEMA_RELPATHS, DEFAULT_REVIEW_PERSONA_RELPATH]` 신설, 복사기가 이를 사용.
- `bin/uninstall.ts` — `tool` 분류를 `KIT_COPY_RELPATHS` 기준으로. `KIT_SCHEMA_RELPATHS`의 schemaPath 축 판정(`:189`)은 **불변**.
- `package.json` — `files[]`에 `workflow/review-persona.md`.
- `tests/unit/init.test.ts` — 설치 축 SSOT 회귀(P1 재발 방지) + 복사 + dry-run 무쓰기.
- `tests/unit/uninstall.test.ts` — persona `tool`/`identical`/removable, 편집 시 `differs`/review. **기존 "전부 제거" 픽스처를 `KIT_COPY_RELPATHS` 기반으로 교체**(하드코딩 목록이 새 파일을 놓쳐 실패했음).
- `tests/unit/package-payload.test.ts` — tarball 축 가드.

**실행한 검증** (증거):
- `npm run typecheck` → 0
- `npm test` → 462/462 green
- `npm pack --dry-run --json`(격리 `npm_config_cache`) → 18파일, `workflow/review-persona.md` 포함
- **실 sandbox**: pack tarball → 임시 git repo에 `npm i -D` → `node node_modules/commitgate/bin/commitgate.mjs` 실행 → `workflow/review-persona.md` 생성 확인 · `req.config.json`에 `reviewPersonaPath` **미주입**(D4) 확인 · `commitgate uninstall`이 `rm -f workflow/review-persona.md` 제시 · 편집 후엔 removable에서 빠지고 review로 강등 확인

### 이 phase의 리뷰 포인트

- **세 축이 정말 분리됐는가**: `files[]`(tarball) / `KIT_COPY_RELPATHS`(설치) / `KIT_SCHEMA_RELPATHS`(schemaPath 판정). `uninstall.ts:189`의 판정이 오염되지 않았는가? `KIT_COPY_RELPATHS`를 거기 쓰면 무엇이 깨지는가?
- **SSOT 회귀가 진짜 P1을 막는가**: `init.test.ts`의 단언이 "설치 축에서 persona가 빠지는" 시나리오를 실제로 잡는가? `DEFAULT_REVIEW_PERSONA_RELPATH`를 `config.ts`에 둔 것이 옳은가(순환 의존·레이어링)?
- **phase 경계 준수**: `config.ts`에 상수만 추가하고 `DEFAULTS`/`CONFIG_SCHEMA`/`ResolvedConfig`는 건드리지 않았는가? `review-codex.ts`를 전혀 안 건드렸는가? (1b 침범 금지)
- **`copyInto` 재사용이 안전한가**: `KIT_COPY_RELPATHS`는 `src`와 `dest` 상대경로가 같다(리터럴 `workflow/`). `--force` 없는 재설치·중첩 디렉터리·dry-run에서 기존 계약이 보존되는가?
- **혼합 버전**: 0.3.1 설치본에 `--force` 없이 0.4.0을 돌리면 구 `review-codex.ts` + 신 persona 파일이 남는다(무해). `--force`면 둘 다 갱신. 이 분석이 diff와 일치하는가?
- **테스트 픽스처 수정이 정당한가**: `uninstall.test.ts:274`의 하드코딩 제거 목록을 `KIT_COPY_RELPATHS` 스프레드로 바꿨다. 이것이 테스트의 의도("전부 제거")를 보존하는가, 아니면 단언을 약화시키는가?
- **persona 본문이 D5 가드레일을 지키는가**: 승인=findings 0건 / 비차단=observations / "부채를 findings로 밀어 올리지 마라"가 명확한가? 이 문서가 곧 이후 모든 리뷰의 리뷰어 지시가 된다 — 문구의 결함은 복리로 쌓인다.
- 범위 이탈: `workflow/REQ-2026-00*` 미변경, 버전 bump 미수행, `req:next`·`templates/` 미착수 확인.

## 배경

CommitGate 사용자는 지금 세 종류의 프롬프트를 매번 손으로 붙여넣는다.

| | 프롬프트 | 실제 수신자 |
|---|---|---|
| P1 | "CommitGate를 사용해라 + 요구사항 4칸" (`README.md:33-59`) | Builder (Claude/Cursor) |
| P2 | "너는 PM이다 / 리뷰 프레임에 갇히지 마라" | **Reviewer (Codex)** |
| P3 | "끊지 말고 끝까지 이어서" | Builder |

문제는 P2다. Codex에게 가는 프롬프트를 조립하는 주체는 Claude가 아니라 `review-codex.ts:85 assembleReviewPrompt()`다. P2를 Claude 스킬/지시문에만 두면 (a) 사람이 `req:review-codex`를 직접 실행할 때 (b) Cursor가 실행할 때 (c) Claude가 그 문장을 잊었을 때 페르소나가 **조용히 누락되고, 리뷰는 exit 0으로 성공한다**. `AGENTS.md` §3이 D9·D10·리뷰어 실패에 적용하는 fail-closed 원칙이 리뷰 품질 계약에는 적용되지 않고 있다.

## 변경 요약

- **phase-1a**: `workflow/review-persona.md` 파일 + **init 복사 SSOT**(`KIT_COPY_RELPATHS`) + uninstall `tool` 분류. 소비 코드 없음 — **파일을 먼저 깐다.**
- **phase-1b**: `assembleReviewPrompt`에 persona 첫 블록 + `reviewPersonaPath` config(기본 활성). **경로가 해소됐는데 파일이 없으면 throw**(handoff의 silent-skip과 반대). `null` 명시 = 의도적 비활성.
- **phase-2**: `req:next` 신설 — `state.json` + git 상태에서 다음 행동을 계산해 `RUN`/`AGENT`/`AWAIT_HUMAN`/`DONE`/`BLOCKED` 중 하나를 출력. 읽기 전용(git allowlist + no-write 회귀 테스트로 강제). exit 0/1/2/10/11.
- **phase-3**: init이 `.claude/skills/commitgate/SKILL.md`·`.claude/commands/req.md`·`.cursor/rules/commitgate.mdc`·`CLAUDE.md`(부재 시) 설치. 본문 SSOT는 `AGENTS.md`, 나머지는 얇은 포인터. `--no-agent-entrypoints` opt-out.
- **phase-4**: README/AGENTS 갱신 + `0.4.0` minor bump (분리 커밋).
- tag / `npm publish` / GitHub release / main 반영은 **수행하지 않는다**(각각 별도 통제점).
- 과거 `workflow/REQ-2026-00*` 감사 기록은 **수정하지 않는다**.

## R1 지적 반영 (design 리뷰 라운드 1 → 2)

| # | 지적 | 반영 |
|---|---|---|
| P1 | `files[]`(tarball 축)만 고치고 `bin/init.ts` 복사 축을 안 고쳐 신규 설치본의 모든 리뷰가 fail-closed로 멈춘다 | **D3-1 신설**. `KIT_COPY_RELPATHS = [...KIT_SCHEMA_RELPATHS, DEFAULT_REVIEW_PERSONA_RELPATH]` SSOT. `KIT_SCHEMA_RELPATHS`는 `uninstall.ts:189`의 schemaPath 축 판정을 위해 **불변**. phase-1을 **1a(설치) → 1b(소비)** 로 분할해 순서를 phase 경계로 강제. `init.test.ts`가 두 SSOT의 일치를 단언 → 재발 불가 |
| P2 | `DONE`/exit 11을 정의했으나 반환하는 분기가 없다. 마지막 커밋 후 8번 `AWAIT_HUMAN`만 반복 | D6 판정표를 **10분기**로 재작성. 9번 `DONE` = 전 phase `approved` **+ `phases[].id` 전부가 `consumed_approvals[].phase_id`에 존재** + 워킹트리 clean. 통합(`[I1]`/`[B1]`)은 `DONE`의 detail로 알리고 `req:next`가 지시하지 않음. fallback은 `DONE`이 아니라 **`BLOCKED`**(fail-closed) |
| P3 | "읽기 전용" 선언만 있고 검증 설계가 없다. `captureGitBinding`의 `git write-tree`는 object DB에 쓴다 | **D6-1 신설**. git allowlist(`rev-parse`/`status`/`diff --cached --name-only`/`ls-files -s`) 명시, `write-tree`·`add`·`commit` 등 금지. 검증 2단: (1) fake adapter argv[0] allowlist 단언 (2) 임시 repo에서 `.git/objects` 목록·`.git/index` 바이트·`state.json` 바이트·`git status` 출력 전후 동일 회귀 |
| obs | 기존 `AGENTS.md`가 CommitGate 계약이 아닌 repo에서 포인터가 엉뚱한 SSOT를 가리킨다 | D7에 완화책 반영: `AGENTS.md`에 `<!-- commitgate:contract -->` 마커, init preflight가 마커 부재 시 **경고**(설치는 계속), 포인터 본문에 fallback 문구. 마커 추가는 phase-3(경고 로직과 동일 phase) |

부수 효과로 판정 순서도 정리했다: **2번(`commit_allowed=true`)이 3~8번보다 앞**(살아 있는 승인이 가장 쉽게 상한다), **3번(문서 미인덱스)이 4번(design freshness)보다 앞**(`captureDesignBinding` throw 차단 — `resolveNext`는 `currentDesignHash: string | null`을 입력으로 받는 순수 함수), **5/6번은 `approval_evidence_required` 필드 존재 여부**로 신규/레거시를 가른다(레거시 티켓이 "phase 분해하라"에 영원히 묶이지 않게).

## R2 지적 반영 (design 리뷰 라운드 2 → 3)

| # | 지적 | 반영 |
|---|---|---|
| P2-A | 6번(legacy → `RUN` phase 리뷰)이 9번 `DONE`보다 앞이라, 레거시 티켓이 커밋 소비 후에도 phase 리뷰로 되돌아간다. `phases[]`가 빈 상태에서 "전부 consumed"는 vacuous truth인데 6번이 먼저 매치돼 `DONE`에 도달 불가 | D6 판정표를 **12분기**로 재작성. 6번을 **"legacy + staged 변경 있음"**으로 좁히고, **8번 `DONE (legacy)`** = "legacy + staged 없음 + `consumed_approvals` ≥1건 + clean" 신설. 레거시는 남은 phase 여부를 도구가 알 수 없으므로 `detail`이 `02-plan.md` 확인을 지시 — 조용히 "다 끝났다"고 말하지 않는다 |
| P2-B | `git status`는 index refresh로 `.git/index`를 갱신할 수 있다. "`.git/index` 바이트 불변" 계약이 plain `status` 허용과 모순 | **D6-1 재작성**. `req:next`의 모든 git 호출을 `--no-optional-locks`(= `GIT_OPTIONAL_LOCKS=0`의 CLI 등가물) 래퍼로 감싼다. `createGitAdapter`가 `env`를 받지 않으므로 어댑터 변경 대신 **전역 플래그를 subcommand 앞에** 두는 기존 패턴(`git -c core.quotePath=false status`)을 따른다. 검증 3단: (1) subcommand allowlist (2) `args[0] === '--no-optional-locks'` 단언 (3) **stat cache가 dirty한 repo**(내용 동일·mtime만 변경)에서 `.git/index` 바이트 불변 회귀 — clean repo에서는 플래그 없이도 우연히 통과하므로 dirty가 요점 |
| obs | phase-3 파일 수 표기(8)가 실제(templates 4 + init + uninstall + package + 테스트 2 + AGENTS marker)와 불일치 | phase-3을 **선제 분할**: `phase-3a-entrypoint-install`(8파일) / `phase-3b-entrypoint-uninstall`(2파일). 01-design의 phase 표에 파일 수 열을 추가하고 전 phase 실수 정정. `AGENTS.template.md` 마커는 경고 로직과 동일 phase(3a) |

**R2를 파고들다 추가로 발견한 결함**(지적받지 않았으나 자체 수정):

`applyVerdict`는 승인 시 `phases[].approved`를 `true`로 토글하지만 **미승인 시 `false`로 되돌리지 않는다**(base에서 그대로 복사 — sticky). 그래서 "phase 승인 → 코드 수정 → 재리뷰 NEEDS_FIX" 상태에서는 `commit_allowed=false`인데 `approved`는 `true`로 남는다. 판정표가 "미승인 phase"를 `approved` 플래그로 셌다면 대상 phase가 0개가 되어 11번 `DONE`도 9·10번도 매치되지 않고 **fallback `BLOCKED`로 오분류**됐을 것이다.

→ **진행도의 정본을 `consumed_approvals[].phase_id`로 바꿨다**(append-only, `req:commit`이 실제 커밋 시에만 기록). `nextPhaseId = phases[] 중 consumed 되지 않은 첫 항목`. 이 상태를 재현하는 회귀 테스트를 phase-2 exit 조건에 넣었다.

## R3 지적 반영 (design 리뷰 라운드 3 → 4)

| # | 지적 | 반영 |
|---|---|---|
| P2-A | `RUN` 분기가 "staged 있음"만 보고, 직전 리뷰가 NEEDS_FIX였고 바인딩이 그대로인 상태를 구분 못 한다. NEEDS_FIX 후에도 staged는 남으므로 **같은 바인딩 무한 재리뷰 루프** | **게이트 G2 신설** + **D6-2(`last_review` 자문 마커)**. `RUN` 후보는 `last_review.(review_kind, phase_id)`가 일치하고 `compare_hash`가 현재와 같으면 **`AGENT`로 강등**("이미 본 바인딩, 승인 안 됨 → findings 수정"). `blocked_review`는 BLOCKED만 잡으므로 NEEDS_FIX 루프를 못 막는다는 지적이 정확하다. design 리뷰(4번)에도 동일 적용 |
| P2-B | `RUN` 분기가 review-codex의 D10 전제(unstaged/untracked 0)를 반영하지 않아, 지시한 명령이 즉시 실패한다 | **게이트 G1 신설**. `RUN` 후보는 `findUnstagedOrUntracked(status, SCRATCH, ticketRel)`가 비어야 통과. 아니면 `AGENT`(정리/`git add`). **기존 순수 함수 재사용** — 판정 로직 복제 없음 |
| P3 | phase-1a가 `bin/uninstall.ts`에 "해소된 `reviewPersonaPath`" 축 info를 넣게 돼 있으나, 그 키는 1b에서야 `RawConfig`/스키마에 추가되므로 1a에서 해소 불가 — phase 경계 불일치 | 1a는 **경로 축**(`KIT_COPY_RELPATHS` 기반 `tool` 분류)만. **설정 축 info는 1b로 이동**(그 phase에서 키가 존재). 1a 8파일 / 1b 8파일로 재산정 |

### D6-2가 필요했던 제약

G2는 "직전 리뷰가 본 바인딩"을 알아야 하는데, 기존 state로는 알 수 없다.

- `approved_diff_hash`/`design_approved_hash`는 **승인 시에만** 채워진다 — NEEDS_FIX면 `null`.
- `review_diff_hash`는 매 phase 리뷰마다 갱신되지만 값이 **tree OID**(`git write-tree` 산물)이고, `req:next`는 D6-1에 의해 `write-tree`를 부를 수 없다 → **현재 값을 재계산해 비교할 수 없다.**

그래서 읽기 전용 명령만으로 재계산 가능한 `compare_hash`를 리뷰 시점에 남긴다: design은 기존 `designHash`(`ls-files -s -- <3경로>`), phase는 `sha256(sorted(git ls-files -s))`. tree OID와 값은 다르지만 "인덱스 내용이 같으면 같다"는 동치 관계라 비교엔 충분하다.

**이 필드는 자문이다 — 어떤 게이트도 읽지 않는다.** 승인 바인딩은 `approved_diff_hash`(tree OID) 그대로다. `compare_hash`가 승인 판정에 관여하는 순간 D9가 다른 해시에 바인딩되므로, phase-2 테스트가 "승인 바인딩은 여전히 tree OID"를 회귀로 고정한다. `last_review` 부재(구 state)는 **fail-forward**(G2 통과 → `RUN` 1회 낭비 후 마커 생성) — 여기서 fail-closed하면 구 티켓이 진행 불가가 된다.

## R4 지적 반영 (design 리뷰 라운드 4 → 5)

| # | 지적 | 반영 |
|---|---|---|
| P2 | G2가 `last_review.outcome`을 판정에 반영하지 않는다. 같은 바인딩의 **모든** 비승인 결과가 `AGENT`("findings 수정")로 강등되는데, `blocked`는 정의상 findings가 0건이라 그 지시가 성립하지 않고, `invalid`는 재시도/도구오류 처리 대상이다. invalid 1회 또는 blocked 1회 뒤 워크플로가 잘못 멈춘다 | **G2를 outcome-aware로 재정의.** `needs-fix` → `AGENT`(수정) · `blocked` → `BLOCKED`(같은 리뷰 재시도 금지, `AGENTS.md` §3) · `invalid` + `count===1` → `RUN`(1회 재시도) / `count>=2` → `BLOCKED`+errors 진단 · `approved` → 방어적 `BLOCKED`(2번에서 걸러져 도달 불가). 이를 위해 `last_review`에 **`count`**(같은 target 반복 카운터, `blocked_review`와 동일 의미론) 추가. phase-2 테스트가 5행 전부 + "바인딩 변경 시 전부 `RUN`"을 고정 |
| obs | D6 본문에 순서 근거 서술이 중복 | 중복 2문단 제거(편집 잔재) |

`blocked`에서 `req:next`가 **자동으로 `--fresh-thread`를 지시하지 않는** 이유도 명시했다: `--fresh-thread`는 `clearBlockedReview()`로 마커를 지우므로, 자동 루프가 매 blocked마다 쓰면 `count`가 2에 영영 도달하지 못해 **회로차단기가 무력화된다.** 회복은 사람의 판단이다. 이것도 테스트로 고정한다(`blocked` 분기 출력에 `--fresh-thread` 명령 없음).

## R5 지적 반영 (design 리뷰 라운드 5 → 6)

| # | 지적 | 반영 |
|---|---|---|
| P2 | 1번 분기가 `blocked_review.count>=2`만 보고 즉시 `BLOCKED`를 낸다. `blocked_review.review_binding`은 phase에서 **tree OID**라 `req:next`가 `write-tree` 없이 재계산할 수 없어 **현재 바인딩과 같은지 판정 불가**. 사용자가 blocked 이후 바인딩을 바꿔도 stale 마커로 영구히 막히고, R4의 "바인딩 바꾸면 `RUN`" 테스트와 충돌 | **1번 분기 제거. `req:next`는 `blocked_review`를 아예 읽지 않는다.** blocked 처리는 G2(`last_review.compare_hash` 기반)가 전담 — 바인딩 변경을 정확히 감지한다. **강제는 그대로 `review-codex` 안에 있다**(`shouldShortCircuitBlockedReview` → codex 호출 없이 exit 2). `req:next`의 G2는 자문적 조기 정지이고, `RUN`을 잘못 지시해도 실제 리뷰는 호출되지 않는다 — 안전 방향 실패. 판정표를 **10분기**로 재번호 |
| P3 | `invalid + count>=2 → BLOCKED + errors 진단`인데 `last_review`에 `errors`가 없고, `req:next` 입력은 state+git뿐이라 검증 오류를 재구성할 경로가 없다 | `last_review`에 **`errors`** 추가(`outcome==='invalid'`일 때만 `ProcessResponseResult.errors` 저장, **20개 × 500자 상한**). `req:next`는 **검증기를 다시 돌리지 않는다** — `codex-response.json`은 untracked 스크래치라 존재 보장이 없고, 재검증은 AJV 로드와 throw 가능성을 순수·읽기전용 명령에 끌어들인다. 진단 본문을 리뷰 시점에 함께 저장하는 것이 정합적이다. 테스트로 고정 |

`blocked_review`를 `req:next`에서 떼어낸 결과, **강제(enforcement)와 자문(advisory)의 경계가 선명해졌다.**

| | 주체 | 키 | 실패 방향 |
|---|---|---|---|
| 강제 | `review-codex` | `blocked_review.review_binding` (tree OID) | fail-closed (exit 2, codex 미호출) |
| 자문 | `req:next` | `last_review.compare_hash` (ls-files sha256) | fail-forward (`RUN` 지시 → 강제가 잡음) |

`req:next`가 틀려도 게이트는 뚫리지 않는다. 반대로 `req:next`가 과도하게 막으면 사용자가 진행 불가가 되므로, 애매하면 `RUN` 쪽으로 기운다.

## 이것은 public 계약 확장이다

`req.config.json`에 키가 추가되고(`reviewPersonaPath`), `package.json`에 주입되는 스크립트가 4→5개가 되고, init이 까는 파일이 늘어난다. `files[]`·`bin/uninstall.ts` 분류가 함께 움직인다. 그래서 minor bump(`0.4.0`)로 낸다. `machine.schema.json`(verdict)은 **불변**이라 `MACHINE_SCHEMA_VERSION`은 `1.1` 유지다.

## 리뷰 포인트

### A. fail-closed 결정(D3)이 옳은가 — 최우선

- 페르소나 파일 부재를 **throw**로 처리하는 것이 맞는가? `handoffPath`는 `existsSync` silent-skip인데 비대칭이다. 이 비대칭의 근거("페르소나는 리뷰 품질 계약, handoff는 읽기 전용 참조")가 충분한가?
- **혼합 버전 분석이 옳은가**: `copyInto`가 `--force` 없이 기존 파일을 skip한다는 사실에 기대어 "구 스크립트 + 신규 persona 파일 = 무해"라고 주장했다(01-design D3). 실제로 그런가? `npx commitgate@0.4.0`(--force 없음)을 0.3.1 설치본에 돌리면 정확히 무슨 파일이 갱신되고 무엇이 남는가? 부분 갱신으로 깨지는 조합이 정말 없는가?
- **D4**(init이 `reviewPersonaPath`를 config에 주입하지 않음)가 그 안전성의 전제다. 이 결정이 명시적으로 기록됐지만, `handoffPath`는 주입하면서 이것만 안 하는 비대칭이 나중에 "버그"로 오해돼 되돌려질 위험은? 코드 주석/테스트로 고정할 방법은?
- 사용자가 `workflow/review-persona.md`를 지우면 **모든 리뷰가 멈춘다**. 이게 의도한 fail-closed인가, 아니면 과도한 결합인가? 복구 경로(`--force` 재설치 / `null` 명시)가 에러 메시지에 있으면 충분한가?

### B. 페르소나 본문의 안전성(D5)

- "스스로 추가 분석하라" + "승인은 findings 0건"(R10, `validateVerdict`)의 조합이 **승인 불가 루프**를 만들 위험을 D5의 가드레일이 실제로 막는가?
- `blocked_review` 회로차단기(동일 바인딩 2회 → exit 2)와의 상호작용: 페르소나가 findings를 늘리면 NEEDS_FIX(exit 3)가 늘고 blocked(exit 2)는 오히려 줄 텐데, 이 분석이 맞는가? 아니면 반대 위험이 있는가?
- 페르소나가 `findings` vs `observations` 경계를 흐릴 문구를 담을 위험은? 예컨대 "개발 부채가 남지 않도록"이 리뷰어를 "부채 후보를 전부 findings로"로 밀 수 있다. 본문에서 이를 어떻게 못 박아야 하는가?
- 페르소나 블록이 **첫 번째**(D1, handoff보다 앞)여야 하는 근거가 타당한가? 아니면 권위 아티팩트 직전이 더 나은가?

### C. `req:next` 판정 순서(D6)

- 8분기 판정 순서가 완전하고 상호배타적인가? 빠진 상태 조합은?
- **5번(`commit_allowed=true` → AWAIT_HUMAN)이 6·7번보다 앞**이어야 D9가 안 깨진다고 주장했다. 이 논증이 맞는가? 다른 순서 의존성이 더 있는가?
- `design_approved_hash !== 현재 designHash`(3번) 판정은 `captureDesignBinding`을 호출해야 하는데, 문서가 인덱스에 없으면 그 함수가 throw한다. 2번(문서 미인덱스 → AGENT)이 3번보다 앞이라 괜찮은가? throw가 새는 경로는?
- `phases[]`가 비어 있는 것은 "레거시 하위호환"(`resolvePhaseTarget`)과 "아직 안 채움"(신규 티켓) 두 의미다. `req:next`의 4번 분기가 레거시 티켓을 영원히 `AGENT`로 묶는가?
- exit code 10/11 신설이 기존 계약(0/1/2/3)과 충돌하지 않는가? 셸/CI에서 10·11을 실패로 오해할 위험은? `AWAIT_HUMAN`을 0으로 하고 stdout으로만 구분하는 편이 나은가?
- 읽기 전용 보장을 어떻게 **테스트로** 고정하는가?

### D. init/uninstall 확장(D7·D8)

- `KIT_AGENT_ENTRYPOINTS`의 `src≠dest`가 기존 `copyInto`(`relative(PACKAGE_ROOT, src)` 레이아웃 재현)와 `uninstall`의 `tool` 분류(`join(PACKAGE_ROOT, rel)`로 원본 찾기) 가정을 **둘 다** 깬다. 이 두 곳을 고치는 것 외에 놓친 소비 지점이 있는가?
- preflight→apply 2단계가 신규 복사 대상(중첩 디렉터리 `.claude/skills/commitgate/`)에서도 **부분 설치를 막는가**? `mkdirSync` 실패·권한 오류 경로는?
- 진입점 3종을 `tool`(자동 제거 후보)로, `CLAUDE.md`를 `ambiguous`로 나눈 기준이 옳은가? 사용자가 `.cursor/rules/commitgate.mdc`를 편집했다면 `differs`로 잡히는데, 그 처리가 `AGENTS.md`와 일관되는가?
- `.claude/`·`.cursor/`를 대상 repo에 심는 것 자체가 **월권**은 아닌가? 이미 다른 도구가 그 디렉터리를 쓰고 있을 때 충돌·오염 위험은? opt-out 플래그(`--no-agent-entrypoints`)가 필요한가?

### E. 설계 범위·부채

- P1(진입점)을 스킬/규칙 계층에 두는 것이 맞는가? 자동 발동이 확률적이라는 한계(D7)를 인정했는데, 그렇다면 스킬을 까는 가치가 `/req` 슬래시 커맨드 + `CLAUDE.md` 포인터 대비 얼마나 되는가? 셋 다 까는 것이 과잉인가?
- 본문 SSOT를 `AGENTS.md`로 두면, `AGENTS.md`가 **이미 존재하는** repo(init이 건드리지 않음)에서 포인터들이 가리키는 대상이 CommitGate 계약이 아닐 수 있다. 이 구멍을 어떻게 다루는가?
- phase 분해(4단계)가 적절한가? phase-3이 D18 WARN 경계(9파일)인데 선제 분할이 나은가?
- 이 티켓이 남길 부채는 무엇인가? Stage B(라이브러리 모델)로 갈 때 `templates/`·`KIT_AGENT_ENTRYPOINTS`가 걸림돌이 되는가?

### F. 검증의 정본

- phase-3의 exit 증거로 "실 sandbox(임시 git repo + pack tarball 설치 + `commitgate` bin 실행)"를 요구했다. 이것이 정본으로 충분한가? `npm run smoke`가 이미 그 일부를 하는데 중복인가, 보강인가?
- `npm pack --dry-run --json` payload 검사에 격리된 `npm_config_cache`를 쓰라고 했다. 다른 npm 호출 경로에서 사용자 캐시를 오염시킬 지점이 남는가?
- `package-payload.test.ts`의 대조군(`handoffpath` 문자열 카운트)이 신규 파일 추가 후에도 유효한가?

결함이 없으면 findings 없이 승인하라. 비차단 의견은 `observations`에.
