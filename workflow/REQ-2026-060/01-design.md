# REQ-2026-060 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

| 축 | 현재 | 근거 |
|---|---|---|
| verb 표면 | `init`/`quickstart`/`sync`/`migrate`/`uninstall` + `req:*` 8종 | `bin/dispatch.mjs:15-29` `VERB_MODULES`(SSOT) |
| 설정 | `req.config.json`(커밋됨) + AJV fail-closed | `scripts/req/lib/config.ts:145-193` |
| 모델·effort | `reviewModel`(slug 패턴) · `reviewReasoningEffort`(6값 enum + null) | `config.ts:159-161` |
| 대화형 인프라 | **없음**(`readline`/`isTTY`/`process.stdin` 사용처 0건) | 전 저장소 grep |
| 리뷰어 CLI 확인 | **없음** — 미설치·미로그인은 첫 호출에서야 드러남 | `adapters.ts:258` |
| spawn 헬퍼 | `safeSpawnSync`(출력 캡처) / `safeSpawnSyncStatus`(status 보존) | `adapters.ts:34,62` |

**실측(이 머신, codex-cli 0.144.1)**
```
codex --version      → codex-cli 0.144.1            (exit 0)
codex login status   → Logged in using ChatGPT      (exit 0, stdout)
codex login --help   → 하위: status/help · 옵션: --with-api-key / --with-access-token (둘 다 stdin)
```
→ 맨 `codex login`은 브라우저 OAuth이고, **비밀값을 stdin으로 받는 것은 두 옵션 변형뿐**이다.

## 핵심 설계 결정

### DEC-1 — 대화형 전용: non-TTY는 질문 없이 즉시 실패
TTY 판정을 **가장 먼저** 수행하고, 실패하면 `Prompter`를 **생성하지도 않는다**. 어떤 경로로도
blocking read에 들어가지 않는다 — 들어가면 에이전트 세션이 그대로 얼어붙는다.
실패는 `runCli` 경계를 통해 **한 줄 메시지 + exit 1**(다른 bin verb와 동일 관례).

> 메시지는 "사람이 터미널에서 직접 실행해야 하며 에이전트는 이 명령을 실행하지 않는다"를 말한다.

### DEC-2 — TTY 판정 방식은 **spike 실측 후** 확정한다
Git Bash(mintty)에서 node의 `process.stdin.isTTY`가 `undefined`로 나오는 것은 알려진 동작이다.
그대로 `!isTTY → 거부`로 두면 **사용자가 자기 터미널에서 직접 실행했는데 setup이 거부하는**
최악의 실패 모드가 된다.

🔴 **이 설계는 판정식을 미리 못 박지 않는다.** phase-1이 4조합
(PowerShell / Git Bash / `npx commitgate setup` / `npm run` 경유)을 실측하고, 그 결과로 판정식을 정한 뒤
**측정값을 커밋 메시지·CHANGELOG에 남긴다**. 어떤 결과가 나와도 DEC-1(질문 없이 즉시 실패)은 불변이다.

*근거: 측정하면 답이 나오는 것을 설계가 미리 단정하면, 틀렸을 때 설계 재승인이 필요해진다.*

### DEC-3 — `Prompter` 주입 seam
```ts
export interface Question { key: string; prompt: string; current: string | null; choices?: readonly string[] }
export interface Prompter { ask(q: Question): Promise<string>; close(): void }
```
실제 구현은 `node:readline/promises`, 테스트는 **스크립트된 답변 배열**. 기존
`GitRunner`·`CodexRunner`·`StatusSpawn` 주입 seam과 같은 관례다.
**질문 목록 생성 · 답변 검증 · config merge는 전부 순수 함수**로 두고, `readline`은 최외곽 1겹에만 둔다.

### DEC-4 — 질문 목록은 **명시**하되, 검증은 `CONFIG_SCHEMA`에서 가져온다
계획 단계에서는 "스키마 전체에서 질문을 파생"을 검토했으나 **채택하지 않는다** — 그러면
`ticketRoot`·`handoffPath`·`designDocs`까지 묻게 되어 이 REQ의 범위(모델·effort)를 넘는다.

대신 **질문은 2개로 명시**하고, 각 질문의 **검증 규칙은 `CONFIG_SCHEMA`의 해당 서브스키마**를 쓴다:
- `reviewModel` → `pattern`(slug) + `null` 허용(= 전역 상속)
- `reviewReasoningEffort` → `enum`(`none|minimal|low|medium|high|xhigh` + `null`)

그래서 enum이 늘어도 질문이 자동으로 따라가고, 스키마와 setup이 갈라지지 않는다.

### DEC-5 — 쓰기 표면은 `req.config.json` **한 파일**
setup은 이 파일만 쓴다. 관리 자산·`package.json`·계약 파일은 `init`의 소관이며 setup은 건드리지 않는다.
파일이 하나면 **원자성이 계약이 아니라 구조로** 보장된다.

- **temp + rename**(같은 디렉터리 → 같은 볼륨)으로 교체한다.
- 🔴 **이 REQ는 setup 완료 마커를 쓰지 않는다**(비목표 B). 다만 B가 마커를 추가할 자리를
  **이 파일로 예약**한다 — 별도 마커 파일을 만들면 두 파일 사이에 원자성 계약이 새로 필요해진다.

### DEC-6 — read-merge-write: 건드린 키만 바꾼다
기존 파일을 파싱해 **`reviewModel`·`reviewReasoningEffort`만 교체**하고 나머지 키는 값·순서를 보존한다.
직렬화는 `JSON.stringify(obj, null, 2) + '\n'`, 줄바꿈은 **LF로 고정**한다
(autocrlf 환경에서 도구마다 CRLF/LF가 갈리면 무의미한 diff와 byte-identity 테스트 실패가 난다).

### DEC-7 — 쓰기 전 AJV 재검증 (fail-closed)
merge 결과를 `CONFIG_SCHEMA`로 다시 검증하고, 실패하면 **쓰지 않는다**. `init`의 preflight 재검증과 같은 축이다.

### DEC-8 — 로그인은 실행하되 **비밀값은 만지지 않는다**
- **맨 `codex login`을 `stdio:'inherit'`로 실행**하고 브라우저 플로우 종료까지 기다린다.
  기존 `safeSpawnSync`는 출력을 캡처하므로 **inherit 전용 spawn 헬퍼가 따로 필요**하다.
- 🔴 **`--with-api-key` / `--with-access-token`은 쓰지 않는다.** 그 변형만이 비밀값을 stdin으로 받으며,
  commitgate가 이를 파이프하면 자격증명이 프로세스를 통과해 에러 메시지·로그로 샐 표면이 생긴다
  (원장이 `prompt_sha256`만 남기고 본문을 배제한 원칙 `review-ledger.ts:66-68`과 어긋난다).
- 🔴 **자격증명을 `req.config.json`에 넣지 않는다** — 그 파일은 커밋된다. 인증은 `~/.codex/`에 남는다.
- **이미 `logged-in`이면 재로그인을 강요하지 않고 건너뛴다.**

### DEC-9 — `authProbe`는 stdout을 읽고 3분류하며, setup에서는 `unknown`도 실패
```ts
type AuthState = 'logged-in' | 'logged-out' | 'unknown'
```
- 🔴 **stdout을 읽는다.** 이 저장소는 이미 같은 실수로 데인 적이 있다(*"adapters는 stderr만 읽는데
  codex는 에러를 stdout에 쓴다"*). 위 실측에서도 결과는 stdout이었다.
- exit code 단독으로 판정하지 않는다 — **로그아웃 상태의 exit code는 측정하지 못했다**(§미측정).
- 🔴 **setup의 재검증에서는 `unknown`도 실패로 처리한다.** 완료로 넘어가려면 "로그인 성공"이
  확정이어야 하고, setup은 사용자가 터미널 앞에 있어 재시도 비용이 거의 없다.
  *(런타임 리뷰 preflight의 관대한 처리는 비목표 F의 소관이며 이 REQ에서 정하지 않는다.)*

### DEC-10 — preflight → apply
```
① TTY 판정(DEC-1)          … 실패 시 질문 0건
② repo·config 로드          … 파싱/스키마 오류면 여기서 중단
③ codex versionProbe        … 미설치면 안내 후 중단(쓰기 없음)
④ 질문(모델·effort)         … 현재 값을 기본 답변으로(DEC-11)
⑤ authProbe → 필요 시 login → 재검증(DEC-8·DEC-9)
⑥ merge + AJV 재검증(DEC-7)
⑦ temp+rename 쓰기(DEC-5)   … 여기가 유일한 쓰기 지점
```
🔴 **로그인 취소·실패 시 `req.config.json`은 변경되지 않는다.** ⑦ 이전의 어떤 실패도 쓰기를 남기지 않는다.
중단 후 재실행은 멱등이다 — 같은 한 파일을 다시 교체할 뿐이다.

### DEC-11 — 재실행 시 현재 값을 기본 답변으로 제시
빈 입력(Enter) = 현재 값 유지. 그래서 "모델만 바꾸기"가 Enter 한 번 + 입력 한 번으로 끝난다.

### DEC-12 — 계약: `AGENTS.md`에 "사람 전용 명령" 절 신설
현재 통제점표(`AGENTS.template.md:93-100`)는 전부 "에이전트가 멈추고 승인 문장을 받는" 형태이고,
**"에이전트가 아예 실행하지 않는 명령"이라는 범주가 없다.** setup이 첫 사례이므로 절을 만든다.
DEC-1의 exit는 마지막 방어선이고, **계약이 먼저 막는 것이 옳다.**

### DEC-13 — verb 등록은 `package.json` 스크립트를 늘리지 않는다
`STAGE_B_REQ_VERBS`가 `VERB_MODULES`에서 **`req:` 접두사만 필터**하므로(`init.ts:189-191`),
`setup` 등록은 대상 repo의 `package.json`에 아무것도 주입하지 않는다 —
`init`/`sync`/`quickstart`와 동일하다. `files:["bin"]`이 이미 있어 tarball 적재도 자동이다.

## Phase별 구현

| phase | 내용 | 변경 파일 수(코드) |
|---|---|---|
| **phase-1** | TTY 판정 spike(4조합) + `bin/setup.ts` 골격(DEC-1·DEC-2) + dispatch 등록(DEC-13) | 3 |
| **phase-2** | 순수 코어 — 질문 모델·검증·merge(DEC-3·DEC-4·DEC-6·DEC-7) | 2 |
| **phase-3** | 로그인 실행·재검증 + preflight→apply 배선 + 원자적 쓰기(DEC-5·DEC-8~11) | 3 |
| **phase-4** | 문서(한/영)·계약(DEC-12)·CHANGELOG | 0(docs) |

## 변경 파일

- `bin/setup.ts` **(신규)** — verb 진입점 + 순수 코어
- `bin/dispatch.mjs` — `setup` verb 등록
- `scripts/req/lib/adapters.ts` — inherited-stdio spawn 헬퍼 + `versionProbe`/`authProbe`
- `tests/unit/setup.test.ts` **(신규)**
- `tests/unit/dispatch.test.ts` — verb 추가 반영
- `AGENTS.template.md` — 사람 전용 명령 절
- `docs/quick-start.md` · `docs/quick-start.en.md` · `docs/configuration.md` · `docs/configuration.en.md`
- `CHANGELOG.md`

## 하위호환·안전

- **기존 동작 무변경.** 신규 verb 추가일 뿐 `req:*`·게이트·doctor를 건드리지 않는다.
  `setup`을 한 번도 실행하지 않아도 모든 기존 워크플로가 그대로 동작한다(비목표 B).
- **`req.config.json` 부재 시**: `DEFAULTS`로 해소되는 현재 동작을 유지하고, setup은 선택된 2키만 담은
  파일을 새로 만든다. 나머지는 계속 `DEFAULTS`가 채운다.
- **자격증명 비취급**(DEC-8) — commitgate 프로세스를 통과시키지 않고 설정 파일에도 넣지 않는다.
- **`git status` 영향**: `req.config.json`은 추적 파일이므로 setup 실행은 워킹트리를 더럽힌다.
  이는 의도된 동작이며(사용자가 커밋할 설정 변경), `req:new`의 clean-tree 요구와 만나면 사용자가 먼저
  커밋해야 한다. 문서에 명시한다.

### 미측정 (정직성 경계)

1. **`codex login status`의 로그아웃 시 exit code·출력** — 로그아웃할 수 없어 미측정.
   → DEC-9가 exit code 단독 판정을 금지하고 `unknown`을 두는 이유다.
2. **Git Bash(mintty)의 `process.stdin.isTTY`** — → DEC-2의 spike가 phase-1의 첫 작업이다.
3. **`codex login`을 `stdio:'inherit'`로 spawn했을 때 Windows에서 브라우저가 열리는지** —
   → phase-3의 수용 기준에 실측을 넣는다.
