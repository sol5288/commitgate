import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  runChecks,
  phaseGranularityWarnings,
  parseArgs,
  classifyInstallMode,
  safeSha256,
  type DoctorInputs,
  type Check,
} from '../../scripts/req/req-doctor'
import { packageRoot } from '../../scripts/req/lib/config'
import type { StatusEntry } from '../../scripts/req/lib/porcelain'
import type { WorkflowState, Verdict } from '../../scripts/req/review-codex'

/**
 * 테스트 편의: `--porcelain` 표기 문자열(`'R  old -> new'`)을 `StatusEntry`로 변환.
 * `-z` 시맨틱(path=NEW, origPath=OLD)으로 맞춘다 — runChecks가 이제 StatusEntry[]를 받기 때문.
 */
const E = (...lines: string[]): StatusEntry[] =>
  lines.map((l) => {
    const index = l[0] as string
    const worktree = l[1] as string
    const rest = l.slice(3)
    const arrow = rest.indexOf(' -> ')
    if (arrow >= 0) return { index, worktree, path: rest.slice(arrow + 4), origPath: rest.slice(0, arrow) }
    return { index, worktree, path: rest }
  })

const base: DoctorInputs = {
  state: {
    id: 'REQ-2026-001',
    branch: 'feat/req-2026-001-x',
    phase: 'IMPLEMENT',
    commit_allowed: false,
  } as WorkflowState,
  currentBranch: 'feat/req-2026-001-x',
  branchExists: true,
  branchPrefix: 'feat/req-', // Phase 2: config 기본값(현재 동작 보존)
  stagedTree: 'TREE',
  statusEntries: E(),
  scratch: [
    'workflow/REQ-2026-001/codex-response.json',
    'workflow/REQ-2026-001/.review-preview.txt',
    'workflow/REQ-2026-001/state.json',
  ],
  responseVerdict: null,
  responseStructureOk: false,
  designApproved: false,
  designApprovedHash: null,
  currentDesignHash: null,
  ticketDocs: [
    'workflow/REQ-2026-001/00-requirement.md',
    'workflow/REQ-2026-001/01-design.md',
    'workflow/REQ-2026-001/02-plan.md',
    'workflow/REQ-2026-001/codex-request.md',
  ],
  ticketRel: 'workflow/REQ-2026-001',
}

function mk(over: Partial<Omit<DoctorInputs, 'state'>> & { state?: Partial<WorkflowState> }): DoctorInputs {
  const { state: stateOver, ...rest } = over
  return { ...base, ...rest, state: { ...base.state, ...stateOver } as WorkflowState }
}
const lvl = (checks: Check[], id: string) => checks.find((c) => c.id === id)?.level

const validVerdict = {
  machine_schema_version: '1.1',
  review_base_sha: 'BASE',
  status: 'STEP_COMPLETE',
  commit_approved: 'yes',
  merge_ready: 'no',
  risk_level: 'LOW',
  review_kind: 'phase',
  findings: [],
  next_action: '',
}

describe('req:doctor — runChecks(1차 최소셋)', () => {
  it('정상 입력(commit_allowed=false)이면 FAIL 없음', () => {
    const fails = runChecks(mk({})).filter((c) => c.level === 'FAIL')
    expect(fails).toEqual([])
  })

  it('D21(REQ-2026-040): Quick Start 블록 부재는 WARN — dev/dogfood·미계산·최신은 OK, 절대 FAIL 아님', () => {
    // dev/dogfood(packageRootDiffers=false) → OK skip
    expect(lvl(runChecks(mk({ packageRootDiffers: false, quickstartMissing: ['CLAUDE.md'] })), 'D21')).toBe('OK')
    // 미계산(undefined) → OK
    expect(lvl(runChecks(mk({ packageRootDiffers: true })), 'D21')).toBe('OK')
    // 없음/최신([]) → OK
    expect(lvl(runChecks(mk({ packageRootDiffers: true, quickstartMissing: [] })), 'D21')).toBe('OK')
    // 소비 repo + 블록 부재 → WARN
    const warned = runChecks(mk({ packageRootDiffers: true, quickstartMissing: ['CLAUDE.md', 'AGENTS.md'] }))
    expect(lvl(warned, 'D21')).toBe('WARN')
    expect(warned.filter((c) => c.level === 'FAIL')).toEqual([]) // 게이트를 벽돌로 만들지 않는다
  })

  it('D2: state.branch != 현재 브랜치 → FAIL', () => {
    expect(lvl(runChecks(mk({ currentBranch: 'other' })), 'D2')).toBe('FAIL')
  })

  it('D3: state.branch 로컬에 없음 → FAIL', () => {
    expect(lvl(runChecks(mk({ branchExists: false })), 'D3')).toBe('FAIL')
  })

  it('D5: codex_thread_id 형식 오류 → FAIL, 정상 UUID → OK', () => {
    expect(lvl(runChecks(mk({ state: { codex_thread_id: 'not-uuid' } })), 'D5')).toBe('FAIL')
    expect(lvl(runChecks(mk({ state: { codex_thread_id: '019eeca1-2356-76c3-aa38-9af48842caea' } })), 'D5')).toBe('OK')
  })

  it('D6: commit_allowed=true인데 응답 없음 → FAIL', () => {
    expect(lvl(runChecks(mk({ state: { commit_allowed: true } })), 'D6')).toBe('FAIL')
  })

  it('D6: commit_allowed=true + 승인 응답·base 일치·바인딩 정합 → OK', () => {
    const r = runChecks(
      mk({
        state: { commit_allowed: true, review_base_sha: 'BASE', review_diff_hash: 'TREE', approved_diff_hash: 'TREE' },
        stagedTree: 'TREE',
        responseVerdict: validVerdict,
        responseStructureOk: true,
      }),
    )
    expect(lvl(r, 'D6')).toBe('OK')
  })

  it('[Codex P1] D6: commit_allowed=true인데 응답이 비승인(NEEDS_FIX/no) → FAIL(승인 우회 차단)', () => {
    const r = runChecks(
      mk({
        state: { commit_allowed: true, review_base_sha: 'BASE', review_diff_hash: 'TREE', approved_diff_hash: 'TREE' },
        stagedTree: 'TREE',
        responseVerdict: {
          machine_schema_version: '1.1',
          review_base_sha: 'BASE',
          status: 'NEEDS_FIX',
          commit_approved: 'no',
          merge_ready: 'no',
          risk_level: 'HIGH',
          review_kind: 'phase',
          findings: [{ severity: 'P1', detail: '미승인', file: null }],
          next_action: '지적 반영 후 재리뷰',
        },
        responseStructureOk: true,
      }),
    )
    expect(lvl(r, 'D6')).toBe('FAIL')
  })

  it('[Codex P1] D6: commit_allowed=true인데 바인딩 필드(review_diff_hash) 누락 → FAIL', () => {
    const r = runChecks(
      mk({
        state: { commit_allowed: true, review_base_sha: 'BASE', approved_diff_hash: 'TREE' },
        stagedTree: 'TREE',
        responseVerdict: validVerdict,
        responseStructureOk: true,
      }),
    )
    expect(lvl(r, 'D6')).toBe('FAIL')
  })

  it('D9: commit_allowed=true인데 staged tree != approved → FAIL(stale)', () => {
    const r = runChecks(
      mk({
        state: { commit_allowed: true, review_base_sha: 'BASE', review_diff_hash: 'OTHER', approved_diff_hash: 'OTHER' },
        stagedTree: 'TREE',
        responseVerdict: validVerdict,
        responseStructureOk: true,
      }),
    )
    expect(lvl(r, 'D9')).toBe('FAIL')
  })

  it('D10: unstaged/untracked(비-스크래치) → FAIL, 스크래치만 → OK', () => {
    expect(lvl(runChecks(mk({ statusEntries: E(' M src/x.ts') })), 'D10')).toBe('FAIL')
    expect(lvl(runChecks(mk({ statusEntries: E('?? workflow/REQ-2026-001/codex-response.json') })), 'D10')).toBe('OK')
  })

  it('[4C e2e] D10: review-codex 후 unstaged state.json은 scratch라 OK', () => {
    expect(lvl(runChecks(mk({ statusEntries: E(' M workflow/REQ-2026-001/state.json') })), 'D10')).toBe('OK')
  })

  it('D11: phase≠DONE인데 main 브랜치 → FAIL', () => {
    expect(lvl(runChecks(mk({ currentBranch: 'main', state: { branch: 'main' } })), 'D11')).toBe('FAIL')
  })

  it('D11: phase=DONE면 브랜치 무관 OK', () => {
    expect(lvl(runChecks(mk({ currentBranch: 'main', state: { branch: 'main', phase: 'DONE' } })), 'D11')).toBe('OK')
  })

  it('[P2] D11: config branchPrefix override(feature/REQ-) → 일치 브랜치 OK', () => {
    expect(
      lvl(
        runChecks(mk({ branchPrefix: 'feature/REQ-', currentBranch: 'feature/REQ-2026-001-x', state: { branch: 'feature/REQ-2026-001-x' } })),
        'D11',
      ),
    ).toBe('OK')
  })
  it('[P2] D11: custom branchPrefix면 기존 feat/req- 브랜치는 FAIL(prefix 실제 적용)', () => {
    expect(
      lvl(
        runChecks(mk({ branchPrefix: 'feature/REQ-', currentBranch: 'feat/req-2026-001-x', state: { branch: 'feat/req-2026-001-x' } })),
        'D11',
      ),
    ).toBe('FAIL')
  })
})

describe('req:doctor — D13 (design 선행 + freshness, exact path 분류)', () => {
  it('유효 design 승인 없음 + src 코드 변경(staged) → FAIL', () => {
    expect(lvl(runChecks(mk({ statusEntries: E('M  src/foo.ts') })), 'D13')).toBe('FAIL')
  })
  it('유효 design 승인 없음 + src 코드 변경(unstaged) → FAIL', () => {
    expect(lvl(runChecks(mk({ statusEntries: E(' M src/foo.ts') })), 'D13')).toBe('FAIL')
  })
  it('유효 design 승인 없음 + src 코드(untracked) → FAIL', () => {
    expect(lvl(runChecks(mk({ statusEntries: E('?? src/new.ts') })), 'D13')).toBe('FAIL')
  })
  it('유효 design 승인 없음 + 현재 티켓 문서만(01-design.md) → OK', () => {
    expect(lvl(runChecks(mk({ statusEntries: E(' M workflow/REQ-2026-001/01-design.md') })), 'D13')).toBe('OK')
  })
  it('유효 design 승인 없음 + scratch만(codex-response/state) → OK', () => {
    expect(
      lvl(
        runChecks(
          mk({
            statusEntries: E(
              '?? workflow/REQ-2026-001/codex-response.json',
              ' M workflow/REQ-2026-001/state.json',
            ),
          }),
        ),
        'D13',
      ),
    ).toBe('OK')
  })
  it('변경 없음(statusLines []) → OK', () => {
    expect(lvl(runChecks(mk({})), 'D13')).toBe('OK')
  })
  it('유효 design 승인(hash 일치) + src 코드 변경 → OK(코드 허용)', () => {
    expect(
      lvl(
        runChecks(mk({ statusEntries: E('M  src/foo.ts'), designApproved: true, designApprovedHash: 'H', currentDesignHash: 'H' })),
        'D13',
      ),
    ).toBe('OK')
  })
  it('design_approved=true지만 hash 불일치(승인 후 설계 변경=stale) + 코드 → FAIL', () => {
    expect(
      lvl(
        runChecks(mk({ statusEntries: E('M  src/foo.ts'), designApproved: true, designApprovedHash: 'OLD', currentDesignHash: 'NEW' })),
        'D13',
      ),
    ).toBe('FAIL')
  })
  it('design_approved=true지만 currentDesignHash=null(문서 미추적) + 코드 → FAIL(승인 무효)', () => {
    expect(
      lvl(
        runChecks(mk({ statusEntries: E('M  src/foo.ts'), designApproved: true, designApprovedHash: 'H', currentDesignHash: null })),
        'D13',
      ),
    ).toBe('FAIL')
  })
  it('[exact match] 다른 REQ 문서는 현재 티켓 docs 아님 → 코드 취급 FAIL', () => {
    expect(lvl(runChecks(mk({ statusEntries: E(' M workflow/REQ-2026-002/01-design.md') })), 'D13')).toBe('FAIL')
  })
  it('[exact match] .bak 변형은 티켓 doc 아님 → FAIL(substring 오인 방지)', () => {
    expect(lvl(runChecks(mk({ statusEntries: E(' M workflow/REQ-2026-001/01-design.md.bak') })), 'D13')).toBe('FAIL')
  })
  it('[exact match] .tmp 변형은 티켓 doc 아님 → FAIL', () => {
    expect(lvl(runChecks(mk({ statusEntries: E('?? workflow/REQ-2026-001/01-design.md.tmp') })), 'D13')).toBe('FAIL')
  })
  it('[exact match] 확장자 변형(.mdx)은 티켓 doc 아님 → FAIL', () => {
    expect(lvl(runChecks(mk({ statusEntries: E(' M workflow/REQ-2026-001/01-design.mdx') })), 'D13')).toBe('FAIL')
  })
  it('[exact match] 티켓 doc 경로를 prefix로 갖는 유사 파일(.orig) → FAIL', () => {
    expect(lvl(runChecks(mk({ statusEntries: E(' M workflow/REQ-2026-001/codex-request.md.orig') })), 'D13')).toBe('FAIL')
  })
  it('[Codex P2] rename 우회 차단: src 코드 → 허용 티켓 doc로 rename → FAIL(원본도 검사)', () => {
    expect(
      lvl(runChecks(mk({ statusEntries: E('R  src/foo.ts -> workflow/REQ-2026-001/01-design.md') })), 'D13'),
    ).toBe('FAIL')
  })
  it('[Codex P2] rename 우회 차단: 티켓 doc → src 코드로 rename → FAIL(목적지도 검사)', () => {
    expect(
      lvl(runChecks(mk({ statusEntries: E('R  workflow/REQ-2026-001/01-design.md -> src/foo.ts') })), 'D13'),
    ).toBe('FAIL')
  })
})

describe('req:doctor — D15 (NEEDS_FIX actionable)', () => {
  const needsFix = (over: Partial<Verdict>): Verdict => ({
    machine_schema_version: '1.1',
    review_base_sha: 'BASE',
    status: 'NEEDS_FIX',
    commit_approved: 'no',
    merge_ready: 'no',
    risk_level: 'HIGH',
    review_kind: 'phase',
    findings: [{ severity: 'P1', detail: 'x', file: null }],
    next_action: '고쳐라',
    ...over,
  })
  it('NEEDS_FIX + findings 있음 + next_action 있음 → OK', () => {
    expect(lvl(runChecks(mk({ responseVerdict: needsFix({}) })), 'D15')).toBe('OK')
  })
  it('NEEDS_FIX + findings=[] → FAIL', () => {
    expect(lvl(runChecks(mk({ responseVerdict: needsFix({ findings: [] }) })), 'D15')).toBe('FAIL')
  })
  it('NEEDS_FIX + next_action 공백 → FAIL', () => {
    expect(lvl(runChecks(mk({ responseVerdict: needsFix({ next_action: '   ' }) })), 'D15')).toBe('FAIL')
  })
  it('NEEDS_FIX + next_action 비-문자열(파손) → throw 없이 FAIL', () => {
    expect(lvl(runChecks(mk({ responseVerdict: needsFix({ next_action: 1 as unknown as string }) })), 'D15')).toBe('FAIL')
  })
  it('STEP_COMPLETE 응답 → D15 점검 불요 OK', () => {
    expect(lvl(runChecks(mk({ responseVerdict: needsFix({ status: 'STEP_COMPLETE' }) })), 'D15')).toBe('OK')
  })
  it('응답 없음(null) → OK', () => {
    expect(lvl(runChecks(mk({ responseVerdict: null })), 'D15')).toBe('OK')
  })
})

// statusPaths 테스트는 삭제(REQ-2026-012 — 함수가 lib/porcelain의 entryPaths로 대체됨).
// entryPaths·parseStatusZ의 경로 추출·rename src/dest·백슬래시 보존은 porcelain.test.ts가 검증한다.
// (옛 '백슬래시 정규화' 테스트는 버그였다 — `-z`는 역슬래시를 파일명의 일부로 보존한다.)

// ─────────────────────────────── [A2] D16/D17 승인 증거 아카이브 정본 검증 ──
type MkArg = Parameters<typeof mk>[0]
describe('[A2] D16 — phase 승인 증거 아카이브 정본 검증', () => {
  const phaseEv = {
    response_path: 'workflow/REQ-2026-001/responses/phase-A1-evidence-mechanism-r02-approved.json',
    response_sha256: 'SHA', review_kind: 'phase', phase_id: 'phase-A1-evidence-mechanism',
    review_base_sha: 'BASE', approved_tree: 'TREE', codex_thread_id: 'TID',
    machine_schema_version: '1.1', status: 'COMPLETE', commit_approved: 'yes', approved_at: 'AT',
  }
  const phaseArchiveOk = {
    exists: true, sha256: 'SHA', structureOk: true,
    verdict: { ...validVerdict, status: 'COMPLETE', commit_approved: 'yes', review_kind: 'phase', review_base_sha: 'BASE' },
  }
  const pState = { commit_allowed: true, approved_diff_hash: 'TREE', review_base_sha: 'BASE', review_diff_hash: 'TREE' }

  it('신규 REQ + 유효 evidence/archive → D16 OK', () => {
    const c = runChecks(mk({ state: { ...pState, approval_evidence_required: true }, approvalEvidenceRequired: true, approvalEvidence: phaseEv, approvalArchive: phaseArchiveOk } as MkArg))
    expect(lvl(c, 'D16')).toBe('OK')
  })
  it('신규 REQ + commit_allowed인데 evidence 없음 → D16 FAIL', () => {
    const c = runChecks(mk({ state: { ...pState, approval_evidence_required: true }, approvalEvidenceRequired: true, approvalEvidence: null, approvalArchive: null } as MkArg))
    expect(lvl(c, 'D16')).toBe('FAIL')
  })
  it('아카이브 SHA 불일치 → D16 FAIL', () => {
    const c = runChecks(mk({ state: { ...pState, approval_evidence_required: true }, approvalEvidenceRequired: true, approvalEvidence: phaseEv, approvalArchive: { ...phaseArchiveOk, sha256: 'OTHER' } } as MkArg))
    expect(lvl(c, 'D16')).toBe('FAIL')
  })
  it('아카이브 review_kind=design(잘못된 kind) → D16 FAIL', () => {
    const c = runChecks(mk({ state: { ...pState, approval_evidence_required: true }, approvalEvidenceRequired: true, approvalEvidence: phaseEv, approvalArchive: { ...phaseArchiveOk, verdict: { ...phaseArchiveOk.verdict, review_kind: 'design' } } } as MkArg))
    expect(lvl(c, 'D16')).toBe('FAIL')
  })
  it('approved_tree != state.approved_diff_hash → D16 FAIL', () => {
    const c = runChecks(mk({ state: { ...pState, approval_evidence_required: true, approved_diff_hash: 'DIFFERENT' }, approvalEvidenceRequired: true, approvalEvidence: phaseEv, approvalArchive: phaseArchiveOk } as MkArg))
    expect(lvl(c, 'D16')).toBe('FAIL')
  })
  it('legacy(미요구) + evidence 없음 → D16 OK(FAIL 아님)', () => {
    const c = runChecks(mk({ state: { ...pState }, approvalEvidenceRequired: false, approvalEvidence: null, approvalArchive: null } as MkArg))
    expect(lvl(c, 'D16')).toBe('OK')
  })
  it('legacy + evidence 있는데 SHA 불일치 → D16 WARN(FAIL 아님)', () => {
    const c = runChecks(mk({ state: { ...pState }, approvalEvidenceRequired: false, approvalEvidence: phaseEv, approvalArchive: { ...phaseArchiveOk, sha256: 'OTHER' } } as MkArg))
    expect(lvl(c, 'D16')).toBe('WARN')
  })
  it('commit_allowed=false → D16 OK(점검 불요)', () => {
    const c = runChecks(mk({ state: { commit_allowed: false, approval_evidence_required: true }, approvalEvidenceRequired: true, approvalEvidence: null } as MkArg))
    expect(lvl(c, 'D16')).toBe('OK')
  })
})

describe('[A2] D17 — design 승인 증거 아카이브 정본 검증', () => {
  const designEv = {
    response_path: 'workflow/REQ-2026-001/responses/design-r02-approved.json',
    response_sha256: 'DSHA', review_kind: 'design', phase_id: null, review_base_sha: 'BASE',
    design_hash: 'DHASH', codex_thread_id: 'TID', machine_schema_version: '1.1',
    status: 'COMPLETE', commit_approved: 'yes', approved_at: 'AT',
  }
  const designArchiveOk = {
    exists: true, sha256: 'DSHA', structureOk: true,
    verdict: { ...validVerdict, status: 'COMPLETE', commit_approved: 'yes', review_kind: 'design', review_base_sha: 'BASE' },
  }
  it('신규 REQ + design 승인 + 유효 design evidence → D17 OK', () => {
    const c = runChecks(mk({ state: { design_approved: true, design_approved_hash: 'DHASH', approval_evidence_required: true }, approvalEvidenceRequired: true, designApprovalEvidence: designEv, designArchive: designArchiveOk, designApproved: true, designApprovedHash: 'DHASH', currentDesignHash: 'DHASH' } as MkArg))
    expect(lvl(c, 'D17')).toBe('OK')
  })
  it('신규 REQ + design 승인인데 design evidence 없음 → D17 FAIL', () => {
    const c = runChecks(mk({ state: { design_approved: true, design_approved_hash: 'DHASH', approval_evidence_required: true }, approvalEvidenceRequired: true, designApprovalEvidence: null, designArchive: null, designApproved: true, designApprovedHash: 'DHASH', currentDesignHash: 'DHASH' } as MkArg))
    expect(lvl(c, 'D17')).toBe('FAIL')
  })
  it('design_hash != state.design_approved_hash → D17 FAIL', () => {
    const c = runChecks(mk({ state: { design_approved: true, design_approved_hash: 'OTHER', approval_evidence_required: true }, approvalEvidenceRequired: true, designApprovalEvidence: designEv, designArchive: designArchiveOk, designApproved: true, designApprovedHash: 'OTHER', currentDesignHash: 'OTHER' } as MkArg))
    expect(lvl(c, 'D17')).toBe('FAIL')
  })
  it('legacy(미요구) + design evidence 없음 → D17 OK', () => {
    const c = runChecks(mk({ state: { design_approved: true, design_approved_hash: 'DHASH' }, approvalEvidenceRequired: false, designApprovalEvidence: null, designApproved: true, designApprovedHash: 'DHASH', currentDesignHash: 'DHASH' } as MkArg))
    expect(lvl(c, 'D17')).toBe('OK')
  })
})

describe('[A2] D10 — responses/ 스크래치 live(ticketRel)', () => {
  it('현재 티켓 untracked 아카이브 → D10 OK', () => {
    const c = runChecks(mk({ statusEntries: E('?? workflow/REQ-2026-001/responses/phase-A1-evidence-mechanism-r01-approved.json'), ticketRel: 'workflow/REQ-2026-001' } as MkArg))
    expect(lvl(c, 'D10')).toBe('OK')
  })
  it('커밋된 evidence 수정(tracked) → D10 FAIL', () => {
    const c = runChecks(mk({ statusEntries: E(' M workflow/REQ-2026-001/responses/design-r01-approved.json'), ticketRel: 'workflow/REQ-2026-001' } as MkArg))
    expect(lvl(c, 'D10')).toBe('FAIL')
  })
  it('approvals.jsonl untracked → D10 FAIL(스크래치 아님)', () => {
    const c = runChecks(mk({ statusEntries: E('?? workflow/REQ-2026-001/responses/approvals.jsonl'), ticketRel: 'workflow/REQ-2026-001' } as MkArg))
    expect(lvl(c, 'D10')).toBe('FAIL')
  })
})

describe('[A2-fix] D16/D17 — base-sha 정합 + 경로 confinement', () => {
  const T = 'workflow/REQ-2026-001'
  const pEv = { response_path: `${T}/responses/phase-A1-evidence-mechanism-r02-approved.json`, response_sha256: 'SHA', review_kind: 'phase', phase_id: 'phase-A1-evidence-mechanism', review_base_sha: 'BASE', approved_tree: 'TREE', codex_thread_id: 'TID', machine_schema_version: '1.1', status: 'COMPLETE', commit_approved: 'yes', approved_at: 'AT' }
  const pArch = { exists: true, sha256: 'SHA', structureOk: true, verdict: { ...validVerdict, status: 'COMPLETE', commit_approved: 'yes', review_kind: 'phase', review_base_sha: 'BASE' } }
  const pState = { commit_allowed: true, approved_diff_hash: 'TREE', review_base_sha: 'BASE', review_diff_hash: 'TREE', approval_evidence_required: true }
  const dEv = { response_path: `${T}/responses/design-r02-approved.json`, response_sha256: 'DSHA', review_kind: 'design', phase_id: null, review_base_sha: 'DESIGN_BASE', design_hash: 'DHASH', codex_thread_id: 'TID', machine_schema_version: '1.1', status: 'COMPLETE', commit_approved: 'yes', approved_at: 'AT' }
  const dArch = { exists: true, sha256: 'DSHA', structureOk: true, verdict: { ...validVerdict, status: 'COMPLETE', commit_approved: 'yes', review_kind: 'design', review_base_sha: 'DESIGN_BASE' } }

  it('[fix1] phase로 state.review_base_sha가 바뀌어도 design evidence는 자기 base로 검증 → D17 OK', () => {
    const c = runChecks(mk({ state: { design_approved: true, design_approved_hash: 'DHASH', approval_evidence_required: true, review_base_sha: 'PHASE_BASE_NEW' }, ticketRel: T, approvalEvidenceRequired: true, designApprovalEvidence: dEv, designArchive: dArch, designApproved: true, designApprovedHash: 'DHASH', currentDesignHash: 'DHASH' } as MkArg))
    expect(lvl(c, 'D17')).toBe('OK')
  })
  it('[fix2] phase evidence response_path 다른 티켓 → D16 FAIL', () => {
    const c = runChecks(mk({ state: pState, ticketRel: T, approvalEvidenceRequired: true, approvalEvidence: { ...pEv, response_path: 'workflow/REQ-2026-999/responses/phase-A1-evidence-mechanism-r02-approved.json' }, approvalArchive: pArch } as MkArg))
    expect(lvl(c, 'D16')).toBe('FAIL')
  })
  it('[fix2] nested path → D16 FAIL', () => {
    const c = runChecks(mk({ state: pState, ticketRel: T, approvalEvidenceRequired: true, approvalEvidence: { ...pEv, response_path: `${T}/responses/sub/phase-A1-evidence-mechanism-r02-approved.json` }, approvalArchive: pArch } as MkArg))
    expect(lvl(c, 'D16')).toBe('FAIL')
  })
  it('[fix2] design evidence response_path 다른 티켓 → D17 FAIL', () => {
    const c = runChecks(mk({ state: { design_approved: true, design_approved_hash: 'DHASH', approval_evidence_required: true }, ticketRel: T, approvalEvidenceRequired: true, designApprovalEvidence: { ...dEv, response_path: 'workflow/REQ-2026-999/responses/design-r02-approved.json' }, designArchive: dArch, designApproved: true, designApprovedHash: 'DHASH', currentDesignHash: 'DHASH' } as MkArg))
    expect(lvl(c, 'D17')).toBe('FAIL')
  })
  it('[fix2] 정상 current ticket 직계 → D16 OK', () => {
    const c = runChecks(mk({ state: pState, ticketRel: T, approvalEvidenceRequired: true, approvalEvidence: pEv, approvalArchive: pArch } as MkArg))
    expect(lvl(c, 'D16')).toBe('OK')
  })
})

describe('[A2-R2-fix] D13 — untracked 응답 아카이브 코드변경 오분류 차단', () => {
  const T = 'workflow/REQ-2026-001'
  const noDesign = { state: { design_approved: false }, designApproved: false, designApprovedHash: null, currentDesignHash: null, ticketRel: T }
  it('design 미승인 + untracked needs-fix 아카이브만 → D13 FAIL 아님(아카이브는 코드변경 아님)', () => {
    const c = runChecks(mk({ ...noDesign, statusEntries: E(`?? ${T}/responses/design-r01-needs-fix.json`) } as MkArg))
    expect(lvl(c, 'D13')).not.toBe('FAIL')
  })
  it('회귀: approvals.jsonl untracked는 D13에서 숨기지 않음(미승인→FAIL)', () => {
    const c = runChecks(mk({ ...noDesign, statusEntries: E(`?? ${T}/responses/approvals.jsonl`) } as MkArg))
    expect(lvl(c, 'D13')).toBe('FAIL')
  })
  it('회귀: tracked evidence 수정은 D13에서 숨기지 않음(미승인→FAIL)', () => {
    const c = runChecks(mk({ ...noDesign, statusEntries: E(` M ${T}/responses/design-r01-approved.json`) } as MkArg))
    expect(lvl(c, 'D13')).toBe('FAIL')
  })
  it('회귀: 타 티켓 아카이브는 D13에서 숨기지 않음(미승인→FAIL)', () => {
    const c = runChecks(mk({ ...noDesign, statusEntries: E('?? workflow/REQ-2026-999/responses/design-r01-needs-fix.json') } as MkArg))
    expect(lvl(c, 'D13')).toBe('FAIL')
  })
  it('회귀: collapsed responses/ 디렉터리는 D13에서 숨기지 않음(미승인→FAIL)', () => {
    const c = runChecks(mk({ ...noDesign, statusEntries: E(`?? ${T}/responses/`) } as MkArg))
    expect(lvl(c, 'D13')).toBe('FAIL')
  })
})

describe('[A2-R3-fix] D16 — live codex-response.json SHA 일치(phase 전용)', () => {
  const T = 'workflow/REQ-2026-001'
  const pEv = { response_path: `${T}/responses/phase-A1-evidence-mechanism-r02-approved.json`, response_sha256: 'SHA', review_kind: 'phase', phase_id: 'phase-A1-evidence-mechanism', review_base_sha: 'BASE', approved_tree: 'TREE', codex_thread_id: 'TID', machine_schema_version: '1.1', status: 'COMPLETE', commit_approved: 'yes', approved_at: 'AT' }
  const pArch = { exists: true, sha256: 'SHA', structureOk: true, verdict: { ...validVerdict, status: 'COMPLETE', commit_approved: 'yes', review_kind: 'phase', review_base_sha: 'BASE' } }
  const pState = { commit_allowed: true, approved_diff_hash: 'TREE', review_base_sha: 'BASE', review_diff_hash: 'TREE', approval_evidence_required: true }
  const reqd = { state: pState, ticketRel: T, approvalEvidenceRequired: true, approvalEvidence: pEv, approvalArchive: pArch }

  it('live SHA == evidence SHA → D16 OK', () => {
    expect(lvl(runChecks(mk({ ...reqd, liveResponseSha256: 'SHA' } as MkArg)), 'D16')).toBe('OK')
  })
  it('live SHA != evidence SHA (신규) → D16 FAIL', () => {
    expect(lvl(runChecks(mk({ ...reqd, liveResponseSha256: 'OTHER' } as MkArg)), 'D16')).toBe('FAIL')
  })
  it('live SHA != evidence SHA (legacy) → D16 WARN', () => {
    const c = runChecks(mk({ state: { ...pState, approval_evidence_required: false }, ticketRel: T, approvalEvidenceRequired: false, approvalEvidence: pEv, approvalArchive: pArch, liveResponseSha256: 'OTHER' } as MkArg))
    expect(lvl(c, 'D16')).toBe('WARN')
  })
  it('live response 없음(null) → live 검사 skip(나머지 정상 → OK)', () => {
    expect(lvl(runChecks(mk({ ...reqd, liveResponseSha256: null } as MkArg)), 'D16')).toBe('OK')
  })
})

describe('[A2-R3-fix] D17 — design은 live SHA 비교 안 함', () => {
  const T = 'workflow/REQ-2026-001'
  const dEv = { response_path: `${T}/responses/design-r02-approved.json`, response_sha256: 'DSHA', review_kind: 'design', phase_id: null, review_base_sha: 'DESIGN_BASE', design_hash: 'DHASH', codex_thread_id: 'TID', machine_schema_version: '1.1', status: 'COMPLETE', commit_approved: 'yes', approved_at: 'AT' }
  const dArch = { exists: true, sha256: 'DSHA', structureOk: true, verdict: { ...validVerdict, status: 'COMPLETE', commit_approved: 'yes', review_kind: 'design', review_base_sha: 'DESIGN_BASE' } }
  it('live SHA가 design evidence SHA와 달라도 archive/design_hash 정상이면 D17 OK', () => {
    const c = runChecks(mk({ state: { design_approved: true, design_approved_hash: 'DHASH', approval_evidence_required: true }, ticketRel: T, approvalEvidenceRequired: true, designApprovalEvidence: dEv, designArchive: dArch, designApproved: true, designApprovedHash: 'DHASH', currentDesignHash: 'DHASH', liveResponseSha256: 'PHASE_RESPONSE_SHA' } as MkArg))
    expect(lvl(c, 'D17')).toBe('OK')
  })
})

// ─────────────────────────────── [C] D18 granularity 정책(advisory WARN) ──
describe('[C] phaseGranularityWarnings — phase 분할 권고(순수)', () => {
  it('임계 이하 → []', () => expect(phaseGranularityWarnings(['a.ts', 'b.ts'], 8)).toEqual([]))
  it('정확히 임계 → []', () => expect(phaseGranularityWarnings(Array.from({ length: 8 }, (_, i) => `f${i}.ts`), 8)).toEqual([]))
  it('임계 초과 → WARN 메시지', () =>
    expect(phaseGranularityWarnings(Array.from({ length: 9 }, (_, i) => `f${i}.ts`), 8).length).toBeGreaterThan(0))
})

describe('[C] D18 — granularity advisory(절대 FAIL 아님)', () => {
  // validDesign(D13 OK) 상태에서 코드 변경 파일이 임계 초과면 D18=WARN, FAIL 아님.
  const manyStaged = Array.from({ length: 12 }, (_, i) => `M  src/file${i}.ts`)
  const validDesignOver = { designApproved: true, designApprovedHash: 'H', currentDesignHash: 'H', statusEntries: E(...manyStaged) }
  it('코드 변경 많음 → D18 WARN', () => expect(lvl(runChecks(mk(validDesignOver)), 'D18')).toBe('WARN'))
  it('D18은 FAIL을 만들지 않음', () =>
    expect(runChecks(mk(validDesignOver)).filter((c) => c.id === 'D18' && c.level === 'FAIL')).toEqual([]))
  it('코드 변경 적음 → D18 OK', () =>
    expect(lvl(runChecks(mk({ designApproved: true, designApprovedHash: 'H', currentDesignHash: 'H', statusEntries: E('M  src/a.ts') })), 'D18')).toBe('OK'))

  it('[P2] config granularityMaxFiles=2 → 3파일이면 WARN(임계 주입)', () => {
    const three = ['M  src/a.ts', 'M  src/b.ts', 'M  src/c.ts']
    expect(
      lvl(runChecks(mk({ designApproved: true, designApprovedHash: 'H', currentDesignHash: 'H', statusEntries: E(...three), granularityMaxFiles: 2 })), 'D18'),
    ).toBe('WARN')
  })
  it('[P2] config granularityMaxFiles=50 → 12파일이어도 OK(임계 상향)', () => {
    expect(lvl(runChecks(mk({ ...validDesignOver, granularityMaxFiles: 50 })), 'D18')).toBe('OK')
  })
})

// ─────────────────────── D19: 설치 모드 진단(REQ-2026-014, 형태 기준·WARN 상한) ──

const STAGE_A: Record<string, string> = {
  'req:new': 'tsx scripts/req/req-new.ts',
  'req:next': 'tsx scripts/req/req-next.ts',
  'req:review-codex': 'tsx scripts/req/review-codex.ts',
  'req:doctor': 'tsx scripts/req/req-doctor.ts',
  'req:commit': 'tsx scripts/req/req-commit.ts',
}
const STAGE_B: Record<string, string> = {
  'req:new': 'commitgate req:new',
  'req:next': 'commitgate req:next',
  'req:review-codex': 'commitgate req:review-codex',
  'req:doctor': 'commitgate req:doctor',
  'req:commit': 'commitgate req:commit',
}

describe('[REQ-2026-014] classifyInstallMode — req:* 값의 형태만으로 판정(순수)', () => {
  it('전부 Stage A 형태 → stage-a', () => expect(classifyInstallMode(STAGE_A)).toBe('stage-a'))
  it('전부 Stage B 형태 → stage-b', () => expect(classifyInstallMode(STAGE_B)).toBe('stage-b'))
  it('섞이면 mixed', () => expect(classifyInstallMode({ ...STAGE_A, 'req:next': 'commitgate req:next' })).toBe('mixed'))
  it('req:* 키가 없으면 none', () => expect(classifyInstallMode({})).toBe('none'))
  it('무관한 스크립트만 있어도 none', () => expect(classifyInstallMode({ build: 'tsc', test: 'vitest' })).toBe('none'))
  it('전부 사용자 정의 값이면 custom', () =>
    expect(classifyInstallMode({ 'req:new': 'node mine.mjs', 'req:doctor': 'echo hi' })).toBe('custom'))
  it('일부만 kit 형태이고 나머지가 사용자 값이면 custom(Stage A/B가 공존해야 mixed)', () =>
    expect(classifyInstallMode({ 'req:new': 'tsx scripts/req/req-new.ts', 'req:doctor': 'echo hi' })).toBe('custom'))
  it('부분 집합이어도 전부 같은 형태면 그 형태로 판정', () => {
    expect(classifyInstallMode({ 'req:new': 'tsx scripts/req/req-new.ts' })).toBe('stage-a')
    expect(classifyInstallMode({ 'req:commit': 'commitgate req:commit' })).toBe('stage-b')
  })
  it('형태만 본다 — 파일명이 달라도 Stage A 형태(바이트 정확 일치 요구는 migrate 쪽 계약)', () =>
    expect(classifyInstallMode({ 'req:new': 'tsx scripts/req/whatever.ts' })).toBe('stage-a'))
})

describe('[REQ-2026-014] D19 — 설치 모드 진단(절대 FAIL 아님)', () => {
  /**
   * 🔴 이 검사가 FAIL을 내면 **이 저장소 자신의 req:commit이 영구 차단**된다.
   * CommitGate의 package.json 은 Stage A 형태이고(개발 repo가 자기 스크립트를 직접 실행), req:commit 이
   * req:doctor 를 exit≠0에 throw 하는 하드 게이트로 spawn 하기 때문이다. Stage A 는 지원되는 설치 형태다.
   */
  it('Stage A → OK (결함이 아니라 지원되는 설치 형태)', () =>
    expect(lvl(runChecks(mk({ reqScripts: STAGE_A })), 'D19')).toBe('OK'))
  it('Stage B → OK', () => expect(lvl(runChecks(mk({ reqScripts: STAGE_B })), 'D19')).toBe('OK'))
  it('mixed → WARN + migrate 안내', () => {
    const checks = runChecks(mk({ reqScripts: { ...STAGE_A, 'req:next': 'commitgate req:next' } }))
    expect(lvl(checks, 'D19')).toBe('WARN')
    expect(checks.find((c) => c.id === 'D19')?.msg).toContain('commitgate migrate')
  })
  it('none/custom → OK', () => {
    expect(lvl(runChecks(mk({ reqScripts: {} })), 'D19')).toBe('OK')
    expect(lvl(runChecks(mk({ reqScripts: { 'req:new': 'node mine.mjs' } })), 'D19')).toBe('OK')
  })

  it('어떤 입력에도 FAIL을 만들지 않는다(WARN 상한)', () => {
    const inputs: Array<Record<string, string> | null | undefined> = [
      STAGE_A,
      STAGE_B,
      { ...STAGE_A, 'req:next': 'commitgate req:next' },
      {},
      null,
      undefined,
    ]
    for (const reqScripts of inputs)
      expect(runChecks(mk({ reqScripts })).filter((c) => c.id === 'D19' && c.level === 'FAIL')).toEqual([])
  })

  it('reqScripts 미지정(legacy 2-arg 호출) → OK 점검 불요 — 기존 호출부를 깨지 않는다', () => {
    expect(lvl(runChecks(base), 'D19')).toBe('OK')
    expect(runChecks(base).find((c) => c.id === 'D19')?.msg).toContain('점검 불요')
  })

  it('package.json 없음/파손(null) → OK 점검 불요(무관한 이유로 커밋 게이트를 죽이지 않는다)', () =>
    expect(lvl(runChecks(mk({ reqScripts: null })), 'D19')).toBe('OK'))

  it('모든 경로에서 정확히 1개 Check를 push한다(비해당도 OK를 낸다)', () => {
    const inputs: Array<Record<string, string> | null | undefined> = [STAGE_A, STAGE_B, {}, null, undefined]
    for (const reqScripts of inputs) expect(runChecks(mk({ reqScripts })).filter((c) => c.id === 'D19')).toHaveLength(1)
  })
})

// ─────────────────────────────── [P2] CLI 파싱(parseArgs) — --root 계약 ──
describe('req:doctor — parseArgs(--root·--ticket·--finalize)', () => {
  it('[P2] --root 수용(config 탐색 루트 주입)', () => {
    expect(parseArgs(['2026-001', '--root', '/x']).root).toBe('/x')
    expect(parseArgs(['2026-001']).root).toBe(null)
  })
  it('[P2] --root 값 누락은 throw', () => {
    expect(() => parseArgs(['2026-001', '--root'])).toThrow(/--root/)
  })
  it('--ticket·--finalize·reqId 파싱(behavior-preserving)', () => {
    const o = parseArgs(['--ticket', '/t', '--finalize'])
    expect(o.ticket).toBe('/t')
    expect(o.finalize).toBe(true)
    expect(parseArgs(['2026-003']).reqId).toBe('2026-003')
  })
  it('알 수 없는 옵션은 throw(fail-closed)', () => {
    expect(() => parseArgs(['--nope'])).toThrow(/알 수 없는/)
  })
})

describe('req:doctor — D20 (자산 skew content-hash, REQ-2026-038)', () => {
  const D20 = (over: Parameters<typeof mk>[0]) => lvl(runChecks(mk(over)), 'D20')

  it('필드 미지정(legacy/2-arg) → OK(점검 불요)', () => {
    expect(D20({})).toBe('OK')
  })
  it('dev repo/dogfood(packageRootDiffers=false) → OK', () => {
    expect(D20({ packageRootDiffers: false, schemaPathIsDefault: true, packagedSchemaSha: 'a', vendoredSchemaSha: 'b' })).toBe('OK')
  })
  it('custom schemaPath(schemaPathIsDefault=false) → OK(unmanaged)', () => {
    expect(D20({ packageRootDiffers: true, schemaPathIsDefault: false, packagedSchemaSha: 'a', vendoredSchemaSha: 'b' })).toBe('OK')
  })
  it('shipped/vendored 조회 불가(sha null) → OK', () => {
    expect(D20({ packageRootDiffers: true, schemaPathIsDefault: true, packagedSchemaSha: null, vendoredSchemaSha: 'b' })).toBe('OK')
    expect(D20({ packageRootDiffers: true, schemaPathIsDefault: true, packagedSchemaSha: 'a', vendoredSchemaSha: null })).toBe('OK')
  })
  it('shipped === vendored → OK(동기화됨)', () => {
    expect(D20({ packageRootDiffers: true, schemaPathIsDefault: true, packagedSchemaSha: 'same', vendoredSchemaSha: 'same' })).toBe('OK')
  })
  it('shipped !== vendored(skew) → WARN', () => {
    expect(
      D20({ packageRootDiffers: true, schemaPathIsDefault: true, packagedSchemaSha: 'shipped', vendoredSchemaSha: 'stale', installedVersion: '0.8.1' }),
    ).toBe('WARN')
  })
  it('skew여도 D20은 절대 FAIL이 아니다(커밋 게이트 무영향)', () => {
    const checks = runChecks(mk({ packageRootDiffers: true, schemaPathIsDefault: true, packagedSchemaSha: 'x', vendoredSchemaSha: 'y' }))
    expect(checks.filter((c) => c.id === 'D20' && c.level === 'FAIL').length).toBe(0)
  })

  // main() 경로 증명(REQ-2026-038 phase-2 리뷰 대응): 합성 sha 문자열이 아니라 req-doctor의 **실제 createHash 경로**
  // (safeSha256)를 구동한다. createHash import가 결함이면 safeSha256이 null을 반환해 아래 hex 단언이 실패한다.
  it('safeSha256 — 실제 createHash 경로 동작(파일 sha 64hex)', () => {
    const sha = safeSha256(join(packageRoot(), 'workflow', 'machine.schema.json'))
    expect(sha).toMatch(/^[0-9a-f]{64}$/)
  })
  it('실제 shipped-vs-stale sha로 D20 WARN(main() sha 계산 end-to-end)', () => {
    const shipped = safeSha256(join(packageRoot(), 'workflow', 'machine.schema.json'))
    const dir = mkdtempSync(join(tmpdir(), 'cg-d20-'))
    try {
      const stalePath = join(dir, 'stale.json')
      writeFileSync(stalePath, '{"machine_schema_version":["1.1"],"_stale":"0.7.0"}')
      const stale = safeSha256(stalePath)
      expect(shipped).toMatch(/^[0-9a-f]{64}$/)
      expect(stale).toMatch(/^[0-9a-f]{64}$/)
      expect(shipped).not.toBe(stale)
      expect(
        D20({ packageRootDiffers: true, schemaPathIsDefault: true, packagedSchemaSha: shipped, vendoredSchemaSha: stale, installedVersion: '0.8.1' }),
      ).toBe('WARN')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  it('safeSha256 — 부재 파일은 null(fail-safe → D20 OK 처리)', () => {
    expect(safeSha256(join(tmpdir(), 'cg-nonexistent-xyz-123.json'))).toBeNull()
  })
})
