import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CODEX_INSTALL_HINT, type VersionProbeResult, type AuthProbeResult } from '../../scripts/req/lib/adapters'
import { runInit, installGuidance, type InitOptions } from '../../bin/init'
import { runChecks, type CheckInputs } from '../../bin/check'
import { runSetup } from '../../bin/setup'

/**
 * G-B — 🔴 **"codex 가 없다"고 말하는 표면은 설치 명령을 함께 준다** (REQ-2026-083 DEC-2·DEC-4).
 *
 * ## 왜 이 가드가 있나
 *
 * 0.12.1 시점에 `npm i -g @openai/codex` 를 **런타임에 말하는 곳은 `--help` 단 하나**였다.
 * 정작 사용자가 막히는 자리 셋(`init` 설치 후 안내 · `setup` 미설치 오류 · `check` C2 실패)은
 * "설치·PATH 를 확인하세요"라고만 했다 — 신규 PC 에서 막다른 길이었다.
 * REQ-2026-082 가 `--help` 만 고치고 나머지를 놓친 것이 그 실패의 직접 원인이다.
 *
 * ## 오라클 — 🔴 **실제 사용자 대면 경로를 실행한다**
 *
 * 처음에는 메시지 **빌더 함수를 직접 호출**해 검사했다가 phase-2 r01 에서 P1 을 받았다:
 * 그 방식은 표면이 빌더를 **더 이상 호출하지 않게** 바뀌어도 통과한다(빌더는 그대로 살아 있으므로).
 * 그래서 여기서는 각 표면의 **진짜 진입점**을 돌린다 — `installGuidance(runInit(…))` ·
 * `runChecks(…)` · `runSetup(…)`. 배선이 끊기면 그 시점에 실패한다.
 *
 * 🔴 **이 가드가 하지 않는 것**: 새 표면을 자동으로 발견하지 못한다. 네 번째 표면이 생기면 여기에
 *    케이스를 추가해야 한다. 완전 자동 발견은 정적 스캐너가 필요하고, REQ-2026-044 에서 그 접근이
 *    오라클을 명세하지 못해 설계 5R 미수렴으로 폐기됐다 — 같은 함정에 다시 들어가지 않는다.
 */

const MISSING: VersionProbeResult = { ok: false, version: null, detail: 'spawn codex ENOENT' }
const AUTH_UNKNOWN: AuthProbeResult = { state: 'unknown', reason: 'probe-failed', detail: '' }

/** init 을 실제로 돌릴 수 있는 최소 대상 repo. */
function tmpRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cg-g83-'))
  const git = (a: string[]) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' })
  git(['init', '-q', '.'])
  git(['config', 'user.email', 'a@b.c'])
  git(['config', 'user.name', 'test'])
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'x', version: '1.0.0', devDependencies: { commitgate: '^0.12.1' } }, null, 2),
    'utf8',
  )
  return dir
}

describe('[REQ-2026-083] codex 미설치 안내 — 실제 경로가 설치 명령을 준다 (G-B)', () => {
  it('S1 `init` 설치 후 안내: installGuidance 출력에 설치 명령이 있다', () => {
    const dir = tmpRepo()
    try {
      const opts: InitOptions = { dir, force: false, dryRun: false, strict: false, noAgentEntrypoints: false }
      const guidance = installGuidance(runInit(opts)).join('\n')
      expect(guidance, 'init 안내가 codex 설치 명령을 준다').toContain(CODEX_INSTALL_HINT)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('S3 `check` C2 실패: runChecks 가 낸 C2 행에 설치 명령이 있다', () => {
    const inp: CheckInputs = {
      // C4 가 cfg 를 읽으므로 정상 설정을 채운다 — 이 테스트가 보는 것은 C2 뿐이다.
      config: { ok: true, cfg: { reviewModel: 'gpt-5.6-terra', reviewReasoningEffort: 'medium' } as never },
      version: MISSING,
      auth: AUTH_UNKNOWN,
    }
    const report = runChecks(inp)
    const c2 = report.checks.find((c) => c.id === 'C2')
    expect(c2, 'C2 행이 있어야 한다').toBeDefined()
    expect(c2!.level, 'codex 부재는 C2 FAIL 이다').toBe('FAIL')
    expect(c2!.msg, 'C2 실패 메시지가 설치 명령을 준다').toContain(CODEX_INSTALL_HINT)
    expect(c2!.msg, '진단 detail 을 삼키지 않는다').toContain('spawn codex ENOENT')
  })

  it('S2 `setup` codex 미설치: 던지는 오류에 설치 명령이 있다', async () => {
    const deps = {
      streams: { stdin: true, stdout: true }, // 대화형 터미널을 가정 — TTY 가드를 통과해야 codex 검사에 닿는다
      log: () => {},
      io: { read: () => '{}', write: () => {} },
      probes: { version: () => MISSING, auth: () => AUTH_UNKNOWN, login: () => {} },
      createPrompter: () => ({ ask: async () => '', close: () => {} }),
      now: () => '2026-07-28T00:00:00.000Z',
      version: '0.12.1',
    }
    await expect(runSetup({ root: process.cwd() } as never, deps as never)).rejects.toThrow(CODEX_INSTALL_HINT)
  })

  it('🔴 S2: codex 미설치면 로그인을 **시도하지 않는다**(미설치 상태에서 login 은 무의미하다)', async () => {
    let loginCalls = 0
    const deps = {
      streams: { stdin: true, stdout: true },
      log: () => {},
      io: { read: () => '{}', write: () => {} },
      probes: { version: () => MISSING, auth: () => AUTH_UNKNOWN, login: () => { loginCalls++ } },
      createPrompter: () => ({ ask: async () => '', close: () => {} }),
      now: () => '2026-07-28T00:00:00.000Z',
      version: '0.12.1',
    }
    await expect(runSetup({ root: process.cwd() } as never, deps as never)).rejects.toThrow()
    expect(loginCalls, 'codex 가 없는데 login 을 부르면 더 혼란스러운 오류가 난다').toBe(0)
  })

  /**
   * 힌트 자체의 **내용 계약**. 문자열을 바꿔도 이 두 가지는 남아야 한다.
   * 🔴 "새 터미널" 이 빠지면 Windows 사용자가 전역 설치 직후 `codex` 를 못 찾고 **설치가 실패했다고
   *    오해한다**(PATH 갱신 문제 — `docs/quick-start.md` 실측). 같은 자리에서 두 번 막힌다.
   */
  it('힌트가 설치 명령과 새 터미널 안내를 모두 담는다', () => {
    expect(CODEX_INSTALL_HINT, '설치 명령').toContain('npm i -g @openai/codex')
    expect(CODEX_INSTALL_HINT, 'PATH 갱신 안내').toMatch(/새 터미널/)
  })
})
