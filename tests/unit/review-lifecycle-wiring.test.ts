/**
 * REQ-2026-054 phase(통합) — mainImpl dispatch lifecycle 배선(실 git near-e2e).
 *
 * 🔴 pre-dispatch 실패 → 보상 attempt-closed(pre_dispatch_failed) + 예산 환불 · dispatched/dispatch_confirmed →
 *    보상 close + 차감 유지 · 정상 approved → completed 불변 · durable이면 보상 close가 HEAD에 커밋된다.
 */
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { packageRoot } from '../../scripts/req/lib/config'
import { main as reviewCodexMain, type SeriesRecord } from '../../scripts/req/review-codex'
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
