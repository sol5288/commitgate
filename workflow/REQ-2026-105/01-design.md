# REQ-2026-105 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

정규화 해시로 분류한 실측(`grep -A7 '^export function runCli' | tr -d ' \r\n' | md5sum`):

| 형태 | 파일 수 | 대상 |
|---|---|---|
| 바이트 동일 (`dac5633d`) | 11 | `bin/init.ts` · `scripts/req/`의 `req-close`·`req-commit`·`req-confirm`·`req-doctor`·`req-new`·`req-next`·`req-rebind`·`req-reconstruct`·`req-review-exception`·`review-codex` |
| 접두어만 다름 | 4 | `bin/`의 `quickstart`·`uninstall`·`sync`·`migrate` — `commitgate <verb>: ` 접두어 + `runX(parseArgs(argv))` |
| 본문 상이 | 3 | `bin/check.ts` · `bin/delivery.ts` · `bin/setup.ts` — 셋 다 help를 **오류가 아닌 제어 흐름**으로 처리한다. 앞 둘은 `HelpRequested`를 잡아 `printHelp()` 후 정상 반환(접두어 `commitgate check: `·`commitgate delivery: `). `setup.ts`는 **async** `runCli(argv, deps?)`다 — 첫 측정이 `export function runCli` grep이라 이 파일을 놓쳤고, 실제 총계는 17이 아니라 **18**이다 |

동일 본문:

```ts
export function runCli(argv: string[]): void {
  try { main(argv) } catch (err) {
    console.error(`commitgate: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  }
}
```

`isMain`은 **18개 파일 전부**에 있고, 그중 2곳(`req-confirm.ts:169`·`req-rebind.ts:291`)만 표현이 다르다. 11 + 4 + 3 = 18로 합이 맞는다.

## 핵심 설계 결정

### DEC-1 헬퍼는 `scripts/req/lib/cli-boundary.ts`에 둔다

`bin/*.ts`가 이미 `../scripts/req/lib/*`를 import한다(`check.ts:16`·`delivery.ts:18-20` 등 실측). 새 공유 위치를 만들 이유가 없다.

`package.json` `files[]`에 `scripts/req`가 이미 있으므로 **배포 페이로드에 자동 포함**된다(누락 skew 없음 — REQ-2026-025/038 계열 재발 방지).

### DEC-2 헬퍼는 두 개, 훅은 없다

```ts
export function makeRunCli(run: (argv: string[]) => void, prefix = 'commitgate'): (argv: string[]) => void
export function isEntrypoint(moduleUrl: string): boolean
```

- `makeRunCli`는 **접두어만** 파라미터로 받는다. 15개 호출자를 덮는 데 그 이상이 필요 없다.
- 🔴 **`check.ts`를 위한 `onError` 훅을 만들지 않는다.** `HelpRequested`는 오류가 아니라 제어 흐름이고, 그것을 헬퍼가 알게 하면 "예외 → 한 줄 메시지 + exit 1"이라는 경계의 의미가 흐려진다. 한 호출자를 위해 공용 계약을 넓히는 것은 중복 제거로 얻는 것보다 잃는 것이 크다. `check.ts`는 자기 경계를 유지하고, **왜 공유하지 않는지 주석으로 남긴다**(다음 사람이 "빠뜨렸다"고 오해하지 않게).

### DEC-3 `isEntrypoint`는 **가드 우선** 표현식으로 통일한다

```ts
export const isEntrypoint = (moduleUrl: string): boolean =>
  process.argv[1] !== undefined && moduleUrl === pathToFileURL(process.argv[1]).href
```

두 변형의 **결과는 현재 같다**(실측: `pathToFileURL('')`은 throw하지 않고 cwd URL(`file:///D:/1_projects/61_commitgate`)을 낸다 → 어떤 모듈 URL과도 불일치 → `false`). 그래도 가드 우선을 정본으로 삼는 이유는, 같은 결과를 **`pathToFileURL('')`의 미문서화 동작에 의존해서** 얻지 않기 위해서다. Node가 그 동작을 바꾸면 16곳이 함께 흔들린다.

`?? ''` 형태를 지우는 것이므로 **동작 변화 없음**을 이 근거로 주장한다(추측이 아니라 실행 결과다).

### DEC-4 `check.ts`·`delivery.ts`·`setup.ts`는 자기 `runCli`를 유지한다 — **그러나 `isEntrypoint`는 쓴다**

초안은 `delivery.ts`를 "본문이 try 안에 있을 뿐"으로 보고 편입하려 했다. **검토 중 두 번 틀렸음이 드러났다**:

1. `delivery.ts:runCli`도 `check.ts`와 똑같이 `HelpRequested`를 잡아 `printHelp()` 후 정상 반환한다(오류 아님).
2. `bin/setup.ts`에도 `runCli`가 있는데 **`export async function`**이라 첫 grep(`export function runCli`)이 놓쳤다. async + `deps?` 주입 seam이라 동기 헬퍼로 덮을 수 없다.

세 파일 모두 `runCli` 통합에서 제외한다:

- 흡수하려면 헬퍼가 예외 **클래스**·**핸들러**·**async 여부**를 파라미터로 받아야 한다. 본문 8줄짜리 호출자 3개를 위해 공용 경계를 그만큼 일반화하는 것은 남는 장사가 아니다.
- 더 중요하게, 그러면 경계의 계약이 "예외 → 한 줄 + exit 1"에서 "예외 → 경우에 따라 정상 종료"로 **약해진다**. 그 계약이 스택트레이스 비노출의 근거다.

🔴 **그러나 `isEntrypoint`는 이 세 파일에도 적용한다**(설계 r01 P1). `runCli` 통합과 `isMain` 통합은 **별개 관심사**이며, 전자의 예외가 후자로 번지면 요구 2("18곳 전부 통일")가 충족되지 않는다. 실제로 초안 계획은 11곳만 바꿔 나머지 7곳이 옛 표현식을 그대로 평가하게 두고 있었다.

세 파일에는 **왜 `runCli`만 공유하지 않는지 주석을 남긴다.** 다음 사람이 "15곳은 헬퍼를 쓰는데 여기만 빠졌다"를 결함으로 오해하지 않게 한다.

### DEC-5 회귀 방어는 기존 자산에 기댄다

`tests/unit/dispatch.test.ts`가 **모든 `VERB_MODULES` 대상이 `runCli`를 export하는지**를 이미 전수 검사한다(REQ-2026-090). 배선이 끊기면 여기서 잡힌다. 새 테스트는 헬퍼 자체의 단위 검사만 추가한다(접두어 적용·비-Error throw의 `String(err)` 처리·`exitCode=1`).

🔴 **오류 메시지 문자열을 고정 문자열로 단언한다.** 이 REQ의 계약이 "메시지 불변"이므로 오라클도 문자열이어야 한다.

## Phase별 구현

| phase | 내용 | 파일 |
|---|---|---|
| `phase-1-cli-boundary-helper` | 헬퍼 신설 + 단위 테스트 + **바이트 동일 11곳** 전환(`runCli`+`isMain` 둘 다) | 13 |
| `phase-2-cli-boundary-variants` | 접두어 변형 4곳 전환(`runCli`+`isMain`) + `check`·`delivery`·`setup` **`isMain`만** 전환 + 미공유 사유 주석 + CHANGELOG | 8 |

🔴 phase-1은 13파일로 granularity 권고(8)를 넘는다. **분할하지 않는 이유**: 11곳이 바이트 동일한 기계적 치환이라 검수 면적이 파일 수에 비례하지 않는다(같은 diff 11번). 오히려 쪼개면 "헬퍼는 있는데 절반만 쓰는" 중간 상태가 커밋된다. `phases[].max_files`로 15를 선언한다.

## 변경 파일

- phase-1: `scripts/req/lib/cli-boundary.ts`(신규) · `tests/unit/cli-boundary.test.ts`(신규) · `bin/init.ts` · `scripts/req/{req-close,req-commit,req-confirm,req-doctor,req-new,req-next,req-rebind,req-reconstruct,req-review-exception,review-codex}.ts`
- phase-2: `bin/{quickstart,uninstall,sync,migrate}.ts`(`runCli`+`isMain`) · `bin/{check,delivery,setup}.ts`(**`isMain`만** + 미공유 주석) · `CHANGELOG.md`

## 하위호환·안전

| 축 | 영향 |
|---|---|
| 오류 메시지 | **불변**(접두어·본문 동일). 테스트가 고정 문자열로 단언 |
| exit code | **불변**(`process.exitCode = 1`) |
| verb 표면 | **불변**. `dispatch.test.ts`가 전수 검사 |
| `isMain` 판정 | 18곳 전부 `isEntrypoint`로 수렴. 결과는 실측상 동일(아래 DEC-3) |
| 배포 페이로드 | `scripts/req`가 이미 `files[]`에 있어 신규 파일이 자동 포함 |
| state·아카이브·원장·프롬프트 | **미접촉** |

**되돌리기**: phase별 독립 커밋이라 개별 revert 가능.
