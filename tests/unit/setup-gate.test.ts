import { describe, it, expect } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  setupGateVerdict,
  blockMessage,
  resolveGateRoot,
  countValidTickets,
  collectInstallSignals,
  hasSetupMarker,
  collectGateFacts,
  assertSetupComplete,
  MIN_INSTALL_SIGNALS,
  type GateFacts,
} from '../../scripts/req/lib/setup-gate'

/**
 * REQ-2026-062 phase-2 — setup 완료 게이트(설계 DEC-3~DEC-5·DEC-7).
 *
 * 🔴 이 파일의 헤드라인 단언 둘:
 *   1. **기존 설치본은 막히지 않는다**(grandfather) — 업그레이드 사용자가 커밋도 리뷰도 못 하는
 *      상태가 되면 안 된다. 그 상황에서는 setup을 실행해도 워킹트리가 dirty해져 더 나빠진다.
 *   2. **빈 `REQ-*` 디렉터리만으로는 grandfather 되지 않는다** — 복사된 껍데기로 신규 프로젝트가
 *      영구 면제받는 구멍을 막는다(수용기준 4).
 */

/** 저장소 루트(tests/unit 기준 2단계 위). */
const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..')

function tmp(): string {
  return mkdtempSync(join(tmpdir(), 'cg-gate-'))
}
function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
}

const facts = (over: Partial<GateFacts> = {}): GateFacts => ({
  hasMarker: false,
  validTickets: 0,
  installSignals: [],
  ...over,
})

describe('[setup-gate] setupGateVerdict — 순수 판정(DEC-4·DEC-5)', () => {
  it('마커가 있으면 통과(reason=marker)', () => {
    const v = setupGateVerdict(facts({ hasMarker: true }))
    expect(v.kind).toBe('pass')
    if (v.kind === 'pass') expect(v.reason).toBe('marker')
  })

  it('🔴 기존 설치본은 마커가 없어도 통과(grandfathered) — 수용기준 3', () => {
    const v = setupGateVerdict(facts({ validTickets: 3, installSignals: ['req:* 스크립트', 'req.config.json'] }))
    expect(v.kind).toBe('pass')
    if (v.kind === 'pass') expect(v.reason).toBe('grandfathered')
  })

  it('신규 설치(티켓 0·신호 0)는 차단 — 수용기준 1', () => {
    expect(setupGateVerdict(facts()).kind).toBe('block')
  })

  // 🔴 수용기준 4: 껍데기 디렉터리로 영구 면제받는 구멍을 막는다.
  it('🔴 유효 티켓이 있어도 설치 신호가 부족하면 차단', () => {
    expect(setupGateVerdict(facts({ validTickets: 5, installSignals: ['req.config.json'] })).kind).toBe('block')
  })

  it('🔴 설치 신호가 충분해도 유효 티켓이 0이면 차단(신규 설치 = 잃을 작업이 없다)', () => {
    const v = setupGateVerdict(facts({ installSignals: ['req:* 스크립트', 'req.config.json', 'AGENTS.md 계약 마커'] }))
    expect(v.kind).toBe('block')
  })

  it(`grandfather 임계값은 설치 신호 ${MIN_INSTALL_SIGNALS}개`, () => {
    expect(setupGateVerdict(facts({ validTickets: 1, installSignals: ['a'] })).kind).toBe('block')
    expect(setupGateVerdict(facts({ validTickets: 1, installSignals: ['a', 'b'] })).kind).toBe('pass')
  })

  // 🔴 근거가 안 보이면 오판을 아무도 못 잡는다.
  it('🔴 판정 근거가 pass·block 양쪽에 담긴다', () => {
    for (const f of [facts({ hasMarker: true }), facts()]) {
      const v = setupGateVerdict(f)
      expect(v.evidence.join(' ')).toMatch(/마커=/)
      expect(v.evidence.join(' ')).toMatch(/유효티켓=/)
      expect(v.evidence.join(' ')).toMatch(/설치신호=/)
    }
  })
})

describe('[setup-gate] blockMessage — 실행이 아니라 요청을 지시한다(DEC-7)', () => {
  const m = blockMessage(['마커=없음'])

  it('setup은 사용자가 직접 실행한다고 말한다', () => {
    expect(m).toContain('npx commitgate setup')
    expect(m).toContain('사용자가 터미널에서 직접 실행')
  })

  // 🔴 에이전트가 이 메시지를 읽고 setup을 실행하면 비-TTY로 즉시 실패한다.
  it('🔴 에이전트에게는 "요청하라"고 지시한다', () => {
    expect(m).toContain('사용자에게 실행을 요청')
  })

  it('막히지 않는 진단 명령을 안내한다', () => {
    expect(m).toContain('commitgate check')
  })

  it('판정 근거를 포함한다', () => {
    expect(blockMessage(['근거A', '근거B'])).toContain('근거A · 근거B')
  })
})

describe('[setup-gate] countValidTickets — state.id 일치까지 확인(수용기준 4)', () => {
  it('유효 티켓만 센다', () => {
    const d = tmp()
    try {
      const wf = join(d, 'workflow')
      mkdirSync(join(wf, 'REQ-2026-001'), { recursive: true })
      writeFileSync(join(wf, 'REQ-2026-001', 'state.json'), JSON.stringify({ id: 'REQ-2026-001' }), 'utf8')
      expect(countValidTickets(d, 'workflow')).toBe(1)
    } finally {
      cleanup(d)
    }
  })

  it('🔴 빈 REQ 디렉터리는 세지 않는다', () => {
    const d = tmp()
    try {
      mkdirSync(join(d, 'workflow', 'REQ-2026-002'), { recursive: true })
      expect(countValidTickets(d, 'workflow')).toBe(0)
    } finally {
      cleanup(d)
    }
  })

  it('🔴 state.id 가 디렉터리명과 다르면 세지 않는다(복사된 껍데기)', () => {
    const d = tmp()
    try {
      const t = join(d, 'workflow', 'REQ-2026-003')
      mkdirSync(t, { recursive: true })
      writeFileSync(join(t, 'state.json'), JSON.stringify({ id: 'REQ-2026-999' }), 'utf8')
      expect(countValidTickets(d, 'workflow')).toBe(0)
    } finally {
      cleanup(d)
    }
  })

  it('손상된 state.json 은 세지 않는다(grandfather는 실제로 쓰던 설치본에만)', () => {
    const d = tmp()
    try {
      const t = join(d, 'workflow', 'REQ-2026-004')
      mkdirSync(t, { recursive: true })
      writeFileSync(join(t, 'state.json'), '{ broken', 'utf8')
      expect(countValidTickets(d, 'workflow')).toBe(0)
    } finally {
      cleanup(d)
    }
  })

  it('티켓 루트가 없으면 0', () => {
    const d = tmp()
    try {
      expect(countValidTickets(d, 'workflow')).toBe(0)
    } finally {
      cleanup(d)
    }
  })

  it('REQ- 형식이 아닌 디렉터리는 무시한다', () => {
    const d = tmp()
    try {
      const t = join(d, 'workflow', 'notes')
      mkdirSync(t, { recursive: true })
      writeFileSync(join(t, 'state.json'), JSON.stringify({ id: 'notes' }), 'utf8')
      expect(countValidTickets(d, 'workflow')).toBe(0)
    } finally {
      cleanup(d)
    }
  })
})

describe('[setup-gate] collectInstallSignals', () => {
  it('네 신호를 모두 감지한다', () => {
    const d = tmp()
    try {
      writeFileSync(join(d, 'package.json'), JSON.stringify({ scripts: { 'req:new': 'commitgate req:new' } }), 'utf8')
      writeFileSync(join(d, 'req.config.json'), '{}', 'utf8')
      mkdirSync(join(d, 'workflow'), { recursive: true })
      writeFileSync(join(d, 'workflow', 'machine.schema.json'), '{}', 'utf8')
      writeFileSync(join(d, 'AGENTS.md'), '# x\n<!-- commitgate:contract -->\n', 'utf8')
      expect(collectInstallSignals(d, 'workflow')).toHaveLength(4)
    } finally {
      cleanup(d)
    }
  })

  it('req:* 없는 package.json 은 신호가 아니다', () => {
    const d = tmp()
    try {
      writeFileSync(join(d, 'package.json'), JSON.stringify({ scripts: { build: 'tsc' } }), 'utf8')
      expect(collectInstallSignals(d, 'workflow')).toEqual([])
    } finally {
      cleanup(d)
    }
  })

  it('계약 마커 없는 AGENTS.md 는 신호가 아니다', () => {
    const d = tmp()
    try {
      writeFileSync(join(d, 'AGENTS.md'), '# 그냥 문서\n', 'utf8')
      expect(collectInstallSignals(d, 'workflow')).toEqual([])
    } finally {
      cleanup(d)
    }
  })

  it('깨진 package.json 은 추정하지 않고 신호 없음으로 본다', () => {
    const d = tmp()
    try {
      writeFileSync(join(d, 'package.json'), '{ broken', 'utf8')
      expect(collectInstallSignals(d, 'workflow')).toEqual([])
    } finally {
      cleanup(d)
    }
  })
})

describe('[setup-gate] hasSetupMarker — 파싱 실패는 false(fail-closed)', () => {
  it('마커가 있으면 true', () => {
    const d = tmp()
    try {
      writeFileSync(
        join(d, 'req.config.json'),
        JSON.stringify({ setup: { completedVersion: '1.0.0', completedAt: '2026-01-01T00:00:00Z' } }),
        'utf8',
      )
      expect(hasSetupMarker(d)).toBe(true)
    } finally {
      cleanup(d)
    }
  })

  it('파일이 없으면 false', () => {
    const d = tmp()
    try {
      expect(hasSetupMarker(d)).toBe(false)
    } finally {
      cleanup(d)
    }
  })

  it('🔴 깨진 설정은 "마커 있음"으로 단정하지 않는다', () => {
    const d = tmp()
    try {
      writeFileSync(join(d, 'req.config.json'), '{ broken', 'utf8')
      expect(hasSetupMarker(d)).toBe(false)
    } finally {
      cleanup(d)
    }
  })

  it('setup 키가 형태를 안 갖추면 false', () => {
    const d = tmp()
    try {
      writeFileSync(join(d, 'req.config.json'), JSON.stringify({ setup: true }), 'utf8')
      expect(hasSetupMarker(d)).toBe(false)
    } finally {
      cleanup(d)
    }
  })
})

describe('[setup-gate] resolveGateRoot — resolveRoot 의 package fallback 을 피한다(DEC-3)', () => {
  it('명시 root 가 최우선', () => {
    expect(resolveGateRoot({ root: '/explicit' })).toBe('/explicit')
  })

  it('git top-level 을 쓴다', () => {
    const spawn = (() => ({ status: 0, stdout: '/repo/top\n', stderr: '' })) as never
    expect(resolveGateRoot({ cwd: '/repo/sub' }, spawn)).toBe('/repo/top')
  })

  it('🔴 비-git 디렉터리에서는 cwd 로 떨어진다(패키지 root 로 새지 않는다)', () => {
    const spawn = (() => ({ status: 128, stdout: '', stderr: 'not a git repository' })) as never
    expect(resolveGateRoot({ cwd: '/plain/dir' }, spawn)).toBe('/plain/dir')
  })

  it('git 실행 자체가 실패해도 cwd 로 떨어진다', () => {
    const spawn = (() => {
      throw new Error('ENOENT')
    }) as never
    expect(resolveGateRoot({ cwd: '/plain/dir' }, spawn)).toBe('/plain/dir')
  })
})

describe('[setup-gate] assertSetupComplete — 통합', () => {
  it('신규 설치에서 throw + 안내(수용기준 1)', () => {
    const d = tmp()
    try {
      expect(() => assertSetupComplete({ root: d })).toThrow('setup을 아직 마치지 않았습니다')
    } finally {
      cleanup(d)
    }
  })

  it('마커가 있으면 통과(수용기준 2)', () => {
    const d = tmp()
    try {
      writeFileSync(
        join(d, 'req.config.json'),
        JSON.stringify({ setup: { completedVersion: '1.0.0', completedAt: '2026-01-01T00:00:00Z' } }),
        'utf8',
      )
      expect(assertSetupComplete({ root: d }).kind).toBe('pass')
    } finally {
      cleanup(d)
    }
  })

  it('🔴 기존 설치본(유효 티켓 + 신호 2)은 통과(수용기준 3)', () => {
    const d = tmp()
    try {
      writeFileSync(join(d, 'package.json'), JSON.stringify({ scripts: { 'req:new': 'x' } }), 'utf8')
      writeFileSync(join(d, 'req.config.json'), '{}', 'utf8')
      const t = join(d, 'workflow', 'REQ-2026-010')
      mkdirSync(t, { recursive: true })
      writeFileSync(join(t, 'state.json'), JSON.stringify({ id: 'REQ-2026-010' }), 'utf8')
      const v = assertSetupComplete({ root: d })
      expect(v.kind).toBe('pass')
      if (v.kind === 'pass') expect(v.reason).toBe('grandfathered')
    } finally {
      cleanup(d)
    }
  })

  it('🔴 빈 REQ 디렉터리만 있는 신규 프로젝트는 통과하지 못한다(수용기준 4)', () => {
    const d = tmp()
    try {
      writeFileSync(join(d, 'package.json'), JSON.stringify({ scripts: { 'req:new': 'x' } }), 'utf8')
      writeFileSync(join(d, 'req.config.json'), '{}', 'utf8')
      mkdirSync(join(d, 'workflow', 'REQ-2026-011'), { recursive: true })
      expect(() => assertSetupComplete({ root: d })).toThrow('setup을 아직 마치지 않았습니다')
    } finally {
      cleanup(d)
    }
  })

  it('collectGateFacts 가 세 축을 모두 채운다', () => {
    const d = tmp()
    try {
      const f = collectGateFacts(d, 'workflow')
      expect(f).toEqual({ hasMarker: false, validTickets: 0, installSignals: [] })
    } finally {
      cleanup(d)
    }
  })
})

/**
 * phase-3 배선 가드(설계 DEC-6).
 *
 * 🔴 소스 텍스트를 검사하는 **구조 테스트**다. `main()`을 직접 돌리면 실제 repo IO·git이 필요해
 * 단위 테스트로 성립하지 않는데, 정작 중요한 성질("게이트가 걸려 있는가 / 진단에는 안 걸려 있는가")은
 * 배선의 **유무**다. 이 저장소의 SSOT 드리프트 가드와 같은 계열이다.
 */
describe('[setup-gate] verb 배선 — 변경 verb는 걸리고 진단 verb는 안 걸린다(DEC-6)', () => {
  const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf8')

  const gated = [
    'scripts/req/req-new.ts',
    'scripts/req/req-next.ts',
    'scripts/req/review-codex.ts',
    'scripts/req/req-commit.ts',
    'scripts/req/req-close.ts',
    'scripts/req/req-reconstruct.ts',
    'scripts/req/req-review-exception.ts',
  ]
  for (const f of gated) {
    it(`게이트 적용: ${f}`, () => {
      expect(read(f)).toContain('assertSetupComplete(')
    })
  }

  // 🔴 수용기준 6: 막으면 **문제를 진단할 수단까지 사라진다**. 이 둘은 마커 없이도 동작해야 한다.
  const ungated = ['scripts/req/req-doctor.ts', 'bin/check.ts']
  for (const f of ungated) {
    it(`🔴 진단은 막지 않는다: ${f}`, () => {
      expect(read(f)).not.toContain('assertSetupComplete(')
    })
  }

  // 유지보수·설정 verb는 setup 이전에 쓰이거나 setup 자체다.
  const maintenance = ['bin/init.ts', 'bin/migrate.ts', 'bin/sync.ts', 'bin/uninstall.ts', 'bin/quickstart.ts', 'bin/setup.ts']
  for (const f of maintenance) {
    it(`유지보수·설정 verb는 막지 않는다: ${f}`, () => {
      expect(read(f)).not.toContain('assertSetupComplete(')
    })
  }

  it('🔴 게이트 호출은 parseArgs 직후 — 다른 IO·판정보다 먼저다', () => {
    for (const f of gated) {
      const src = read(f)
      const gate = src.indexOf('assertSetupComplete(')
      const load = src.indexOf('loadConfig(', gate === -1 ? 0 : gate)
      expect(gate).toBeGreaterThan(-1)
      // 같은 함수 안에서 loadConfig 가 뒤따른다면 게이트가 그보다 앞이어야 한다.
      if (load > -1) expect(gate).toBeLessThan(load)
    }
  })
})

describe('[setup-gate] 이 저장소 자신(dogfood)', () => {
  it('grandfather 로 통과한다 — 게이트 도입이 자기 워크플로를 막지 않는다', () => {
    const v = setupGateVerdict(collectGateFacts(REPO_ROOT, 'workflow'))
    expect(v.kind).toBe('pass')
  })

  it('임시 디렉터리 정리(자리표시)', () => {
    const d = tmp()
    try {
      const f = collectGateFacts(d, 'workflow')
      expect(f).toEqual({ hasMarker: false, validTickets: 0, installSignals: [] })
    } finally {
      cleanup(d)
    }
  })
})
