/**
 * REQ-2026-054 phase(통합) — mainImpl dispatch lifecycle 배선(실 git near-e2e).
 *
 * 🔴 pre-dispatch 실패 → 보상 attempt-closed(pre_dispatch_failed) + 예산 환불 · dispatched/dispatch_confirmed →
 *    보상 close + 차감 유지 · 정상 approved → completed 불변 · durable이면 보상 close가 HEAD에 커밋된다.
 */
import { describe, it, expect, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { packageRoot } from '../../scripts/req/lib/config'
import { main as reviewCodexMain, captureDesignBinding, phaseCodeFiles, STAGED_NAMES_Z_ARGS, type SeriesRecord } from '../../scripts/req/review-codex'
import { createFakeReviewerAdapter } from '../../scripts/req/lib/adapters'
import { ReviewCallError } from '../../scripts/req/lib/adapters'

const gitOf = (repo: string) => (args: string[]): string =>
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: repo, encoding: 'utf8' })

const setupRepo = (stateExtra: Record<string, unknown> = {}): { repo: string; ticket: string; head: string } => {
  const repo = mkdtempSync(join(tmpdir(), 'req054-wiring-'))
  const git = gitOf(repo)
  git(['init', '-q'])
  git(['config', 'user.email', 't@t.t'])
  git(['config', 'user.name', 't'])
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.0' }))
  mkdirSync(join(repo, 'workflow'), { recursive: true })
  writeFileSync(join(repo, 'workflow', 'machine.schema.json'), readFileSync(join(packageRoot(), 'workflow', 'machine.schema.json'), 'utf8'))
  writeFileSync(join(repo, 'workflow', '.gitignore'), '/.review-calls.jsonl\n')
  writeFileSync(join(repo, 'req.config.json'), JSON.stringify({ packageManager: 'npm', reviewPersonaPath: null }))
  const ticket = join(repo, 'workflow', 'REQ-2026-001')
  mkdirSync(ticket, { recursive: true })
  for (const f of ['00-requirement.md', '01-design.md', '02-plan.md']) writeFileSync(join(ticket, f), `# ${f}\n본문\n`)
  writeFileSync(join(ticket, 'codex-request.md'), '# req\n리뷰 포인트\n')
  writeFileSync(
    join(ticket, 'state.json'),
    JSON.stringify({ id: 'REQ-2026-001', phase: 'INTAKE', phases: [], approval_evidence_required: true, review_series_model_version: 1, ...stateExtra }, null, 2) + '\n',
  )
  git(['add', '-A'])
  git(['commit', '-qm', 'baseline'])
  return { repo, ticket, head: git(['rev-parse', 'HEAD']).trim() }
}

const cannedApproved = (head: string): string =>
  JSON.stringify({ machine_schema_version: '1.1', review_base_sha: head, risk_level: 'LOW', review_kind: 'design', status: 'STEP_COMPLETE', commit_approved: 'yes', merge_ready: 'no', findings: [], next_action: '' })

const readLedger = (ticket: string): Array<Record<string, unknown>> => {
  const f = join(ticket, 'responses', 'review-ledger.jsonl')
  if (!existsSync(f)) return []
  return readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as Record<string, unknown>)
}
const readSeries = (ticket: string): SeriesRecord[] => {
  const s = JSON.parse(readFileSync(join(ticket, 'state.json'), 'utf8')) as { review_series?: SeriesRecord[] }
  return s.review_series ?? []
}
const runExpectThrow = (repo: string, reviewer: unknown): boolean => {
  try {
    reviewCodexMain(['2026-001', '--kind', 'design', '--run', '--root', repo], { reviewer: reviewer as never })
    return false
  } catch {
    return true
  }
}
// 각 lifecycle을 유발하는 reviewer.
const preDispatchReviewer = { review() { throw new ReviewCallError('pre-dispatch', 'codex ENOENT — 미기동') } }
const dispatchedReviewer = { review() { throw new ReviewCallError('dispatched', 'codex 종료 코드 1') } }
// thread_id 확보 후 malformed 응답 → processResponse 파싱 실패(확인 후) = dispatch_confirmed.
const confirmedThenFailReviewer = { review() { return { threadId: 'TID', lastMessage: 'NOT-JSON{', rawStdout: '' } } }

describe('[REQ-2026-054] dispatch lifecycle 배선(실 git near-e2e)', () => {
  it('⑧ pre-dispatch 실패 → 보상 closed(pre_dispatch_failed) + 예산 환불 + throw', () => {
    const { repo, ticket } = setupRepo({ evidence_durability_required: true })
    try {
      expect(runExpectThrow(repo, preDispatchReviewer)).toBe(true)
      const rows = readLedger(ticket)
      expect(rows.map((r) => r.event)).toEqual(['attempt-opened', 'attempt-closed'])
      expect(rows[1]!.lifecycle).toBe('pre_dispatch_failed')
      expect(rows[1]!.outcome).toBe('invalid')
      // 🔴 환불: attempts=1 단조 유지 + refunded_attempts=1 → 유효 회차 0(재시도가 회차 안 태움).
      const s = readSeries(ticket)[0]!
      expect(s.attempts).toBe(1)
      expect(s.refunded_attempts).toBe(1)
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('⑨ dispatched(확인 전) → 보상 closed(dispatched_unknown) + 환불 없음 + throw', () => {
    const { repo, ticket } = setupRepo({ evidence_durability_required: true })
    try {
      expect(runExpectThrow(repo, dispatchedReviewer)).toBe(true)
      const rows = readLedger(ticket)
      expect(rows[1]!.lifecycle).toBe('dispatched_unknown')
      const s = readSeries(ticket)[0]!
      expect(s.attempts).toBe(1)
      expect(s.refunded_attempts ?? 0).toBe(0) // 차감 유지(환불 없음)
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('⑩ thread_id 확보 후 응답 파싱 실패 → 보상 closed(dispatch_confirmed) + 환불 없음', () => {
    const { repo, ticket } = setupRepo({ evidence_durability_required: true })
    try {
      expect(runExpectThrow(repo, confirmedThenFailReviewer)).toBe(true)
      const rows = readLedger(ticket)
      expect(rows[1]!.lifecycle).toBe('dispatch_confirmed')
      expect((readSeries(ticket)[0]!.refunded_attempts ?? 0)).toBe(0)
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('⑪ 정상 approved → completed(불변) · series 닫힘', () => {
    const { repo, ticket, head } = setupRepo({ evidence_durability_required: true })
    try {
      const fake = createFakeReviewerAdapter({ lastMessage: cannedApproved(head), threadId: 'TID', rawStdout: '' })
      reviewCodexMain(['2026-001', '--kind', 'design', '--run', '--root', repo], { reviewer: fake })
      const rows = readLedger(ticket)
      expect(rows.map((r) => r.event)).toEqual(['attempt-opened', 'attempt-closed'])
      expect(rows[1]!.lifecycle).toBe('completed')
      expect(rows[1]!.outcome).toBe('approved')
      expect(readSeries(ticket)[0]!.closed_reason).toBe('approved')
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  /** REQ-2026-121 완료 기준 1(near-e2e): design 승인 → finalize 커밋 하나에 증거+state.json 동승·별도 checkpoint 커밋 없음. */
  it('[REQ-2026-121] design 승인 finalize 커밋에 state.json 동승 · state checkpoint 커밋 부재 · 메시지 표기', () => {
    const { repo, ticket, head } = setupRepo({ evidence_durability_required: true })
    const git = gitOf(repo)
    try {
      const fake = createFakeReviewerAdapter({ lastMessage: cannedApproved(head), threadId: 'TID', rawStdout: '' })
      reviewCodexMain(['2026-001', '--kind', 'design', '--run', '--root', repo], { reviewer: fake })
      const subjects = git(['log', '--format=%s', `${head}..HEAD`]).split('\n').filter(Boolean)
      // 별도 checkpoint 커밋이 없다 — 동승으로 대체됐다.
      expect(subjects.some((s) => s.includes('state checkpoint'))).toBe(false)
      // finalize 커밋이 state 동승을 메시지로 표기하고(R4) 파일 목록에 state.json이 있다.
      const finalizeSha = git(['log', '--format=%H %s', `${head}..HEAD`])
        .split('\n')
        .find((l) => l.includes('design-finalize'))
      expect(finalizeSha, 'design-finalize 커밋이 있어야 한다').toBeTruthy()
      const sha = (finalizeSha as string).split(' ')[0] as string
      expect(finalizeSha).toContain('·state')
      const files = git(['show', '--name-only', '--format=', sha]).split('\n').filter(Boolean)
      expect(files).toContain('workflow/REQ-2026-001/state.json')
      expect(files.some((f) => f.includes('/responses/'))).toBe(true) // 증거와 같은 커밋
      // 워킹트리에 state.json dirty 잔재가 없다(동승 후 상태는 HEAD와 일치).
      expect(git(['status', '--porcelain', '--', 'workflow/REQ-2026-001/state.json']).trim()).toBe('')
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  // ── REQ-2026-085 DEC-5.3: 리뷰 프롬프트가 죽은 `state.phase`를 더 이상 싣지 않는지 **실제 진입점**으로 확인 ──
  // 🔴 setupRepo가 심는 state에는 `phase: 'INTAKE'`가 그대로 있다(옛 티켓 형태). 프롬프트 조립이 그 값을
  //    읽지 않아야 한다 — 빌더 함수만 단위로 보면 배선이 살아 있어도 통과한다.
  it('[REQ-085 R5] Review Context에 죽은 state.phase(INTAKE)가 실리지 않고 진행 중 phase가 들어간다', () => {
    const { repo, ticket } = setupRepo({
      evidence_durability_required: true,
      current_phase: 'phase-7-live',
      phases: [{ id: 'phase-7-live', approved: false }],
    })
    try {
      // dry-run(--run 없음) — 외부 호출 없이 프롬프트만 조립해 미리보기로 떨군다.
      reviewCodexMain(['2026-001', '--kind', 'design', '--root', repo], { reviewer: undefined as never })
      const preview = readFileSync(join(ticket, '.review-preview.txt'), 'utf8')
      expect(preview).toContain('# Review Context')
      expect(preview).toContain('- phase: phase-7-live') // design 리뷰 → current_phase
      expect(preview).not.toContain('INTAKE') // 🔴 배선 지점
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('[REQ-085 R5] phase 리뷰는 대상 phase를 Review Context에 싣는다', () => {
    const { repo, ticket } = setupRepo({
      evidence_durability_required: true,
      design_approved: true,
      current_phase: 'phase-1-a',
      phases: [{ id: 'phase-1-a', approved: false }],
    })
    try {
      reviewCodexMain(['2026-001', '--kind', 'phase', '--phase', 'phase-1-a', '--root', repo], { reviewer: undefined as never })
      const preview = readFileSync(join(ticket, '.review-preview.txt'), 'utf8')
      expect(preview).toContain('- phase: phase-1-a')
      expect(preview).not.toContain('INTAKE')
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  // ── REQ-2026-084 DEC-4: 정상 경로 invalid(호출 성공·판정 없음)가 void로 표시되는지 **실제 진입점**으로 확인 ──
  // 🔴 순수 함수(voidAttempt) 단위 테스트만으로는 배선이 끊겨도 통과한다 — mainImpl을 직접 돌려야 잡힌다.
  it('[REQ-084 R5] 정상 경로 invalid → void_attempts +1 · attempts 단조 · series는 열린 채', () => {
    const { repo, ticket, head } = setupRepo({ evidence_durability_required: true })
    try {
      // 파싱은 되지만 도메인 검증에서 걸리는 응답(NEEDS_FIX인데 findings 비어 있음) → lifecycle=completed·outcome=invalid.
      const domainInvalid = JSON.stringify({
        machine_schema_version: '1.1', review_base_sha: head, review_kind: 'design',
        status: 'NEEDS_FIX', commit_approved: 'no', merge_ready: 'no', findings: [], next_action: '',
      })
      const fake = createFakeReviewerAdapter({ lastMessage: domainInvalid, threadId: 'TID', rawStdout: '' })
      try {
        reviewCodexMain(['2026-001', '--kind', 'design', '--run', '--root', repo], { reviewer: fake })
      } catch {
        /* invalid는 비-0 종료(fail-closed) — 종료 코드가 아니라 계수·원장을 검증한다. */
      }
      const rows = readLedger(ticket)
      expect(rows.map((r) => r.event)).toEqual(['attempt-opened', 'attempt-closed'])
      expect(rows[1]!.lifecycle).toBe('completed') // dispatch 실패 경로(DEC-C4)가 아니라 **정상 경로**다
      expect(rows[1]!.outcome).toBe('invalid')
      const s = readSeries(ticket)[0]!
      expect(s.void_attempts).toBe(1) // 🔴 배선 지점
      expect(s.attempts).toBe(1) // 단조 유지(DEC-6)
      expect(s.refunded_attempts).toBeUndefined() // pre-dispatch 환불과 섞이지 않는다(R7)
      expect(s.closed_reason).toBeNull() // 재시도 가능하게 열린 채(REQ-2026-027 R6)
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('⑫ durable: 보상 closed가 HEAD에 커밋된다 + 재시도는 새 원장 키(#2, 충돌 없음)', () => {
    const { repo, ticket } = setupRepo({ evidence_durability_required: true })
    const git = gitOf(repo)
    try {
      expect(runExpectThrow(repo, preDispatchReviewer)).toBe(true)
      // HEAD 커밋본에 opened+closed 둘 다 있다(다음 리뷰 D10 안 막힘).
      const head = git(['show', 'HEAD:workflow/REQ-2026-001/responses/review-ledger.jsonl'])
      const headRows = head.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as Record<string, unknown>)
      expect(headRows.map((r) => r.event)).toEqual(['attempt-opened', 'attempt-closed'])
      // 재시도(또 pre-dispatch) → attempts=2(단조) → opened #2(새 자연키, 충돌 없음).
      expect(runExpectThrow(repo, preDispatchReviewer)).toBe(true)
      const rows = readLedger(ticket)
      const opened = rows.filter((r) => r.event === 'attempt-opened').map((r) => r.attempt)
      expect(opened).toEqual([1, 2])
      const s = readSeries(ticket)[0]!
      expect(s.attempts).toBe(2)
      expect(s.refunded_attempts).toBe(2) // 두 번 다 pre-dispatch 환불 → 유효 0
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })
})

// ───────────────── REQ-2026-086: phase 검수 면적 게이트 (실 git near-e2e) ──
describe('[REQ-2026-086] granularity 게이트 — 리뷰 호출 전 차단', () => {
  /** 티켓 밖에 코드 파일 n개를 staged 상태로 만든다. */
  const stageCode = (repo: string, git: (a: string[]) => string, n: number): void => {
    mkdirSync(join(repo, 'src'), { recursive: true })
    for (let i = 0; i < n; i++) writeFileSync(join(repo, 'src', `f${i}.ts`), `export const f${i} = ${i}\n`)
    git(['add', '--', 'src'])
  }
  const phaseState = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    evidence_durability_required: true,
    design_approved: true,
    current_phase: 'phase-1-a',
    phases: [{ id: 'phase-1-a', approved: false }],
    ...over,
  })
  /**
   * setupRepo + **실제 design 결속 해시** 주입. phase 리뷰는 designValid를 먼저 요구하므로
   * 그것을 통과시켜야 granularity 게이트에 도달한다(게이트 순서 자체를 검증하려면 앞 관문을 열어야 한다).
   */
  const setupPhaseRepo = (over: Record<string, unknown> = {}): { repo: string; ticket: string; head: string } => {
    const r = setupRepo(phaseState(over))
    const git = gitOf(r.repo)
    const st = JSON.parse(readFileSync(join(r.ticket, 'state.json'), 'utf8')) as Record<string, unknown>
    st.design_approved_hash = captureDesignBinding('workflow/REQ-2026-001', git).designHash
    writeFileSync(join(r.ticket, 'state.json'), `${JSON.stringify(st, null, 2)}\n`)
    return r
  }
  /** 이 repo의 granularityGate를 명시한다. 기본값은 'warn'(REQ-2026-087)이라 차단 검증은 opt-in이 필요하다. */
  const setGate = (repo: string, gate: 'block' | 'warn'): void => {
    writeFileSync(join(repo, 'req.config.json'), JSON.stringify({ packageManager: 'npm', reviewPersonaPath: null, granularityGate: gate }))
    // 🔴 **커밋**한다 — stage만 하면 두 가지가 어긋난다:
    //    (1) 미스테이징이면 D10(워킹트리 클린)이 granularity 게이트보다 먼저 막고,
    //    (2) staged면 config가 티켓 밖 파일이라 **면적 계수에 잡혀** 테스트가 세려는 수와 달라진다.
    const git = gitOf(repo)
    git(['add', '--', 'req.config.json'])
    git(['commit', '-qm', `test: granularityGate=${gate}`, '--', 'req.config.json'])
  }
  const runPhase = (repo: string): { threw: boolean; msg: string } => {
    try {
      reviewCodexMain(['2026-001', '--kind', 'phase', '--phase', 'phase-1-a', '--run', '--root', repo], {
        reviewer: createFakeReviewerAdapter({ lastMessage: '{}', threadId: 'T', rawStdout: '' }),
      })
      return { threw: false, msg: '' }
    } catch (e) {
      return { threw: true, msg: e instanceof Error ? e.message : String(e) }
    }
  }

  it('임계 이하(8파일)는 통과한다', () => {
    const { repo } = setupPhaseRepo()
    try {
      stageCode(repo, gitOf(repo), 8)
      expect(runPhase(repo).msg).not.toContain('검수 면적 초과')
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('🔴 [block] 초과(9파일)하면 throw + 두 탈출구를 모두 안내한다', () => {
    const { repo } = setupPhaseRepo()
    try {
      setGate(repo, 'block')
      stageCode(repo, gitOf(repo), 9)
      const r = runPhase(repo)
      expect(r.threw).toBe(true)
      expect(r.msg).toContain('검수 면적 초과')
      expect(r.msg).toContain('git restore --staged') // 탈출구 A
      expect(r.msg).toContain('"max_files": 9') // 탈출구 B(실제 개수를 제시)
      expect(r.msg).toContain('granularityGate') // 정책을 끄는 법
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('🔴 [block] DEC-1 순서: 차단되면 attempt·원장 행·부기 커밋이 하나도 생기지 않는다', () => {
    const { repo, ticket } = setupPhaseRepo()
    try {
      setGate(repo, 'block')
      // 🔴 HEAD는 setGate의 설정 커밋 **이후**에 잡는다 — 그게 "리뷰가 커밋을 만들지 않았다"의 기준선이다.
      const head = gitOf(repo)(['rev-parse', 'HEAD']).trim()
      stageCode(repo, gitOf(repo), 12)
      expect(runPhase(repo).threw).toBe(true)
      expect(readLedger(ticket)).toEqual([]) // 원장 행 0
      expect(readSeries(ticket)).toEqual([]) // attempt 0 (예산 미소모)
      expect(gitOf(repo)(['rev-parse', 'HEAD']).trim()).toBe(head) // 커밋 0
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('DEC-3: phases[].max_files 선언이 그 phase의 임계를 올린다', () => {
    const { repo } = setupPhaseRepo({ phases: [{ id: 'phase-1-a', approved: false, max_files: 12 }] })
    try {
      setGate(repo, 'block')
      stageCode(repo, gitOf(repo), 12)
      expect(runPhase(repo).msg).not.toContain('검수 면적 초과')
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('🔴 max_files는 fail-closed — 1 이상의 정수가 아니면 거부한다(오타로 게이트가 꺼지지 않는다)', () => {
    for (const bad of [0, -1, 1.5, '12']) {
      const { repo } = setupPhaseRepo({ phases: [{ id: 'phase-1-a', approved: false, max_files: bad }] })
      try {
        stageCode(repo, gitOf(repo), 20)
        const r = runPhase(repo)
        expect(r.threw, `max_files=${JSON.stringify(bad)}`).toBe(true)
        expect(r.msg).toContain('max_files 비유효')
      } finally {
        rmSync(repo, { recursive: true, force: true })
      }
    }
  })

  // 🔴 REQ-2026-087 R1: **기본 설정이 진행을 막지 않는다.** 0.13.0은 여기서 막혔고 그것이 정정 대상이다.
  it('🔴 [REQ-087 R1] 기본 설정(granularityGate 미지정)은 크게 초과해도 면적으로 멈추지 않는다', () => {
    const { repo } = setupPhaseRepo()
    try {
      // req.config.json을 손대지 않는다 — setupRepo가 쓴 그대로(= granularityGate 미지정 = 기본값).
      stageCode(repo, gitOf(repo), 25)
      expect(runPhase(repo).msg).not.toContain('검수 면적 초과')
      // 🔴 대조군: 같은 상태에서 block을 명시하면 막힌다 — 기본값이 실제로 warn임을 증명한다
      //    (이게 없으면 "다른 이유로 안 막힌 것"과 구별되지 않는다).
      setGate(repo, 'block')
      expect(runPhase(repo).msg).toContain('검수 면적 초과')
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('DEC-6: granularityGate:"warn" 명시 시 초과해도 진행한다', () => {
    const { repo } = setupPhaseRepo()
    try {
      setGate(repo, 'warn')
      stageCode(repo, gitOf(repo), 20)
      expect(runPhase(repo).msg).not.toContain('검수 면적 초과')
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  /**
   * 🔴 REQ-2026-098 — 위 DEC-6 테스트는 "throw하지 않는다"만 본다. 그래서 warn 경로가 **거짓 문구**를
   *    출력해도 통과했다(실제로 그랬다: "리뷰를 실행하지 않았습니다 — 소모된 것이 없습니다"를
   *    출력한 뒤 호출이 나갔다). 순수 테스트만 두면 호출부가 `gate`를 안 넘겨 기본값으로 떨어져도
   *    통과하므로, **실제 진입점의 출력**을 본다.
   */
  it('🔴 [REQ-098] warn 경로의 경고가 실행·소모에 관해 거짓을 말하지 않는다(배선)', () => {
    const { repo } = setupPhaseRepo()
    const warned: string[] = []
    const spy = vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => void warned.push(a.join(' ')))
    try {
      setGate(repo, 'warn')
      stageCode(repo, gitOf(repo), 9)
      runPhase(repo)
      const area = warned.find((l) => l.includes('검수 면적 초과')) ?? ''
      expect(area, '면적 경고가 출력돼야 한다(warn 모드에서도 알리기는 한다)').not.toBe('')
      expect(area).not.toContain('소모된 것이 없습니다')
      expect(area).not.toContain('실행하지 않았습니다')
      expect(area).not.toContain('"granularityGate": "warn"') // 이미 warn — 무의미한 조치
      expect(area).toContain('이 검사는 리뷰를 멈추지 않습니다')
      expect(area).toContain('"granularityGate": "block"') // 실제로 멈추는 법
    } finally {
      spy.mockRestore()
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('DEC-7: design 리뷰는 면적을 보지 않는다', () => {
    const { repo, ticket } = setupPhaseRepo()
    try {
      stageCode(repo, gitOf(repo), 30)
      reviewCodexMain(['2026-001', '--kind', 'design', '--root', repo], { reviewer: undefined as never })
      expect(readFileSync(join(ticket, '.review-preview.txt'), 'utf8')).toContain('# Review Context')
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('DEC-4: 티켓 문서·증거는 면적에 세지 않는다', () => {
    const { repo } = setupPhaseRepo()
    const git = gitOf(repo)
    try {
      // 티켓 안 파일 20개를 staged로 — 전부 제외돼야 한다.
      mkdirSync(join(repo, 'workflow', 'REQ-2026-001', 'responses'), { recursive: true })
      for (let i = 0; i < 20; i++) writeFileSync(join(repo, 'workflow', 'REQ-2026-001', 'responses', `x${i}.json`), '{}')
      git(['add', '--', 'workflow/REQ-2026-001'])
      stageCode(repo, git, 3)
      expect(runPhase(repo).msg).not.toContain('검수 면적 초과')
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })
})

// ── REQ-2026-086 phase-1 r01 P1: 비ASCII 경로가 C-quote돼 면적 판정이 빗나가면 안 된다 ──
describe('[REQ-2026-086] 비ASCII 경로 회귀(core.quotePath 기본값)', () => {
  it('🔴 티켓 안 한글 파일명이 코드 변경으로 잘못 세어지지 않는다', () => {
    const repo = mkdtempSync(join(tmpdir(), 'req086-quote-'))
    const git = gitOf(repo)
    try {
      git(['init', '-q'])
      git(['config', 'user.email', 't@t.t'])
      git(['config', 'user.name', 't'])
      // 🔴 기본값을 명시적으로 켠다 — 이 결함이 나타나는 정확한 조건이다.
      git(['config', 'core.quotePath', 'true'])
      const ticketRel = 'workflow/REQ-2026-001'
      mkdirSync(join(repo, ticketRel, 'responses'), { recursive: true })
      // 티켓 안 한글 파일 12개(임계 8 초과) — 전부 제외돼야 한다.
      for (let i = 0; i < 12; i++) writeFileSync(join(repo, ticketRel, 'responses', `설계응답-${i}.json`), '{}')
      writeFileSync(join(repo, 'seed.txt'), 'x\n')
      git(['add', '-A'])

      // 표시 문자열(-z 없음)은 실제로 C-quote된다 — 전제 자체를 고정한다(이 단언이 깨지면 회귀가 무의미).
      expect(git(['diff', '--cached', '--name-only'])).toContain('"')

      const zPaths = git([...STAGED_NAMES_Z_ARGS]).split('\0')
      const code = phaseCodeFiles(zPaths, ticketRel)
      expect(code).toEqual(['seed.txt']) // 한글 티켓 파일 12개가 전부 빠진다
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('공백이 있는 경로도 접두사가 어긋나지 않는다', () => {
    expect(phaseCodeFiles(['workflow/REQ-1/ a.md', 'src/b .ts', ''], 'workflow/REQ-1')).toEqual(['src/b .ts'])
  })
})
