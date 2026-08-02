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
