/**
 * CLI 경계 — 예외를 "한 줄 메시지 + exit 1"로 바꾸는 공용 어댑터와 엔트리포인트 판정(REQ-2026-105).
 *
 * 왜 공용인가: 이 경계의 계약은 **스택트레이스를 사용자에게 노출하지 않는다**는 것이다. 18개 CLI가
 * 각자 7줄씩 복제하고 있으면 한 곳만 어긋나도 raw stack이 샌다. 계약을 한 곳에 둔다.
 *
 * 🔴 **일부러 좁게 만들었다.** `makeRunCli`는 접두어만 받는다. help 신호처럼 "오류가 아닌 제어 흐름"을
 *    다루는 세 CLI(`bin/check.ts`·`bin/delivery.ts`·`bin/setup.ts`)는 자기 경계를 유지한다 — 예외
 *    클래스·핸들러·async 여부를 파라미터로 받기 시작하면 "예외 → 한 줄 + exit 1"이라는 계약 자체가
 *    "예외 → 경우에 따라 정상 종료"로 약해지기 때문이다. 그 세 파일에는 미공유 사유가 주석으로 있다.
 *    (다만 `isEntrypoint`는 그 셋도 쓴다 — 두 관심사는 별개다.)
 */
import { pathToFileURL } from 'node:url'

/**
 * `main`류 함수를 감싸 CLI 경계를 만든다. 예외는 `${prefix}: <message>` 한 줄로 바뀌고 exit code는 1이 된다.
 *
 * `process.exit()`가 아니라 `process.exitCode`를 쓴다 — 진행 중인 stdout 플러시를 끊지 않는다(기존 동작 보존).
 */
export function makeRunCli(
  run: (argv: string[]) => void,
  prefix = 'commitgate',
): (argv: string[]) => void {
  return (argv: string[]): void => {
    try {
      run(argv)
    } catch (err) {
      console.error(`${prefix}: ${err instanceof Error ? err.message : String(err)}`)
      process.exitCode = 1
    }
  }
}

/**
 * **자유 텍스트 옵션 값**을 읽는다(REQ-2026-129 phase-2 r02 P1, 순수).
 *
 * 문제: 승인 문장·사유는 `-`로 시작할 수 있어서 접두 검사를 못 한다. 그런데 그 자리를 무조건 값으로
 * 받으면 `--reason --run`이 **`--run`을 사유로 삼키고** 플래그는 사라진다 — 사용자가 요청하지 않은
 * 조합으로 명령이 성립한다(여기서는 DRY-RUN 의도가 실제 write로 바뀐다).
 *
 * 🔴 해법은 "모든 대시 거부"가 아니다(그러면 정당한 `-이유`를 못 쓴다). **알려진 옵션 이름**만 거부한다 —
 *    오타는 값으로 들어가더라도, 이 CLI가 실제로 해석하는 플래그는 절대 값으로 소비되지 않는다.
 */
export function readFreeTextValue(argv: string[], i: number, flag: string, knownOptions: readonly string[]): string {
  const v = argv[i]
  if (v === undefined) throw new Error(`${flag} 값이 필요합니다`)
  if (knownOptions.includes(v))
    throw new Error(`${flag} 값 자리에 옵션 "${v}" 가 왔습니다 — 값이 누락된 것으로 봅니다(옵션을 값으로 삼키지 않습니다).`)
  return v
}

/**
 * 이 모듈이 `node <file>`로 **직접** 실행됐는가(import된 것이 아니라).
 *
 * 🔴 **가드를 먼저 둔다**(REQ-2026-105 DEC-3). 이전에는 16곳이 `pathToFileURL(process.argv[1] ?? '')`,
 *    2곳이 이 형태였다. 실측하면 결과는 같다 — `pathToFileURL('')`은 throw하지 않고 cwd URL을 내므로
 *    어떤 모듈 URL과도 불일치해 `false`가 된다. 그래도 가드 우선을 정본으로 삼는 이유는 **같은 결과를
 *    `pathToFileURL('')`의 미문서화 동작에 의존해서 얻지 않기 위해서다.** Node가 그 동작을 바꾸면
 *    18곳이 한꺼번에 흔들린다.
 */
export function isEntrypoint(moduleUrl: string): boolean {
  return process.argv[1] !== undefined && moduleUrl === pathToFileURL(process.argv[1]).href
}
