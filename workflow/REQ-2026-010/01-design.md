# REQ-2026-010 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

### 프롬프트 조립 경로

`review-codex.ts:85 assembleReviewPrompt()`가 내보내는 블록 순서:

```
[handoff?] → [Review Context?] → REVIEW_BASE_SHA → REVIEW_KIND → codex-request.md → 권위 아티팩트
```

페르소나(리뷰어 역할 정의)가 들어갈 자리가 없다. `handoff`는 `main()`에서 `existsSync` 게이트로 읽히고(`review-codex.ts:969`), **없으면 조용히 생략**된다 — 읽기 전용 참조라 그 정책이 맞다.

### config 경계

`lib/config.ts`의 `DEFAULTS` + AJV `CONFIG_SCHEMA`(`additionalProperties: false`) + confinement(`assertRelative`/`assertUnderRoot`). confinement는 **repo-내부 자원**(`ticketRoot`, `schemaPath`)에만 적용되고 `handoffPath`는 면제다(외부 참조 문서). 스키마 정본은 `lib/config.ts`의 `CONFIG_SCHEMA`와 `workflow/req.config.schema.json` **두 곳**에 있고 수동 동기 상태다.

### 설치·제거 SSOT (P1이 드러낸 축)

`bin/init.ts`가 대상 repo에 **실제로 복사하는** 것은 딱 둘이다.

```ts
KIT_SOURCE_DIR_REL = 'scripts/req'                                        // 디렉터리 통째
KIT_SCHEMA_RELPATHS = ['workflow/machine.schema.json', 'workflow/req.config.schema.json']
```

`package.json`의 `files[]`는 **npm tarball**에 무엇이 실리는가이고, 위 상수는 **대상 repo에 무엇이 깔리는가**다. **둘은 다른 축이다.** `files[]`에만 파일을 추가하면 tarball에는 들어가지만 대상 repo에는 영원히 나타나지 않는다.

`bin/uninstall.ts`도 같은 상수를 공유해 `tool`(바이트 비교) 분류를 만들고, 별도로 `KIT_SCHEMA_RELPATHS.includes(schemaPath)`로 **설정 경로 축**과 **설치 경로 축**의 분기를 사용자에게 알린다.

### 상태 → 다음 행동

`state.json`이 다음을 안다: `design_approved`, `design_approved_hash`, `phases[]`, `current_phase`, `commit_allowed`, `approved_diff_hash`, `blocked_review`, `risk_level`, `user_commit_confirmed`, `consumed_approvals[]`. 다음 행동을 계산해 **출력하는 주체가 없다**. `req:doctor`는 게이트를 점검할 뿐 "다음에 뭘 해라"를 말하지 않는다.

---

## 핵심 설계 결정

### D1 — persona는 프롬프트의 **첫 블록**

```
[persona?] → [handoff?] → [Review Context?] → REVIEW_BASE_SHA → REVIEW_KIND → codex-request.md → 권위 아티팩트
```

리뷰어의 **역할 정의**는 컨텍스트·판정 대상보다 먼저 와야 한다. `ReviewPromptInput`에 `persona?: string | null` 추가. 빈 문자열/공백은 `handoff`와 동일하게 블록 생략(`trim()` 후 판정).

`assembleReviewPrompt`는 순수 함수로 남는다 — 파일을 읽지 않는다. 읽기·부재 판정은 `main()`이 한다.

### D2 — config 키 `reviewPersonaPath`

| 항목 | 값 |
|---|---|
| 타입 | `string \| null` |
| 기본값 | `DEFAULT_REVIEW_PERSONA_RELPATH` = `'workflow/review-persona.md'` (**활성**) |
| `null` | 의도적 비활성 — persona 블록 생략 |
| confinement | **적용** (`assertRelative` + `assertUnderRoot`) |
| 파생 | `reviewPersonaPathAbs: string \| null` |

`handoffPath`와 달리 confinement를 **적용**한다. 근거: 페르소나는 **패키지가 배포하는 repo-내부 자원**이고 `schemaPath`와 같은 축이다. `handoffPath`는 repo 밖 문서를 읽기 위한 참조라 면제였다.

`CONFIG_SCHEMA`(config.ts)와 `workflow/req.config.schema.json` **양쪽**에 `"reviewPersonaPath": { "type": ["string","null"] }`를 추가한다. 둘 중 하나만 고치면 `additionalProperties:false` 때문에 한쪽 경로에서 config가 거부된다.

### D3 — 부재 시 fail-closed (이 티켓의 핵심 안전 결정)

```
reviewPersonaPath === null           → persona 블록 생략 (의도적 opt-out)
경로 해소됨 + 파일 존재              → 블록 주입
경로 해소됨 + 파일 부재              → throw (fail-closed)
```

`handoff`의 `existsSync` silent-skip 패턴을 **따르지 않는다**. 페르소나는 리뷰 품질 계약이므로, 조용히 빠진 채 exit 0으로 승인이 나오는 것이 정확히 이 티켓이 없애려는 실패 양식이다. 비활성이 필요하면 `null`을 **명시**하게 한다(암묵 < 명시 — `init`이 `handoffPath: null`을 명시 기록하는 것과 같은 원칙).

에러 메시지는 복구법을 담는다: 파일 경로 + "`npx commitgate --force`로 복원하거나 `req.config.json`에 `reviewPersonaPath: null`로 비활성화".

### D3-1 — **설치가 소비보다 먼저다** (design R1 P1)

D3의 fail-closed는 "대상 repo에 `workflow/review-persona.md`가 있다"에 전적으로 의존한다. 그런데 그 파일을 거기 갖다 놓는 주체는 `files[]`가 **아니라** `bin/init.ts`의 복사 SSOT다. 순서를 틀리면 신규 설치본의 **모든 리뷰가 fail-closed로 멈춘다**.

그래서 두 가지를 못 박는다.

1. **새 SSOT 상수**를 만들고 init 복사기와 uninstall `tool` 분류가 공유한다.

   ```ts
   // scripts/req/lib/config.ts — 기본값의 정본
   export const DEFAULT_REVIEW_PERSONA_RELPATH = 'workflow/review-persona.md'

   // bin/init.ts — 복사 대상의 정본
   export const KIT_COPY_RELPATHS = [...KIT_SCHEMA_RELPATHS, DEFAULT_REVIEW_PERSONA_RELPATH] as const
   ```

   `KIT_SCHEMA_RELPATHS`는 **그대로 둔다**. 그 상수는 `uninstall.ts:189`에서 "설정된 `schemaPath`가 init이 깐 스키마인가"를 판정하는 **의미론적 축**이다. 여기에 persona를 섞으면 그 판정이 오염된다.

2. **phase 순서로 강제한다.** `phase-1a`(파일 + 설치/제거 배선)가 `phase-1b`(fail-closed 소비)보다 먼저다. 1a가 승인·커밋된 뒤에만 1b가 들어간다. 이 repo 자신의 다음 리뷰도 그 순서로만 살아남는다.

   **테스트로 고정**: `init.test.ts`가 `KIT_COPY_RELPATHS`에 `DEFAULT_REVIEW_PERSONA_RELPATH`가 포함됨을 단언한다. `config.ts`의 기본값과 init 복사 목록이 갈라지면 실패한다 — P1이 다시 발생할 수 없다.

`uninstall.ts`에는 `schemaPath`와 대칭으로, 해소된 `reviewPersonaPath`가 `DEFAULT_REVIEW_PERSONA_RELPATH`와 다르면 "런타임이 읽는 경로이지만 init이 복사한 파일이 아님" info를 추가한다.

### D4 — `init`은 `reviewPersonaPath`를 config에 주입하지 않는다

`handoffPath: null`은 "코어 기본이 비활성"이라 명시 기록에 값이 있었다. `reviewPersonaPath`는 코어 기본이 **활성**이고 그 기본값이 곧 init이 까는 파일 경로다. config에 적으면 아래 혼합 버전 안전성이 깨진다.

**혼합 버전 분석** (`copyInto`는 `--force` 없이 기존 파일을 덮어쓰지 않는다):

| 시나리오 | `review-codex.ts` | `review-persona.md` | 결과 |
|---|---|---|---|
| 신규 설치 (0.4.0) | 신규 | 신규 (D3-1) | 정합 |
| 0.3.1 → `npx commitgate@0.4.0` (force 없음) | **구** (skip) | 신규 (부재였음) | 구 스크립트는 persona를 모름 → 무해 |
| 0.3.1 → `npx commitgate@0.4.0 --force` | 신규 | 신규 | 정합 |
| 사용자가 persona 파일 삭제 | 신규 | 없음 | **throw** (의도된 fail-closed) |

두 번째 행이 안전한 이유가 D4다. 만약 init이 `reviewPersonaPath`를 config에 적으면, 구 `review-codex.ts`의 `loadConfig`가 `additionalProperties:false`로 **unknown key를 거부**해 모든 명령이 죽는다. 기본값에 맡기면 구 코드는 그 키를 본 적조차 없다.

이 비대칭(`handoffPath`는 주입, `reviewPersonaPath`는 미주입)은 나중에 "버그"로 오해될 수 있다. `bin/init.ts`의 config 병합부에 근거 주석을 달고, `init.test.ts`가 **"병합된 config에 `reviewPersonaPath`가 없다"**를 명시적으로 단언한다.

### D5 — 페르소나 본문은 스키마 필드로 번역한다

Codex는 `machine.schema.json`으로 structured output을 낸다. "이후 액션에 대한 지시를 내린다" 같은 자유서술 지시는 스키마와 충돌한다. 원문 의도 → 필드 매핑:

| 원문 의도 | 스키마 통로 |
|---|---|
| PM으로서 적절성·완성도 확보 | `status` / `commit_approved` 판정 기준 |
| Builder의 리뷰 프레임에 갇히지 마라 | `codex-request.md`의 리뷰 포인트는 **하한**이지 상한이 아니다 → 요청서에 없는 결함도 `findings`에 |
| 개발 부채가 남지 않도록 | 차단 결함은 `findings`, 비차단 제안은 `observations` |
| 이후 액션 지시 | `next_action` |

**필수 가드레일(누락 시 티켓 진행 불가)**: 페르소나 본문은 다음을 함께 명시해야 한다.

- 승인(`commit_approved=yes`)은 `findings` 0건일 때만 가능하다(`validateVerdict`의 R10).
- `findings`는 **"이 변경을 지금 커밋하면 안 되는 이유"**만 담는다. 스타일 취향·범위 밖 개선·후속 티켓 후보는 `observations`.
- "개발 부채가 남지 않도록"이 **부채 후보를 전부 `findings`로 밀어 올리는 것으로 읽히면 안 된다.** 지금 넘어가도 되는 부채는 `observations`에 기록해 다음 티켓의 입력으로 만든다.

이 가드레일이 없으면 "스스로 추가 분석하라"가 findings를 무한히 늘려 승인 불가 루프가 된다. **트레이드오프는 인정한다**: 페르소나는 리뷰 라운드 수를 늘리는 방향이다(REQ-2026-008 design R6 전례).

회로차단기와의 상호작용: 페르소나는 `findings`를 늘리므로 NEEDS_FIX(exit 3)를 늘리고 BLOCKED(exit 2 = 미승인 + findings 0건)는 **줄인다**. `blocked_review` 단락은 "지적 없이 승인도 안 하는" 고착에만 걸리므로 페르소나가 그 빈도를 높이지 않는다.

### D6 — `req:next` 계약

순수 코어 `resolveNext(input): NextAction`. `main()`은 IO(state 로드·git 조회)만.

```ts
type NextKind = 'RUN' | 'AGENT' | 'AWAIT_HUMAN' | 'DONE' | 'BLOCKED'
interface NextAction { kind: NextKind; detail: string; command?: string; controlPoint?: string; approvalSentence?: string }
```

| exit | kind | 의미 |
|---|---|---|
| 0 | `RUN` | 그대로 실행할 단일 명령이 있다 |
| 0 | `AGENT` | 도구가 대신 못 하는 작업(구현·문서 작성·`git add`) |
| 10 | `AWAIT_HUMAN` | 통제점 — 승인 문장 그대로 받기 전엔 진행 금지 |
| 11 | `DONE` | 이 티켓에서 도구가 할 일 없음 — 다음은 통합(별도 통제점) |
| 2 | `BLOCKED` | 회로차단기 또는 판정 불가 — 사람 개입 |
| 1 | — | 오류(state 부재/파손) |

`review-codex`의 exit 2(blocked)와 숫자를 맞춘다. 10/11은 성공이지만 "루프를 계속 돌리면 안 되는" 상태라 0과 구분한다. **CI가 10/11을 실패로 읽을 위험**은 실재하므로, `req:next`는 CI 게이트가 아니며 `--json`(stdout) + `kind` 필드가 정본 판정이라고 문서화한다. exit code는 셸 루프 편의다.

#### 진행도의 정본은 `consumed_approvals[]`이지 `phases[].approved`가 아니다 (design R2)

`applyVerdict`는 승인 시 해당 phase를 `approved: true`로 토글하지만 **미승인 시 `false`로 되돌리지 않는다** — `phases`는 base에서 그대로 복사된다. 즉 `approved`는 **sticky**다.

그래서 이런 상태가 실재한다: phase-1b 승인(`approved:true`, `commit_allowed:true`) → 코드 수정 → 재리뷰 NEEDS_FIX → `commit_allowed:false`, `approved_diff_hash:null`, 그러나 **`approved`는 여전히 `true`**. "미승인 phase"를 `approved` 플래그로 세면 이 상태에서 대상 phase가 0개가 되어 판정이 무너진다.

`consumed_approvals[]`는 `req:commit`이 실제 커밋 시에만 append하는 **append-only 진행 원장**이다. 이것을 정본으로 삼는다.

```
nextPhaseId = phases[] 중 consumed_approvals[].phase_id 에 없는 첫 항목
```

**`req:next`는 `blocked_review`를 읽지 않는다** (design R5 P2). 그 마커의 `review_binding`은 phase에서 **tree OID**(`write-tree` 산물)라 `req:next`가 D6-1 제약 하에서 재계산할 수 없다. 따라서 "이 마커가 현재 바인딩에 대한 것인가"를 판정할 방법이 없고, 사용자가 blocked 이후 staged/design 바인딩을 바꿔도 stale 마커 때문에 **영구히 막힌다**. blocked 처리는 전적으로 G2(`last_review.compare_hash` 기반)가 맡는다 — 그쪽은 바인딩 변경을 정확히 감지한다.

> `blocked_review` 회로차단기 자체는 **`review-codex` 안에 그대로 살아 있다**(`shouldShortCircuitBlockedReview` → codex 호출 없이 exit 2). `req:next`가 그 상태에서 `RUN`을 지시하더라도 실제 리뷰는 호출되지 않고 exit 2로 끝난다. 즉 `req:next`의 G2는 **자문적 조기 정지**이고, 강제는 여전히 `review-codex`에 있다. 안전 방향으로 실패한다.

**판정 순서**(먼저 매치되는 것이 이긴다):

| # | 조건 | 결과 |
|---|---|---|
| 1 | `commit_allowed === true` | `AWAIT_HUMAN` — `req:commit --run 승인` |
| 2 | 설계 문서 3종이 git 인덱스에 없음 | `AGENT` — 문서 작성 후 `git add` |
| 3 | `design_approved !== true` 또는 `design_approved_hash !== currentDesignHash` | `RUN`\* — `req:review-codex --kind design --run` |
| 4 | `phases[]` 빈 + `approval_evidence_required === true` (신규 티켓) | `AGENT` — `02-plan.md` phase 분해 + `state.phases[]` 작성 |
| **legacy** | ↓ `phases[]` 빈 + `approval_evidence_required` 필드 부재 | |
| 5 | legacy + staged 변경 있음 | `RUN`\* — `req:review-codex --kind phase --run` (`--phase` 없이) |
| 6 | legacy + staged 없음 + `consumed_approvals[]` 비어 있음 | `AGENT` — 구현 + 테스트 + `git add` |
| 7 | legacy + staged 없음 + `consumed_approvals[]` ≥1건 + 워킹트리 clean | `DONE (legacy)` |
| **tracked** | ↓ `phases[]` 비어 있지 않음 | |
| 8 | `nextPhaseId` 존재 + staged 변경 없음 | `AGENT` — `<nextPhaseId>` 구현 + 테스트 + `git add` |
| 9 | `nextPhaseId` 존재 + staged 변경 있음 | `RUN`\* — `req:review-codex --kind phase --phase <nextPhaseId> --run` |
| 10 | `nextPhaseId` 없음(전부 consumed) + 워킹트리 clean | `DONE` |
| — | 그 외(판정 불가) | `BLOCKED` + state 진단 덤프 |

\* **`RUN` 후보는 두 게이트를 통과해야 실제로 `RUN`이 된다** (design R3 P2-A/P2-B, R4 P2). 통과하지 못하면 다른 kind로 강등된다.

**G1 — D10 전제**: `findUnstagedOrUntracked(status, SCRATCH, ticketRel)`가 비어 있어야 통과. 아니면 `AGENT` — "워킹트리에 unstaged/untracked 존재. 의도 변경은 `git add`, 그 외 정리".

`review-codex`의 `main()`은 호출 전에 D10 precondition을 검사해 unstaged/untracked가 있으면 **throw한다**. 그걸 모른 채 `RUN`을 지시하면 그 명령은 즉시 죽는다. `req:next`는 `findUnstagedOrUntracked`(기존 순수 함수)를 그대로 재사용한다 — 판정 로직 복제 없음.

**G2 — 바인딩 신선도 (outcome-aware)**: `last_review`의 `(review_kind, phase_id)`가 일치하고 `compare_hash`가 현재 값과 **같으면**, 직전 리뷰가 이미 이 바인딩을 봤다는 뜻이다. 이때 **`outcome`에 따라 다르게 강등한다**(design R4 P2).

| `last_review.outcome` | 결과 | 근거 |
|---|---|---|
| `needs-fix` | `AGENT` — "findings를 수정하고 `git add`" | 조치할 지적이 있다. 같은 바인딩 재리뷰는 순수 낭비 |
| `blocked` | `BLOCKED` — "같은 바인딩 재리뷰 금지. 리뷰 대상을 바꾸거나 사람이 `--fresh-thread` 1회 판단" | **findings가 0건**이므로 "수정하라"는 지시가 성립하지 않는다. `AGENTS.md` §3의 "같은 리뷰 재시도 금지"가 정본 |
| `invalid` | `count === 1` → `RUN`(1회 재시도) · `count >= 2` → `BLOCKED` + `last_review.errors` 출력 | 구조/도메인 검증 실패. 일시적 파손 응답일 수 있어 1회는 재시도하되, 반복되면 도구/스키마 문제이므로 에스컬레이션 |
| `approved` | `BLOCKED` (방어적 fallback) | 도달 불가 — phase 승인은 1번이, design 승인은 3번 조건이 먼저 걸러낸다 |

`blocked`를 `req:next`가 **자동으로 `--fresh-thread`로 재시도하지 않는** 이유: `--fresh-thread`는 `clearBlockedReview()`로 마커를 지운다. 자동 루프가 매 blocked마다 그것을 쓰면 `count`가 2에 영영 도달하지 못해 회로차단기가 무력화된다. 회복은 사람의 판단이다.

`invalid` 행이 두 가지를 요구한다 — **`count`**(재시도 횟수)와 **`errors`**(진단 본문). `req:next`의 입력은 state + git뿐이고 검증기를 다시 돌리지 않으므로(순수·읽기 전용), 둘 다 리뷰 시점에 `last_review`가 들고 있어야 한다(design R5 P3). D6-2 참조.

**G2가 필요한 이유** (R3 P2-A): `req:review-codex`가 NEEDS_FIX(exit 3)를 내도 **staged 변경은 그대로 남는다**. G2가 없으면 9번이 다시 `RUN`을 지시하고, 리뷰는 같은 바인딩에 같은 NEEDS_FIX를 내고, 무한 루프가 된다. `blocked_review` 회로차단기는 **BLOCKED만** 잡고 NEEDS_FIX는 잡지 않는다. 같은 논리가 design 리뷰(3번)에도 적용된다 — 실제로 이 티켓의 design 리뷰가 R1~R5를 도는 동안 매 라운드 문서를 고쳐 바인딩이 바뀌었기 때문에 루프에 빠지지 않았을 뿐이다.

**1번이 2~10번보다 앞인 이유**: 살아 있는 승인(`commit_allowed=true`)은 가장 쉽게 상하는 상태다. 다른 어떤 행동(문서 편집, 새 stage)도 D9(staged tree == approved tree)를 깨뜨린다. 승인이 있으면 그것부터 소비한다. 승인 상태는 1번에서 빠져나가므로 G2의 `approved` 행에 도달하지 않는다.

**2번이 3번보다 앞인 이유**: 3번의 freshness 판정은 `captureDesignBinding`을 호출하는데, 문서가 인덱스에 없으면 그 함수가 **throw한다**(`엔트리 3개 아님 → fail-closed`). 2번이 먼저 걸러 준다. `resolveNext`는 순수 함수이므로 `currentDesignHash: string | null`을 **입력으로 받고**, `main()`이 try/catch로 `null`을 넣는다 — throw가 새지 않는다.

**4번과 5~7번의 구분 근거**: `phases: []`는 "레거시(phase 추적 없음)"와 "신규인데 아직 안 채움"의 두 의미를 갖는다(`resolvePhaseTarget`이 둘 다 레거시로 취급). `req:new`가 신규 티켓에 `approval_evidence_required: true`를 심으므로(grandfathering 트리거), 그 필드의 **존재 여부**로 갈라진다.

**7번 `DONE (legacy)`** (design R2 P2-A): 레거시 티켓은 `phases[]`가 비어 있어 10번의 "전부 consumed"가 vacuous truth가 된다. 5번이 무조건 먼저 매치되면 커밋 소비 후에도 phase 리뷰로 되돌아가 **`DONE`에 영영 도달하지 못한다.** 그래서 5번을 "staged 변경 있음"으로 좁히고, "소비 이력 있음 + clean"을 7번으로 분리한다. 레거시는 `phases[]`가 없어 **남은 phase가 있는지 도구가 알 수 없으므로**, `DONE`의 `detail`이 그 사실과 함께 `02-plan.md` 확인을 지시한다. 조용히 "다 끝났다"고 말하지 않는다.

**10번 `DONE`**: 마지막 phase가 승인됐지만 커밋 전이면 1번이 잡는다. 커밋이 끝나면 `req:commit`이 `commit_allowed=false`로 소비하고 `consumed_approvals[]`에 `phase_id`를 append한다. 통합(`[I1]`/`[B1]`)은 사람의 경로 선택이므로 `DONE`의 `detail`이 알릴 뿐 `req:next`가 지시하지 않는다.

**마지막 fallback은 `BLOCKED`다.** 알 수 없는 상태 조합에서 조용히 `DONE`을 반환하지 않는다(fail-closed).

### D6-2 — `last_review` 자문 마커 (design R3 P2-A)

G2는 "직전 리뷰가 본 바인딩"을 알아야 한다. 기존 state로는 알 수 없다.

- `approved_diff_hash` / `design_approved_hash`는 **승인 시에만** 채워진다. NEEDS_FIX면 `null`이라 "무엇을 봤는지" 남지 않는다.
- `review_diff_hash`는 매 phase 리뷰마다 갱신되지만 값이 **tree OID**(`git write-tree` 산물)다. `req:next`는 D6-1에 의해 `write-tree`를 부를 수 없으므로 **현재 값을 계산해 비교할 수 없다.**

그래서 `req:next`가 **읽기 전용 명령만으로 재계산할 수 있는** 비교 해시를 리뷰 시점에 남긴다.

```jsonc
"last_review": {
  "review_kind": "phase",              // 'design' | 'phase'
  "phase_id": "phase-2-req-next",      // design이면 null
  "outcome": "needs-fix",              // approved | needs-fix | blocked | invalid
  "compare_hash": "<sha256>",
  "count": 1,                          // 같은 (kind, phase_id, compare_hash) 반복 횟수
  "errors": [],                        // outcome === 'invalid' 일 때만 채움 (최대 20개, 각 500자)
  "at": "2026-07-09T…Z"
}
```

`count`는 `blocked_review.count`와 **동일한 의미론**이다: 같은 target(`review_kind`+`phase_id`+`compare_hash`)이 반복되면 증가하고, target이 바뀌면 1로 리셋한다. G2의 `invalid` 행이 "1회 재시도 후 에스컬레이션"을 판정하는 데 쓴다(design R4 P2).

`errors`는 **`outcome === 'invalid'`일 때만** `ProcessResponseResult.errors`(AJV 구조 + `validateVerdict` 도메인 오류)를 담는다(design R5 P3). `req:next`는 순수·읽기 전용이라 **검증기를 다시 돌리지 않는다** — `codex-response.json`은 untracked 스크래치라 존재를 보장할 수 없고, 재검증은 AJV 로드와 throw 가능성을 `req:next`에 끌어들인다. 그래서 진단 본문을 리뷰 시점에 **함께 저장**한다. 다른 outcome에서는 빈 배열이다(findings는 이미 `responses/` 아카이브에 남는다). 상한(20개 × 500자)은 state 비대를 막는다.

`compare_hash` 산식 (둘 다 `git ls-files -s` 기반 — `captureDesignBinding`이 이미 쓰는 기법):

| kind | 산식 |
|---|---|
| `design` | `sha256(sorted(git ls-files -s -- <00,01,02 경로>))` — 기존 `captureDesignBinding`의 `designHash`와 **동일** |
| `phase` | `sha256(sorted(git ls-files -s))` — 인덱스 전체(mode·blob sha·stage·path)의 신원 |

phase의 `compare_hash`는 tree OID와 값이 다르지만 **동치 관계**다: 인덱스 내용이 같으면 같고 다르면 다르다. 비교에는 그것으로 충분하다.

`resolveReviewOutcome`(outcome 판정의 단일 정본)이 이 마커를 기록한다 — `blocked_review` 마커를 쓰는 바로 그 자리다.

> **`last_review`는 자문(advisory)이다. 어떤 게이트도 읽지 않는다.**
> 승인 바인딩은 `approved_diff_hash`(tree OID) / `design_approved_hash` 그대로다. `req:doctor`의 D-체크도 이 필드를 검사하지 않는다. `req:next`의 루프 방지에만 쓰인다. 이 경계를 흐리면 D9가 약해진다 — `compare_hash`가 승인 판정에 관여하는 순간, 승인이 tree OID가 아닌 다른 해시에 바인딩된다.

**Grandfathering**: `last_review` 부재(구 state) → G2는 통과(= `RUN`). 최악의 경우 리뷰 1회를 낭비하고, 그 리뷰가 마커를 남기므로 다음 라운드부터 G2가 작동한다. fail-closed가 아니라 **fail-forward**여야 하는 유일한 지점이다 — 여기서 막으면 구 티켓이 진행 불가가 된다.

### D6-1 — `req:next`의 읽기 전용은 **git allowlist + `--no-optional-locks`로 강제**한다 (design R1 P3 / R2 P2-B)

"읽기 전용"은 선언이 아니라 검증 대상이다. 두 개의 쓰기 경로를 막아야 한다.

**(1) object DB 쓰기**: `captureGitBinding()`은 `git write-tree`를 호출해 tree object를 **쓴다**. `req:next`는 이 함수를 호출하지 않는다.

**(2) index 쓰기** (design R2 P2-B): `git status`와 `git diff --cached`는 stat cache를 갱신하려고 `.git/index`를 **다시 쓴다**(`index.lock` 취득). 명령 이름만 보면 읽기지만 실제로는 쓰기다. `--no-optional-locks`(= `GIT_OPTIONAL_LOCKS=0`의 CLI 등가물, git 2.15+)가 그 optional write를 끈다.

`createGitAdapter`는 `execFileSync(..., {cwd, encoding, maxBuffer})`로 **env를 받지 않는다**. 어댑터를 바꾸는 대신, 이 코드베이스에 이미 있는 패턴(`git -c core.quotePath=false status ...`)대로 **전역 플래그를 subcommand 앞에** 둔다. `req:next`는 모든 git 호출을 감싸는 read-only 래퍼를 만든다.

```ts
const roGit: GitFn = (args) => gitAdapter.exec(['--no-optional-locks', ...args])
```

`captureDesignBinding(ticketRel, roGit, designDocs)`처럼 기존 헬퍼에도 이 래퍼를 주입한다.

허용 subcommand (전부 무쓰기, 위 래퍼 경유):

| 용도 | subcommand |
|---|---|
| 현재 브랜치 | `rev-parse --abbrev-ref HEAD` |
| 워킹트리 상태 (G1 · D10 재사용) | `-c core.quotePath=false status --porcelain --untracked-files=all` |
| staged 변경 유무 | `diff --cached --name-only` |
| design 문서 해시 (D6-2) | `ls-files -s -- <3경로>` (= `captureDesignBinding` 재사용) |
| 인덱스 전체 해시 (D6-2 `compare_hash`) | `ls-files -s` |

**금지**: `write-tree`, `add`, `commit`, `checkout`, `reset`, `stash`, `gc`, `hash-object`.

검증 3단:

1. **allowlist 단위 테스트** — 주입된 fake `GitAdapter`가 받은 모든 호출에서, 전역 플래그를 걷어낸 **첫 subcommand**가 allowlist에 있는지 단언. `write-tree`가 나오면 실패.
2. **`--no-optional-locks` 단언** — 모든 호출의 `args[0] === '--no-optional-locks'`.
3. **no-write 회귀 테스트** — 임시 git repo를 **stat cache가 dirty한 상태**로 만든 뒤(내용 동일·mtime만 변경되도록 파일을 touch) `req:next` 실행. 전후로 (a) `.git/objects` 파일 목록 (b) **`.git/index` 바이트** (c) `state.json` 바이트 (d) `git status --porcelain` 출력이 **전부 동일**한지 단언. stat cache가 clean한 repo에서는 `--no-optional-locks` 없이도 우연히 통과하므로, dirty 상태를 만드는 것이 이 테스트의 요점이다.

### D7 — 진입점은 얇은 포인터, 본문 SSOT는 `AGENTS.md`

| 파일 | 대상 | 정책 |
|---|---|---|
| `AGENTS.md` | Codex CLI, Cursor | **본문 SSOT** (현행, 부재 시 생성) |
| `.claude/skills/commitgate/SKILL.md` | Claude Code (자동 발동 후보) | 포인터 |
| `.claude/commands/req.md` | Claude Code (`/req` 명시 호출) | 포인터 |
| `.cursor/rules/commitgate.mdc` | Cursor (`alwaysApply`) | 포인터 |
| `CLAUDE.md` | Claude Code (항상 로드) | 포인터, **부재 시에만 생성** |

포인터 파일은 (a) `AGENTS.md`를 읽으라는 지시, (b) 요구사항 4칸 양식, (c) `req:next` 루프 지시만 담는다. 계약 본문(통제점 표·승인 문장·절대 규칙)은 복제하지 않는다.

**정직한 한계**: Claude Code 스킬의 자동 발동은 description 매칭에 의존하므로 **확률적**이다. "요구사항만 입력하면 반드시 CommitGate가 돈다"는 보장은 스킬 하나로는 못 만든다. 그래서 항상 로드되는 `CLAUDE.md` 포인터 + 결정론적 `/req` 슬래시 커맨드를 함께 깐다. 셋의 역할이 다르므로 과잉이 아니다.

**`AGENTS.md`가 이미 존재하는 repo** (init이 건드리지 않음): 포인터가 CommitGate 계약이 아닌 문서를 가리킬 수 있다(design R1 observation). 완화책 — `AGENTS.md`에 마커(`<!-- commitgate:contract -->`)를 두고, init preflight가 (a) `AGENTS.md` 부재 → 템플릿 생성(마커 포함) (b) 존재 + 마커 있음 → 정상 (c) 존재 + 마커 없음 → **경고**하고 "포인터가 가리킬 CommitGate 계약이 `AGENTS.md`에 없습니다. `AGENTS.template.md`의 내용을 병합하세요"를 출력. 설치는 계속(비파괴 원칙). 포인터 본문에도 같은 fallback 문구를 넣는다.

**opt-out**: `.claude/`·`.cursor/`는 다른 도구가 이미 쓰는 디렉터리일 수 있다. `npx commitgate --no-agent-entrypoints`로 이 계층 전체를 건너뛴다. 기존 파일 미덮어씀 원칙은 그대로라 충돌 시에도 파괴는 없다.

### D8 — 새 SSOT 상수 `KIT_AGENT_ENTRYPOINTS`

```ts
export const KIT_AGENT_ENTRYPOINTS = [
  { src: 'templates/claude-skill.md',   dest: '.claude/skills/commitgate/SKILL.md' },
  { src: 'templates/claude-command.md', dest: '.claude/commands/req.md' },
  { src: 'templates/cursor-rule.mdc',   dest: '.cursor/rules/commitgate.mdc' },
] as const
```

`src !== dest`라 기존 `copyInto`(`relative(PACKAGE_ROOT, src)`로 레이아웃 재현)를 쓸 수 없다. 명시적 `src→dest` 복사기가 필요하고, 중첩 디렉터리(`.claude/skills/commitgate/`)를 `mkdirSync({recursive:true})`로 만든다. **preflight에서 대상 부모 디렉터리 쓰기 가능 여부를 미리 검사**해 apply 단계의 부분 설치를 막는다.

`uninstall`의 `tool` 분류는 지금 `join(PACKAGE_ROOT, rel)`로 원본을 찾는다 — `src≠dest`에서 깨진다. `ToolArtifact`에 원본 경로를 분리해 넘기는 형태로 고친다(`{ path: dest, srcAbs }`).

`CLAUDE.md`는 `AGENTS.template.md`와 같은 취급: `templates/CLAUDE.template.md` → `CLAUDE.md`, **부재 시에만**, `ambiguous` 분류.

진입점 3종은 CommitGate 전용 경로라 `tool`(바이트 비교) 분류가 안전하다. 사용자가 편집하면 `differs`로 잡혀 자동 제거 후보에서 빠진다 — `AGENTS.md` 처리와 일관된다.

### D9 — `req:next`는 `REQ_SCRIPTS`에 추가된다

`package.json` 주입 대상이 4개 → 5개. `init`은 **부재 키만** 주입하므로 기존 설치본에 `npx commitgate`를 다시 돌리면 `req:next`만 추가된다. 비파괴.

---

## Phase별 구현

| phase | 산출물 | 파일 | 핵심 |
|---|---|---|---|
| `phase-1a-persona-install` | `workflow/review-persona.md`, `lib/config.ts`(상수만), `bin/init.ts`(`KIT_COPY_RELPATHS`), `bin/uninstall.ts`(**경로 기반 `tool` 분류만**), `package.json`(files), 테스트 3종 | 8 | **파일을 먼저 깐다** (D3-1) |
| `phase-1b-persona-inject` | `lib/config.ts`, `req.config.schema.json`, `review-codex.ts`, `req.config.json.sample`, `bin/uninstall.ts`(**config 축 info**), 테스트 3종 | 8 | **그 다음에 fail-closed 소비를 켠다** |
| `phase-2-req-next` | `scripts/req/req-next.ts`, `review-codex.ts`(`last_review` 마커), `bin/init.ts`(REQ_SCRIPTS), `package.json`(scripts), 테스트 3종 | 7 | G1/G2 + allowlist + `--no-optional-locks` (D6-1·D6-2) |
| `phase-3a-entrypoint-install` | `templates/*` 4종, `AGENTS.template.md`(마커), `bin/init.ts`(복사기·마커 경고·opt-out), `package.json`(files), `init.test.ts` | 8 | `src≠dest` (D8) |
| `phase-3b-entrypoint-uninstall` | `bin/uninstall.ts`(분류), `uninstall.test.ts` | 2 | tool vs ambiguous |
| `phase-4-docs-version` | `README.md`, `README.en.md`, `0.4.0` bump | 4 | |

**phase-1a와 1b의 `bin/uninstall.ts` 분담** (design R3 P3): `reviewPersonaPath`는 **1b에서야** `RawConfig`/`ResolvedConfig`/스키마에 들어간다. 따라서 1a의 uninstall은 `loadConfig`로 그 값을 해소할 수 없다. 1a는 `KIT_COPY_RELPATHS` 기반의 **경로 축** `tool` 분류만 한다(config 불필요). "해소된 `reviewPersonaPath`가 init이 깐 경로와 다르면 info" 같은 **설정 축** 분기는 1b로 간다 — `schemaPath` 축 분기와 대칭.

`phase-1a` → `phase-1b` 순서가 D3-1의 안전 근거다. 1a가 커밋된 뒤에만 1b가 fail-closed를 켠다. 이 repo 자신의 후속 리뷰(1b 이후 전부)도 그 순서로만 살아남는다.

`phase-3`은 D18 WARN(8파일)을 넘기므로 **선제 분할**한다(design R2 observation). `AGENTS.template.md`의 마커 추가는 마커 경고 로직과 **같은 phase(3a)** 여야 테스트가 성립한다.

## 변경 파일

**신규**: `workflow/review-persona.md`, `scripts/req/req-next.ts`, `templates/claude-skill.md`, `templates/claude-command.md`, `templates/cursor-rule.mdc`, `templates/CLAUDE.template.md`, `tests/unit/req-next.test.ts`

**수정**: `scripts/req/lib/config.ts`, `scripts/req/review-codex.ts`, `workflow/req.config.schema.json`, `bin/init.ts`, `bin/uninstall.ts`, `package.json`, `package-lock.json`, `README.md`, `README.en.md`, `AGENTS.template.md`, `req.config.json.sample`, `tests/unit/{req-config,req-review-codex,init,uninstall,package-payload}.test.ts`

**미변경**: `workflow/machine.schema.json`(verdict 스키마 불변 → `MACHINE_SCHEMA_VERSION` = `1.1` 유지), `scripts/req/{req-commit,req-doctor,req-new}.ts`, `workflow/REQ-2026-00*`(과거 감사 기록)

## 하위호환·안전

- **승인 바인딩 불변**: D9/D10/D13, `approved_diff_hash`, `consumed_approvals`, evidence 아카이브 로직에 손대지 않는다. 페르소나는 프롬프트 **입력**만 바꾸고 verdict **검증**은 그대로다.
- **`req:next`는 읽기 전용**(D6-1, 테스트로 강제) → 오작동해도 상태를 오염시키지 못한다.
- **config 스키마 확장은 additive** → 기존 `req.config.json`은 그대로 유효. init은 새 키를 주입하지 않는다(D4).
- **혼합 버전**: D4의 표 4행 전부 분석 완료. 유일한 실패는 "사용자가 persona 파일 삭제" = 의도된 fail-closed.
- **`DEFAULTS.reviewPersonaPath`는 중립 기본값**이다(모든 대상 프로젝트에서 init이 그 파일을 깐다). REQ-2026-009가 세운 "코어 기본값은 프로젝트 중립" 원칙 준수.
- **버전**: public 계약에 키·명령·설치물이 **추가**되므로 minor. `0.3.1` → `0.4.0`.
- **payload 회귀 가드**: `files[]`(tarball 축)와 `KIT_COPY_RELPATHS`(설치 축)를 **둘 다** 갱신한다. 정본 증거는 격리된 `npm_config_cache`를 쓴 `npm pack --dry-run --json` + 실 sandbox 설치.
