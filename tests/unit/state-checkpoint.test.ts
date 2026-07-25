import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { commitStateCheckpoint, serializeState } from '../../scripts/req/lib/state-checkpoint'
import { writeState, main as reviewCodexMain, type WorkflowState } from '../../scripts/req/review-codex'
import { createFakeReviewerAdapter } from '../../scripts/req/lib/adapters'
import { packageRoot } from '../../scripts/req/lib/config'
import { computeReviewSemanticIdentity } from '../../scripts/req/lib/review-target'

/**
 * REQ-2026-057 phase-1 — **state checkpoint 헬퍼의 불변식**을 고정한다.
 *
 * 이 헬퍼가 존재하는 이유: 승인·소비 상태가 `state.json`에만 남고 커밋되지 않아
 *   (1) 티켓 완주 후 dirty tree가 다음 `req:new`를 막고,
 *   (2) 그 파일을 버리면 커밋된 승인 증거가 있는데도 재리뷰를 요구받는다.
 *
 * 헬퍼는 **티켓 `state.json` 한 경로만** pathspec 커밋한다 — 증거 커밋의 `responses/` 외 staged 금지
 * 가드를 완화하지 않고, 사용자가 stage해 둔 코드도 건드리지 않는다(설계 DEC-1).
 */

/**
 * 픽스처 저장소의 **auto 유지보수를 끈다** (REQ-2026-059 DEC-1).
 *
 * git은 커밋 뒤 유지보수를 **detached 프로세스**로 띄울 수 있고, 그 프로세스가 `.git/objects/pack/`에
 * 쓰는 동안 정리(`rmSync`)가 그 디렉터리를 지우려 하면 `ENOTEMPTY`로 죽는다 — 실제로 CI
 * (ubuntu·node 20)에서 단언은 전부 통과했는데 정리에서만 실패했다.
 *
 * 🔴 두 경로를 **모두** 닫는다: git 버전에 따라 자동 실행 경로가 `gc --auto`이거나
 *    `maintenance run --auto`다. 하나만 끄면 다른 러너에서 같은 증상이 남는다.
 * ⚠️ 피시험 동작에는 영향이 없다 — 유지보수는 저장소 관리 기능이고, 검증 대상은 커밋 내용·인덱스·상태다.
 */
function disableAutoMaintenance(git: (args: string[]) => string): void {
  git(['config', 'gc.auto', '0'])
  git(['config', 'maintenance.auto', 'false'])
}

/**
 * 임시 저장소 정리 — `disableAutoMaintenance`가 원인을 없앤 뒤의 **얇은 보험**(REQ-2026-059 DEC-2).
 * `rmSync`의 재시도는 `EBUSY`·`ENOTEMPTY`·`EPERM`에만 적용되므로 다른 오류는 그대로 드러난다.
 */
function cleanupRepo(dir: string): void {
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
}

const TICKET_ID = 'REQ-2026-001'
const TICKET_REL = `workflow/${TICKET_ID}`

interface Fixture {
  dir: string
  git: (args: string[]) => string
  state: WorkflowState
}

function makeRepo(): Fixture {
  const dir = mkdtempSync(join(tmpdir(), 'cg-ckpt-'))
  const git = (args: string[]): string => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
  git(['init', '-q'])
  // 🔴 repo-local identity — 전역 config는 tests/setup/git-hermetic.ts가 차단한다.
  git(['config', 'user.email', 't@t.t'])
  git(['config', 'user.name', 't'])
  disableAutoMaintenance(git)
  const ticketDir = join(dir, 'workflow', TICKET_ID)
  mkdirSync(ticketDir, { recursive: true })
  const state: WorkflowState = { id: TICKET_ID, phase: 'INTAKE', design_approved: false }
  writeState(ticketDir, state)
  git(['add', '-A'])
  git(['commit', '-q', '-m', 'seed'])
  return { dir, git, state }
}

/** 헬퍼 호출 인자(테스트마다 반복되는 부분). */
function args(f: Fixture, state: WorkflowState) {
  return {
    root: f.dir,
    ticketRel: TICKET_REL,
    ticketId: TICKET_ID,
    state,
    reason: 'design 승인',
    gitFn: f.git,
  }
}

/** 커밋이 실제로 담은 경로 목록. */
function committedPaths(f: Fixture, ref = 'HEAD'): string[] {
  return f
    .git(['show', '--pretty=format:', '--name-only', ref])
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
}

describe('commitStateCheckpoint', () => {
  it('변경이 없으면 커밋하지 않는다(멱등 — 빈 커밋 금지)', () => {
    const f = makeRepo()
    try {
      const before = f.git(['rev-parse', 'HEAD']).trim()
      expect(commitStateCheckpoint(args(f, f.state))).toBe(false)
      expect(f.git(['rev-parse', 'HEAD']).trim()).toBe(before)
    } finally {
      cleanupRepo(f.dir)
    }
  })

  it('변경된 상태를 커밋하고 워킹트리를 clean으로 만든다', () => {
    const f = makeRepo()
    try {
      const next: WorkflowState = { ...f.state, design_approved: true, design_approved_hash: 'abc' }
      writeState(join(f.dir, 'workflow', TICKET_ID), next)
      expect(f.git(['status', '--porcelain']).trim()).not.toBe('')

      expect(commitStateCheckpoint(args(f, next))).toBe(true)

      expect(f.git(['status', '--porcelain']).trim()).toBe('')
      expect(committedPaths(f)).toEqual([`${TICKET_REL}/state.json`])
      const committed = f.git(['show', `HEAD:${TICKET_REL}/state.json`])
      expect(JSON.parse(committed).design_approved).toBe(true)
    } finally {
      cleanupRepo(f.dir)
    }
  })

  it('사용자가 stage해 둔 변경을 커밋에 섞지 않고 인덱스에 남긴다(pathspec 격리)', () => {
    const f = makeRepo()
    try {
      // 리뷰를 도는 정상 경로: 코드가 staged인 채로 승인 경계에 도달한다.
      writeFileSync(join(f.dir, 'src.ts'), 'export const x = 1\n')
      f.git(['add', '--', 'src.ts'])
      const next: WorkflowState = { ...f.state, design_approved: true }
      writeState(join(f.dir, 'workflow', TICKET_ID), next)

      expect(commitStateCheckpoint(args(f, next))).toBe(true)

      expect(committedPaths(f)).toEqual([`${TICKET_REL}/state.json`])
      // staged 코드는 그대로 인덱스에 남아 있어야 한다.
      expect(f.git(['diff', '--cached', '--name-only']).trim()).toBe('src.ts')
    } finally {
      cleanupRepo(f.dir)
    }
  })

  it('디스크 내용이 도구가 쓴 상태와 다르면 커밋하지 않고 fail-closed', () => {
    const f = makeRepo()
    try {
      const next: WorkflowState = { ...f.state, design_approved: true }
      // 외부 편집·경쟁 쓰기 모의: 디스크에는 다른 값이 들어 있다.
      writeState(join(f.dir, 'workflow', TICKET_ID), { ...next, design_approved_hash: 'tampered' })
      const before = f.git(['rev-parse', 'HEAD']).trim()

      expect(() => commitStateCheckpoint(args(f, next))).toThrow(/state\.json/)
      expect(f.git(['rev-parse', 'HEAD']).trim()).toBe(before)
    } finally {
      cleanupRepo(f.dir)
    }
  })

  it('state.id가 대상 티켓과 다르면 fail-closed(다른 티켓 상태를 싣지 않는다)', () => {
    const f = makeRepo()
    try {
      const alien: WorkflowState = { ...f.state, id: 'REQ-2026-999', design_approved: true }
      writeState(join(f.dir, 'workflow', TICKET_ID), alien)
      const before = f.git(['rev-parse', 'HEAD']).trim()

      expect(() => commitStateCheckpoint(args(f, alien))).toThrow(/REQ-2026-999/)
      expect(f.git(['rev-parse', 'HEAD']).trim()).toBe(before)
    } finally {
      cleanupRepo(f.dir)
    }
  })

  it('커밋 메시지에 티켓 id와 사유가 담긴다', () => {
    const f = makeRepo()
    try {
      const next: WorkflowState = { ...f.state, design_approved: true }
      writeState(join(f.dir, 'workflow', TICKET_ID), next)
      commitStateCheckpoint({ ...args(f, next), reason: 'phase phase-1-x 소비' })
      const subject = f.git(['log', '-1', '--format=%s']).trim()
      expect(subject).toContain(TICKET_ID)
      expect(subject).toContain('phase-1-x')
    } finally {
      cleanupRepo(f.dir)
    }
  })
})

/**
 * design 승인 경로 **near-e2e**(설계 리뷰 observation 대응).
 *
 * 헬퍼 단위 테스트만으로는 완료 기준 3·4("승인 직후 checkpoint" · "상태를 버려도 승인이 남는다")가
 * 입증되지 않는다 — 배선이 빠져도 통과하기 때문이다. 여기서는 `main()` 전체 경로를 fake reviewer로
 * 돌려 **승인 → 증거 커밋 → state checkpoint** 사슬을 실제로 통과시킨다.
 */
describe('design 승인 경로 — state checkpoint 배선(near-e2e)', () => {
  const repos: string[] = []
  afterEach(() => {
    while (repos.length) cleanupRepo(repos.pop() as string)
  })

  const SCHEMA_SRC = readFileSync(join(packageRoot(), 'workflow', 'machine.schema.json'), 'utf8')

  function setupTicketRepo(): { repo: string; git: (a: string[]) => string; ticketAbs: string } {
    const repo = mkdtempSync(join(tmpdir(), 'cg-ckpt-e2e-'))
    repos.push(repo)
    const git = (args: string[]): string =>
      execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).replace(/\s+$/, '')
    git(['init', '-q'])
    // REQ-2026-049: repo-local identity(피시험 코드의 커밋이 전역 config에 기대지 않아야 한다).
    git(['config', 'user.email', 't@t.t'])
    git(['config', 'user.name', 't'])
    disableAutoMaintenance(git)
    writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.0' }))
    writeFileSync(join(repo, 'req.config.json'), JSON.stringify({ packageManager: 'npm', reviewPersonaPath: null }))
    const ticketAbs = join(repo, 'workflow', TICKET_ID)
    mkdirSync(ticketAbs, { recursive: true })
    writeFileSync(join(repo, 'workflow', 'machine.schema.json'), SCHEMA_SRC)
    writeFileSync(join(ticketAbs, '00-requirement.md'), '# req\nreq body\n')
    writeFileSync(join(ticketAbs, '01-design.md'), '# design\ndesign body\n')
    writeFileSync(join(ticketAbs, '02-plan.md'), '# plan\nplan body\n')
    writeFileSync(join(ticketAbs, 'codex-request.md'), '# codex-request\nreview this\n')
    writeState(ticketAbs, {
      id: TICKET_ID,
      phase: 'INTAKE',
      review_series_model_version: 1,
      phases: [],
      approval_evidence_required: true,
    } as unknown as WorkflowState)
    git(['add', '-A'])
    git(['commit', '-qm', 'base'])
    return { repo, git, ticketAbs }
  }

  it('design 승인이 끝나면 state.json이 커밋돼 워킹트리가 clean이고, 버려도 승인이 남는다', () => {
    const { repo, git, ticketAbs } = setupTicketRepo()
    const verdict = {
      machine_schema_version: '1.1',
      review_base_sha: git(['rev-parse', 'HEAD']),
      status: 'COMPLETE',
      commit_approved: 'yes',
      merge_ready: 'yes',
      risk_level: 'LOW',
      review_kind: 'design',
      findings: [],
      next_action: 'done',
    }
    const fake = createFakeReviewerAdapter({ lastMessage: JSON.stringify(verdict), threadId: 'TID', rawStdout: '' })

    reviewCodexMain(['2026-001', '--kind', 'design', '--run', '--root', repo], { reviewer: fake })

    // ① 승인 상태가 워킹 변경으로 남지 않는다(완료 기준 3).
    const stateRel = `workflow/${TICKET_ID}/state.json`
    expect(git(['status', '--porcelain', '--', stateRel]).trim()).toBe('')
    // ② 커밋된 내용만으로 승인 사실이 성립한다.
    const committed = JSON.parse(git(['show', `HEAD:${stateRel}`])) as WorkflowState
    expect(committed.design_approved).toBe(true)
    // ③ 워킹 변경을 버려도(F-2의 재현 조작) 승인이 그대로다 — 재리뷰를 요구할 근거가 없다(완료 기준 4).
    git(['checkout', '--', stateRel])
    const onDisk = JSON.parse(readFileSync(join(ticketAbs, 'state.json'), 'utf8')) as WorkflowState
    expect(onDisk.design_approved).toBe(true)
    expect(onDisk.design_approval_evidence).toBeTruthy()
  })

  it('checkpoint 커밋이 semantic identity를 바꾸지 않는다(G2 stale 오판 방지)', () => {
    const { repo, git } = setupTicketRepo()
    const verdict = {
      machine_schema_version: '1.1',
      review_base_sha: git(['rev-parse', 'HEAD']),
      status: 'COMPLETE',
      commit_approved: 'yes',
      merge_ready: 'yes',
      risk_level: 'LOW',
      review_kind: 'design',
      findings: [],
      next_action: 'done',
    }
    const fake = createFakeReviewerAdapter({ lastMessage: JSON.stringify(verdict), threadId: 'TID', rawStdout: '' })

    reviewCodexMain(['2026-001', '--kind', 'design', '--run', '--root', repo], { reviewer: fake })

    // 🔴 checkpoint는 인덱스의 state.json 항목을 갱신한다. 그것이 identity에 잡히면 req:next G2가
    //    **방금 승인한 리뷰**를 stale로 오판해 재리뷰를 지시한다 — responses/에서 이미 겪은 결함과 같은 형태다.
    const stored = (
      JSON.parse(git(['show', `HEAD:workflow/${TICKET_ID}/state.json`])) as { last_review?: { compare_hash?: string } }
    ).last_review?.compare_hash
    expect(typeof stored).toBe('string')
    expect(computeReviewSemanticIdentity(`workflow/${TICKET_ID}`, (a) => git(a))).toBe(stored)
  })
})

describe('serializeState', () => {
  it('writeState가 디스크에 쓰는 바이트와 동일하다(드리프트 금지)', () => {
    const f = makeRepo()
    try {
      const s: WorkflowState = { ...f.state, design_approved: true, phases: [{ id: 'p1', approved: false }] }
      const ticketDir = join(f.dir, 'workflow', TICKET_ID)
      writeState(ticketDir, s)
      expect(readFileSync(join(ticketDir, 'state.json'), 'utf8')).toBe(serializeState(s))
    } finally {
      cleanupRepo(f.dir)
    }
  })
})
