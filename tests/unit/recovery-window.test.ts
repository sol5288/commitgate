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
import { STATUS_Z_ARGS } from '../../scripts/req/lib/porcelain'
import { main as confirmMain } from '../../scripts/req/req-confirm'
import { main as repolicyMain } from '../../scripts/req/req-repolicy'
import { main as exceptionMain } from '../../scripts/req/req-review-exception'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  inRecoveryWindow,
  recoveryWindowProblem,
  inCheckpointWindow,
  stateWriteBlocked,
  checkpointWindowReason,
} from '../../scripts/req/lib/recovery-window'

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
      const guardAt = lines.findIndex((l) => l.includes('stateWriteBlockedReason('))
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
      const guard = body.findIndex((l) => l.includes('stateWriteBlockedReason('))
      expect(guard, `${f} — 진입 함수 본문에 stateWriteBlockedReason 가드 없음`).toBeGreaterThan(-1)
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

/**
 * 🔴 REQ-2026-156 — **checkpoint 창**(evidence 커밋 뒤·소비 checkpoint 전).
 *
 * `consumeState` 가 `pending_evidence_for` 를 제거하므로 이 창에서는 `inRecoveryWindow` 가 false 다.
 * REQ-2026-155 는 그래서 네 verb 를 전부 통과시켰고, 그 결과 결속과 다른 state 가 HEAD 에 **영구**
 * 기록됐다 — 그 뒤엔 워크트리가 깨끗해 복구가 대조할 기회조차 없다.
 */
describe('[REQ-2026-156] inCheckpointWindow (순수)', () => {
  const SRC = 'b'.repeat(40)
  /**
   * 🔴 **결속(`consumed_state_sha256`)이 있어야 이 창의 대상**이다 — 결속 없는 행(예: design 승인)은
   *    바꿀 대조 대상이 없고, 좁히지 않으면 영구 오탐이 난다(실측).
   */
  const row = (sha: string, phase: string): string =>
    `${JSON.stringify({ consumed_by_commit_sha: sha, phase_id: phase, kind: 'phase', consumed_state_sha256: 'e'.repeat(64) })}\n`
  const rowNoBinding = (sha: string, phase: string): string =>
    `${JSON.stringify({ consumed_by_commit_sha: sha, phase_id: phase, kind: 'design' })}\n`
  const stateWith = (sha: string, phase: string): string =>
    JSON.stringify({ consumed_approvals: [{ consumed_by_commit_sha: sha, phase_id: phase }] })

  it('🔴 A∧B → 창이다', () => {
    expect(
      inCheckpointWindow({ headManifest: row(SRC, 'p1'), parentManifest: '', headStateText: null }),
    ).toBe(true)
  })

  it('🔴 B 만(HEAD 가 추가한 행이 아님) → 창이 아니다', () => {
    expect(
      inCheckpointWindow({ headManifest: row(SRC, 'p1'), parentManifest: row(SRC, 'p1'), headStateText: null }),
    ).toBe(false)
  })

  it('🔴 A 만(HEAD state 에 이미 기록됨) → 창이 아니다 — checkpoint 는 끝났다', () => {
    expect(
      inCheckpointWindow({ headManifest: row(SRC, 'p1'), parentManifest: '', headStateText: stateWith(SRC, 'p1') }),
    ).toBe(false)
  })

  it('🔴 둘 다 아님 → 창이 아니다', () => {
    expect(
      inCheckpointWindow({ headManifest: row(SRC, 'p1'), parentManifest: row(SRC, 'p1'), headStateText: stateWith(SRC, 'p1') }),
    ).toBe(false)
  })

  /**
   * 🔴 설계 r01·r02: **부모가 없으면 A 는 true 다.** 루트 커밋이 소비 행을 추가했다면 그것이 곧
   *    이 창이다 — `planEvidenceRecovery` 의 checkpoint 분기가 이미 같은 규약을 쓴다.
   *    "부모 부재"와 "HEAD 를 못 읽음"은 **다르다**.
   */
  it('🔴 부모가 없어도(루트 커밋) 창이다 — 부재와 읽기 실패를 구별한다', () => {
    expect(inCheckpointWindow({ headManifest: row(SRC, 'p1'), parentManifest: '', headStateText: null })).toBe(true)
  })

  it('🔴 HEAD 매니페스트를 못 읽으면 창이 아니다 — 새 교착을 만들지 않는다', () => {
    expect(inCheckpointWindow({ headManifest: '', parentManifest: '', headStateText: null })).toBe(false)
  })
})

describe('[REQ-2026-156] stateWriteBlocked — 두 창의 합집합', () => {
  const none = { headManifest: '', parentManifest: '', headStateText: null }
  const cp = {
    headManifest: `${JSON.stringify({
      consumed_by_commit_sha: 'b'.repeat(40),
      phase_id: 'p1',
      consumed_state_sha256: 'e'.repeat(64),
    })}\n`,
    parentManifest: '',
    headStateText: null,
  }

  it('창 ①(pending 핀)만으로도 막는다', () => {
    expect(stateWriteBlocked({ pending_evidence_for: { source_commit_sha: 'a'.repeat(40) } }, none)).toBe(true)
  })

  it('🔴 창 ②(checkpoint)만으로도 막는다 — REQ-2026-155 가 놓친 구간이다', () => {
    expect(stateWriteBlocked({}, cp)).toBe(true)
  })

  it('둘 다 아니면 막지 않는다(평시 무회귀)', () => {
    expect(stateWriteBlocked({}, none)).toBe(false)
  })
})

/**
 * 🔴 REQ-2026-156 — **실제 evidence 결속이 든 checkpoint 창**에서 네 verb 가 거부한다.
 *
 * 이 fixture 는 `evidence-recovery-wiring.test.ts` 의 `boundFixture` 와 같은 모양이다:
 * HEAD 에 `consumed_state_sha256` 이 든 evidence 커밋, 워킹에 소비 state(핀 **둘 다 없음**).
 * 임의로 만든 상태로는 이 결함을 재현하지 못한다 — 표식이 HEAD 와의 관계에 있기 때문이다.
 */
describe('[REQ-2026-156] 🔴 checkpoint 창 e2e — 네 verb 가 거부하고 아무것도 쓰지 않는다', () => {
  const roots: string[] = []
  afterEach(() => {
    while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
  })

  const setupCp = () => {
    const root = mkdtempSync(join(tmpdir(), 'cg-cp156-'))
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
    // baseline: 소비 전 state(핀 없음) — HEAD state 에 이 소비가 기록돼 있지 않아야 한다(판별자 B).
    const before = { id: 'REQ-2026-999', risk_level: 'LOW', policy_snapshot: { stop_gate: 'phase' }, consumed_approvals: [] }
    writeFileSync(join(ticket, 'state.json'), `${JSON.stringify(before, null, 2)}\n`)
    git(['add', '-A'])
    git(['commit', '-qm', 'base'])
    const src = git(['rev-parse', 'HEAD']).trim()
    // evidence-finalize 커밋: 소비 행 + 결속. state.json 은 **커밋하지 않는다**(여기서 중단).
    writeFileSync(
      join(ticket, 'responses', 'approvals.jsonl'),
      `${JSON.stringify({
        kind: 'phase',
        phase_id: 'phase-1-x',
        consumed_by_commit_sha: src,
        consumed_state_sha256: 'e'.repeat(64),
      })}\n`,
    )
    git(['add', '--', 'workflow/REQ-2026-999/responses/approvals.jsonl'])
    git(['commit', '-qm', 'chore(REQ-2026-999): evidence-finalize'])
    // 🔴 소비 state 를 디스크에만 쓴다 — 핀이 **둘 다 없다**(inRecoveryWindow 는 false 다).
    writeFileSync(
      join(ticket, 'state.json'),
      `${JSON.stringify(
        { ...before, consumed_approvals: [{ consumed_by_commit_sha: src, phase_id: 'phase-1-x' }] },
        null,
        2,
      )}\n`,
    )
    return {
      root,
      ticket,
      git,
      before: readFileSync(join(ticket, 'state.json'), 'utf8'),
      head: git(['rev-parse', 'HEAD']).trim(),
    }
  }
  const expectUntouchedCp = (f: ReturnType<typeof setupCp>): void => {
    expect(readFileSync(join(f.ticket, 'state.json'), 'utf8')).toBe(f.before)
    expect(f.git(['rev-parse', 'HEAD']).trim()).toBe(f.head)
  }

  it('🔴 이 상태에서 inRecoveryWindow 는 false 다 — 그래서 창 ②가 필요하다', () => {
    const f = setupCp()
    const st = JSON.parse(readFileSync(join(f.ticket, 'state.json'), 'utf8')) as Record<string, unknown>
    expect(inRecoveryWindow(st)).toBe(false)
  })

  it('🔴 req:confirm 이 거부한다', () => {
    const f = setupCp()
    expect(() =>
      confirmMain(['2026-999', '--root', f.root, '--scope', 'phase', '--method', '사람이 말한 승인', '--run'], {
        now: () => '2026-08-13T00:00:00.000Z',
        log: () => {},
        inDeliverySet: () => false,
      }),
    ).toThrow(/증거 복구가 끝나지 않은/)
    expectUntouchedCp(f)
  })

  it('🔴 req:repolicy 가 거부한다', () => {
    const f = setupCp()
    expect(() =>
      repolicyMain(['2026-999', '--root', f.root, '--run'], { now: () => '2026-08-13T00:00:00.000Z', log: () => {} }),
    ).toThrow(/증거 복구가 끝나지 않은/)
    expectUntouchedCp(f)
  })

  for (const [label, argv] of [
    ['일반', ['--kind', 'design', '--method', '사람이 말한 승인', '--rationale-file', 'r.md']],
    ['--close-stale', ['--close-stale', 'design:-#1', '--reason', '버린다']],
    ['--resolve', ['--resolve', 'replace', '--series', 'design:-#1', '--confirm', '사람이 말한 승인']],
  ] as [string, string[]][]) {
    it(`🔴 req:review-exception ${label} 이 거부한다`, () => {
      const f = setupCp()
      expect(() => exceptionMain(['2026-999', '--root', f.root, ...argv, '--run'])).toThrow(/증거 복구가 끝나지 않은/)
      expectUntouchedCp(f)
    })
  }

  it('🔴 dry-run 은 이 창에서도 막지 않는다', () => {
    const f = setupCp()
    const lines: string[] = []
    repolicyMain(['2026-999', '--root', f.root], { now: () => '2026-08-13T00:00:00.000Z', log: (m) => lines.push(m) })
    expect(lines.join('\n')).toContain('DRY-RUN')
    expectUntouchedCp(f)
  })

  it('🔴 소비 checkpoint 까지 끝나면 막지 않는다(평시 무회귀)', () => {
    const f = setupCp()
    f.git(['add', '--', 'workflow/REQ-2026-999/state.json'])
    f.git(['commit', '-qm', 'chore(REQ-2026-999): state checkpoint'])
    // 🔴 HEAD state 에 그 소비가 기록됐다 = 판별자 B 가 false → 창이 아니다.
    try {
      repolicyMain(['2026-999', '--root', f.root, '--run'], { now: () => '2026-08-13T00:00:00.000Z', log: () => {} })
    } catch (e) {
      expect((e as Error).message).not.toMatch(/증거 복구가 끝나지 않은/)
    }
  })
})

/**
 * 🔴 REQ-2026-156 — 검토의 하위 주장 **반증**을 회귀로 고정한다.
 *
 * "dry-run 이 preview 파일을 써서 복구 plan 의 `foreign-files` 판정을 막는다"는 성립하지 않는다:
 * `.review-preview.txt` 는 **gitignored** 이고 `STATUS_Z_ARGS` 에 `--ignored` 가 없어 porcelain 에
 * 나타나지 않는다. 이 사실이 바뀌면(ignore 규칙이 사라지면) 그 주장이 되살아나므로 고정한다.
 */
describe('[REQ-2026-156] 🔴 preview 파일은 gitignored 다(하위 주장 반증)', () => {
  it('루트 .gitignore 가 workflow/**/.review-preview.txt 를 무시한다', () => {
    const out = execFileSync('git', ['check-ignore', '-v', 'workflow/REQ-2026-156/.review-preview.txt'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    })
    expect(out).toContain('.review-preview.txt')
  })

  it('🔴 porcelain 인자에 --ignored 가 없다 — 그래서 dirtyPaths 에 들어가지 않는다', () => {
    expect(STATUS_Z_ARGS).not.toContain('--ignored')
  })
})

/**
 * 🔴 REQ-2026-156 — **형식 불량 결속도 창이다**(외부 리뷰 P2).
 *
 * `bound` 인 행만 보면 결속값이 손상된 행이 필터에서 빠져 가드가 통과했고, 그 뒤 verb 가 state 를
 * checkpoint 커밋한 다음 `--finalize` 가 `state-mismatch` 로 거부하는 **영구 교착**이 남았다.
 * **키가 있다고 주장하는 행은 전부 대상**이다.
 */
describe('[REQ-2026-156] 🔴 형식 불량 결속도 막는다', () => {
  const SRC = 'b'.repeat(40)
  const rowWith = (v: unknown): string =>
    `${JSON.stringify({ consumed_by_commit_sha: SRC, phase_id: 'p1', kind: 'phase', consumed_state_sha256: v })}\n`

  for (const bad of ['not-a-sha', null, 0, '', 'e'.repeat(63)] as unknown[]) {
    it(`🔴 결속이 ${JSON.stringify(bad)} 여도 창으로 본다`, () => {
      const f = { headManifest: rowWith(bad), parentManifest: '', headStateText: null }
      expect(inCheckpointWindow(f)).toBe(true)
      expect(checkpointWindowReason(f)).toBe('malformed-binding')
    })
  }

  it('🔴 안내가 "결속 손상"이라고 말한다 — 복구하면 된다고 오해하게 두지 않는다', () => {
    const m = recoveryWindowProblem('REQ-2026-001', 'req:repolicy', 'malformed-binding')
    expect(m).toContain('증거 결속이 손상')
    expect(m).toContain('npx commitgate req:commit REQ-2026-001 --finalize --run')
    expect(m).toContain('아무것도 쓰지 않았습니다')
  })

  it('정상 결속은 window 사유다', () => {
    expect(checkpointWindowReason({ headManifest: rowWith('e'.repeat(64)), parentManifest: '', headStateText: null })).toBe(
      'window',
    )
  })
})
