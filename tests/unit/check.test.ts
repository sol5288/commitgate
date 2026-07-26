import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  runChecks,
  renderHuman,
  renderJson,
  parseArgs,
  loadConfigResult,
  HelpRequested,
  type CheckInputs,
  type CheckReport,
} from '../../bin/check'
import type { AuthProbeResult, VersionProbeResult } from '../../scripts/req/lib/adapters'
import { DEFAULTS } from '../../scripts/req/lib/config'

/**
 * REQ-2026-061 — `commitgate check`(비대화형 진단).
 *
 * 🔴 이 파일의 헤드라인 단언 둘:
 *   1. **`unknown` 로그인은 WARN이지 FAIL이 아니다** — probe는 진단이지 승인 무결성 게이트가 아니므로,
 *      codex 출력 포맷이 바뀐 날 진단이 곧 오탐 경보가 되면 안 된다(설계 DEC-3).
 *   2. **한 항목의 실패가 나머지 진단을 가리지 않는다** — 설정이 깨져도 C2/C3는 계속 평가된다(DEC-6).
 */

const OK_VERSION: VersionProbeResult = { ok: true, version: 'codex-cli 0.144.1', detail: 'codex-cli 0.144.1' }
const NO_CLI: VersionProbeResult = { ok: false, version: null, detail: 'ENOENT' }
const LOGGED_IN: AuthProbeResult = { state: 'logged-in', reason: 'ok', detail: 'Logged in using ChatGPT' }
const LOGGED_OUT: AuthProbeResult = { state: 'logged-out', reason: 'ok', detail: 'Not logged in' }
const UNKNOWN: AuthProbeResult = { state: 'unknown', reason: 'unrecognized-output', detail: '???' }

/** 기본 입력 = 전부 정상. 각 테스트가 필요한 축만 덮어쓴다. */
function inputs(over: Partial<CheckInputs> = {}): CheckInputs {
  return {
    config: { ok: true, cfg: { reviewModel: 'gpt-5.6-terra', reviewReasoningEffort: 'high' } as never },
    version: OK_VERSION,
    auth: LOGGED_IN,
    ...over,
  }
}

const byId = (r: CheckReport, id: string) => r.checks.find((c) => c.id === id)

describe('[check] 전부 정상 → ok', () => {
  it('FAIL 0건이면 ok=true, 모든 항목 OK', () => {
    const r = runChecks(inputs())
    expect(r.ok).toBe(true)
    expect(r.summary).toEqual({ ok: 4, warn: 0, fail: 0 })
  })

  it('항목 id는 C1~C4 순서로 고정된다(에이전트 소비 안정성)', () => {
    expect(runChecks(inputs()).checks.map((c) => c.id)).toEqual(['C1', 'C2', 'C3', 'C4'])
  })
})

describe('[check] C3 로그인 — unknown은 WARN이지 FAIL이 아니다(DEC-3)', () => {
  it('logged-in → OK', () => {
    expect(byId(runChecks(inputs()), 'C3')?.level).toBe('OK')
  })

  it('logged-out → FAIL + 조치 안내(예산 차감 사실 포함)', () => {
    const c = byId(runChecks(inputs({ auth: LOGGED_OUT })), 'C3')
    expect(c?.level).toBe('FAIL')
    expect(c?.msg).toContain('예산')
    expect(c?.msg).toContain('commitgate setup')
  })

  // 🔴 회귀 가드: 이걸 FAIL로 바꾸면 codex가 출력 문자열만 바꿔도 모든 소비자의 진단이 빨갛게 된다.
  it('🔴 unknown → WARN(리뷰를 막지 않는다는 문장 포함)', () => {
    const r = runChecks(inputs({ auth: UNKNOWN }))
    const c = byId(r, 'C3')
    expect(c?.level).toBe('WARN')
    expect(c?.msg).toContain('막지는 않습니다')
    expect(r.ok).toBe(true) // WARN은 exit 0
  })
})

describe('[check] C2 리뷰어 CLI', () => {
  it('미설치 → FAIL', () => {
    const r = runChecks(inputs({ version: NO_CLI }))
    expect(byId(r, 'C2')?.level).toBe('FAIL')
    expect(r.ok).toBe(false)
  })
})

describe('[check] C1/C4 — 설정', () => {
  it('설정 깨짐 → C1 FAIL', () => {
    const r = runChecks(inputs({ config: { ok: false, error: '스키마 위반: …' } }))
    expect(byId(r, 'C1')?.level).toBe('FAIL')
    expect(r.ok).toBe(false)
  })

  // 🔴 DEC-6: 한 항목의 실패가 나머지 진단을 가리지 않는다.
  it('🔴 설정이 깨져도 C2·C3는 계속 평가된다', () => {
    const r = runChecks(inputs({ config: { ok: false, error: 'broken' }, version: NO_CLI, auth: LOGGED_OUT }))
    expect(byId(r, 'C2')?.level).toBe('FAIL')
    expect(byId(r, 'C3')?.level).toBe('FAIL')
    expect(r.summary.fail).toBe(3)
  })

  // 같은 원인을 두 번 세지 않는다 — C1이 실패하면 C4는 판정 불가다.
  it('설정이 깨지면 C4는 점검 불요(OK)로 남는다', () => {
    const c = byId(runChecks(inputs({ config: { ok: false, error: 'broken' } })), 'C4')
    expect(c?.level).toBe('OK')
    expect(c?.msg).toContain('점검 불요')
  })

  it('모델·effort가 null이면 C4 WARN(전역 상속 = 비용·재현성 미고정)', () => {
    const r = runChecks(
      inputs({ config: { ok: true, cfg: { reviewModel: null, reviewReasoningEffort: null } as never } }),
    )
    const c = byId(r, 'C4')
    expect(c?.level).toBe('WARN')
    expect(c?.msg).toContain('reviewModel')
    expect(c?.msg).toContain('reviewReasoningEffort')
    expect(r.ok).toBe(true)
  })

  it('한쪽만 null이어도 WARN이고 그 키만 언급한다', () => {
    const c = byId(
      runChecks(inputs({ config: { ok: true, cfg: { reviewModel: 'm', reviewReasoningEffort: null } as never } })),
      'C4',
    )
    expect(c?.level).toBe('WARN')
    expect(c?.msg).toContain('reviewReasoningEffort')
    expect(c?.msg).not.toContain('reviewModel,')
  })
})

describe('[check] 렌더링 — 두 출력이 같은 report에서 파생된다(DEC-5)', () => {
  it('사람용은 등급·id·요약을 담는다', () => {
    const out = renderHuman(runChecks(inputs()))
    expect(out).toContain('[OK] C1:')
    expect(out).toContain('PASS')
  })

  it('FAIL이면 요약이 FAIL로 바뀐다', () => {
    expect(renderHuman(runChecks(inputs({ version: NO_CLI })))).toContain('FAIL —')
  })

  // 🔴 파이프 소비자가 파싱에 실패하지 않도록 JSON 출력에 사람용 줄을 섞지 않는다.
  it('🔴 --json 출력은 그 자체로 파싱 가능하고 report와 동등하다', () => {
    const report = runChecks(inputs({ auth: UNKNOWN }))
    const parsed = JSON.parse(renderJson(report))
    expect(parsed).toEqual(report)
    expect(parsed.summary.warn).toBe(1)
  })
})

describe('[check] parseArgs — fail-closed', () => {
  it('기본은 cwd + 사람용 출력', () => {
    expect(parseArgs([])).toEqual({ dir: process.cwd(), json: false })
  })

  it('--json / --dir', () => {
    expect(parseArgs(['--json']).json).toBe(true)
    expect(parseArgs(['--dir', '.']).dir).toBe(process.cwd())
  })

  it('--dir 값 누락 → throw', () => {
    expect(() => parseArgs(['--dir'])).toThrow('--dir')
  })

  /**
   * 🔴 phase-1 r01 P1 회귀 가드. 값을 빠뜨리면 뒤따르는 **옵션이 경로로 소비**되어
   * JSON 모드가 꺼진 채 존재하지 않는 `<cwd>/--json`을 진단하고, codex가 정상이면 그것이
   * **exit 0으로 성공**한다 — 잘못된 호출이 조용히 통과하는 fail-closed 우회다.
   */
  for (const bad of [
    ['--dir', '--json'],
    ['--dir', '--dir', 'x'],
    ['--dir', '-h'],
  ]) {
    it(`🔴 값 자리의 옵션을 삼키지 않는다: ${bad.join(' ')}`, () => {
      expect(() => parseArgs(bad)).toThrow('--dir 에 경로가 필요합니다')
    })
  }

  it('정상 조합은 그대로 동작한다(과잉 거부 아님)', () => {
    expect(parseArgs(['--dir', '.', '--json'])).toEqual({ dir: process.cwd(), json: true })
    expect(parseArgs(['--json', '--dir', '.'])).toEqual({ dir: process.cwd(), json: true })
  })

  it('알 수 없는 옵션 → throw', () => {
    expect(() => parseArgs(['--fix'])).toThrow('알 수 없는 옵션')
  })

  it('-h/--help → HelpRequested', () => {
    expect(() => parseArgs(['-h'])).toThrow(HelpRequested)
  })
})

describe('[check] loadConfigResult — throw를 진단으로 흡수(DEC-6)', () => {
  it('설정 파일이 없으면 DEFAULTS로 성공한다(수용기준 1 — 티켓 없는 repo)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cg-check-'))
    try {
      const r = loadConfigResult(dir)
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.cfg.reviewModel).toBe(DEFAULTS.reviewModel)
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
    }
  })

  it('🔴 깨진 설정이 스택트레이스로 죽지 않고 진단 결과가 된다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cg-check-'))
    try {
      writeFileSync(join(dir, 'req.config.json'), '{ not json', 'utf8')
      const r = loadConfigResult(dir)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toContain('파싱 실패')
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
    }
  })

  it('스키마 위반도 진단 결과가 된다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cg-check-'))
    try {
      writeFileSync(join(dir, 'req.config.json'), JSON.stringify({ branchPrefix: '' }), 'utf8')
      const r = loadConfigResult(dir)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toContain('스키마')
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
    }
  })

  // 🔴 DEC-7: resolveRoot 의 package-root fallback 을 타면 소비자 repo 에서 **패키지 자신**을 진단한다.
  it('🔴 --dir 로 준 root 만 본다(패키지 fallback 으로 새지 않는다)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cg-check-'))
    try {
      writeFileSync(join(dir, 'req.config.json'), JSON.stringify({ reviewModel: 'sentinel-model' }), 'utf8')
      const r = loadConfigResult(dir)
      expect(r.ok).toBe(true)
      if (r.ok) expect(r.cfg.reviewModel).toBe('sentinel-model')
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
    }
  })
})
