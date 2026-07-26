#!/usr/bin/env tsx
/**
 * commitgate setup — 리뷰어 설정 대화형 마법사 (REQ-2026-060).
 *
 * 🔴 **이 저장소 최초의 대화형 명령이자 최초의 "사람 전용" 명령이다**(설계 DEC-1·DEC-12).
 *    다른 모든 verb는 flag 기반이고 **에이전트가 비대화형으로 실행하는 것이 설계 전제**였다
 *    (`readline`/`isTTY`/`process.stdin` 사용처가 이 REQ 전까지 0건이었다).
 *    대화형 전용으로 두는 이유는 편의가 아니라 **에이전트가 게이트 정책을 스스로 바꾸는 경로를
 *    구조적으로 닫기 위해서**다(`req-commit.ts`의 "가장 강한 보장 = 사용자가 직접 실행"과 같은 축).
 *
 * 🔴 **절대 blocking read에 들어가지 않는다.** TTY 판정을 **가장 먼저** 하고, 실패하면 질문을 하나도 던지지
 *    않은 채 즉시 실패한다. 들어가면 에이전트 세션이 그대로 얼어붙는다.
 *
 * phase-1(이 커밋) 범위: TTY 판정 + verb 골격. 질문·로그인·설정 쓰기는 phase-2/3에서 온다.
 * 이 phase는 **아무것도 쓰지 않는다**.
 */
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * TTY 판정 입력(주입 가능 — 테스트). `process.std*.isTTY`는 **비-TTY에서 `undefined`**이지 `false`가 아니므로
 * 타입이 `boolean | undefined`다. 이 구분이 판정식(`=== true`)의 이유다.
 */
export interface TtyStreams {
  stdin: boolean | undefined
  stdout: boolean | undefined
}

/**
 * 대화형 판정(설계 DEC-2 — **실측으로 확정한 판정식**).
 *
 * **stdin·stdout이 모두 `true`일 때만** 대화형으로 본다. 질문을 읽으려면 stdin이, 그 질문을 보여 주려면
 * stdout이 각각 터미널이어야 하므로 둘 다 요구한다. `undefined`(비-TTY의 실제 값)와 `false`는 모두 거부다.
 *
 * ## phase-1 spike 실측 (Windows 11 · Git for Windows 2.46.0 · Node v24.18.0)
 *
 * | 조합                                   | stdin/stdout        | 판정 |
 * |----------------------------------------|---------------------|------|
 * | PowerShell 대화형 콘솔                  | `true` / `true`     | 허용 |
 * | **Git Bash(mintty) 대화형**             | **`true` / `true`** | 허용 |
 * | 위 두 터미널에서 `npx` 경유             | 유지(true/true)      | 허용 |
 * | 에이전트/파이프 셸(stdio 리다이렉트)     | `undefined`         | 거부 |
 *
 * (`npm run` 경유 조합은 **존재하지 않는다** — `setup`은 `req:` 접두 verb가 아니라 대상 repo의
 *  `package.json`에 스크립트가 주입되지 않는다. 설계 DEC-13 / `init.ts`의 `STAGE_B_REQ_VERBS`.)
 *
 * 🔴 **"mintty는 `isTTY`가 `undefined`"는 옛 이야기다.** Git for Windows가 ConPTY를 쓰면서 대화형 mintty도
 *    `true`를 보고한다(위 실측). 따라서 `=== true` 판정식이 **정상 경로를 거부하지 않는다** — 통상 경로인
 *    `npx commitgate setup`이 두 터미널 모두에서 그대로 통과한다.
 *
 * ⚠️ **env 휴리스틱(`TERM`·`MSYSTEM` 등)으로 보완하지 않는다 — 실측으로 배제했다.**
 *    비대화형 에이전트 셸에서도 `TERM=xterm-256color`·`MSYSTEM=MINGW64`가 그대로 존재한다.
 *    즉 env는 대화형/비대화형을 **구분하지 못하며**, env로 보완하면 이 가드가 막아야 할 바로 그 에이전트
 *    경로를 false-allow 한다.
 */
export function isInteractiveTty(streams: TtyStreams): boolean {
  return streams.stdin === true && streams.stdout === true
}

/**
 * 비-TTY 거부 메시지(설계 DEC-1).
 *
 * 주 독자는 **에이전트**다 — "네가 실행할 명령이 아니다, 사용자에게 요청하라". 이것이 통상적으로 이 메시지가
 * 뜨는 유일한 상황이다: 실측상 **지원 터미널(PowerShell·Git Bash)에서 직접 실행하면 그대로 통과**하므로
 * (`isInteractiveTty` 실측표), 사람이 이 메시지를 보는 것은 stdio가 리다이렉트됐거나(파이프·CI) ConPTY 이전
 * 구형 Git for Windows인 예외적 경우다. 마지막 줄은 그 잔여 경우를 위한 **탈출로**이며, 정상 실행법이 아니다.
 */
export const NON_TTY_MESSAGE = [
  '이 명령은 대화형 전용입니다 — 터미널이 아니어서 실행할 수 없습니다.',
  '',
  '  · 에이전트(Claude/Codex)는 이 명령을 실행하지 않습니다. 사용자에게 실행을 요청하세요.',
  '  · 사람이라면 터미널 창에서 직접 실행하세요:  npx commitgate setup',
  '    (PowerShell·Git Bash 모두 그대로 동작합니다. 파이프·리다이렉트·CI에서는 동작하지 않습니다.)',
  '  · 터미널에서 직접 실행했는데도 이 메시지가 보인다면 구형 Git for Windows(ConPTY 이전)일 수 있습니다.',
  '    그때만 예외적으로:  winpty npx commitgate setup',
].join('\n')

/** phase-1 안내 — 질문·로그인·설정 쓰기는 phase-2/3에서 온다. 이 phase는 아무것도 쓰지 않는다. */
export const PHASE1_INTERACTIVE_NOTICE = [
  'commitgate setup — 대화형 환경을 확인했습니다.',
  '리뷰 모델·추론강도 설정과 codex 로그인은 다음 단계에서 제공됩니다(REQ-2026-060 phase-2/3).',
  '이 단계에서는 아무 파일도 변경하지 않았습니다.',
].join('\n')

export interface Opts {
  /** 대상 repo 루트(기본: 현재 디렉터리). phase-3의 설정 쓰기가 이 값을 쓴다. */
  dir: string
}

/** 부작용 주입 seam(테스트). 출력·TTY 상태를 밖에서 준다. */
export interface SetupDeps {
  streams: TtyStreams
  log: (msg: string) => void
}

/** 인자 파싱(fail-closed): 값 누락·알 수 없는 옵션은 즉시 throw. */
export function parseArgs(argv: string[]): Opts {
  let dir = process.cwd()
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dir') {
      const v = argv[++i]
      if (!v) throw new Error('--dir 에 경로가 필요합니다')
      dir = v
    } else if (a === '-h' || a === '--help') {
      throw new HelpRequested()
    } else {
      throw new Error(`알 수 없는 옵션: ${a}`)
    }
  }
  return { dir: resolve(dir) }
}

/** `-h/--help` 신호(오류가 아니다 — runCli가 exit 0으로 처리). */
export class HelpRequested extends Error {
  constructor() {
    super('help')
    this.name = 'HelpRequested'
  }
}

/**
 * setup 본체(phase-1). **TTY 가드가 가장 먼저**이고, 그 앞에는 아무 부작용도 없다 —
 * `deps.log`조차 호출되지 않는다(테스트가 이 성질을 단언한다).
 */
export function runSetup(_opts: Opts, deps: SetupDeps): void {
  if (!isInteractiveTty(deps.streams)) throw new Error(NON_TTY_MESSAGE)
  deps.log(PHASE1_INTERACTIVE_NOTICE)
}

export function printHelp(): void {
  console.log(`commitgate setup — 리뷰어 설정 대화형 마법사

⚠️ **대화형 전용**입니다. 사람이 터미널에서 직접 실행해야 하며,
   에이전트(Claude/Codex)는 이 명령을 실행하지 않고 사용자에게 실행을 요청합니다.
   터미널이 아니면 질문을 하나도 던지지 않고 즉시 종료합니다.

사용법:
  npx commitgate setup [--dir <대상repo>]

옵션:
  --dir <path>   대상 repo 루트(기본: 현재 디렉터리)
  -h, --help     도움말

하지 않는 일:
  비대화형(--set 등) 설정 경로 · 설치(init 소관) · 게이트 강제 · 자격증명 보관.
`)
}

export function runCli(argv: string[], deps?: SetupDeps): void {
  const d: SetupDeps = deps ?? {
    streams: { stdin: process.stdin.isTTY, stdout: process.stdout.isTTY },
    log: (m) => console.log(m),
  }
  try {
    runSetup(parseArgs(argv), d)
  } catch (err) {
    if (err instanceof HelpRequested) {
      printHelp()
      return
    }
    console.error(`commitgate setup: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  }
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href
if (isMain) runCli(process.argv.slice(2))
