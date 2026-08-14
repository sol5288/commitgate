import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parseArgs, planRepolicy, nextSnapshot, hasValidSnapshot, existingAdoptions, main } from '../../scripts/req/req-repolicy'
import { resolveDispatch, VERB_MODULES } from '../../bin/dispatch.mjs'
import { STAGE_B_REQ_VERBS, STAGE_B_REQ_SCRIPTS } from '../../bin/init'
import type { WorkflowState } from '../../scripts/req/review-codex'

/**
 * REQ-2026-129 phase-2 — `req:repolicy`.
 *
 * 🔴 이 명령의 존재 이유: 스냅샷만 넣고 채택 경로를 빼면 정책을 바꾼 사용자의 **진행 중 티켓이 영구히
 *    옛 정책에 갇힌다**. 이 저장소는 탈출구 없는 게이트가 교착을 만든다는 것을 두 번 겪었다
 *    (REQ-2026-072 · REQ-2026-093). 그래서 둘은 같은 릴리스에 있어야 한다.
 */

const st = (over: Record<string, unknown> = {}) => ({ id: 'REQ-2026-999', ...over }) as unknown as WorkflowState

describe('[req:repolicy] parseArgs — fail-closed', () => {
  it('REQ·reason·run 을 읽는다', () => {
    expect(parseArgs(['2026-129', '--reason', '정책 변경', '--run'])).toEqual({
      reqId: '2026-129',
      reason: '정책 변경',
      root: null,
      run: true,
    })
  })

  it('알 수 없는 옵션과 값 누락은 조용히 무시하지 않는다', () => {
    expect(() => parseArgs(['x', '--bogus'])).toThrow('알 수 없는 옵션')
    expect(() => parseArgs(['x', '--reason'])).toThrow('--reason')
    expect(() => parseArgs(['x', '--root', '--run'])).toThrow('--root')
  })

  /** 승인 사유는 `-`로 시작할 수 있다 — 접두 검사로 막지 않는다. */
  it("--reason 은 '-' 로 시작하는 값을 받는다", () => {
    expect(parseArgs(['x', '--reason', '-이유']).reason).toBe('-이유')
  })

  /**
   * 🔴 r02 P1 회귀: `--reason --run` 은 사유가 아니라 **값 누락**이다. 이전에는 `--run` 을 사유로 삼켜
   *    DRY-RUN 의도가 실제 write 로 바뀌었다 — 사용자가 요청하지 않은 조합으로 명령이 성립했다.
   */
  it('🔴 --reason 값 자리의 알려진 옵션은 값이 아니라 누락이다', () => {
    for (const opt of ['--run', '--root', '--reason']) {
      expect(() => parseArgs(['x', '--reason', opt]), `--reason ${opt}`).toThrow('옵션')
    }
    // 대조군: 알려지지 않은 대시 문자열은 그대로 사유다(정당한 `-이유`를 막지 않는다).
    expect(parseArgs(['x', '--reason', '--미상']).reason).toBe('--미상')
  })
})

describe('[req:repolicy] planRepolicy — 무엇을 할지', () => {
  it('스냅샷이 config 와 같으면 noop', () => {
    expect(planRepolicy(st({ policy_snapshot: { stop_gate: 'req' } }), 'req')).toEqual({ kind: 'noop', current: 'req' })
  })

  it('스냅샷이 다르면 adopt', () => {
    expect(planRepolicy(st({ policy_snapshot: { stop_gate: 'phase' } }), 'merge')).toEqual({
      kind: 'adopt',
      current: 'phase',
      target: 'merge',
    })
  })

  /** legacy(스냅샷 부재)는 현재 정책을 **고정**하는 것이 의미 있는 동작이다. */
  it('스냅샷이 없으면 pin', () => {
    expect(planRepolicy(st(), 'merge')).toEqual({ kind: 'pin', current: 'merge', target: 'merge' })
  })

  it('손상 스냅샷도 pin(부재와 같게 취급 — effectiveStopGate 와 같은 기준)', () => {
    expect(planRepolicy(st({ policy_snapshot: { stop_gate: 'all' } }), 'req').kind).toBe('pin')
    expect(hasValidSnapshot(st({ policy_snapshot: { stop_gate: 'all' } }))).toBe(false)
  })
})

describe('[req:repolicy] nextSnapshot — append-only 이력', () => {
  it('기존 이력을 보존하고 뒤에 붙인다', () => {
    const prior = { from: 'phase' as const, to: 'req' as const, at: '2026-01-01T00:00:00.000Z' }
    const state = st({ policy_snapshot: { stop_gate: 'req', adopted: [prior] } })
    const snap = nextSnapshot(state, { kind: 'adopt', current: 'req', target: 'merge' }, '2026-08-13T00:00:00.000Z', '사유')
    expect(snap.stop_gate).toBe('merge')
    expect(snap.adopted).toHaveLength(2)
    expect(snap.adopted?.[0]).toEqual(prior)
    expect(snap.adopted?.[1]).toEqual({ from: 'req', to: 'merge', at: '2026-08-13T00:00:00.000Z', reason: '사유' })
  })

  it('사유가 없으면 reason 키를 만들지 않는다', () => {
    const snap = nextSnapshot(st(), { kind: 'pin', current: 'req', target: 'req' }, 'T', null)
    expect(snap.adopted?.[0]).toEqual({ from: 'req', to: 'req', at: 'T' })
  })

  it('손상된 adopted 는 이어붙이지 않는다(빈 배열로 시작)', () => {
    expect(existingAdoptions(st({ policy_snapshot: { stop_gate: 'req', adopted: 'nope' } }))).toEqual([])
  })

  it('🔴 noop 은 기록하지 않는다', () => {
    expect(() => nextSnapshot(st(), { kind: 'noop', current: 'req' }, 'T', null)).toThrow()
  })
})

describe('[req:repolicy] verb 등록', () => {
  it('dispatch 가 모듈로 보낸다', () => {
    expect(resolveDispatch(['req:repolicy', '2026-129'])).toEqual({
      entry: VERB_MODULES['req:repolicy'],
      rest: ['2026-129'],
    })
  })

  /**
   * 🔴 배선 끊김은 순수 테스트가 못 잡는다(REQ-2026-090·099 실측) — 파생이 끊기면 소비자 프로젝트에
   *    `npm run req:repolicy` 자체가 없다.
   */
  it('🔴 Stage B 주입 목록에 따라온다', () => {
    expect(STAGE_B_REQ_VERBS).toContain('req:repolicy')
    expect(STAGE_B_REQ_SCRIPTS['req:repolicy']).toBe('commitgate req:repolicy')
  })
})

/**
 * 🔴 순수 표만 검사하면 `main()` 이 배선을 안 써도 통과한다(과거 phase-4 r04 P1). 실행 경로를 태운다.
 */
describe('[req:repolicy] main() — 실행 경로', () => {
  const roots: string[] = []
  afterEach(() => {
    while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
  })

  const setup = (stopGate: string, snapshot?: unknown) => {
    const root = mkdtempSync(join(tmpdir(), 'cg-repolicy-'))
    roots.push(root)
    writeFileSync(
      join(root, 'req.config.json'),
      JSON.stringify({ stopGate, setup: { completedVersion: '0.22.0', completedAt: '2026-08-13T00:00:00.000Z' } }),
    )
    const ticket = join(root, 'workflow', 'REQ-2026-999')
    mkdirSync(ticket, { recursive: true })
    writeFileSync(
      join(ticket, 'state.json'),
      JSON.stringify({ id: 'REQ-2026-999', risk_level: 'LOW', ...(snapshot === undefined ? {} : { policy_snapshot: snapshot }) }),
    )
    return { root, ticket, before: readFileSync(join(ticket, 'state.json'), 'utf8') }
  }

  const run = (root: string, extra: string[] = []) => {
    const lines: string[] = []
    main(['2026-999', '--root', root, ...extra], { now: () => '2026-08-13T00:00:00.000Z', log: (m) => lines.push(m) })
    return lines.join('\n')
  }

  it('🔴 DRY-RUN 은 state 를 쓰지 않는다', () => {
    const { root, ticket, before } = setup('merge', { stop_gate: 'phase' })
    const out = run(root)
    expect(out).toContain('DRY-RUN')
    expect(out).toContain('"phase" → "merge"')
    expect(readFileSync(join(ticket, 'state.json'), 'utf8')).toBe(before)
  })

  it('🔴 일치하면 아무것도 쓰지 않고 그 사실을 말한다', () => {
    const { root, ticket, before } = setup('req', { stop_gate: 'req' })
    const out = run(root, ['--run'])
    expect(out).toContain('채택할 것이 없습니다')
    expect(readFileSync(join(ticket, 'state.json'), 'utf8')).toBe(before)
  })

  /**
   * 🔴 이 명령이 실제로 티켓 정책을 바꾼다는 오라클. state 를 다시 읽어 스냅샷과 이력을 확인한다.
   *    (checkpoint 커밋은 git 저장소가 아니므로 실패하지만, **state write 는 그 前**이다.)
   */
  it('🔴 --run 이 스냅샷과 채택 이력을 남긴다', () => {
    const { root, ticket } = setup('merge', { stop_gate: 'phase' })
    try {
      run(root, ['--run', '--reason', '정책 변경'])
    } catch {
      /* checkpoint 커밋은 비-git 임시 디렉터리라 실패한다 — write 이후 단계다. */
    }
    const after = JSON.parse(readFileSync(join(ticket, 'state.json'), 'utf8')) as {
      policy_snapshot: { stop_gate: string; adopted: Array<Record<string, string>> }
    }
    expect(after.policy_snapshot.stop_gate).toBe('merge')
    expect(after.policy_snapshot.adopted).toEqual([
      { from: 'phase', to: 'merge', at: '2026-08-13T00:00:00.000Z', reason: '정책 변경' },
    ])
  })

  it('legacy 티켓은 현재 정책을 고정한다고 말한다', () => {
    const { root } = setup('req')
    expect(run(root)).toContain('고정합니다')
  })
})

/**
 * 🔴 REQ-2026-154 DEC-2 — **복구 창에서는 정책을 바꾸지 않는다.**
 *
 * evidence 커밋 뒤·소비 checkpoint 전에 이 명령이 state 를 바꿔 checkpoint 커밋하면, 커밋된 증거의
 * `consumed_state_sha256` 결속이 깨지고 이후 `--finalize` 가 영구 차단된다(실측 재현).
 */
describe('[REQ-2026-154] req:repolicy — 복구 창 차단', () => {
  const roots: string[] = []
  afterEach(() => {
    while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
  })

  const setup = (extraState: Record<string, unknown>) => {
    const root = mkdtempSync(join(tmpdir(), 'cg-repolicy154-'))
    roots.push(root)
    writeFileSync(
      join(root, 'req.config.json'),
      JSON.stringify({ stopGate: 'merge', setup: { completedVersion: '0.22.0', completedAt: '2026-08-13T00:00:00.000Z' } }),
    )
    const ticket = join(root, 'workflow', 'REQ-2026-999')
    mkdirSync(ticket, { recursive: true })
    writeFileSync(
      join(ticket, 'state.json'),
      JSON.stringify({ id: 'REQ-2026-999', risk_level: 'LOW', policy_snapshot: { stop_gate: 'phase' }, ...extraState }),
    )
    return { root, ticket, before: readFileSync(join(ticket, 'state.json'), 'utf8') }
  }
  const run = (root: string, extra: string[] = []): string => {
    const lines: string[] = []
    main(['2026-999', '--root', root, ...extra], { now: () => '2026-08-13T00:00:00.000Z', log: (m) => lines.push(m) })
    return lines.join('\n')
  }

  it('🔴 pending_evidence_for 가 살아 있으면 --run 이 거부하고 state 를 쓰지 않는다', () => {
    const { root, ticket, before } = setup({ pending_evidence_for: { source_commit_sha: 'a'.repeat(40) } })
    expect(() => run(root, ['--run'])).toThrow(/증거 복구가 끝나지 않은/)
    expect(readFileSync(join(ticket, 'state.json'), 'utf8')).toBe(before)
  })

  /**
   * 🔴 phase-1 r01 P1: **승인 핀만으로는 막지 않는다.** `approval_evidence` 는 승인 직후부터 소비까지
   *    살아 있는 정상 상태이고, 그 구간에는 아직 source 커밋도 결속도 없다. 여기서 막으면 정책 채택이
   *    통째로 봉쇄되고, 안내하는 `--finalize` 는 복구할 evidence 가 없어 **완료할 수도 없다**.
   */
  it('🔴 승인 직후(approval_evidence 만)에는 막지 않는다 — 새 교착을 만들지 않는다', () => {
    const { root } = setup({ approval_evidence: { response_path: 'x', response_sha256: 'b'.repeat(64) } })
    try {
      run(root, ['--run'])
    } catch (e) {
      // git 저장소가 아니라 checkpoint 커밋이 실패하는 것은 허용 — 복구 창 거부는 아니어야 한다.
      expect((e as Error).message).not.toMatch(/증거 복구가 끝나지 않은/)
    }
    const after = JSON.parse(readFileSync(join(root, 'workflow', 'REQ-2026-999', 'state.json'), 'utf8')) as {
      policy_snapshot: { stop_gate: string }
    }
    expect(after.policy_snapshot.stop_gate).toBe('merge')
  })

  it('🔴 안내가 실행 가능한 다음 명령을 준다 — 복구를 끝내는 길', () => {
    const { root } = setup({ pending_evidence_for: { source_commit_sha: 'a'.repeat(40) } })
    try {
      run(root, ['--run'])
      throw new Error('거부되지 않았다')
    } catch (e) {
      const m = (e as Error).message
      expect(m).toContain('npx commitgate req:commit REQ-2026-999 --finalize --run')
      expect(m).toContain('아무것도 쓰지 않았습니다')
    }
  })

  it('🔴 DRY-RUN 은 막지 않는다 — 무엇이 바뀔지 보는 것은 안전하다', () => {
    const { root, ticket, before } = setup({ pending_evidence_for: { source_commit_sha: 'a'.repeat(40) } })
    const out = run(root)
    expect(out).toContain('DRY-RUN')
    expect(readFileSync(join(ticket, 'state.json'), 'utf8')).toBe(before)
  })

  it('🔴 복구 창이 아니면 종전대로 동작한다(무회귀)', () => {
    const { root } = setup({})
    // checkpoint 커밋은 git 저장소가 아니라 실패하지만 **state write 는 그 前**이다.
    try {
      run(root, ['--run'])
    } catch {
      /* git 없음 — 무시 */
    }
    const after = JSON.parse(readFileSync(join(root, 'workflow', 'REQ-2026-999', 'state.json'), 'utf8')) as {
      policy_snapshot: { stop_gate: string }
    }
    expect(after.policy_snapshot.stop_gate).toBe('merge')
  })
})
