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

> 이 페르소나 블록이 `codex-request.md`에 손으로 들어간 것은 이번이 **마지막**이다. phase-1이 이것을 `review-codex.ts`의 프롬프트 조립 단계로 옮긴다 — 그게 이 티켓의 요지다.

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
