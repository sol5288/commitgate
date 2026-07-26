import { describe, it, expect } from 'vitest'
import {
  isInteractiveTty,
  runSetup,
  parseArgs,
  HelpRequested,
  NON_TTY_MESSAGE,
  PHASE1_INTERACTIVE_NOTICE,
  type SetupDeps,
} from '../../bin/setup'

/**
 * REQ-2026-060 phase-1 — TTY 판정 + verb 골격(설계 DEC-1·DEC-2).
 *
 * 🔴 이 파일의 헤드라인 단언은 **"비-TTY에서는 아무 일도 일어나지 않는다"**이다. `setup`은 이 저장소
 *    최초의 대화형 명령이고, 가드가 늦으면 에이전트 세션이 blocking read에서 얼어붙는다. 그래서
 *    "throw 한다"뿐 아니라 **"throw 전에 부작용이 0건이다"**(log 미호출)까지 검증한다.
 */

/** log 호출을 기록하는 deps. 부작용 0건 단언의 관측점. */
function deps(stdin: boolean | undefined, stdout: boolean | undefined): SetupDeps & { logs: string[] } {
  const logs: string[] = []
  return { streams: { stdin, stdout }, log: (m) => logs.push(m), logs }
}

describe('[setup] isInteractiveTty — stdin·stdout 둘 다 true일 때만 대화형(DEC-2)', () => {
  /**
   * 🔴 **정상 경로 회귀 가드**(phase-1 r01 P1). 실측(Windows 11 · Git for Windows 2.46.0 · Node v24.18.0):
   * PowerShell 대화형과 **Git Bash(mintty) 대화형이 둘 다 `true`/`true`** 를 보고했고, `npx` 경유에서도 유지됐다.
   * 즉 통상 경로 `npx commitgate setup`은 두 터미널 모두에서 통과한다 — "mintty는 undefined"는 ConPTY 이전의
   * 옛 동작이다. 이 단언이 깨지면 **실제 터미널 사용자를 거부**하는 회귀다.
   */
  const supportedTerminals: Array<[string, boolean, boolean]> = [
    ['PowerShell 대화형(실측)', true, true],
    ['Git Bash(mintty) 대화형(실측)', true, true],
    ['npx 경유 — 두 터미널 모두 유지(실측)', true, true],
  ]
  for (const [name, stdin, stdout] of supportedTerminals) {
    it(`지원 터미널을 거부하지 않는다: ${name}`, () => {
      expect(isInteractiveTty({ stdin, stdout })).toBe(true)
    })
  }

  // 🔴 `undefined`는 비-TTY의 **실제** 값이다(phase-1 spike 실측: PowerShell·Git Bash 양쪽 에이전트 셸에서
  //    stdin/stdout/stderr 모두 undefined). `!isTTY`가 아니라 `=== true`로 판정하는 이유가 이것이다.
  const rejected: Array<[unknown, unknown]> = [
    [undefined, undefined],
    [true, undefined],
    [undefined, true],
    [false, false],
    [true, false],
    [false, true],
  ]
  for (const [stdin, stdout] of rejected) {
    it(`stdin=${String(stdin)} stdout=${String(stdout)} → 비대화형(거부)`, () => {
      expect(isInteractiveTty({ stdin: stdin as boolean | undefined, stdout: stdout as boolean | undefined })).toBe(false)
    })
  }
})

describe('[setup] runSetup — 비-TTY는 질문 없이 즉시 실패(DEC-1)', () => {
  it('비-TTY: NON_TTY_MESSAGE로 throw', () => {
    const d = deps(undefined, undefined)
    expect(() => runSetup({ dir: '/tmp/x' }, d)).toThrow(NON_TTY_MESSAGE)
  })

  it('🔴 비-TTY: throw 전에 부작용 0건 — log가 한 번도 호출되지 않는다', () => {
    const d = deps(undefined, undefined)
    expect(() => runSetup({ dir: '/tmp/x' }, d)).toThrow()
    expect(d.logs).toEqual([])
  })

  it('거부 메시지는 에이전트에게 "요청하라"를, 사람에게 통상 실행법을 지시한다', () => {
    expect(NON_TTY_MESSAGE).toContain('에이전트')
    expect(NON_TTY_MESSAGE).toContain('사용자에게 실행을 요청')
    expect(NON_TTY_MESSAGE).toContain('npx commitgate setup')
  })

  // winpty는 **정상 실행법이 아니라 구형 환경 탈출로**다(phase-1 r01 P1 반영). 실측상 지원 터미널은
  // 그대로 통과하므로, 메시지가 winpty를 기본 경로처럼 제시하면 안 된다.
  it('winpty는 예외 경로로만 제시된다(기본 실행법으로 제시하지 않는다)', () => {
    expect(NON_TTY_MESSAGE).toContain('winpty')
    expect(NON_TTY_MESSAGE).toContain('구형 Git for Windows')
    expect(NON_TTY_MESSAGE).toContain('PowerShell·Git Bash 모두 그대로 동작')
  })

  it('TTY: 안내만 출력하고 아무것도 쓰지 않는다(phase-1 범위)', () => {
    const d = deps(true, true)
    expect(() => runSetup({ dir: '/tmp/x' }, d)).not.toThrow()
    expect(d.logs).toEqual([PHASE1_INTERACTIVE_NOTICE])
  })
})

describe('[setup] parseArgs — fail-closed', () => {
  it('--dir 는 절대경로로 해소된다', () => {
    expect(parseArgs(['--dir', '.']).dir).toBe(process.cwd())
  })

  it('--dir 값 누락 → throw', () => {
    expect(() => parseArgs(['--dir'])).toThrow('--dir')
  })

  it('알 수 없는 옵션 → throw(조용히 무시하지 않는다)', () => {
    expect(() => parseArgs(['--set', 'reviewModel=x'])).toThrow('알 수 없는 옵션')
  })

  // 비대화형 경로를 만들지 않는다는 것이 R1의 핵심이므로, `--set` 류가 **거부되는 것**이 계약이다.
  it('비대화형 설정 경로(--set/--non-interactive)는 존재하지 않는다', () => {
    expect(() => parseArgs(['--non-interactive'])).toThrow('알 수 없는 옵션')
    expect(() => parseArgs(['--yes'])).toThrow('알 수 없는 옵션')
  })

  it('-h/--help 는 HelpRequested(오류 아님)', () => {
    expect(() => parseArgs(['-h'])).toThrow(HelpRequested)
    expect(() => parseArgs(['--help'])).toThrow(HelpRequested)
  })

  it('인자 없음 → cwd', () => {
    expect(parseArgs([]).dir).toBe(process.cwd())
  })
})
