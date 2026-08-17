# REQ-2026-166 설계

## 문제 요약

| # | 결함 | 실측 |
|---|---|---|
| ① | 설치가 아닌 디렉터리에서 `C7` 이 persona 조치를 안내 | 빈 디렉터리 `check` → `action` 1건 |
| ② | `req:*` verb 12개 중 **11개**가 `--help` 를 거부 | `bin/commitgate.mjs` 순회 |

## DEC-1 — 자산 축은 "설치 신호"를 전제로 판정한다 (①)

### 왜 지금 틀리는가

`upgrade-status` 의 자산 축 다섯(`req-scripts`·`vendored-schema`·`workflow-gitignore`·`managed-blocks`·
`review-persona`)은 `assetPrelude` 로 공통 전제를 검사한다. 그 전제는 **dogfood 인가** 하나뿐이다.
"애초에 CommitGate 설치본인가"는 아무도 묻지 않는다.

네 축은 입력이 없으면 자연히 `unknown` 이 되어 결과적으로 안전했다. `review-persona` 만 그렇지 않다 —
`planSync` 는 persona 부재를 **복원 대상**(`status:'new'`)으로 보고하고, 그것은 설치본이든 아니든 같다.
즉 **다른 축이 안전했던 것은 설계가 아니라 우연**이다. 전제를 명시하지 않는 한 다음 축에서 또 난다.

### 무엇을 한다

`UpgradeStatusInput` 에 `installSignals?: string[] | null` 을 더하고, `assetPrelude` 가 그것을 먼저 본다.

```
1. packageRootDiffers === undefined  → unknown('미수집')
2. installSignals    === undefined   → unknown('미수집')
3. installSignals.length === 0       → unknown('CommitGate 설치 신호 없음 — 판정 대상이 아니다')
4. packageRootDiffers === false      → ok('점검 불요(dev repo/dogfood)')
```

값은 `lib/setup-gate` 의 **`collectInstallSignals(root, ticketRoot)`** 를 그대로 부른다.

- 🔴 **재구현하지 않는다.** `req:doctor` D24 가 이미 그 함수를 쓴다. 두 벌이 되면 *"doctor 는 설치로 보는데
  check 는 아니라는"* 상태가 생긴다(REQ-2026-094 가 같은 결론).
- 문턱은 **1 이상**이다. `setup-gate` 의 `MIN_INSTALL_SIGNALS = 2` 를 쓰지 않는다 — 그것은 "setup 이
  끝났는가"를 묻는 더 강한 질문이고, 여기 질문은 "여기가 CommitGate 프로젝트이긴 한가"다. 2를 쓰면
  신호가 하나뿐인 **부분 설치 프로젝트의 진짜 조치가 `unknown` 뒤로 숨는다**.

### `undefined` 를 하위호환 통과로 쓰지 않는다

새 필드라 기존 호출부는 `undefined` 를 낸다. 그것을 "가드 통과"로 읽으면 **미수집을 기본값으로 읽는**
것이고, REQ-2026-165 phase-2 r01 P1 이 바로 그 자리에서 잡힌 결함이다(`schemaPathIsDefault`).
이 모듈이 스스로 선언한 법(`undefined` = 미수집 → `unknown`)을 새 필드에서만 어길 이유가 없다.
따라서 `undefined` → `unknown`, 그리고 실 호출부(`collectUpgradeStatusInput`)와 테스트 헬퍼가 값을 채운다.

### 두 축은 왜 이 전제를 두지 않는가

- `mixed-install` — 자산이 아니라 **`package.json` 의 형태**다. `scripts` 를 읽지 못하면 이미 `unknown`,
  읽었다면 그 판정은 설치 신호와 무관하게 참이다(dogfood 도 본다 — 기존 계약).
- `contract-claims` — 자산이 아니라 **문구**다. `action` 이 나오려면 계약 파일이 실재하고 그 안에 폐기
  서술이 있어야 한다. 즉 조건 자체가 이미 설치를 함의한다.

이 둘에 전제를 더하면 조치가 **줄기만** 하는 게 아니라 dogfood 계약(`contract-claims` 는 dogfood 에서도
본다)이 뒤집힌다. 비목표다.

### 대안과 기각

| 안 | 기각 사유 |
|---|---|
| `personaStateOf` 가 설치 아님을 `unmanaged` 로 반환 | `unmanaged` 는 "custom/비활성 persona"라는 **다른 뜻**이다. 뜻을 겹치면 진짜 unmanaged 를 구분할 수 없다 |
| `planSync` 가 비설치에서 persona 를 `unchanged` 로 보고 | `sync` 의 계약이 옳다 — 부재면 복원이 맞다. 소비자가 `sync --persona` 를 직접 부르는 경로를 망가뜨린다 |
| `check` 가 비설치면 C7 자체를 건너뜀 | 축별 판정을 통째로 숨긴다. `mixed-install` 처럼 여전히 유효한 판정까지 사라진다 |

### 남는 것 — `ok` 의 정직성

빈 디렉터리에서 `workflow-gitignore` 가 "런타임 스크래치가 모두 보호됨"이라 말하던 것도 이 전제로
`unknown` 이 된다. 조치가 늘지 않으므로 제약 위반이 아니고, 없는 프로젝트를 "정상"이라 부르던 것이
사라진다.

## DEC-2 — `req:*` 전 verb 에 사용법을 둔다 (②)

### 자리

새 모듈 `scripts/req/lib/verb-help.ts`:

```ts
export interface VerbOption { flag: string; value?: string; desc: string }
export interface VerbHelp { summary: string; usage: string[]; options: VerbOption[]; notes?: string[] }

export const REQ_VERB_HELP: Record<string, VerbHelp>          // verb → 사용법(정본)
export function renderVerbHelp(verb: string): string          // 공용 렌더러
export function wantsHelp(argv: readonly string[]): boolean   // -h | --help
export function helpGate(verb: string, argv: readonly string[]): boolean  // 출력하고 true
```

🔴 옵션을 **문자열 본문이 아니라 구조로** 든다. 산문에서 `--flag` 를 정규식으로 긁으면 가드가 오려는
플래그 목록 자체가 추정이 된다. 구조로 두면 가드가 **등록된 플래그 그대로**를 검사한다.

각 verb 의 `main` **첫 줄**에 한 줄:

```ts
if (helpGate('req:confirm', argv)) return
```

`req:review-codex` 는 옵션 파싱 前 인자 검사에서 죽으므로(실측: *"REQ id 또는 --ticket 필요"*)
그 검사보다 **앞**이어야 한다.

### 왜 `makeRunCli` 안에 넣지 않는가

넣으면 12곳이 아니라 1곳이지만, `cli-boundary.ts:7-11` 이 그 어댑터를 **일부러 좁게** 만들었다고
못박아 두었다. 또 12개 verb 중 11개는 prefix 를 넘기지 않아(`'commitgate'` 기본값) 어차피 파일마다
한 줄을 고쳐야 한다 — 그 한 줄을 `verb` 로 하나 `helpGate` 로 하나 편집량은 같다. 대신 어댑터의
계약은 손대지 않는다.

복제 위험(어떤 verb 가 이 한 줄을 빠뜨림)은 **가드가 원천 차단**한다 — 아래.

### 본문 규칙

- 형태는 `req:delegate` 의 현행 출력을 따른다(`commitgate <verb> — <한 줄>` · 빈 줄 · `사용법:` · `옵션:`).
  `req:delegate` 의 **내용**은 그대로 옮긴다(문구 개선 아님). 줄 정렬·들여쓰기는 공용 렌더러를 따르므로
  바이트 동일은 요구하지 않는다 — 정본을 두 곳에 두지 않는 것이 목적이다.
- 🔴 **옵션은 그 verb 의 파서가 실제로 해석하는 것만 적는다.** 없는 플래그를 안내하면 이 세션이 반복해
  고쳐온 *"실행 불가능한 안내"* 와 같은 결함이 된다.

## 가드

| # | 무엇 | 왜 공허하지 않은가 |
|---|---|---|
| G1 | `VERB_MODULES` 의 `req:*` 전부가 `REQ_VERB_HELP` 에 있다 | 목록을 **등록부에서 파생** — 새 verb 를 더하면 자동으로 red |
| G2 | **실제 진입점 e2e**: `bin/commitgate.mjs req:<v> --help` · `-h` 를 verb 전부에 대해 spawn → exit 0 · 출력 비지 않음 · verb 이름 포함 | 소스 가드는 exit code 를 증명하지 못한다. ②의 오독이 **진입점이 아닌 것을 돌려서** 났다 |
| G3 | 사용법에 적힌 플래그를 그 verb 의 **`parseArgs` 가 실제로 수용한다** | 아래 — 존재 검사가 아니라 수용 검사다 |
| G4 | 설치 신호 0 → 자산 축 다섯이 `action` 이 아니다 / 신호 있고 persona 부재 → **여전히** `action` | 양방향 — 과잉 완화면 red |
| G5 | `check` 배선: `collectUpgradeStatusInput` 이 `installSignals` 를 채운다(빈 임시 디렉터리 실측) | 배선 끊김은 순수 테스트가 못 잡는다(3연속 실증) |

### G3 — 수용 오라클 (design r02·r03 P1)

**r02 P1** — 문자열 존재만 보면 주석·오류 문구·죽은 분기에 그 이름이 있어도 green 이다. 즉 **파서가
거부하는 플래그를 안내해도 통과한다** — 이 REQ 가 고치려는 *"실행 불가능한 안내"* 를 가드가 통과시킨다.

**r03 P1** — 그렇다고 "상존하지 않는 플래그는 던져야 한다"로 갈 수도 없다. 실측:

```
parseArgs(['2026-166'])               → {…, run:false, …}
parseArgs(['2026-166','--__nope__'])  → {…, run:false, …}   ← 던지지 않는다(조용히 무시)
parseArgs(['2026-166','--run'])       → {…, run:true,  …}
```

`req:review-codex` 의 파서는 **permissive** 다. 파서 계약을 엄격화하는 것은 이 REQ 의 범위가 아니고
(하위호환 영향이 별개 판단이다), 그걸 전제로 한 오라클은 항상 red 가 된다.

**그래서 오라클은 "수용"을 이렇게 정의한다 — 문서에 적힌 플래그는 파싱 결과를 바꾼다**(부작용 없음,
실행하지 않는다):

```
base   = parseArgs(base)                       → 던지지 않아야 한다        (앵커 ①)
flag   = parseArgs([...base, F, 표본값?])       → base 와 **달라야** 한다   (수용 증거)
nope   = parseArgs([...base, '--__nope__'])    → base 와 **같아야** 한다   (앵커 ②)
```

- 앵커 ①이 없으면 base 가 던지는 순간 전부 공허해진다.
- 앵커 ②가 차이의 출처를 고정한다 — 상존하지 않는 이름으로도 결과가 달라진다면 그 비교는 무의미하다.
  엄격한 파서라면 이 줄은 throw 로 만족된다(둘 다 허용).
- 값을 받는 플래그는 등록부의 표본값을 함께 넘긴다. 등록부가 값 유무를 틀리게 적으면 `값이 필요합니다`
  로 **red** 가 된다 — 즉 이 오라클은 플래그 이름뿐 아니라 **모양**까지 고정한다.

G3 의 역방향(파서가 읽는 모든 플래그가 문서에 있다)은 두지 않는다 — 공유 파싱·내부 전용 플래그에서
오탐이 나고, 오탐 나는 가드는 사람이 끈다.

G2 는 spawn 12회다(≈30초). 스폰이 스위트 비용의 대부분인 것은 알지만, **이 REQ 의 유일한 참 오라클**이
거기에 있다 — 소스만 보는 가드로는 ②를 처음부터 다시 놓친다.

## Phase

| phase | 내용 |
|---|---|
| 1 | DEC-1 — `upgrade-status` 전제 + `check` 배선 + G4·G5 |
| 2 | DEC-2 — `verb-help` + 12 verb 배선 + G1·G2·G3 |
| 3 | CHANGELOG · 버전 |

## 비목표

- 새 축·새 진단·새 조치.
- `planSync` 의 persona 상태 의미 변경.
- `bin/*` verb 의 help 문구 개선.
- `makeRunCli` 의 계약 변경.
