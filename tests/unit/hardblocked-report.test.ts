/**
 * REQ-2026-147 phase-2 — `hard-blocked` 보고 배선.
 *
 * 🔴 이 스위트의 **첫 번째** 오라클은 기능이 아니라 무회귀다: 보고를 만들다 어떤 이유로든 실패해도
 *    `hard-blocked` 는 **여전히 throw** 해야 한다. 부수 기능이 주 기능을 이기면 그건 게이트 붕괴다.
 */
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gateAndRecordAttempt, __setGitAdapterForTest } from '../../scripts/req/review-codex'
import { createGitAdapter } from '../../scripts/req/lib/adapters'
import { collectRounds, splitDirty, hardBlockedInput } from '../../scripts/req/lib/hardblocked-facts'
import { nextChoices } from '../../scripts/req/lib/nonconvergence'
import type { WorkflowState } from '../../scripts/req/review-codex'

const BUDGET = { autoBudget: 5, hardCap: 8, onSoftLimit: 'ask' } as const
const gitOf = (repo: string) => (args: string[]): string =>
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: repo, encoding: 'utf8' })

/** hardCap 에 닿은 티켓(dispatched=8). */
const setup = (opts: { archives?: [number, string, unknown][]; dirtyOutside?: boolean } = {}): { repo: string; ticket: string; state: WorkflowState } => {
  const repo = mkdtempSync(join(tmpdir(), 'req147-'))
  const git = gitOf(repo)
  git(['init', '-q'])
  git(['config', 'user.email', 't@t.t'])
  git(['config', 'user.name', 't'])
  writeFileSync(join(repo, 'package.json'), '{"name":"x","version":"0.0.0"}')
  const ticket = join(repo, 'workflow', 'REQ-2026-001')
  mkdirSync(join(ticket, 'responses'), { recursive: true })
  for (const [round, status, body] of opts.archives ?? []) {
    writeFileSync(join(ticket, 'responses', `design-r${String(round).padStart(2, '0')}-${status}.json`), JSON.stringify(body))
  }
  writeFileSync(join(ticket, 'state.json'), '{}')
  git(['add', '-A'])
  git(['commit', '-qm', 'baseline'])
  if (opts.dirtyOutside) writeFileSync(join(repo, 'code.ts'), 'x')
  const state = {
    id: 'REQ-2026-001',
    branch: 'feat/req-2026-001-parent-slug',
    review_series_model_version: 1,
    review_series: [
      { series_id: 'design:-#1', review_kind: 'design', phase_id: null, attempts: 8, closed_reason: null },
    ],
  } as unknown as WorkflowState
  return { repo, ticket, state }
}

const blockMessage = (repo: string, ticket: string, state: WorkflowState): string => {
  __setGitAdapterForTest(createGitAdapter(repo))
  try {
    gateAndRecordAttempt({ ticketDir: ticket, state, kind: 'design', phaseId: null, budget: BUDGET })
  } catch (e) {
    return (e as Error).message
  }
  throw new Error('차단되지 않았다')
}

describe('[REQ-2026-147] 🔴 보고가 차단을 흔들 수 없다', () => {
  it('아카이브·원장이 하나도 없어도 여전히 차단한다', () => {
    const { repo, ticket, state } = setup()
    const msg = blockMessage(repo, ticket, state)
    expect(msg).toContain('review 예산 소진')
    expect(msg).toContain('hardCap=8')
    rmSync(repo, { recursive: true, force: true })
  })

  it('🔴 티켓 디렉터리가 아예 없어도 차단한다(보고 생성 실패 → 원문 fallback)', () => {
    const { repo, state } = setup()
    const msg = blockMessage(repo, join(repo, 'workflow', 'NOPE'), state)
    expect(msg).toContain('review 예산 소진')
    rmSync(repo, { recursive: true, force: true })
  })

  it('🔴 파손된 아카이브가 있어도 차단하고, 나머지 라운드로 보고를 만든다', () => {
    const { repo, ticket, state } = setup({
      archives: [
        [1, 'needs-fix', { findings: [{ file: 'a.ts' }] }],
        [2, 'needs-fix', { findings: [{ file: 'a.ts' }] }],
      ],
    })
    writeFileSync(join(ticket, 'responses', 'design-r03-needs-fix.json'), '{ not json')
    const msg = blockMessage(repo, ticket, state)
    expect(msg).toContain('review 예산 소진')
    expect(msg).toContain('r01')
    expect(msg).not.toContain('r03')
    rmSync(repo, { recursive: true, force: true })
  })
})

describe('[REQ-2026-147] 보고 내용', () => {
  it('반복 축과 다음 선택을 함께 낸다', () => {
    const { repo, ticket, state } = setup({
      archives: [
        [1, 'needs-fix', { findings: [{ file: 'a.ts', detail: 'x' }] }],
        [2, 'needs-fix', { findings: [{ file: 'a.ts', detail: 'y' }] }],
      ],
    })
    const msg = blockMessage(repo, ticket, state)
    expect(msg).toContain('감사 증거 아님')
    expect(msg).toContain('a.ts')
    expect(msg).toContain('req:close')
    expect(msg).toContain('--resolve replace')
    expect(msg).toContain('--successor-of REQ-2026-001')
    rmSync(repo, { recursive: true, force: true })
  })

  it('🔴 slug 는 부모 branch 에서 산출된 실제 값이다(자리표시자 없음)', () => {
    const { repo, ticket, state } = setup()
    const msg = blockMessage(repo, ticket, state)
    expect(msg).toContain('parent-slug-successor')
    expect(msg).not.toContain('<')
    rmSync(repo, { recursive: true, force: true })
  })

  it('🔴 티켓 밖 더러운 경로를 데이터로 열거한다', () => {
    const { repo, ticket, state } = setup({ dirtyOutside: true })
    const msg = blockMessage(repo, ticket, state)
    expect(msg).toContain('code.ts')
    expect(msg).toContain('티켓 밖에도')
    rmSync(repo, { recursive: true, force: true })
  })
})

describe('[REQ-2026-147] 사실 수집(순수 경계)', () => {
  it('splitDirty — 티켓 안/밖을 가른다', () => {
    const p = ' M workflow/REQ-2026-001/01-design.md\0?? workflow/REQ-2026-001/responses/x.json\0 M src/a.ts\0'
    const r = splitDirty(p, 'workflow/REQ-2026-001')
    expect(r.ticketDirty).toBe(true)
    expect(r.outsideDirty).toEqual(['src/a.ts'])
  })

  it('splitDirty — rename 은 src·dest 를 둘 다 본다', () => {
    const r = splitDirty('R  src/new.ts\0old.ts\0', 'workflow/REQ-2026-001')
    expect(r.outsideDirty).toContain('src/new.ts')
  })

  /**
   * 🔴 phase-2 r01 P1 회귀: `--porcelain` 단독은 공백·비ASCII 경로를 **C-quote** 한다
   *    (`"workflow/\355\213\260…"`). 손으로 자르면 티켓 경로가 티켓 **밖**으로 분류돼 파킹 줄이
   *    빠지고, 그러면 다음 `req:new` 가 clean-tree 검사에 막힌다. `-z` 는 인용하지 않는다.
   */
  it('🔴 공백이 든 티켓 경로도 티켓 안으로 분류한다', () => {
    const r = splitDirty(' M work flow/REQ-2026-001/01-design.md\0', 'work flow/REQ-2026-001')
    expect(r.ticketDirty).toBe(true)
    expect(r.outsideDirty).toEqual([])
  })

  it('🔴 한글이 든 티켓 경로도 티켓 안으로 분류한다', () => {
    const r = splitDirty(' M 워크플로/REQ-2026-001/01-design.md\0', '워크플로/REQ-2026-001')
    expect(r.ticketDirty).toBe(true)
    expect(r.outsideDirty).toEqual([])
  })

  it('🔴 파킹 명령의 경로는 따옴표로 감싸진다(공백 티켓 루트)', () => {
    const { replace } = nextChoices({
      reqId: 'REQ-2026-001',
      seriesId: 'design:-#1',
      hasOpenAttempt: false,
      ticketDirty: true,
      outsideDirty: [],
      ticketRel: 'work flow/REQ-2026-001',
      successorSlug: 's',
      rounds: [],
      hardCap: 8,
      attempt: 9,
    })
    expect(replace[1]!.text).toContain('git add -- "work flow/REQ-2026-001"')
  })

  it('splitDirty — 깨끗하면 둘 다 비어 있다', () => {
    const r = splitDirty('', 'workflow/REQ-2026-001')
    expect(r.ticketDirty).toBe(false)
    expect(r.outsideDirty).toEqual([])
  })

  it('collectRounds — 다른 kind 의 아카이브는 섞이지 않는다', () => {
    const { repo, ticket } = setup({ archives: [[1, 'needs-fix', { findings: [{ file: 'a.ts' }] }]] })
    writeFileSync(join(ticket, 'responses', 'phase-p1-r01-needs-fix.json'), JSON.stringify({ findings: [{ file: 'z.ts' }] }))
    const rounds = collectRounds({
      root: repo,
      ticketRel: 'workflow/REQ-2026-001',
      ticketDir: ticket,
      reqId: 'REQ-2026-001',
      branch: null,
      kind: 'design',
      phaseId: null,
      openSeries: null,
      hardCap: 8,
      attempt: 9,
      statusZ: () => '',
    })
    expect(rounds).toHaveLength(1)
    expect(rounds[0]!.findings[0]!.file).toBe('a.ts')
    rmSync(repo, { recursive: true, force: true })
  })

  it('🔴 열린 attempt 를 모르면 --close-stale 을 내지 않는다(없는 명령보다 낫다)', () => {
    const { repo, ticket } = setup()
    const inp = hardBlockedInput({
      root: repo,
      ticketRel: 'workflow/REQ-2026-001',
      ticketDir: ticket,
      reqId: 'REQ-2026-001',
      branch: null,
      kind: 'design',
      phaseId: null,
      openSeries: { series_id: 'design:-#1', attempts: 8 },
      hardCap: 8,
      attempt: 9,
      statusZ: () => '',
    })
    expect(inp.hasOpenAttempt).toBe(false)
    rmSync(repo, { recursive: true, force: true })
  })
})
