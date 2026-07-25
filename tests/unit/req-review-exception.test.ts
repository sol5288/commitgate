/**
 * REQ-2026-055 phase(통합) — req:review-exception 실 git near-e2e.
 *
 * 🔴 needs-exception 구간 부여 → review_exception_confirmed 원자 기록 + review-exceptions.jsonl durable 커밋 →
 *    이어 req:review-codex가 정상 소비 · 구간아님/rationale 누락/dirty 거부 · durable 먼저(부분실패 안전) · 멱등.
 */
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { packageRoot } from '../../scripts/req/lib/config'
import { main as reviewExceptionMain } from '../../scripts/req/req-review-exception'
import { main as reviewCodexMain } from '../../scripts/req/review-codex'
import { createFakeReviewerAdapter } from '../../scripts/req/lib/adapters'
import { parseExceptions } from '../../scripts/req/lib/review-exception'

const gitOf = (repo: string) => (args: string[]): string =>
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: repo, encoding: 'utf8' })

const GOOD_RATIONALE = '## 직전 findings\nP1 두 건: 경계 조건\n\n## 이번 변경\n경계 조건 수정\n\n## 미해결\n없음\n\n## 재시도 근거\n반례 해소돼 재리뷰 정당\n'

/** 열린 design series가 needs-exception 구간(attempts=5)인 durable 티켓. */
const setupRepo = (attempts = 5, refunded?: number): { repo: string; ticket: string; head: string; ratFile: string } => {
  const repo = mkdtempSync(join(tmpdir(), 'req055-exc-'))
  const git = gitOf(repo)
  git(['init', '-q']); git(['config', 'user.email', 't@t.t']); git(['config', 'user.name', 't'])
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.0' }))
  mkdirSync(join(repo, 'workflow'), { recursive: true })
  writeFileSync(join(repo, 'workflow', 'machine.schema.json'), readFileSync(join(packageRoot(), 'workflow', 'machine.schema.json'), 'utf8'))
  writeFileSync(join(repo, 'workflow', '.gitignore'), '/.review-calls.jsonl\n')
  writeFileSync(join(repo, 'req.config.json'), JSON.stringify({ packageManager: 'npm', reviewPersonaPath: null }))
  const ticket = join(repo, 'workflow', 'REQ-2026-001')
  mkdirSync(ticket, { recursive: true })
  for (const f of ['00-requirement.md', '01-design.md', '02-plan.md']) writeFileSync(join(ticket, f), `# ${f}\n본문\n`)
  writeFileSync(join(ticket, 'codex-request.md'), '# req\n리뷰 포인트\n')
  const series = { series_id: 'design:-#1', review_kind: 'design', phase_id: null, attempts, closed_reason: null, ...(refunded !== undefined ? { refunded_attempts: refunded } : {}) }
  writeFileSync(join(ticket, 'state.json'), JSON.stringify({ id: 'REQ-2026-001', phase: 'INTAKE', phases: [], approval_evidence_required: true, evidence_durability_required: true, review_series_model_version: 1, review_series: [series] }, null, 2) + '\n')
  git(['add', '-A']); git(['commit', '-qm', 'baseline'])
  // 🔴 rationale 파일은 **repo 밖**에 둔다 — repo 안 untracked면 req:review-codex의 D10 clean-tree가 막는다.
  const ratFile = join(mkdtempSync(join(tmpdir(), 'req055-rat-')), 'rationale.md')
  writeFileSync(ratFile, GOOD_RATIONALE)
  return { repo, ticket, head: git(['rev-parse', 'HEAD']).trim(), ratFile }
}

const readState = (ticket: string): Record<string, unknown> => JSON.parse(readFileSync(join(ticket, 'state.json'), 'utf8'))
const exFile = (ticket: string): string => join(ticket, 'responses', 'review-exceptions.jsonl')
const commitCount = (repo: string): number => Number(gitOf(repo)(['rev-list', '--count', 'HEAD']).trim())
const grantArgs = (repo: string, ratFile: string): string[] => ['2026-001', '--kind', 'design', '--method', '사람이 6회차 승인함', '--rationale-file', ratFile, '--run', '--root', repo]

describe('[REQ-2026-055] req:review-exception (실 git near-e2e)', () => {
  it('⑩ needs-exception 부여 → state·durable 기록 → req:review-codex가 소비', () => {
    const { repo, ticket, head, ratFile } = setupRepo(5)
    try {
      reviewExceptionMain(grantArgs(repo, ratFile))
      // review_exception_confirmed 원자 기록(회차 정확).
      const ex = readState(ticket).review_exception_confirmed as Record<string, unknown>
      expect(ex.confirmed).toBe(true)
      expect(ex.for_series_id).toBe('design:-#1')
      expect(ex.for_attempt).toBe(6)
      // durable 커밋(HEAD).
      const durable = gitOf(repo)(['show', 'HEAD:workflow/REQ-2026-001/responses/review-exceptions.jsonl'])
      const rows = parseExceptions(durable).rows
      expect(rows).toHaveLength(1)
      expect(rows[0]!.for_attempt).toBe(6)
      expect(rows[0]!.rationale.retry_justification).toContain('재리뷰 정당')
      // 소비: req:review-codex(6회차·needs-exception) → 예외 소비.
      const fake = createFakeReviewerAdapter({ lastMessage: JSON.stringify({ machine_schema_version: '1.1', review_base_sha: head, risk_level: 'LOW', review_kind: 'design', status: 'STEP_COMPLETE', commit_approved: 'yes', merge_ready: 'no', findings: [], next_action: '' }), threadId: 'TID', rawStdout: '' })
      reviewCodexMain(['2026-001', '--kind', 'design', '--run', '--root', repo], { reviewer: fake })
      expect(readState(ticket).review_exception_confirmed).toBeNull() // 소비됨
      expect(parseExceptions(readFileSync(exFile(ticket), 'utf8')).rows).toHaveLength(1) // durable 남음
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('⑨ REQ-2026-054 상호작용: attempts=6·refunded=1 → 유효5 → for_attempt=6 부여', () => {
    const { repo, ticket, ratFile } = setupRepo(6, 1)
    try {
      reviewExceptionMain(grantArgs(repo, ratFile))
      expect((readState(ticket).review_exception_confirmed as Record<string, unknown>).for_attempt).toBe(6)
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('⑪ dry-run → state·커밋 무변경', () => {
    const { repo, ticket, ratFile } = setupRepo(5)
    try {
      const before = commitCount(repo)
      reviewExceptionMain(['2026-001', '--kind', 'design', '--method', 'm', '--rationale-file', ratFile, '--root', repo])
      expect(readState(ticket).review_exception_confirmed).toBeUndefined()
      expect(existsSync(exFile(ticket))).toBe(false)
      expect(commitCount(repo)).toBe(before)
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('⑫ rationale 섹션 누락 → 거부(write 0)', () => {
    const { repo, ticket, ratFile } = setupRepo(5)
    try {
      writeFileSync(ratFile, '## 직전 findings\nx\n## 이번 변경\ny\n') // 미해결·재시도 근거 누락
      const before = commitCount(repo)
      expect(() => reviewExceptionMain(grantArgs(repo, ratFile))).toThrow(/rationale 검증 실패/)
      expect(readState(ticket).review_exception_confirmed).toBeUndefined()
      expect(commitCount(repo)).toBe(before)
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('⑬ allow 구간(attempts=4) → 거부(write 0)', () => {
    const { repo, ticket, ratFile } = setupRepo(4)
    try {
      expect(() => reviewExceptionMain(grantArgs(repo, ratFile))).toThrow(/아직 예외 불요/)
      expect(readState(ticket).review_exception_confirmed).toBeUndefined()
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('⑭ 멱등: 2회 → 커밋 1개·기존 confirmed_at 재사용(conflict 아님)', () => {
    const { repo, ticket, ratFile } = setupRepo(5)
    try {
      reviewExceptionMain(grantArgs(repo, ratFile))
      const firstAt = (readState(ticket).review_exception_confirmed as Record<string, unknown>).confirmed_at
      const afterFirst = commitCount(repo)
      // state를 원복(소비 전 재실행 모사)한 뒤 다시 부여.
      reviewExceptionMain(grantArgs(repo, ratFile))
      expect(commitCount(repo)).toBe(afterFirst) // durable 커밋 증가 없음(material duplicate)
      expect((readState(ticket).review_exception_confirmed as Record<string, unknown>).confirmed_at).toBe(firstAt) // 재사용
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('⑮ review-exceptions.jsonl dirty → clean 가드 거부 + state 미기록(r01 P1)', () => {
    const { repo, ticket, ratFile } = setupRepo(5)
    try {
      mkdirSync(join(ticket, 'responses'), { recursive: true })
      writeFileSync(exFile(ticket), '{"uncommitted":true}\n') // 미커밋 durable 파일
      expect(() => reviewExceptionMain(grantArgs(repo, ratFile))).toThrow(/미커밋 변경/)
      // 🔴 state에 소비 가능한 예외가 남지 않는다(durable 실패 시).
      expect(readState(ticket).review_exception_confirmed).toBeUndefined()
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })
})
