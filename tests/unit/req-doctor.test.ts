import { describe, it, expect } from 'vitest'
import { runChecks, statusPaths, phaseGranularityWarnings, parseArgs, type DoctorInputs, type Check } from '../../scripts/req/req-doctor'
import type { WorkflowState, Verdict } from '../../scripts/req/review-codex'

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
  statusLines: [],
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
    expect(lvl(runChecks(mk({ statusLines: [' M src/x.ts'] })), 'D10')).toBe('FAIL')
    expect(lvl(runChecks(mk({ statusLines: ['?? workflow/REQ-2026-001/codex-response.json'] })), 'D10')).toBe('OK')
  })

  it('[4C e2e] D10: review-codex 후 unstaged state.json은 scratch라 OK', () => {
    expect(lvl(runChecks(mk({ statusLines: [' M workflow/REQ-2026-001/state.json'] })), 'D10')).toBe('OK')
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
    expect(lvl(runChecks(mk({ statusLines: ['M  src/foo.ts'] })), 'D13')).toBe('FAIL')
  })
  it('유효 design 승인 없음 + src 코드 변경(unstaged) → FAIL', () => {
    expect(lvl(runChecks(mk({ statusLines: [' M src/foo.ts'] })), 'D13')).toBe('FAIL')
  })
  it('유효 design 승인 없음 + src 코드(untracked) → FAIL', () => {
    expect(lvl(runChecks(mk({ statusLines: ['?? src/new.ts'] })), 'D13')).toBe('FAIL')
  })
  it('유효 design 승인 없음 + 현재 티켓 문서만(01-design.md) → OK', () => {
    expect(lvl(runChecks(mk({ statusLines: [' M workflow/REQ-2026-001/01-design.md'] })), 'D13')).toBe('OK')
  })
  it('유효 design 승인 없음 + scratch만(codex-response/state) → OK', () => {
    expect(
      lvl(
        runChecks(
          mk({
            statusLines: [
              '?? workflow/REQ-2026-001/codex-response.json',
              ' M workflow/REQ-2026-001/state.json',
            ],
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
        runChecks(mk({ statusLines: ['M  src/foo.ts'], designApproved: true, designApprovedHash: 'H', currentDesignHash: 'H' })),
        'D13',
      ),
    ).toBe('OK')
  })
  it('design_approved=true지만 hash 불일치(승인 후 설계 변경=stale) + 코드 → FAIL', () => {
    expect(
      lvl(
        runChecks(mk({ statusLines: ['M  src/foo.ts'], designApproved: true, designApprovedHash: 'OLD', currentDesignHash: 'NEW' })),
        'D13',
      ),
    ).toBe('FAIL')
  })
  it('design_approved=true지만 currentDesignHash=null(문서 미추적) + 코드 → FAIL(승인 무효)', () => {
    expect(
      lvl(
        runChecks(mk({ statusLines: ['M  src/foo.ts'], designApproved: true, designApprovedHash: 'H', currentDesignHash: null })),
        'D13',
      ),
    ).toBe('FAIL')
  })
  it('[exact match] 다른 REQ 문서는 현재 티켓 docs 아님 → 코드 취급 FAIL', () => {
    expect(lvl(runChecks(mk({ statusLines: [' M workflow/REQ-2026-002/01-design.md'] })), 'D13')).toBe('FAIL')
  })
  it('[exact match] .bak 변형은 티켓 doc 아님 → FAIL(substring 오인 방지)', () => {
    expect(lvl(runChecks(mk({ statusLines: [' M workflow/REQ-2026-001/01-design.md.bak'] })), 'D13')).toBe('FAIL')
  })
  it('[exact match] .tmp 변형은 티켓 doc 아님 → FAIL', () => {
    expect(lvl(runChecks(mk({ statusLines: ['?? workflow/REQ-2026-001/01-design.md.tmp'] })), 'D13')).toBe('FAIL')
  })
  it('[exact match] 확장자 변형(.mdx)은 티켓 doc 아님 → FAIL', () => {
    expect(lvl(runChecks(mk({ statusLines: [' M workflow/REQ-2026-001/01-design.mdx'] })), 'D13')).toBe('FAIL')
  })
  it('[exact match] 티켓 doc 경로를 prefix로 갖는 유사 파일(.orig) → FAIL', () => {
    expect(lvl(runChecks(mk({ statusLines: [' M workflow/REQ-2026-001/codex-request.md.orig'] })), 'D13')).toBe('FAIL')
  })
  it('[Codex P2] rename 우회 차단: src 코드 → 허용 티켓 doc로 rename → FAIL(원본도 검사)', () => {
    expect(
      lvl(runChecks(mk({ statusLines: ['R  src/foo.ts -> workflow/REQ-2026-001/01-design.md'] })), 'D13'),
    ).toBe('FAIL')
  })
  it('[Codex P2] rename 우회 차단: 티켓 doc → src 코드로 rename → FAIL(목적지도 검사)', () => {
    expect(
      lvl(runChecks(mk({ statusLines: ['R  workflow/REQ-2026-001/01-design.md -> src/foo.ts'] })), 'D13'),
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

describe('req:doctor — statusPaths(porcelain 경로 추출)', () => {
  it('일반 라인은 단일 경로(staged/unstaged/untracked)', () => {
    expect(statusPaths('M  src/foo.ts')).toEqual(['src/foo.ts'])
    expect(statusPaths(' M src/foo.ts')).toEqual(['src/foo.ts'])
    expect(statusPaths('?? src/new.ts')).toEqual(['src/new.ts'])
  })
  it('rename(R)은 [원본, 목적지] 둘 다', () => {
    expect(statusPaths('R  src/old.ts -> src/new.ts')).toEqual(['src/old.ts', 'src/new.ts'])
  })
  it('백슬래시 정규화', () => {
    expect(statusPaths('M  workflow\\REQ-1\\01-design.md')).toEqual(['workflow/REQ-1/01-design.md'])
  })
})

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
    const c = runChecks(mk({ statusLines: ['?? workflow/REQ-2026-001/responses/phase-A1-evidence-mechanism-r01-approved.json'], ticketRel: 'workflow/REQ-2026-001' } as MkArg))
    expect(lvl(c, 'D10')).toBe('OK')
  })
  it('커밋된 evidence 수정(tracked) → D10 FAIL', () => {
    const c = runChecks(mk({ statusLines: [' M workflow/REQ-2026-001/responses/design-r01-approved.json'], ticketRel: 'workflow/REQ-2026-001' } as MkArg))
    expect(lvl(c, 'D10')).toBe('FAIL')
  })
  it('approvals.jsonl untracked → D10 FAIL(스크래치 아님)', () => {
    const c = runChecks(mk({ statusLines: ['?? workflow/REQ-2026-001/responses/approvals.jsonl'], ticketRel: 'workflow/REQ-2026-001' } as MkArg))
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
    const c = runChecks(mk({ ...noDesign, statusLines: [`?? ${T}/responses/design-r01-needs-fix.json`] } as MkArg))
    expect(lvl(c, 'D13')).not.toBe('FAIL')
  })
  it('회귀: approvals.jsonl untracked는 D13에서 숨기지 않음(미승인→FAIL)', () => {
    const c = runChecks(mk({ ...noDesign, statusLines: [`?? ${T}/responses/approvals.jsonl`] } as MkArg))
    expect(lvl(c, 'D13')).toBe('FAIL')
  })
  it('회귀: tracked evidence 수정은 D13에서 숨기지 않음(미승인→FAIL)', () => {
    const c = runChecks(mk({ ...noDesign, statusLines: [` M ${T}/responses/design-r01-approved.json`] } as MkArg))
    expect(lvl(c, 'D13')).toBe('FAIL')
  })
  it('회귀: 타 티켓 아카이브는 D13에서 숨기지 않음(미승인→FAIL)', () => {
    const c = runChecks(mk({ ...noDesign, statusLines: ['?? workflow/REQ-2026-999/responses/design-r01-needs-fix.json'] } as MkArg))
    expect(lvl(c, 'D13')).toBe('FAIL')
  })
  it('회귀: collapsed responses/ 디렉터리는 D13에서 숨기지 않음(미승인→FAIL)', () => {
    const c = runChecks(mk({ ...noDesign, statusLines: [`?? ${T}/responses/`] } as MkArg))
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
  const validDesignOver = { designApproved: true, designApprovedHash: 'H', currentDesignHash: 'H', statusLines: manyStaged }
  it('코드 변경 많음 → D18 WARN', () => expect(lvl(runChecks(mk(validDesignOver)), 'D18')).toBe('WARN'))
  it('D18은 FAIL을 만들지 않음', () =>
    expect(runChecks(mk(validDesignOver)).filter((c) => c.id === 'D18' && c.level === 'FAIL')).toEqual([]))
  it('코드 변경 적음 → D18 OK', () =>
    expect(lvl(runChecks(mk({ designApproved: true, designApprovedHash: 'H', currentDesignHash: 'H', statusLines: ['M  src/a.ts'] })), 'D18')).toBe('OK'))

  it('[P2] config granularityMaxFiles=2 → 3파일이면 WARN(임계 주입)', () => {
    const three = ['M  src/a.ts', 'M  src/b.ts', 'M  src/c.ts']
    expect(
      lvl(runChecks(mk({ designApproved: true, designApprovedHash: 'H', currentDesignHash: 'H', statusLines: three, granularityMaxFiles: 2 })), 'D18'),
    ).toBe('WARN')
  })
  it('[P2] config granularityMaxFiles=50 → 12파일이어도 OK(임계 상향)', () => {
    expect(lvl(runChecks(mk({ ...validDesignOver, granularityMaxFiles: 50 })), 'D18')).toBe('OK')
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
