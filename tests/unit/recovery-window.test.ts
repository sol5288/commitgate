/**
 * REQ-2026-155 phase-1 — 복구 창에서 state 를 바꾸는 verb 를 막는다.
 *
 * 🔴 REQ-2026-154 는 `req:repolicy` **하나만** 막았다("관측된 것만 막는다"). `req:confirm` 이 같은
 *    일을 했고 결속을 깼다. 그래서 판정 기준을 **verb 이름이 아니라 동작**으로 옮기고, 재발을
 *    **구조로** 고정한다.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { main as confirmMain } from '../../scripts/req/req-confirm'
import { main as repolicyMain } from '../../scripts/req/req-repolicy'
import { main as exceptionMain } from '../../scripts/req/req-review-exception'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { inRecoveryWindow, recoveryWindowProblem } from '../../scripts/req/lib/recovery-window'

describe('[REQ-2026-155] inRecoveryWindow (순수)', () => {
  it('🔴 `pending_evidence_for` 가 있으면 복구 창이다', () => {
    expect(inRecoveryWindow({ pending_evidence_for: { source_commit_sha: 'a'.repeat(40) } })).toBe(true)
  })

  it('🔴 승인 핀만으로는 복구 창이 아니다 — 승인 직후~소비까지는 정상 상태다', () => {
    expect(inRecoveryWindow({ approval_evidence: { response_path: 'x' } })).toBe(false)
  })

  it('부재·null 은 복구 창이 아니다', () => {
    expect(inRecoveryWindow({})).toBe(false)
    expect(inRecoveryWindow({ pending_evidence_for: null })).toBe(false)
  })
})

describe('[REQ-2026-155] recoveryWindowProblem (순수)', () => {
  const m = recoveryWindowProblem('REQ-2026-001', 'req:confirm')

  it('🔴 실행 가능한 다음 명령을 준다 — 이 창에서 성공하는 유일한 명령이다', () => {
    expect(m).toContain('npx commitgate req:commit REQ-2026-001 --finalize --run')
  })

  it('🔴 아무것도 쓰지 않았음을 말한다 — 사람이 다음을 판단하는 근거다', () => {
    expect(m).toContain('아무것도 쓰지 않았습니다')
  })

  it('어느 verb 때문인지 말한다', () => {
    expect(m).toContain('req:confirm')
  })
})

/**
 * 🔴 **구조 가드** — 주석·규율로는 네 번째 재발을 막지 못한다(이미 세 번 재발했다).
 */
describe('[REQ-2026-155] 🔴 구조 가드 — checkpoint 호출부', () => {
  const FILES = [
    'scripts/req/req-commit.ts',
    'scripts/req/req-confirm.ts',
    'scripts/req/req-repolicy.ts',
    'scripts/req/req-review-exception.ts',
    'scripts/req/review-codex.ts',
  ]
  const MARKER = 'commitgate:recovery-checkpoint'
  const read = (p: string): string[] => readFileSync(join(process.cwd(), p), 'utf8').split(/\r?\n/)

  it('🔴 모든 `commitStateCheckpoint(` 는 마커가 있거나 근처에 가드가 있다', () => {
    /**
     * 🔴 예외를 **파일·함수 단위로 두지 않는다**(설계 r01 P1). `req-commit.ts` 를 통째로 예외로 두면
     *    그 파일에 새 비-복구 호출을 넣어도 green 이다. 예외는 **호출 지점**에 붙인다.
     *
     * 🔴 60줄 창은 **근사**다 — 창을 벗어난 배치는 못 잡는다. 정본은 e2e 다.
     */
    for (const f of FILES) {
      const lines = read(f)
      const guardAt = lines.findIndex((l) => l.includes('inRecoveryWindow('))
      lines.forEach((line, i) => {
        if (!line.includes('commitStateCheckpoint({')) return
        const marked = lines.slice(Math.max(0, i - 2), i).some((l) => l.includes(MARKER))
        // 🔴 "파일 안에서 가드가 **이 호출보다 앞**에 있다" — 가드는 진입 함수의 모드 분기 앞에
        //    있으므로, 그 뒤의 어떤 경로도 가드를 지난 것이다. 창(±N줄)으로 잡으면 같은 파일의
        //    먼 호출(`runResolve` 등)을 놓친다 — 실제로 그랬다.
        const guardedBefore = guardAt > -1 && guardAt < i
        expect(marked || guardedBefore, `${f}:${i + 1} — 마커도 앞선 가드도 없다`).toBe(true)
      })
    }
  })

  it('🔴 마커는 정확히 2개다 — 복사해서 우회하는 것을 막는다', () => {
    const total = FILES.reduce((n, f) => n + read(f).filter((l) => l.includes(MARKER)).length, 0)
    expect(total).toBe(2)
  })

  /**
   * 🔴 **순서 가드**(설계 r02 P1) — checkpoint 근처에만 가드가 있으면 늦다. `review-codex` 는 그
   *    지점에 닿기 전에 원장·state 를 쓰고 **유료 호출까지** 끝낸다.
   *
   * 🔴 소스 순서 **프록시**다 — 실행 순서와 다를 수 있다. 정본은 e2e 다.
   */
  it('🔴 네 verb 에서 가드가 첫 write·모드 분기보다 앞이다', () => {
    const WRITES = ['writeState(', 'gateAndRecordAttempt(', 'commitStateCheckpoint(', 'runCloseStale(', 'runResolve(']
    /** 진입 함수 본문만 잘라낸다 — 파일 전체로 보면 위쪽 **헬퍼 정의**가 첫 write 로 잡힌다. */
    const entryBody = (lines: string[], entryRe: RegExp): string[] => {
      const start = lines.findIndex((l) => entryRe.test(l))
      expect(start, `진입 함수 없음: ${entryRe}`).toBeGreaterThan(-1)
      const end = lines.findIndex((l, i) => i > start && l === '}')
      return lines.slice(start, end === -1 ? lines.length : end)
    }
    for (const [f, entryRe] of [
      ['scripts/req/req-confirm.ts', /^export function main\(/],
      ['scripts/req/req-repolicy.ts', /^export function main\(/],
      ['scripts/req/req-review-exception.ts', /^export function main\(/],
      // review-codex 의 실제 진입 본문은 `mainImpl` 이다(`main` 은 얇은 래퍼).
      ['scripts/req/review-codex.ts', /^function mainImpl\(/],
    ] as [string, RegExp][]) {
      // 🔴 주석은 제외한다 — 가드 옆의 설명 주석이 `gateAndRecordAttempt()` 를 **언급**하는 것을
      //    첫 write 로 세면 자기 자신 때문에 red 가 된다(실제로 그랬다).
      const isComment = (l: string): boolean => /^\s*(\/\/|\*|\/\*)/.test(l)
      const body = entryBody(read(f), entryRe).map((l) => (isComment(l) ? '' : l))
      const guard = body.findIndex((l) => l.includes('inRecoveryWindow('))
      expect(guard, `${f} — 진입 함수 본문에 가드 없음`).toBeGreaterThan(-1)
      const firstWrite = body.findIndex((l) => WRITES.some((w) => l.includes(w)))
      expect(firstWrite, `${f} — 진입 함수 본문에 write 없음`).toBeGreaterThan(-1)
      expect(guard, `${f} — 가드가 첫 write 뒤에 있다`).toBeLessThan(firstWrite)
    }
  })

  it('🔴 네 verb 가 같은 술어·같은 문구를 쓴다 — 갈라지면 어떤 곳은 "쓰지 않았다"를 빠뜨린다', () => {
    for (const f of [
      'scripts/req/req-confirm.ts',
      'scripts/req/req-repolicy.ts',
      'scripts/req/req-review-exception.ts',
      'scripts/req/review-codex.ts',
    ]) {
      const src = read(f).join('\n')
      expect(src, f).toContain('recoveryWindowProblem(')
      expect(src, f).toContain("from './lib/recovery-window'")
    }
  })

  it('🔴 D10 예외 모듈의 표면은 넓어지지 않았다 — 술어는 별도 leaf 다', () => {
    // `lib/evidence-recovery` 호출부는 여전히 req-doctor·req-commit 둘뿐이어야 한다(REQ-2026-142).
    for (const f of ['scripts/req/req-confirm.ts', 'scripts/req/req-repolicy.ts', 'scripts/req/review-codex.ts'])
      expect(read(f).join('\n'), f).not.toContain('evidence-recovery')
  })
})

/**
 * 🔴 **동작 오라클** — 구조 가드는 소스 문자열만 본다. 가드를 `if (false && …)` 로 바꿔도 green 이다
 *    (변이 검사로 실증). 그래서 각 verb 가 **실제로** 거부하고 **아무것도 쓰지 않는지**를 여기서 본다.
 */
describe('[REQ-2026-155] 🔴 동작 — 복구 창에서 거부하고 아무것도 쓰지 않는다', () => {
  const roots: string[] = []
  afterEach(() => {
    while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
  })

  /**
   * 복구 창(`pending_evidence_for` 살아 있음) 티켓.
   *
   * 🔴 **실제 git 저장소여야 한다**(phase-1 r02 P1). git 이 아니면 verb 가 **다른 이유로** 실패해도
   *    테스트가 통과하고(약한 오라클), `HEAD` 커밋 수 불변을 아예 확인할 수 없다.
   */
  const setup = (extra: Record<string, unknown> = {}) => {
    const root = mkdtempSync(join(tmpdir(), 'cg-rw155-'))
    roots.push(root)
    const git = (a: string[]): string =>
      execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: root, encoding: 'utf8' })
    git(['init', '-q'])
    git(['config', 'user.email', 't@t.t'])
    git(['config', 'user.name', 't'])
    writeFileSync(
      join(root, 'req.config.json'),
      JSON.stringify({ stopGate: 'merge', setup: { completedVersion: '0.22.0', completedAt: '2026-08-13T00:00:00.000Z' } }),
    )
    const ticket = join(root, 'workflow', 'REQ-2026-999')
    mkdirSync(join(ticket, 'responses'), { recursive: true })
    writeFileSync(
      join(ticket, 'state.json'),
      JSON.stringify({
        id: 'REQ-2026-999',
        risk_level: 'LOW',
        policy_snapshot: { stop_gate: 'phase' },
        pending_evidence_for: { source_commit_sha: 'a'.repeat(40) },
        ...extra,
      }),
    )
    git(['add', '-A'])
    git(['commit', '-qm', 'base'])
    return {
      root,
      ticket,
      git,
      before: readFileSync(join(ticket, 'state.json'), 'utf8'),
      commits: git(['rev-list', '--count', 'HEAD']).trim(),
    }
  }
  /** 🔴 state 바이트와 **HEAD 커밋 수** 둘 다 본다 — 거부해 놓고 커밋을 남기면 결속이 깨진다. */
  const expectUntouched = (f: ReturnType<typeof setup>): void => {
    expect(readFileSync(join(f.ticket, 'state.json'), 'utf8')).toBe(f.before)
    expect(f.git(['rev-list', '--count', 'HEAD']).trim()).toBe(f.commits)
  }

  it('🔴 req:confirm 이 거부하고 state 를 쓰지 않는다', () => {
    const f = setup()
    expect(() =>
      confirmMain(['2026-999', '--root', f.root, '--scope', 'phase', '--method', '사람이 말한 승인', '--run'], {
        now: () => '2026-08-13T00:00:00.000Z',
        log: () => {},
        inDeliverySet: () => false,
      }),
    ).toThrow(/증거 복구가 끝나지 않은/)
    expectUntouched(f)
  })

  it('🔴 req:repolicy 가 거부하고 state 를 쓰지 않는다', () => {
    const f = setup()
    expect(() =>
      repolicyMain(['2026-999', '--root', f.root, '--run'], { now: () => '2026-08-13T00:00:00.000Z', log: () => {} }),
    ).toThrow(/증거 복구가 끝나지 않은/)
    expectUntouched(f)
  })

  /** 🔴 보조 모드는 **일반 경로 가드를 지나지 않는다** — 그래서 분기 앞에 가드를 두었다. */
  for (const [label, argv] of [
    ['일반(예외 부여)', ['--kind', 'design', '--method', '사람이 말한 승인', '--rationale-file', 'r.md']],
    ['--close-stale', ['--close-stale', 'design:-#1', '--reason', '버린다']],
    ['--resolve', ['--resolve', 'replace', '--series', 'design:-#1', '--confirm', '사람이 말한 승인']],
  ] as [string, string[]][]) {
    it(`🔴 req:review-exception ${label} 이 거부하고 state 를 쓰지 않는다`, () => {
      const f = setup()
      expect(() => exceptionMain(['2026-999', '--root', f.root, ...argv, '--run'])).toThrow(/증거 복구가 끝나지 않은/)
      expectUntouched(f)
    })
  }

  /**
   * 🔴 phase-1 r03 P1: `noop`(정책이 이미 같음) 조기 반환이 가드보다 앞에 있으면 복구 창에서도
   *    **성공으로 끝나고** `--finalize` 안내를 받지 못한다. 가드는 `loadState` 직후여야 한다.
   */
  it('🔴 정책이 이미 같아도(noop) 거부한다 — 조기 반환이 가드를 앞지르지 않는다', () => {
    const f = setup({ policy_snapshot: { stop_gate: 'merge' } }) // config 와 동일 = noop 경로
    expect(() =>
      repolicyMain(['2026-999', '--root', f.root, '--run'], { now: () => '2026-08-13T00:00:00.000Z', log: () => {} }),
    ).toThrow(/증거 복구가 끝나지 않은/)
    expectUntouched(f)
  })

  it('🔴 dry-run 은 막지 않는다 — 무엇이 바뀔지 보는 것은 안전하다', () => {
    const f = setup()
    const lines: string[] = []
    repolicyMain(['2026-999', '--root', f.root], { now: () => '2026-08-13T00:00:00.000Z', log: (m) => lines.push(m) })
    expect(lines.join('\n')).toContain('DRY-RUN')
    expectUntouched(f)
  })

  it('🔴 복구 창이 아니면 막지 않는다(무회귀)', () => {
    const root = mkdtempSync(join(tmpdir(), 'cg-rw155ok-'))
    roots.push(root)
    writeFileSync(
      join(root, 'req.config.json'),
      JSON.stringify({ stopGate: 'merge', setup: { completedVersion: '0.22.0', completedAt: '2026-08-13T00:00:00.000Z' } }),
    )
    const ticket = join(root, 'workflow', 'REQ-2026-999')
    mkdirSync(ticket, { recursive: true })
    writeFileSync(
      join(ticket, 'state.json'),
      JSON.stringify({ id: 'REQ-2026-999', risk_level: 'LOW', policy_snapshot: { stop_gate: 'phase' } }),
    )
    // git 저장소가 아니라 checkpoint 커밋은 실패하지만 **state write 는 그 前**이다.
    try {
      repolicyMain(['2026-999', '--root', root, '--run'], { now: () => '2026-08-13T00:00:00.000Z', log: () => {} })
    } catch (e) {
      expect((e as Error).message).not.toMatch(/증거 복구가 끝나지 않은/)
    }
    const after = JSON.parse(readFileSync(join(ticket, 'state.json'), 'utf8')) as { policy_snapshot: { stop_gate: string } }
    expect(after.policy_snapshot.stop_gate).toBe('merge')
  })
})
