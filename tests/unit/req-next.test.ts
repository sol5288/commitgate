import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, rmSync, existsSync, utimesSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import spawn from 'cross-spawn'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  resolveNext,
  nextPhaseId,
  phaseModelProblems,
  reqIdProblems,
  targetProblems,
  ticketPathProblems,
  PHASE_ID_RE,
  nextExitCode,
  gitSubcommand,
  createReadOnlyGit,
  parseArgs,
  renderAction,
  READONLY_GIT_SUBCOMMANDS,
  NEXT_EXIT_CODES,
  type NextInput,
  type NextTarget,
} from '../../scripts/req/req-next'
import { captureDesignBinding } from '../../scripts/req/review-codex'
import type { WorkflowState } from '../../scripts/req/review-codex'
import type { GitAdapter } from '../../scripts/req/lib/adapters'

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const DESIGN_HASH = 'd'.repeat(64)

/** design 승인이 유효하고 phase 추적을 쓰는 신규 티켓의 기본 state. */
function baseState(over: Partial<WorkflowState> = {}): WorkflowState {
  return {
    id: 'REQ-2026-010',
    phase: 'INTAKE',
    branch: 'feat/req-2026-010-x',
    commit_allowed: false,
    design_approved: true,
    design_approved_hash: DESIGN_HASH,
    phases: [{ id: 'p1', approved: false }, { id: 'p2', approved: false }],
    approval_evidence_required: true,
    // REQ-2026-027: 기본 state는 **새 모델 티켓**이다(첫 리뷰 전에도 stamp됨). legacy 테스트는 이 필드를
    // 명시적으로 제거해 부재를 만든다. 이게 없으면 기존 모든 테스트가 legacy 분기로 빠진다(O1-5가 잡는 회귀).
    review_series_model_version: 1,
    ...over,
  } as WorkflowState
}

function baseInput(over: Partial<NextInput> = {}): NextInput {
  return {
    target: { kind: 'req', reqId: '2026-010' },
    state: baseState(),
    packageManager: 'npm',
    designDocsInIndex: true,
    currentDesignHash: DESIGN_HASH,
    hasStagedChanges: false,
    worktreeReviewClean: true,
    currentIndexHash: HASH_A,
    reviewBudget: { autoBudget: 5, hardCap: 8 },
    // REQ-2026-037: 기본은 never(현행 매 phase 정지) — 대부분의 기존 테스트가 이 무회귀 경로를 검증한다.
    phaseCommitAutoApprove: 'never',
    ...over,
  }
}

// ═══════════════════════════════════════════════════ 판정표 (D6) ══

describe('[req:next] 판정표 — 먼저 매치되는 분기가 이긴다', () => {
  it('1. commit_allowed=true (기본 never·정상 staged) → AWAIT_HUMAN (승인 문장 포함)', () => {
    // REQ-2026-037: 기본 정책 never + staged 존재 = 현행 무회귀 경로(매 phase 정지).
    const a = resolveNext(baseInput({ state: baseState({ commit_allowed: true }), hasStagedChanges: true }))
    expect(a.kind).toBe('AWAIT_HUMAN')
    expect(a.approvalSentence).toBe('req:commit --run 승인')
    expect(a.controlPoint).toContain('req:commit --run')
    expect(a.command).toContain('req:commit')
  })

  it('2. 설계 문서 미인덱스 → AGENT', () => {
    const a = resolveNext(baseInput({ designDocsInIndex: false, currentDesignHash: null }))
    expect(a.kind).toBe('AGENT')
    expect(a.detail).toContain('git add')
  })

  it('3. design 미승인 → RUN (--kind design)', () => {
    const a = resolveNext(baseInput({ state: baseState({ design_approved: false, design_approved_hash: null }) }))
    expect(a.kind).toBe('RUN')
    expect(a.command).toContain('--kind design')
    expect(a.command).not.toContain('--phase')
  })

  it('3. design stale(문서가 승인 후 변경) → RUN design', () => {
    const a = resolveNext(baseInput({ currentDesignHash: 'f'.repeat(64) }))
    expect(a.kind).toBe('RUN')
    expect(a.command).toContain('--kind design')
    expect(a.detail).toContain('stale')
  })

  it('4. phases[] 빈 + 신규 티켓 → AGENT (phase 분해)', () => {
    const a = resolveNext(baseInput({ state: baseState({ phases: [] }) }))
    expect(a.kind).toBe('AGENT')
    expect(a.detail).toContain('02-plan.md')
  })

  it('8. 미소비 phase + staged 없음 → AGENT (해당 phase 구현)', () => {
    const a = resolveNext(baseInput({ hasStagedChanges: false }))
    expect(a.kind).toBe('AGENT')
    expect(a.detail).toContain('p1')
  })

  it('9. 미소비 phase + staged 있음 → RUN (--phase <첫 미소비>)', () => {
    const a = resolveNext(baseInput({ hasStagedChanges: true }))
    expect(a.kind).toBe('RUN')
    expect(a.command).toContain('--kind phase')
    expect(a.command).toContain('--phase p1')
  })

  it('10. 전 phase consumed + clean → DONE (통합은 사람이 결정)', () => {
    const state = baseState({
      consumed_approvals: [{ phase_id: 'p1' }, { phase_id: 'p2' }],
    } as Partial<WorkflowState>)
    const a = resolveNext(baseInput({ state }))
    expect(a.kind).toBe('DONE')
    expect(a.detail).toContain('[I1]')
    expect(a.detail).toContain('[B1]')
  })

  it('fallback. 전 phase consumed + 워킹트리 dirty → BLOCKED (조용한 DONE 금지)', () => {
    const state = baseState({ consumed_approvals: [{ phase_id: 'p1' }, { phase_id: 'p2' }] } as Partial<WorkflowState>)
    const a = resolveNext(baseInput({ state, worktreeReviewClean: false }))
    expect(a.kind).toBe('BLOCKED')
    expect(a.diagnostics?.length).toBeGreaterThan(0)
  })

  it('fallback. phases[] 빈 + approval_evidence_required=false → BLOCKED (신규/레거시 구분 불가)', () => {
    const a = resolveNext(baseInput({ state: baseState({ phases: [], approval_evidence_required: false }) }))
    expect(a.kind).toBe('BLOCKED')
  })

  /**
   * design R2 — **진행도 정본은 consumed_approvals이지 phases[].approved가 아니다.**
   * `applyVerdict`는 approved를 true로만 토글하고 되돌리지 않는다(sticky). 승인 후 재리뷰가 NEEDS_FIX면
   * commit_allowed=false인데 approved는 true로 남는다. approved 기준으로 세면 대상이 0개가 되어 판정이 무너진다.
   */
  it('sticky approved 회귀: p1.approved=true인데 미소비면 여전히 p1이 대상', () => {
    const state = baseState({
      phases: [{ id: 'p1', approved: true }, { id: 'p2', approved: false }],
      consumed_approvals: [],
    } as Partial<WorkflowState>)
    expect(nextPhaseId(state)).toBe('p1')
    const a = resolveNext(baseInput({ state, hasStagedChanges: true }))
    expect(a.kind).toBe('RUN')
    expect(a.command).toContain('--phase p1')
  })

  it('consumed된 phase는 approved 플래그와 무관하게 건너뛴다', () => {
    const state = baseState({
      phases: [{ id: 'p1', approved: false }, { id: 'p2', approved: false }],
      consumed_approvals: [{ phase_id: 'p1' }],
    } as Partial<WorkflowState>)
    expect(nextPhaseId(state)).toBe('p2')
  })
})

/**
 * phase-2 R1 P2 — **조용한 DONE 차단.**
 *
 * `nextPhaseId`가 `null`을 반환하면 "모든 phase가 소비됨"으로 읽힌다. 그런데 `phases[]`가 신뢰할 수 없으면
 * 그 `null`은 거짓말이다. 두 경로가 있다:
 *   1. 중복 id — `consumed_approvals`에 `p1` 1건만 있어도 `[p1, p1]` 두 항목이 모두 소비 처리된다.
 *   2. malformed 항목 — `readPhases`가 걸러내 배열이 비어 보인다(그러나 rawLen>0이라 레거시 분기로도 안 간다).
 *
 * 둘 다 `BLOCKED`(fail-closed)여야 한다. state는 사람이 고친다.
 */
describe('[req:next] phases[] 무결성 — 판정 전에 fail-closed', () => {
  it('중복 id + 소비 1건 → DONE이 아니라 BLOCKED (Codex 재현 시나리오)', () => {
    const state = baseState({
      phases: [{ id: 'p1', approved: false }, { id: 'p1', approved: false }],
      consumed_approvals: [{ phase_id: 'p1' }],
      commit_allowed: false,
    } as Partial<WorkflowState>)
    const a = resolveNext(baseInput({ state, hasStagedChanges: false, worktreeReviewClean: true }))
    expect(a.kind).toBe('BLOCKED')
    expect(a.diagnostics?.join('\n')).toContain('중복')
    expect(a.diagnostics?.join('\n')).toContain('p1')
  })

  it('중복 id는 살아 있는 승인(commit_allowed=true)보다도 먼저 막는다', () => {
    const state = baseState({
      phases: [{ id: 'p1', approved: false }, { id: 'p1', approved: false }],
      commit_allowed: true,
    } as Partial<WorkflowState>)
    // 손상된 state에서 "커밋을 승인하라"고 말하면 엉뚱한 phase가 소비될 수 있다.
    expect(resolveNext(baseInput({ state })).kind).toBe('BLOCKED')
  })

  it('malformed 항목(문자열 id 없음) → BLOCKED', () => {
    const state = baseState({ phases: [{ id: 'p1', approved: false }, { weird: 1 }] } as unknown as Partial<WorkflowState>)
    const a = resolveNext(baseInput({ state }))
    expect(a.kind).toBe('BLOCKED')
    expect(a.diagnostics?.join('\n')).toContain('형식이 잘못된')
  })

  it('전부 malformed여도 레거시로 강등되지 않는다(rawLen>0)', () => {
    const state = baseState({ phases: [{ weird: 1 }, { weird: 2 }] } as unknown as Partial<WorkflowState>)
    expect(resolveNext(baseInput({ state })).kind).toBe('BLOCKED')
  })

  /**
   * phase-2 R2 P2 — 재현 1: `phases`가 배열이 아니면 `Array.isArray` 실패로 `rawLen=0`이 되어
   * **레거시로 오분류**된다. 소비 이력만 있으면 조용히 `DONE`이 나온다.
   */
  it('phases가 배열이 아님(객체) + 레거시처럼 보임 → DONE이 아니라 BLOCKED', () => {
    const s = baseState({ phases: { id: 'p1' }, consumed_approvals: [{ phase_id: null }] } as unknown as Partial<WorkflowState>)
    delete (s as Record<string, unknown>).approval_evidence_required
    const a = resolveNext(baseInput({ state: s, hasStagedChanges: false, worktreeReviewClean: true }))
    expect(a.kind).toBe('BLOCKED')
    expect(a.diagnostics?.join('\n')).toContain('배열이 아니다')
  })

  it('phases: null → BLOCKED', () => {
    const s = baseState({ phases: null } as unknown as Partial<WorkflowState>)
    expect(resolveNext(baseInput({ state: s })).kind).toBe('BLOCKED')
  })

  /**
   * phase-2 R2 P2 — 재현 2: `id: ''`는 `readPhases`를 통과하지만 `--phase` 인자로 쓸 수 없다.
   * 옛 `reviewCmd`는 falsy라 `--phase`를 빠뜨린 RUN을 지시했고, 그 명령은 `resolvePhaseTarget`에서 죽는다.
   */
  it('빈 문자열 id + staged → --phase 없는 RUN이 아니라 BLOCKED', () => {
    const s = baseState({ phases: [{ id: '', approved: false }] } as Partial<WorkflowState>)
    const a = resolveNext(baseInput({ state: s, hasStagedChanges: true }))
    expect(a.kind).toBe('BLOCKED')
    expect(a.diagnostics?.join('\n')).toContain('비어 있는')
  })

  it('공백만인 id도 빈 id로 본다', () => {
    const s = baseState({ phases: [{ id: '   ', approved: false }] } as Partial<WorkflowState>)
    expect(resolveNext(baseInput({ state: s, hasStagedChanges: true })).kind).toBe('BLOCKED')
  })

  /**
   * phase-2 R3 P2 — `req:next`는 **실행 불가능한 `RUN`**을 지시해선 안 된다.
   * `--phase --bad` → `review-codex`의 `parseArgs`가 값 누락으로 throw.
   * 공백 포함 id → `renderAction`의 `.join(' ')`에서 argv 경계가 깨진다.
   */
  it.each([
    ['선행 대시', '--bad'],
    ['단일 대시', '-x'],
    ['공백 포함', 'phase 1'],
    ['따옴표', 'a"b'],
    ['슬래시', 'a/b'],
  ])('CLI-불안전 id(%s) + staged → RUN이 아니라 BLOCKED', (_l, id) => {
    const s = baseState({ phases: [{ id, approved: false }] } as Partial<WorkflowState>)
    const a = resolveNext(baseInput({ state: s, hasStagedChanges: true }))
    expect(a.kind).toBe('BLOCKED')
    expect(a.diagnostics?.join('\n')).toContain('안전하지 않다')
  })

  it('실제 사용 중인 phase id 형식은 안전하다', () => {
    for (const id of ['phase-1a-persona-install', 'phase-2-req-next', 'p1', 'phase-3b.entrypoint_uninstall'])
      expect(PHASE_ID_RE.test(id)).toBe(true)
  })

  /**
   * phase-2 R4 P2 — 같은 결함 class가 **다른 필드**에 남아 있었다.
   * `main()`은 CLI 인자가 아니라 `state.id.replace(/^REQ-/, '')`를 reqId로 쓴다. state가 손상되면
   * `req:next`가 **엉뚱한 티켓을 대상으로 하는** 명령을 지시한다.
   */
  it.each([
    ['공백 포함 (다른 티켓이 대상이 됨)', 'REQ-2026-010 bad', '2026-010 bad'],
    ['strip 후 선행 대시 (unknown option)', 'REQ---bad', '--bad'],
    ['세미콜론', 'REQ-2026-010;x', '2026-010;x'],
    ['따옴표', 'REQ-2026"010', '2026"010'],
  ])('state.id가 argv-불안전(%s) → RUN이 아니라 BLOCKED', (_l, stateId, derived) => {
    const s = baseState({ id: stateId, phases: [{ id: 'p1', approved: false }] } as Partial<WorkflowState>)
    const a = resolveNext(baseInput({ target: { kind: 'req', reqId: derived }, state: s, hasStagedChanges: true }))
    expect(a.kind).toBe('BLOCKED')
    expect(a.diagnostics?.join('\n')).toContain('REQ id')
    expect(a.command).toBeUndefined()
  })

  it('argv-불안전 reqId는 AWAIT_HUMAN(커밋 승인)보다도 먼저 막는다', () => {
    const s = baseState({ id: 'REQ-2026-010 bad', commit_allowed: true } as Partial<WorkflowState>)
    const a = resolveNext(baseInput({ target: { kind: 'req', reqId: '2026-010 bad' }, state: s }))
    expect(a.kind).toBe('BLOCKED')
    expect(a.approvalSentence).toBeUndefined()
  })

  it('reqIdProblems: 정상 REQ id는 문제 없음', () => {
    expect(reqIdProblems('2026-010')).toEqual([])
    expect(reqIdProblems('2026-001')).toEqual([])
  })

  /**
   * phase-2 R5 P2 — **target identity.**
   * argv-safe만으로는 부족하다. 렌더링한 명령이 **방금 판정한 그 티켓**을 가리켜야 한다.
   */
  it.each([
    ['다른 번호', 'REQ-2026-999'],
    ['비표준 id', 'REQ-bad'],
  ])('기본 위치 실행 + state.id 불일치(%s) → RUN이 아니라 BLOCKED', (_l, stateId) => {
    // argv-safe하지만(REQ-2026-999 → 2026-999) 요청한 티켓이 아니다.
    const s = baseState({ id: stateId, phases: [{ id: 'p1', approved: false }] } as Partial<WorkflowState>)
    const a = resolveNext(baseInput({ target: { kind: 'req', reqId: '2026-010' }, state: s, hasStagedChanges: true }))
    expect(a.kind).toBe('BLOCKED')
    expect(a.diagnostics?.join('\n')).toContain('요청한 티켓')
    expect(a.command).toBeUndefined()
  })

  it('state.id 불일치는 AWAIT_HUMAN(커밋 승인)보다도 먼저 막는다', () => {
    const s = baseState({ id: 'REQ-2026-999', commit_allowed: true } as Partial<WorkflowState>)
    const a = resolveNext(baseInput({ target: { kind: 'req', reqId: '2026-010' }, state: s }))
    expect(a.kind).toBe('BLOCKED')
    expect(a.approvalSentence).toBeUndefined()
  })

  it('--ticket으로 읽었으면 후속 명령도 --ticket을 보존한다(다른 티켓 리뷰 방지)', () => {
    const t: NextTarget = { kind: 'ticket', ticketDir: 'workflow/archive/REQ-2026-010' }
    const run = resolveNext(baseInput({ target: t, state: baseState({ id: 'REQ-2026-010' }), hasStagedChanges: true }))
    expect(run.kind).toBe('RUN')
    expect(run.command).toContain('--ticket workflow/archive/REQ-2026-010')
    expect(run.command).not.toMatch(/--\s+2026-010\s/) // positional reqId를 쓰지 않는다

    const await_ = resolveNext(baseInput({ target: t, state: baseState({ commit_allowed: true }), hasStagedChanges: true }))
    expect(await_.kind).toBe('AWAIT_HUMAN')
    expect(await_.command).toContain('--ticket workflow/archive/REQ-2026-010')
  })

  it('--ticket 모드에서는 state.id를 identity로 강제하지 않는다(아카이브 위치 허용)', () => {
    const t: NextTarget = { kind: 'ticket', ticketDir: 'workflow/archive/REQ-2026-010' }
    const a = resolveNext(baseInput({ target: t, state: baseState({ id: 'REQ-anything' }), hasStagedChanges: true }))
    expect(a.kind).toBe('RUN')
  })

  it.each([
    ['공백 포함', 'work flow/REQ-2026-010'],
    ['선행 대시', '--ticket-ish'],
    ['따옴표', 'workflow/"x"'],
    ['세미콜론', 'workflow/x;rm'],
    ['명령 치환', 'workflow/$(id)'],
    ['백틱', 'workflow/`id`'],
    ['파이프', 'workflow/a|b'],
    ['빈 문자열', ''],
  ])('--ticket 경로가 CLI-불안전(%s) → BLOCKED', (_l, dir) => {
    const a = resolveNext(baseInput({ target: { kind: 'ticket', ticketDir: dir }, hasStagedChanges: true }))
    expect(a.kind).toBe('BLOCKED')
    expect(a.diagnostics?.join('\n')).toContain('--ticket 경로')
    expect(a.command).toBeUndefined()
  })

  /**
   * phase-2 R6 P2 — 화이트리스트는 **정상 경로를 막는다**(false BLOCKED).
   * Windows drive 절대경로·POSIX 절대경로·dot-relative는 전부 유효한 `--ticket` 값이다.
   */
  it.each([
    ['repo-상대', 'workflow/REQ-2026-010'],
    ['dot-relative(POSIX)', './workflow/REQ-2026-010'],
    ['dot-relative(Windows)', '.\\workflow\\REQ-2026-010'],
    ['POSIX 절대경로', '/tmp/tickets/REQ-2026-010'],
    ['Windows drive 절대경로', 'D:\\1_projects\\61_commitgate\\workflow\\REQ-2026-010'],
    ['UNC', '\\\\server\\share\\REQ-2026-010'],
  ])('정상 --ticket 경로(%s)는 RUN을 내고 그대로 보존된다', (_l, dir) => {
    expect(ticketPathProblems(dir)).toEqual([])
    const a = resolveNext(baseInput({ target: { kind: 'ticket', ticketDir: dir }, hasStagedChanges: true }))
    expect(a.kind).toBe('RUN')
    expect(a.command).toContain(`--ticket ${dir}`)
  })

  it('정상 --ticket 절대경로는 AWAIT_HUMAN 명령에도 보존된다', () => {
    const dir = 'D:\\proj\\workflow\\REQ-2026-010'
    const a = resolveNext(baseInput({ target: { kind: 'ticket', ticketDir: dir }, state: baseState({ commit_allowed: true }), hasStagedChanges: true }))
    expect(a.kind).toBe('AWAIT_HUMAN')
    expect(a.command).toContain(`--ticket ${dir}`)
  })

  it('targetProblems: 정상 target은 문제 없음', () => {
    expect(targetProblems({ kind: 'req', reqId: '2026-010' }, baseState())).toEqual([])
    expect(targetProblems({ kind: 'ticket', ticketDir: 'workflow/REQ-2026-010' }, baseState())).toEqual([])
  })

  it('phaseModelProblems: 정상 phases[]는 문제 없음', () => {
    expect(phaseModelProblems(baseState())).toEqual([])
  })

  it('phaseModelProblems: 빈 배열/부재는 여기서 판단하지 않는다(레거시·미분해는 다른 분기)', () => {
    expect(phaseModelProblems(baseState({ phases: [] }))).toEqual([])
    const noPhases = baseState()
    delete (noPhases as Record<string, unknown>).phases
    expect(phaseModelProblems(noPhases)).toEqual([])
  })
})

// ═════════════════════════════════════════════ 레거시 티켓 (5~7) ══

describe('[req:next] 레거시 티켓 — approval_evidence_required 필드 부재', () => {
  const legacy = (over: Partial<WorkflowState> = {}): WorkflowState => {
    const s = baseState({ phases: [], ...over })
    delete (s as Record<string, unknown>).approval_evidence_required
    return s
  }

  it('5. legacy + staged 있음 → RUN (--phase 없이)', () => {
    const a = resolveNext(baseInput({ state: legacy(), hasStagedChanges: true }))
    expect(a.kind).toBe('RUN')
    expect(a.command).toContain('--kind phase')
    expect(a.command).not.toContain('--phase ')
  })

  it('6. legacy + staged 없음 + 소비 이력 없음 → AGENT', () => {
    const a = resolveNext(baseInput({ state: legacy(), hasStagedChanges: false }))
    expect(a.kind).toBe('AGENT')
  })

  /**
   * design R2 P2-A — 레거시는 `phases[]`가 비어 "전부 consumed"가 vacuous truth다.
   * 5번이 무조건 먼저 매치되면 커밋 소비 후에도 phase 리뷰로 되돌아가 DONE에 영영 도달하지 못한다.
   */
  it('7. legacy + staged 없음 + 소비 이력 있음 + clean → DONE (도구가 남은 phase를 모른다고 명시)', () => {
    const state = legacy({ consumed_approvals: [{ phase_id: null }] } as Partial<WorkflowState>)
    const a = resolveNext(baseInput({ state, hasStagedChanges: false }))
    expect(a.kind).toBe('DONE')
    expect(a.detail).toContain('알 수 없다')
    expect(a.detail).toContain('02-plan.md')
  })

  it('legacy + 소비 이력 있음 + dirty → BLOCKED', () => {
    const state = legacy({ consumed_approvals: [{ phase_id: null }] } as Partial<WorkflowState>)
    const a = resolveNext(baseInput({ state, hasStagedChanges: false, worktreeReviewClean: false }))
    expect(a.kind).toBe('BLOCKED')
  })
})

// ═══════════════════════════════════════════════════════ G1 / G2 ══

describe('[req:next] G1 — D10 전제(워킹트리 clean)를 RUN 조건에 반영', () => {
  it('staged 있음 + unstaged/untracked 있음 → RUN이 아니라 AGENT', () => {
    const a = resolveNext(baseInput({ hasStagedChanges: true, worktreeReviewClean: false }))
    expect(a.kind).toBe('AGENT')
    expect(a.detail).toContain('D10')
    expect(a.command).toBeUndefined()
  })

  it('design RUN 후보에도 G1이 걸린다', () => {
    const a = resolveNext(
      baseInput({ state: baseState({ design_approved: false }), worktreeReviewClean: false }),
    )
    expect(a.kind).toBe('AGENT')
    expect(a.detail).toContain('D10')
  })
})

describe('[req:next] G2 — 바인딩 신선도(outcome-aware)', () => {
  const withLastReview = (outcome: string, over: Record<string, unknown> = {}): NextInput =>
    baseInput({
      hasStagedChanges: true,
      state: baseState({
        last_review: { review_kind: 'phase', phase_id: 'p1', outcome, compare_hash: HASH_A, count: 1, errors: [], at: 'T', ...over },
      } as Partial<WorkflowState>),
    })

  it('needs-fix + 같은 바인딩 → AGENT (무한 재리뷰 루프 차단)', () => {
    const a = resolveNext(withLastReview('needs-fix'))
    expect(a.kind).toBe('AGENT')
    expect(a.detail).toContain('NEEDS_FIX')
  })

  it('blocked + 같은 바인딩 → BLOCKED (findings 0건에 "수정하라"는 지시 금지)', () => {
    const a = resolveNext(withLastReview('blocked'))
    expect(a.kind).toBe('BLOCKED')
    expect(a.detail).not.toContain('findings를 수정')
  })

  it('blocked 분기는 --fresh-thread를 자동 지시하지 않는다 (회로차단기 무력화 방지)', () => {
    const a = resolveNext(withLastReview('blocked'))
    expect(a.command).toBeUndefined()
    const text = [a.detail, ...(a.diagnostics ?? [])].join('\n')
    // 사람이 판단할 수 있다는 안내는 있되, 실행 명령으로 주지 않는다.
    expect(text).toContain('사람')
  })

  it('invalid + count=1 → RUN (1회 재시도)', () => {
    const a = resolveNext(withLastReview('invalid', { count: 1, errors: ['/status bad'] }))
    expect(a.kind).toBe('RUN')
    expect(a.detail).toContain('재시도')
  })

  it('invalid + count>=2 → BLOCKED + 저장된 errors 출력', () => {
    const a = resolveNext(withLastReview('invalid', { count: 2, errors: ['/status must be equal to one of', '/findings bad'] }))
    expect(a.kind).toBe('BLOCKED')
    expect(a.diagnostics).toContain('/status must be equal to one of')
  })

  it('approved + 같은 바인딩 → BLOCKED (방어적 — 1번에서 걸러져 도달 불가)', () => {
    const a = resolveNext(withLastReview('approved'))
    expect(a.kind).toBe('BLOCKED')
  })

  it.each(['needs-fix', 'blocked', 'invalid', 'approved'])(
    '바인딩이 바뀌면(%s여도) RUN — stale 마커가 진행을 막지 않는다',
    (outcome) => {
      const input = withLastReview(outcome, { compare_hash: HASH_B })
      const a = resolveNext(input)
      expect(a.kind).toBe('RUN')
    },
  )

  it('last_review 부재(구 state) → RUN (fail-forward)', () => {
    const a = resolveNext(baseInput({ hasStagedChanges: true }))
    expect(a.kind).toBe('RUN')
  })

  it('phase_id가 다르면 매치되지 않는다', () => {
    const input = withLastReview('needs-fix', { phase_id: 'p2' })
    expect(resolveNext(input).kind).toBe('RUN')
  })

  it('review_kind가 다르면 매치되지 않는다', () => {
    const input = withLastReview('needs-fix', { review_kind: 'design' })
    expect(resolveNext(input).kind).toBe('RUN')
  })

  it('currentIndexHash를 계산하지 못하면(null) G2를 건너뛴다(fail-forward)', () => {
    const input = { ...withLastReview('needs-fix'), currentIndexHash: null }
    expect(resolveNext(input).kind).toBe('RUN')
  })

  /**
   * design R5 P2 — `req:next`는 `blocked_review`를 읽지 않는다.
   * 그 마커의 `review_binding`은 tree OID라 write-tree 없이 재계산할 수 없어 stale 판정이 불가능하다.
   * 강제는 `review-codex`의 `shouldShortCircuitBlockedReview`가 계속 담당한다(codex 호출 없이 exit 2).
   */
  it('blocked_review.count>=2가 있어도 compare_hash가 다르면 RUN', () => {
    const state = baseState({
      blocked_review: { review_kind: 'phase', phase_id: 'p1', review_base_sha: 'x', review_binding: 'TREE', count: 5, response_sha256: null, blocked_at: 'T' },
      last_review: { review_kind: 'phase', phase_id: 'p1', outcome: 'blocked', compare_hash: HASH_B, count: 5, errors: [], at: 'T' },
    } as Partial<WorkflowState>)
    const a = resolveNext(baseInput({ state, hasStagedChanges: true, currentIndexHash: HASH_A }))
    expect(a.kind).toBe('RUN')
  })
})

// ══════════════════════════════════════════ 읽기 전용 계약 (D6-1) ══

describe('[req:next] git allowlist + --no-optional-locks', () => {
  const recorder = (): { adapter: GitAdapter; calls: string[][] } => {
    const calls: string[][] = []
    return { calls, adapter: { exec: (args) => (calls.push(args), '') } }
  }

  it('모든 호출에 --no-optional-locks가 맨 앞에 붙는다', () => {
    const { adapter, calls } = recorder()
    const g = createReadOnlyGit(adapter)
    g(['status', '--porcelain'])
    g(['-c', 'core.quotePath=false', 'status'])
    g(['ls-files', '-s'])
    for (const c of calls) expect(c[0]).toBe('--no-optional-locks')
  })

  it.each([...READONLY_GIT_SUBCOMMANDS])('허용 subcommand: %s', (sub) => {
    const { adapter } = recorder()
    expect(() => createReadOnlyGit(adapter)([sub])).not.toThrow()
  })

  it.each(['write-tree', 'add', 'commit', 'checkout', 'reset', 'stash', 'gc', 'hash-object'])(
    '금지 subcommand %s → throw (실행 전에 막는다)',
    (sub) => {
      const { adapter, calls } = recorder()
      expect(() => createReadOnlyGit(adapter)([sub])).toThrow(/읽기 전용/)
      expect(calls).toHaveLength(0)
    },
  )

  it('전역 플래그를 걷어내고 subcommand를 찾는다', () => {
    expect(gitSubcommand(['--no-optional-locks', '-c', 'core.quotePath=false', 'status', '--porcelain'])).toBe('status')
    expect(gitSubcommand(['-c', 'a=b', 'ls-files', '-s'])).toBe('ls-files')
    expect(gitSubcommand(['--no-optional-locks'])).toBeNull()
    // `-c`가 값을 먹으므로 그 값이 subcommand로 오인되지 않는다.
    expect(gitSubcommand(['-c', 'write-tree', 'status'])).toBe('status')
  })

  it('captureGitBinding 경로(write-tree)를 실수로 끌어 써도 즉시 터진다', () => {
    const { adapter } = recorder()
    expect(() => createReadOnlyGit(adapter)(['write-tree'])).toThrow()
  })
})

/**
 * no-write 회귀 (design R2 P2-B).
 *
 * `git status`·`git diff --cached`는 stat cache 갱신으로 `.git/index`를 **다시 쓴다.**
 * stat cache가 clean한 repo에서는 `--no-optional-locks` 없이도 우연히 통과하므로,
 * **mtime만 바꿔 stat cache를 dirty하게 만든 뒤** 실행하는 것이 이 테스트의 요점이다.
 */
describe('[req:next] no-write 회귀 — .git/index·objects·state.json 불변', () => {
  const snapshot = (repo: string): Record<string, string> => {
    const out: Record<string, string> = {}
    const walk = (abs: string, rel: string): void => {
      for (const e of readdirSync(abs)) {
        const a = join(abs, e)
        const r = rel ? `${rel}/${e}` : e
        if (statSync(a).isDirectory()) walk(a, r)
        else out[r] = readFileSync(a).toString('base64')
      }
    }
    walk(join(repo, '.git', 'objects'), 'objects')
    out['index'] = readFileSync(join(repo, '.git', 'index')).toString('base64')
    return out
  }

  it('stat cache가 dirty한 repo에서 req:next를 돌려도 .git/index·objects·state.json이 그대로다', () => {
    const repo = mkdtempSync(join(tmpdir(), 'reqnext-nowrite-'))
    try {
      const git = (args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' })
      git(['init', '-q'])
      git(['config', 'user.email', 't@t.t'])
      git(['config', 'user.name', 't'])
      writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.0' }))
      writeFileSync(join(repo, 'req.config.json'), JSON.stringify({ packageManager: 'npm' }))

      const ticket = join(repo, 'workflow', 'REQ-2026-001')
      mkdirSync(ticket, { recursive: true })
      for (const f of ['00-requirement.md', '01-design.md', '02-plan.md']) writeFileSync(join(ticket, f), `# ${f}\n`)
      writeFileSync(
        join(ticket, 'state.json'),
        // REQ-2026-027: 새 모델 티켓 fixture — review_series_model_version 없으면 legacy(AWAIT_HUMAN)로 빠진다.
        JSON.stringify({ id: 'REQ-2026-001', phase: 'INTAKE', phases: [], approval_evidence_required: true, review_series_model_version: 1 }, null, 2) + '\n',
      )
      git(['add', '-A'])
      git(['commit', '-qm', 'baseline'])

      // stat cache를 dirty하게: 내용은 그대로, mtime만 미래로.
      const bumped = join(ticket, '01-design.md')
      const future = new Date(Date.now() + 60_000)
      utimesSync(bumped, future, future)
      git(['status', '--porcelain']) // 여기서 index가 갱신될 수 있으므로 스냅샷은 이 다음에 찍는다
      const before = snapshot(repo)
      const stateBefore = readFileSync(join(ticket, 'state.json'), 'utf8')
      utimesSync(bumped, future, future) // 다시 dirty하게

      const reqNext = join(PACKAGE_ROOT, 'scripts', 'req', 'req-next.ts')
      expect(existsSync(reqNext)).toBe(true)
      const r = spawn.sync('npx', ['tsx', reqNext, '2026-001', '--root', repo, '--json'], {
        cwd: PACKAGE_ROOT,
        encoding: 'utf8',
        stdio: 'pipe',
      })

      // ⚠️ 위양성 방지: req:next가 즉시 크래시해도 "아무것도 안 썼으니" 스냅샷 비교는 통과한다.
      //    실제로 판정까지 갔음을 먼저 단언한다. (이 픽스처는 design 미승인 → RUN design, exit 0)
      expect(r.error ?? null).toBeNull()
      expect(r.status, `req:next 실패 — stderr: ${r.stderr}`).toBe(0)
      const parsed = JSON.parse(r.stdout) as { kind: string; command?: string }
      expect(parsed.kind).toBe('RUN')
      expect(parsed.command).toContain('--kind design')

      expect(snapshot(repo)).toEqual(before)
      expect(readFileSync(join(ticket, 'state.json'), 'utf8')).toBe(stateBefore)
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  }, 60_000)
})

// ══════════════════════════════════════════════════ exit 계약 / CLI ══

describe('[req:next] exit 계약', () => {
  it('RUN/AGENT=0, BLOCKED=2, AWAIT_HUMAN=10, DONE=11', () => {
    expect(NEXT_EXIT_CODES).toEqual({ RUN: 0, AGENT: 0, BLOCKED: 2, AWAIT_HUMAN: 10, DONE: 11 })
    expect(nextExitCode('RUN')).toBe(0)
    expect(nextExitCode('AWAIT_HUMAN')).toBe(10)
    expect(nextExitCode('DONE')).toBe(11)
    expect(nextExitCode('BLOCKED')).toBe(2)
  })
})

describe('[req:next] CLI 파싱 / 출력', () => {
  it('reqId·--json·--root·--ticket', () => {
    expect(parseArgs(['2026-010'])).toMatchObject({ reqId: '2026-010', json: false })
    expect(parseArgs(['2026-010', '--json']).json).toBe(true)
    expect(parseArgs(['--root', '/r']).root).toBe('/r')
    expect(parseArgs(['--ticket', '/t']).ticket).toBe('/t')
  })

  it('알 수 없는 옵션 → throw(조용한 무시 금지)', () => {
    expect(() => parseArgs(['--bogus'])).toThrow()
  })

  it('--root 값 누락 → throw', () => {
    expect(() => parseArgs(['--root'])).toThrow()
  })

  it('AWAIT_HUMAN 출력에 통제점과 승인 문장이 그대로 보인다', () => {
    const a = resolveNext(baseInput({ state: baseState({ commit_allowed: true }), hasStagedChanges: true }))
    const text = renderAction('REQ-2026-010', a)
    expect(text).toContain('AWAIT_HUMAN')
    expect(text).toContain('승인 문장: "req:commit --run 승인"')
  })

  it('RUN 출력에 실행 명령이 보인다', () => {
    const text = renderAction('REQ-2026-010', resolveNext(baseInput({ hasStagedChanges: true })))
    expect(text).toContain('$ npm run req:review-codex -- 2026-010 --kind phase --phase p1 --run')
  })
})

// REQ-2026-027 phase-1 — legacy 판정(D1). 모델 버전 부재 = legacy → req:next는 RUN이 아니라 AWAIT_HUMAN.
describe('REQ-2026-027 — legacy ticket 안내(resolveNext)', () => {
  /** baseState에서 review_series_model_version을 제거해 legacy state를 만든다. */
  const legacyState = (over: Partial<WorkflowState> = {}): WorkflowState => {
    const s = baseState(over) as Record<string, unknown>
    delete s.review_series_model_version
    return s as WorkflowState
  }

  it('O1-2: legacy + design 미승인 + 워킹트리 clean → RUN이 아니라 AWAIT_HUMAN', () => {
    const a = resolveNext(
      baseInput({ state: legacyState({ design_approved: false, design_approved_hash: null }), worktreeReviewClean: true }),
    )
    expect(a.kind).toBe('AWAIT_HUMAN')
    expect(a.controlPoint).toBe('legacy 티켓 채택')
    expect(a.approvalSentence).toContain('review_series_model_version: 1')
  })

  it('O1-2: legacy는 phase RUN 상태에서도 AWAIT_HUMAN (호출 안내를 내지 않는다)', () => {
    // 정상이면 phase RUN이 나올 state(staged 변경). legacy면 그 앞에서 가로챈다.
    const a = resolveNext(baseInput({ state: legacyState(), hasStagedChanges: true }))
    expect(a.kind).toBe('AWAIT_HUMAN')
  })

  it('O1-5: 살아 있는 승인(commit_allowed)은 legacy보다 우선한다 — 소비만, 새 호출 아님', () => {
    const a = resolveNext(baseInput({ state: legacyState({ commit_allowed: true }), hasStagedChanges: true }))
    expect(a.kind).toBe('AWAIT_HUMAN')
    expect(a.approvalSentence).toBe('req:commit --run 승인') // legacy 안내가 아니라 commit 안내
  })

  it('O1-4: 새 모델 티켓(모델 버전 있음, series 레코드 없음)은 legacy가 아니다 — 종전 판정', () => {
    // baseState는 이미 review_series_model_version=1이고 review_series는 없다. design 미승인 → design RUN.
    const a = resolveNext(baseInput({ state: baseState({ design_approved: false, design_approved_hash: null }) }))
    expect(a.kind).toBe('RUN')
    expect(a.command).toContain('--kind design')
  })

  it('O1-5: 새 모델 정상 티켓의 기존 분기(design RUN·phase RUN·commit)는 무변경', () => {
    expect(resolveNext(baseInput({ state: baseState({ commit_allowed: true }) })).kind).toBe('AWAIT_HUMAN')
    expect(resolveNext(baseInput({ state: baseState({ design_approved: false, design_approved_hash: null }) })).command).toContain('--kind design')
    expect(resolveNext(baseInput({ hasStagedChanges: true })).command).toContain('--kind phase')
  })
})

// REQ-2026-028 phase-2 — G3 예산 소진 안내(resolveNext). 우선순위 G1→G3→G2.
describe('REQ-2026-028 — G3 예산 소진 안내(resolveNext)', () => {
  /** 열린 phase series(attempts)를 심는다. phase p1 RUN 경로가 나오는 baseState 기반. */
  const withOpenSeries = (attempts: number, over: Partial<WorkflowState> = {}): WorkflowState =>
    baseState({ review_series: [{ series_id: 'phase:p1#1', review_kind: 'phase', phase_id: 'p1', attempts, closed_reason: null }], ...over } as Partial<WorkflowState>)

  it('O2-1 🔴 escalated → AWAIT_HUMAN + 실제 시도 수·실제 outcome·선택지 내용(phase-2 r03 P1)', () => {
    const state = withOpenSeries(5, {
      last_review: { review_kind: 'phase', phase_id: 'p1', outcome: 'needs-fix', compare_hash: 'HH', count: 1, errors: [], at: 'T', findings: [] },
    } as Partial<WorkflowState>)
    const a = resolveNext(baseInput({ state, hasStagedChanges: true }))
    expect(a.kind).toBe('AWAIT_HUMAN')
    expect(a.controlPoint).toBe('review 예산 소진(escalated)')
    const diag = a.diagnostics?.join(' ') ?? ''
    // 🔴 라벨 존재가 아니라 **실제 값**을 단언 — =0·(없음)으로 고정하면 실패한다.
    expect(diag).toContain('openAttempts)=5')
    expect(diag).toContain('다음 회차=6')
    expect(diag).toContain('직전 리뷰 outcome=needs-fix')
    // 선택지 내용까지 — soft-escalated는 예외·종료·대체 REQ.
    expect(diag).toContain('선택지:')
    expect(diag).toContain('예외 가능')
    expect(diag).toContain('종료')
    expect(diag).toContain('대체 REQ')
  })

  it('O2-2 🔴 G3가 G2보다 앞선다 — escalated + 같은 바인딩 needs-fix 동시 성립', () => {
    // 5회차 NEEDS_FIX 직후: escalated이고 last_review가 같은 compare_hash로 needs-fix. G2가 먼저면 AGENT.
    const state = withOpenSeries(5, {
      last_review: { review_kind: 'phase', phase_id: 'p1', outcome: 'needs-fix', compare_hash: HASH_A, count: 1, errors: [], at: 'T', findings: [] },
    } as Partial<WorkflowState>)
    const a = resolveNext(baseInput({ state, hasStagedChanges: true, currentIndexHash: HASH_A }))
    expect(a.kind).toBe('AWAIT_HUMAN') // G3 승 — G2의 AGENT가 아니다
  })

  it('O2-3 G1이 G3보다 앞선다 — 워킹트리 dirty + escalated → AGENT(정리 먼저)', () => {
    const a = resolveNext(baseInput({ state: withOpenSeries(5), hasStagedChanges: true, worktreeReviewClean: false }))
    expect(a.kind).toBe('AGENT')
  })

  it('O2-4 🔴 정상 series(attempts<autoBudget)는 G2 무변경 — RUN + 경계값 same-binding NEEDS_FIX→AGENT', () => {
    // attempts=2면 escalated 아님. staged 있으면 종전대로 phase RUN.
    const a = resolveNext(baseInput({ state: withOpenSeries(2), hasStagedChanges: true }))
    expect(a.kind).toBe('RUN')
    expect(a.command).toContain('--kind phase')
    // 🔴 경계값(phase-2 r03 P1): attempts=4(=autoBudget-1, 아직 escalated 아님) + 같은 바인딩 needs-fix →
    // G2가 AGENT. G3 조건을 `>= autoBudget-1`로 잘못 넓히면 이게 AWAIT_HUMAN이 되어 실패한다.
    const boundary = withOpenSeries(4, {
      last_review: { review_kind: 'phase', phase_id: 'p1', outcome: 'needs-fix', compare_hash: HASH_A, count: 1, errors: [], at: 'T', findings: [] },
    } as Partial<WorkflowState>)
    const b = resolveNext(baseInput({ state: boundary, hasStagedChanges: true, currentIndexHash: HASH_A }))
    expect(b.kind).toBe('AGENT') // G2 — escalated 아니므로 "고치고 다시 add"가 유효한 조언
  })

  it('O2-5 🔴 hard-blocked 선택지는 "예외로도 진행 불가 — 종료/대체 REQ"(soft와 구분, 위험 수용 없음)', () => {
    const a = resolveNext(baseInput({ state: withOpenSeries(8), hasStagedChanges: true }))
    expect(a.kind).toBe('AWAIT_HUMAN')
    expect(a.detail).toContain('하드 상한')
    const diag = a.diagnostics?.join(' ') ?? ''
    // 🔴 hard-blocked 선택지 내용까지 단언(phase-2 r02 P1) — soft 문구로 바꾸면 실패한다.
    expect(diag).toContain('예외로도 진행 불가')
    expect(diag).not.toContain('예외 가능') // soft-escalated 문구가 새면 안 됨
    expect(diag).toContain('종료')
    expect(diag).toContain('대체 REQ')
    // 🔴 detail 포함 **전체 문자열**에 "위험 수용" 부재(phase-2 r03 P1) — detail 끝에 붙여도 잡힌다.
    const allText = [a.detail, a.approvalSentence, ...(a.diagnostics ?? [])].join(' ')
    expect(allText).not.toContain('위험 수용') // 배분표 ④, 어느 문구에도
  })

  it('O2-5b 🔴 soft-escalated(6~8회차)에도 "위험 수용" 표현 없음 — 부정문으로도(phase-2 r01 P1)', () => {
    // hard-blocked만 검사하면 soft 문구의 "위험 수용은 선택지가 아니다"를 놓친다.
    const a = resolveNext(baseInput({ state: withOpenSeries(5), hasStagedChanges: true }))
    expect(a.kind).toBe('AWAIT_HUMAN')
    const allText = [a.detail, a.approvalSentence, ...(a.diagnostics ?? [])].join(' ')
    expect(allText).not.toContain('위험 수용') // 부정문으로도 금지
  })

  it('O2-6 기존 분기 무변경 — commit_allowed·design RUN은 G3 삽입에도 그대로', () => {
    expect(resolveNext(baseInput({ state: baseState({ commit_allowed: true }) })).kind).toBe('AWAIT_HUMAN')
    expect(resolveNext(baseInput({ state: baseState({ design_approved: false, design_approved_hash: null }) })).command).toContain('--kind design')
  })

  it('O2-6 config 예산이 G3 경계를 움직인다 — autoBudget=3이면 attempts=3에서 escalated', () => {
    const a = resolveNext(baseInput({ state: withOpenSeries(3), hasStagedChanges: true, reviewBudget: { autoBudget: 3, hardCap: 6 } }))
    expect(a.kind).toBe('AWAIT_HUMAN')
  })
})

// REQ-2026-029 phase-1 — terminal 안내(resolveNext). 우선순위 G1→terminal→G3→G2.
describe('REQ-2026-029 — human-resolution terminal 안내(resolveNext)', () => {
  const hr = { decision: 'replace' as const, method: '대체 승인', decided_at: '2026-07-18T00:00:00Z' }
  const withTerminal = (over: Partial<WorkflowState> = {}): WorkflowState =>
    baseState({ review_series: [{ series_id: 'phase:p1#1', review_kind: 'phase', phase_id: 'p1', attempts: 8, closed_reason: 'human-resolution', human_resolution: hr }], ...over } as Partial<WorkflowState>)

  it('O1-6 🔴 terminal 키 → RUN이 아니라 AWAIT_HUMAN(종결됨 — 대체 REQ 안내)', () => {
    const a = resolveNext(baseInput({ state: withTerminal(), hasStagedChanges: true }))
    expect(a.kind).toBe('AWAIT_HUMAN')
    expect(a.controlPoint).toBe('human-resolution 종결됨')
    expect(a.approvalSentence).toContain('--successor-of')
  })

  it('O1-6 terminal이 G3(escalated)보다 앞 — attempts=8이지만 예산 안내가 아니라 종결 안내', () => {
    const a = resolveNext(baseInput({ state: withTerminal(), hasStagedChanges: true }))
    expect(a.controlPoint).toBe('human-resolution 종결됨') // 예산 소진(escalated) 아님
    expect(a.detail).not.toContain('예산')
  })

  it('O1-6 G1이 terminal보다 앞 — 워킹트리 dirty면 AGENT(정리 먼저)', () => {
    const a = resolveNext(baseInput({ state: withTerminal(), hasStagedChanges: true, worktreeReviewClean: false }))
    expect(a.kind).toBe('AGENT')
  })

  it('O1-7 terminal 아닌 정상 series는 무변경 — approved 뒤 새 series(attempts<budget)는 RUN', () => {
    const state = baseState({ review_series: [{ series_id: 'phase:p1#1', review_kind: 'phase', phase_id: 'p1', attempts: 2, closed_reason: null }] } as Partial<WorkflowState>)
    const a = resolveNext(baseInput({ state, hasStagedChanges: true }))
    expect(a.kind).toBe('RUN')
    expect(a.command).toContain('--kind phase')
  })
})

// REQ-2026-037 phase-2 — LOW phase 자동 커밋(opt-in, fail-closed) + 복구 가드.
describe('REQ-2026-037 — phaseCommit 자동 커밋 분기(commit_allowed=true)', () => {
  const approved = (over: Partial<WorkflowState> = {}) => baseState({ commit_allowed: true, ...over } as Partial<WorkflowState>)

  it('auto: low-only + risk=LOW + staged → RUN(자동 커밋), 명령에 req:commit·--run·-m', () => {
    const a = resolveNext(baseInput({ state: approved({ risk_level: 'LOW' }), phaseCommitAutoApprove: 'low-only', hasStagedChanges: true }))
    expect(a.kind).toBe('RUN')
    expect(a.command).toContain('req:commit')
    expect(a.command).toContain('--run')
    expect(a.command).toContain('-m')
    expect(nextExitCode(a.kind)).toBe(0) // RUN=0 → 셸 루프가 자동 진행
    expect(a.approvalSentence).toBeUndefined() // 자동 = 사람 정지 아님
  })

  it('HIGH 유지: low-only + risk=HIGH + staged → AWAIT_HUMAN(정책 무관, LOW만 자동)', () => {
    const a = resolveNext(baseInput({ state: approved({ risk_level: 'HIGH' }), phaseCommitAutoApprove: 'low-only', hasStagedChanges: true }))
    expect(a.kind).toBe('AWAIT_HUMAN')
    expect(a.controlPoint).toBe('req:commit --run 직전')
    expect(a.approvalSentence).toBe('req:commit --run 승인')
  })

  it('fail-closed: risk_level 누락/오타/MEDIUM은 자동 아님(→ AWAIT_HUMAN)', () => {
    for (const risk of [undefined, 'Low', 'low', 'MEDIUM', '']) {
      const a = resolveNext(baseInput({ state: approved({ risk_level: risk as never }), phaseCommitAutoApprove: 'low-only', hasStagedChanges: true }))
      expect(a.kind, `risk=${String(risk)}`).toBe('AWAIT_HUMAN') // "HIGH 아님"이 "자동 안전"이 아니다
    }
  })

  it('never 무회귀: never + risk=LOW + staged → AWAIT_HUMAN(현행 통제점 그대로)', () => {
    const a = resolveNext(baseInput({ state: approved({ risk_level: 'LOW' }), phaseCommitAutoApprove: 'never', hasStagedChanges: true }))
    expect(a.kind).toBe('AWAIT_HUMAN')
    expect(a.controlPoint).toBe('req:commit --run 직전')
    expect(a.approvalSentence).toBe('req:commit --run 승인')
  })

  it('복구 가드(R4): commit_allowed=true인데 staged 없음 → AWAIT_HUMAN(자동 RUN 아님) + --finalize 일관', () => {
    const a = resolveNext(baseInput({ state: approved({ risk_level: 'LOW' }), phaseCommitAutoApprove: 'low-only', hasStagedChanges: false }))
    expect(a.kind).toBe('AWAIT_HUMAN') // staged 없으면 자동 커밋 억제(스핀 방지)
    // detail·command·controlPoint·approvalSentence 모두 finalize로 일관(phase-2 리뷰 observation)
    expect(a.detail).toContain('--finalize')
    expect(a.command).toContain('--finalize')
    expect(a.controlPoint).toContain('--finalize')
    expect(a.approvalSentence).toBe('req:commit --finalize --run 승인')
  })

  it('우선순위: state 손상(중복 phase id)은 low-only·LOW·staged라도 BLOCKED가 이긴다', () => {
    const bad = approved({ risk_level: 'LOW', phases: [{ id: 'p1', approved: false }, { id: 'p1', approved: false }] } as Partial<WorkflowState>)
    const a = resolveNext(baseInput({ state: bad, phaseCommitAutoApprove: 'low-only', hasStagedChanges: true }))
    expect(a.kind).toBe('BLOCKED') // 분기 0(modelProblems)이 자동 커밋 분기보다 앞
  })

  it('auto RUN도 --ticket 대상을 보존한다', () => {
    const dir = join(PACKAGE_ROOT, 'workflow', 'REQ-2026-010')
    const a = resolveNext(baseInput({ target: { kind: 'ticket', ticketDir: dir }, state: approved({ risk_level: 'LOW' }), phaseCommitAutoApprove: 'low-only', hasStagedChanges: true }))
    expect(a.kind).toBe('RUN')
    expect(a.command).toContain('--ticket')
  })

  it('renderAction: auto RUN은 `$ ...req:commit ... --run` 줄을 내고 통제점/승인 문장은 없다', () => {
    const a = resolveNext(baseInput({ state: approved({ risk_level: 'LOW' }), phaseCommitAutoApprove: 'low-only', hasStagedChanges: true }))
    const text = renderAction('REQ-2026-010', a)
    expect(text).toContain('$ ')
    expect(text).toContain('req:commit')
    expect(text).not.toContain('승인 문장')
  })

  // R5 병합 단일 게이트 — 모든 phase 소비 + 워킹트리 clean 종단.
  const allConsumed = (over: Partial<WorkflowState> = {}) =>
    baseState({
      consumed_approvals: [
        { approved_tree: HASH_A, phase_id: 'p1', consumed_by_commit_sha: 'aa', approval_consumed_at: '2026-07-18T00:00:00Z' },
        { approved_tree: HASH_B, phase_id: 'p2', consumed_by_commit_sha: 'bb', approval_consumed_at: '2026-07-18T00:00:00Z' },
      ],
      ...over,
    } as Partial<WorkflowState>)

  it('병합 게이트(R5): 모든 phase 소비 + clean + low-only → AWAIT_HUMAN(통합, I1/I2/B1 정본 가리킴)', () => {
    const a = resolveNext(baseInput({ state: allConsumed(), phaseCommitAutoApprove: 'low-only', hasStagedChanges: false, worktreeReviewClean: true }))
    expect(a.kind).toBe('AWAIT_HUMAN') // DONE(exit 11)이 아니라 AWAIT_HUMAN(exit 10)으로 병합 전 멈춘다
    expect(a.controlPoint).toContain('통합')
    expect(a.approvalSentence).toMatch(/I1/)
    expect(a.approvalSentence).toMatch(/B1/)
  })

  it('병합 게이트: never(기본)는 종단 DONE 유지(무회귀)', () => {
    const a = resolveNext(baseInput({ state: allConsumed(), phaseCommitAutoApprove: 'never', hasStagedChanges: false, worktreeReviewClean: true }))
    expect(a.kind).toBe('DONE')
  })
})

// ───────────── DONE 직전 커밋된 design 증거 게이트 (REQ-2026-048 phase-4) ──

describe('[REQ-2026-048] req:next DONE 게이트 — 커밋된 design 증거', () => {
  const allConsumed = (over: Partial<WorkflowState> = {}): WorkflowState =>
    baseState({
      consumed_approvals: [
        { approved_tree: HASH_A, phase_id: 'p1', consumed_by_commit_sha: 'aa', approval_consumed_at: '2026-07-18T00:00:00Z' },
        { approved_tree: HASH_B, phase_id: 'p2', consumed_by_commit_sha: 'bb', approval_consumed_at: '2026-07-18T00:00:00Z' },
      ],
      ...over,
    } as Partial<WorkflowState>)
  const terminal = (dur?: NextInput['designEvidenceDurability'], policy: 'never' | 'low-only' = 'never'): NextInput =>
    baseInput({
      state: allConsumed(),
      phaseCommitAutoApprove: policy,
      hasStagedChanges: false,
      worktreeReviewClean: true,
      designEvidenceDurability: dur,
    })

  it('① 미계산(undefined) → 기존 DONE 유지(무회귀)', () => {
    expect(resolveNext(terminal(undefined)).kind).toBe('DONE')
  })

  it('② legacy 티켓(required=false) → 기존 DONE 유지', () => {
    expect(resolveNext(terminal({ required: false, durable: true, reason: 'legacy' })).kind).toBe('DONE')
  })

  it('③ 신규 티켓 + 증거 완비 → DONE', () => {
    expect(resolveNext(terminal({ required: true, durable: true, reason: 'ok' })).kind).toBe('DONE')
  })

  it('④ 신규 티켓 + 증거 미완 → BLOCKED + 복구 명령', () => {
    const a = resolveNext(terminal({ required: true, durable: false, reason: 'design 승인 행이 없음' }))
    expect(a.kind).toBe('BLOCKED')
    expect(a.detail).toContain('design 승인 행이 없음')
    expect(a.detail).toContain('--finalize-design')
  })

  /** 🔴 자동 커밋(low-only)의 병합 AWAIT_HUMAN 경로도 막아야 한다 — 둘 다 완료 선언 경로다. */
  it('⑤ low-only 병합 게이트 경로도 증거 미완이면 BLOCKED', () => {
    const a = resolveNext(terminal({ required: true, durable: false, reason: 'archive_inventory 없음' }, 'low-only'))
    expect(a.kind).toBe('BLOCKED')
  })

  it('⑥ 종단 조건이 아니면(스테이지 남음) 게이트가 개입하지 않는다', () => {
    const a = resolveNext(
      baseInput({
        state: allConsumed(),
        hasStagedChanges: true,
        worktreeReviewClean: true,
        designEvidenceDurability: { required: true, durable: false, reason: 'x' },
      }),
    )
    // 이 상태는 기존 fallback 으로도 BLOCKED 다 — 중요한 것은 **내 게이트가 원인이 아니라는 것**.
    expect(a.detail).not.toContain('--finalize-design')
    expect(a.detail).not.toContain('설계 승인 감사 증거')
  })
})

/**
 * phase-4 리뷰 관찰 대응 — `req:next` **main() 배선** 통합 검증(HEAD 읽기 → NextInput → BLOCKED).
 * 순수 `resolveNext` 테스트는 판정을 고정하지만, main()이 HEAD blob에서 marker·증거를 실제로 읽어
 * 그 판정에 연결하는 부분은 잡지 못한다.
 */
describe('[REQ-2026-048] req:next main() 배선 — HEAD 기준 DONE 게이트', () => {
  const setupTerminal = (marker: boolean): string => {
    const repo = mkdtempSync(join(tmpdir(), 'reqnext-dur-'))
    const g = (args: string[]): string => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).replace(/\s+$/, '')
    g(['init', '-q'])
    g(['config', 'user.email', 't@t.t'])
    g(['config', 'user.name', 't'])
    writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.0' }))
    writeFileSync(join(repo, 'req.config.json'), JSON.stringify({ packageManager: 'npm' }))
    const ticket = join(repo, 'workflow', 'REQ-2026-001')
    mkdirSync(ticket, { recursive: true })
    for (const f of ['00-requirement.md', '01-design.md', '02-plan.md']) writeFileSync(join(ticket, f), '# doc\n')
    writeFileSync(join(ticket, 'state.json'), '{}\n')
    g(['add', '-A'])
    g(['commit', '-qm', 'baseline'])

    // 종단 분기까지 가려면 **유효 design 승인**이 필요하다 — 해시는 커밋된 인덱스에서 실제로 계산한다.
    const designHash = captureDesignBinding('workflow/REQ-2026-001', g).designHash
    const state: Record<string, unknown> = {
      id: 'REQ-2026-001',
      phase: 'INTAKE',
      phases: [{ id: 'p1', approved: true }],
      approval_evidence_required: true,
      review_series_model_version: 1,
      design_approved: true,
      design_approved_hash: designHash,
      consumed_approvals: [
        { approved_tree: 'a'.repeat(40), phase_id: 'p1', consumed_by_commit_sha: 'b'.repeat(40), approval_consumed_at: '2026-07-18T00:00:00Z' },
      ],
    }
    if (marker) state['evidence_durability_required'] = true
    writeFileSync(join(ticket, 'state.json'), JSON.stringify(state, null, 2) + '\n')
    g(['add', '-A'])
    g(['commit', '-qm', 'state'])
    return repo
  }

  const runNext = (repo: string): string => {
    const r = spawn.sync('npx', ['tsx', join(PACKAGE_ROOT, 'scripts', 'req', 'req-next.ts'), '2026-001', '--root', repo], {
      cwd: PACKAGE_ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
    })
    return `${r.stdout ?? ''}${r.stderr ?? ''}`
  }

  it('marker 있는 신규 티켓 + 커밋된 design 증거 없음 → BLOCKED(복구 명령 포함)', () => {
    const repo = setupTerminal(true)
    try {
      const out = runNext(repo)
      expect(out).toContain('BLOCKED')
      expect(out).toContain('--finalize-design')
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })

  it('marker 없는 legacy 티켓은 게이트가 개입하지 않는다(무회귀)', () => {
    const repo = setupTerminal(false)
    try {
      expect(runNext(repo)).not.toContain('--finalize-design')
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })
})
