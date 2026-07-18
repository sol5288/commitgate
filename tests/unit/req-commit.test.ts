import { describe, it, expect } from 'vitest'
import { resolve, isAbsolute } from 'node:path'
import {
  buildManifestEntry,
  serializeManifestLine,
  validateManifest,
  expectedArchivePaths,
  userConfirmGate,
  consumeState,
  evidencePreflight,
  recoveryClassify,
  recoveryCoreValid,
  resolveRecoverySource,
  manifestHasConsumed,
  markPendingEvidence,
  parseArgs,
  resolveCommitTarget,
  buildCommitArgs,
  resolveMessageSource,
} from '../../scripts/req/req-commit'
import { finalizeD9Check } from '../../scripts/req/req-doctor'
import { buildScriptInvocation, type ResolvedConfig } from '../../scripts/req/lib/config'
import type { ApprovalEvidence, WorkflowState } from '../../scripts/req/review-codex'

const T = 'workflow/REQ-2026-016'
const SHA = 'a'.repeat(64) // response_sha256 (sha256)
const OID = 'c'.repeat(40) // git OID(40 hex)
const BASE = 'b'.repeat(40)
const COMMIT = 'd'.repeat(40)
const DHASH = 'e'.repeat(64) // design_hash (sha256)
const AT = '2026-06-29T00:00:00.000Z'
const CAT = '2026-06-29T01:00:00.000Z'

const phaseEv: ApprovalEvidence = {
  response_path: `${T}/responses/phase-A2-doctor-evidence-gates-r04-approved.json`,
  response_sha256: SHA,
  review_kind: 'phase',
  phase_id: 'phase-A2-doctor-evidence-gates',
  review_base_sha: BASE,
  approved_tree: OID,
  codex_thread_id: 'TID',
  machine_schema_version: '1.1',
  status: 'COMPLETE',
  commit_approved: 'yes',
  approved_at: AT,
}
const consume = { consumedAt: CAT, consumedByCommitSha: COMMIT, userCommitConfirmed: null }

describe('[P2a] resolveRecoverySource / recoveryCoreValid — orphaned source 복구창', () => {
  const APPROVED = 'a'.repeat(40)
  const st = (over: Partial<WorkflowState> = {}): WorkflowState =>
    ({
      id: 'REQ-2026-001',
      phase: 'X',
      commit_allowed: true,
      approval_evidence: { response_sha256: SHA } as unknown as ApprovalEvidence,
      approved_diff_hash: APPROVED,
      ...over,
    }) as WorkflowState

  it('pending 마커 있으면 그 SHA(viaOrphan=false)', () => {
    const r = resolveRecoverySource(st({ pending_evidence_for: { source_commit_sha: 'deadbeef' } }), { sha: 'HEAD', tree: 'other' })
    expect(r).toMatchObject({ sourceSha: 'deadbeef', viaOrphan: false })
  })
  it('마커 없고 HEAD tree==approved → HEAD를 orphaned source로 복구', () => {
    const r = resolveRecoverySource(st(), { sha: 'HEADSHA', tree: APPROVED })
    expect(r.sourceSha).toBe('HEADSHA')
    expect(r.viaOrphan).toBe(true)
  })
  it('마커 없고 HEAD tree!=approved → 복구 불가(승인 우회 방지)', () => {
    expect(resolveRecoverySource(st(), { sha: 'H', tree: 'mismatch' }).sourceSha).toBeNull()
  })
  it('commit_allowed 아님/approval_evidence 없음/HEAD null → orphaned 복구 안 함', () => {
    expect(resolveRecoverySource(st({ commit_allowed: false }), { sha: 'H', tree: APPROVED }).sourceSha).toBeNull()
    expect(resolveRecoverySource(st({ approval_evidence: undefined }), { sha: 'H', tree: APPROVED }).sourceSha).toBeNull()
    expect(resolveRecoverySource(st(), null).sourceSha).toBeNull()
  })
  it('recoveryCoreValid: source tree == approved면 valid, 아니면 invalid', () => {
    expect(recoveryCoreValid(st(), APPROVED).valid).toBe(true)
    expect(recoveryCoreValid(st(), 'X').valid).toBe(false)
    expect(recoveryCoreValid(st({ approved_diff_hash: null }), null).valid).toBe(false)
  })
})

describe('[B1] buildManifestEntry — 고정 필드 + fail-fast', () => {
  it('phase evidence → 필드 전부(approved_tree, design_hash 없음)', () => {
    expect(buildManifestEntry(phaseEv, consume)).toEqual({
      kind: 'phase',
      phase_id: 'phase-A2-doctor-evidence-gates',
      response_path: phaseEv.response_path,
      response_sha256: SHA,
      review_base_sha: BASE,
      approved_tree: OID,
      approved_at: AT,
      consumed_at: CAT,
      consumed_by_commit_sha: COMMIT,
      user_commit_confirmed: null,
    })
  })
  it('design evidence → design_hash 포함, approved_tree 없음, phase_id=null', () => {
    const dEv = { ...phaseEv, review_kind: 'design', phase_id: null, approved_tree: undefined, design_hash: DHASH } as ApprovalEvidence
    const e = buildManifestEntry(dEv, consume)
    expect(e.kind).toBe('design')
    expect(e.design_hash).toBe(DHASH)
    expect(e.approved_tree).toBeUndefined()
    expect(e.phase_id).toBe(null)
  })
  it('fail-fast: phase인데 approved_tree 없음 → throw', () => {
    expect(() => buildManifestEntry({ ...phaseEv, approved_tree: undefined } as ApprovalEvidence, consume)).toThrow()
  })
  it('fail-fast: design인데 design_hash 없음 → throw', () => {
    const dEv = { ...phaseEv, review_kind: 'design', phase_id: null, approved_tree: undefined } as ApprovalEvidence
    expect(() => buildManifestEntry(dEv, consume)).toThrow()
  })
})

describe('[B1] serializeManifestLine — JSONL·deterministic', () => {
  it('단일 라인 + 끝 newline + JSON 파싱 가능', () => {
    const line = serializeManifestLine(buildManifestEntry(phaseEv, consume))
    expect(line.endsWith('\n')).toBe(true)
    expect(line.trimEnd().includes('\n')).toBe(false)
    expect(JSON.parse(line)).toMatchObject({ kind: 'phase', consumed_by_commit_sha: COMMIT })
  })
  it('deterministic: 같은 입력 → 같은 직렬화', () => {
    expect(serializeManifestLine(buildManifestEntry(phaseEv, consume))).toBe(
      serializeManifestLine(buildManifestEntry(phaseEv, consume)),
    )
  })
})

describe('[B1] validateManifest — strict schema fail-closed', () => {
  const opts = { ticketRel: T, validPhaseIds: ['phase-A2-doctor-evidence-gates'] }
  const validRaw: Record<string, unknown> = {
    kind: 'phase',
    phase_id: 'phase-A2-doctor-evidence-gates',
    response_path: `${T}/responses/phase-A2-doctor-evidence-gates-r04-approved.json`,
    response_sha256: SHA,
    review_base_sha: BASE,
    approved_tree: OID,
    approved_at: AT,
    consumed_at: CAT,
    consumed_by_commit_sha: COMMIT,
    user_commit_confirmed: null,
  }
  const rawLine = (over: Record<string, unknown>) => `${JSON.stringify({ ...validRaw, ...over })}\n`
  const designValid: Record<string, unknown> = { ...validRaw, kind: 'design', phase_id: null, approved_tree: undefined, design_hash: DHASH, response_path: `${T}/responses/design-r02-approved.json` }
  const bad = (over: Record<string, unknown>) => expect(validateManifest(rawLine(over), opts).length).toBeGreaterThan(0)

  it('정상 phase manifest → 문제 없음', () => {
    expect(validateManifest(rawLine({}), opts)).toEqual([])
  })
  it('정상 design manifest → 문제 없음', () => {
    expect(validateManifest(`${JSON.stringify(designValid)}\n`, opts)).toEqual([])
  })
  it('user_commit_confirmed=true 객체 → OK', () => {
    expect(validateManifest(rawLine({ user_commit_confirmed: { confirmed: true, method: 'user-direct-command', confirmed_at: AT } }), opts)).toEqual([])
  })
  it('malformed JSONL → 문제', () => expect(validateManifest('{not json\n', opts).length).toBeGreaterThan(0))
  it('kind 비유효 → 문제', () => bad({ kind: 'foo' }))
  it('phase인데 design_hash 존재 → 문제', () => bad({ design_hash: DHASH }))
  it('phase인데 approved_tree 비-OID → 문제', () => bad({ approved_tree: 'xyz' }))
  it('phase_id가 validPhaseIds 밖 → 문제', () => bad({ phase_id: 'phase-X' }))
  it('design인데 phase_id 비-null → 문제', () => expect(validateManifest(`${JSON.stringify({ ...designValid, phase_id: 'p' })}\n`, opts).length).toBeGreaterThan(0))
  it('design인데 approved_tree 존재 → 문제', () => expect(validateManifest(`${JSON.stringify({ ...designValid, approved_tree: OID })}\n`, opts).length).toBeGreaterThan(0))
  it('design_hash 비-64hex → 문제', () => expect(validateManifest(`${JSON.stringify({ ...designValid, design_hash: 'short' })}\n`, opts).length).toBeGreaterThan(0))
  it('response_sha256 비-64hex → 문제', () => bad({ response_sha256: 'short' }))
  it('review_base_sha 비-OID → 문제', () => bad({ review_base_sha: 'nothex' }))
  it('consumed_by_commit_sha 비-OID → 문제', () => bad({ consumed_by_commit_sha: 'x' }))
  it('approved_at 비-ISO → 문제', () => bad({ approved_at: 'yesterday' }))
  it('consumed_at 비-ISO → 문제', () => bad({ consumed_at: 'soon' }))
  it('user_commit_confirmed.confirmed=false → 문제', () => bad({ user_commit_confirmed: { confirmed: false, method: 'm', confirmed_at: AT } }))
  it('[B2-block3] user_commit_confirmed method 누락 → 문제', () => bad({ user_commit_confirmed: { confirmed: true, confirmed_at: AT } }))
  it('[B2-block3] user_commit_confirmed confirmed_at 누락 → 문제', () => bad({ user_commit_confirmed: { confirmed: true, method: 'm' } }))
  it('[B2-block3] user_commit_confirmed confirmed_at 비-ISO → 문제', () => bad({ user_commit_confirmed: { confirmed: true, method: 'm', confirmed_at: 'nope' } }))
  it('예상 외 extra field → 문제', () => bad({ bogus: 1 }))
  it('다른 티켓 response_path → 문제', () => bad({ response_path: 'workflow/REQ-2026-999/responses/phase-A2-doctor-evidence-gates-r04-approved.json' }))
  it('path escape(..) → 문제', () => bad({ response_path: `${T}/responses/../../../etc/x-r01-approved.json` }))
  it('중복(같은 response_path) → 문제', () => expect(validateManifest(rawLine({}) + rawLine({ response_sha256: 'f'.repeat(64) }), opts).length).toBeGreaterThan(0))
  it('중복(같은 kind/phase/sha) → 문제', () => expect(validateManifest(rawLine({}) + rawLine({}), opts).length).toBeGreaterThan(0))
  // [B1-P2-1] response_path basename ↔ 행의 kind/phase_id 결속 + 승인본(-approved)만.
  it('[B1-P2-1] design 행이 phase 아카이브 경로 → 문제', () =>
    expect(validateManifest(`${JSON.stringify({ ...designValid, response_path: `${T}/responses/phase-A2-doctor-evidence-gates-r04-approved.json` })}\n`, opts).length).toBeGreaterThan(0))
  it('[B1-P2-1] phase 행이 다른 phase 아카이브 경로 → 문제', () =>
    bad({ response_path: `${T}/responses/phase-A1-evidence-mechanism-r01-approved.json` }))
  it('[B1-P2-1] response_path가 needs-fix → 문제(승인본 아님)', () =>
    bad({ response_path: `${T}/responses/phase-A2-doctor-evidence-gates-r04-needs-fix.json` }))
})

describe('[B1] expectedArchivePaths — target 라운드만 + round 정렬(deterministic)', () => {
  const names = [
    'phase-A2-doctor-evidence-gates-r04-approved.json',
    'phase-A2-doctor-evidence-gates-r01-needs-fix.json',
    'design-r02-approved.json',
    'phase-A1-evidence-mechanism-r01-approved.json',
    'approvals.jsonl',
    'phase-A2-doctor-evidence-gates-r02-needs-fix.json',
  ]
  it('phase target 아카이브만 round 오름차순(입력 순서 무관)', () => {
    expect(expectedArchivePaths(names, 'phase', 'phase-A2-doctor-evidence-gates', T)).toEqual([
      `${T}/responses/phase-A2-doctor-evidence-gates-r01-needs-fix.json`,
      `${T}/responses/phase-A2-doctor-evidence-gates-r02-needs-fix.json`,
      `${T}/responses/phase-A2-doctor-evidence-gates-r04-approved.json`,
    ])
  })
  it('design target → design 아카이브만', () => {
    expect(expectedArchivePaths(names, 'design', null, T)).toEqual([`${T}/responses/design-r02-approved.json`])
  })
})

describe('[B2] userConfirmGate — HIGH 사람확인 게이트', () => {
  const st = (over: Partial<WorkflowState>): WorkflowState => ({ id: 'X', phase: 'P', ...over } as WorkflowState)
  it('LOW → 차단 안 함', () => expect(userConfirmGate(st({ risk_level: 'LOW' })).blocked).toBe(false))
  it('HIGH + 확인 기록 없음 → 차단', () => expect(userConfirmGate(st({ risk_level: 'HIGH' })).blocked).toBe(true))
  it('HIGH + confirmed=false → 차단', () =>
    expect(userConfirmGate(st({ risk_level: 'HIGH', user_commit_confirmed: { confirmed: false, method: 'm', confirmed_at: AT } })).blocked).toBe(true))
  it('HIGH + confirmed=true(method+ISO confirmed_at) → 허용', () =>
    expect(userConfirmGate(st({ risk_level: 'HIGH', user_commit_confirmed: { confirmed: true, method: 'user-direct-command', confirmed_at: AT } })).blocked).toBe(false))
  // [B2-block3] HIGH 확인 기록 강화: confirmed=true만으로 부족 — method(비어있지 않음)+confirmed_at(ISO) 필수.
  it('[B2-block3] HIGH + confirmed=true·method 누락 → 차단', () =>
    expect(userConfirmGate(st({ risk_level: 'HIGH', user_commit_confirmed: { confirmed: true, confirmed_at: AT } })).blocked).toBe(true))
  it('[B2-block3] HIGH + confirmed=true·method 빈문자열 → 차단', () =>
    expect(userConfirmGate(st({ risk_level: 'HIGH', user_commit_confirmed: { confirmed: true, method: '  ', confirmed_at: AT } })).blocked).toBe(true))
  it('[B2-block3] HIGH + confirmed=true·confirmed_at 누락 → 차단', () =>
    expect(userConfirmGate(st({ risk_level: 'HIGH', user_commit_confirmed: { confirmed: true, method: 'm' } })).blocked).toBe(true))
  it('[B2-block3] HIGH + confirmed=true·confirmed_at 비-ISO → 차단', () =>
    expect(userConfirmGate(st({ risk_level: 'HIGH', user_commit_confirmed: { confirmed: true, method: 'm', confirmed_at: 'nope' } })).blocked).toBe(true))
})

describe('[B2-block1/2] evidencePreflight — source 커밋 전 evidence 실패 차단', () => {
  const validPhaseIds = ['phase-A2-doctor-evidence-gates']
  const evOk: ApprovalEvidence = {
    response_path: `${T}/responses/phase-A2-doctor-evidence-gates-r04-approved.json`,
    response_sha256: SHA, review_kind: 'phase', phase_id: 'phase-A2-doctor-evidence-gates',
    review_base_sha: BASE, approved_tree: OID, codex_thread_id: 'TID',
    machine_schema_version: '1.1', status: 'COMPLETE', commit_approved: 'yes', approved_at: AT,
  }
  const archivesOk = [
    'phase-A2-doctor-evidence-gates-r04-approved.json',
    'phase-A2-doctor-evidence-gates-r01-needs-fix.json',
  ]
  const baseInput = {
    existingManifest: '', approvalEvidence: evOk, archiveNames: archivesOk,
    ticketRel: T, validPhaseIds, responsePathExists: true, userCommitConfirmed: null,
    placeholderCommitSha: COMMIT, placeholderConsumedAt: AT,
  }
  const pf = (over: Record<string, unknown>) => evidencePreflight({ ...baseInput, ...over })

  it('정상 → []', () => expect(pf({})).toEqual([]))
  it('approval_evidence 없음 → 문제', () => expect(pf({ approvalEvidence: null }).length).toBeGreaterThan(0))
  it('response_path가 expectedArchivePaths에 없음 → 문제', () =>
    expect(pf({ approvalEvidence: { ...evOk, response_path: `${T}/responses/phase-A2-doctor-evidence-gates-r09-approved.json` } }).length).toBeGreaterThan(0))
  it('approved 아카이브 없음(needs-fix만) → 문제', () =>
    expect(pf({
      archiveNames: ['phase-A2-doctor-evidence-gates-r01-needs-fix.json'],
      approvalEvidence: { ...evOk, response_path: `${T}/responses/phase-A2-doctor-evidence-gates-r01-needs-fix.json` },
    }).length).toBeGreaterThan(0))
  // (c) approved≥1 분기를 **독립 강제**(mutation-killing): (f) basename 메시지가 아닌 (c) 고유 메시지 존재를 단언.
  it('[B2-block2-c] approved 없음 → (c) "approved 아카이브 없음" 메시지 명시', () =>
    expect(pf({
      archiveNames: ['phase-A2-doctor-evidence-gates-r01-needs-fix.json'],
      approvalEvidence: { ...evOk, response_path: `${T}/responses/phase-A2-doctor-evidence-gates-r01-needs-fix.json` },
    }).some((p) => p.includes('approved 아카이브 없음'))).toBe(true))
  it('response_path 파일 부재 → 문제', () => expect(pf({ responsePathExists: false }).length).toBeGreaterThan(0))
  it('기존 manifest 무결성 실패 → 문제', () => expect(pf({ existingManifest: '{not json\n' }).length).toBeGreaterThan(0))
  it('이미 소비된 승인(candidate 중복) → 문제', () => {
    const dup = serializeManifestLine(buildManifestEntry(evOk, { consumedAt: CAT, consumedByCommitSha: COMMIT, userCommitConfirmed: null }))
    expect(pf({ existingManifest: dup }).length).toBeGreaterThan(0)
  })
})

describe('[B2] consumeState — 소비(evidence 커밋 후 마지막)', () => {
  const base = {
    id: 'X', phase: 'P', risk_level: 'HIGH', commit_allowed: true, approved_diff_hash: OID,
    current_phase: 'phase-B2-req-commit-flow', phases: [{ id: 'phase-B2-req-commit-flow', approved: true }],
    user_commit_confirmed: { confirmed: true, method: 'm', confirmed_at: AT },
    approval_evidence: { response_path: 'p', response_sha256: 'x', review_kind: 'phase' },
  } as unknown as WorkflowState
  it('commit_allowed=false·approved_diff_hash=null·consumed_approvals append·user_commit_confirmed 초기화·approval_evidence 제거·phases 보존', () => {
    const ns = consumeState(base, { sourceCommitSha: COMMIT, consumedAt: CAT })
    expect(ns.commit_allowed).toBe(false)
    expect(ns.approved_diff_hash).toBe(null)
    expect(ns.user_commit_confirmed).toBe(null)
    expect(ns.approval_evidence).toBeUndefined()
    expect(ns.phases).toEqual([{ id: 'phase-B2-req-commit-flow', approved: true }])
    const ca = ns.consumed_approvals as Array<Record<string, unknown>>
    expect(Array.isArray(ca)).toBe(true)
    expect(ca.length).toBe(1)
    expect(ca[0]).toMatchObject({ consumed_by_commit_sha: COMMIT, approved_tree: OID, phase_id: 'phase-B2-req-commit-flow', approval_consumed_at: CAT })
  })
  it('기존 consumed_approvals에 append(기존 보존)', () => {
    const ns = consumeState({ ...base, consumed_approvals: [{ prev: 1 }] } as WorkflowState, { sourceCommitSha: COMMIT, consumedAt: CAT })
    const ca = ns.consumed_approvals as Array<Record<string, unknown>>
    expect(ca.length).toBe(2)
    expect(ca[0]).toEqual({ prev: 1 })
  })
})

describe('[B3] finalizeD9Check — 정상/finalize D9(우회 아님, 비교 대상만 교체)', () => {
  const A = OID
  it('commit_allowed=false → ok(점검 불요)', () =>
    expect(finalizeD9Check({ commitAllowed: false, finalize: false, approvedDiffHash: null, stagedTree: null, finalizeSourceTree: null }).ok).toBe(true))
  it('commit_allowed=true·approved 없음 → !ok', () =>
    expect(finalizeD9Check({ commitAllowed: true, finalize: false, approvedDiffHash: null, stagedTree: A, finalizeSourceTree: A }).ok).toBe(false))
  it('정상(finalize=false): staged==approved → ok', () =>
    expect(finalizeD9Check({ commitAllowed: true, finalize: false, approvedDiffHash: A, stagedTree: A, finalizeSourceTree: 'zzz' }).ok).toBe(true))
  it('정상(finalize=false): staged!=approved → !ok', () =>
    expect(finalizeD9Check({ commitAllowed: true, finalize: false, approvedDiffHash: A, stagedTree: BASE, finalizeSourceTree: A }).ok).toBe(false))
  it('finalize: source tree==approved → ok', () =>
    expect(finalizeD9Check({ commitAllowed: true, finalize: true, approvedDiffHash: A, stagedTree: 'zzz', finalizeSourceTree: A }).ok).toBe(true))
  it('finalize: source tree!=approved → !ok(staged가 approved여도 우회 불가)', () =>
    expect(finalizeD9Check({ commitAllowed: true, finalize: true, approvedDiffHash: A, stagedTree: A, finalizeSourceTree: BASE }).ok).toBe(false))
  it('finalize: source tree=null(마커 없음) → !ok(fail-closed)', () =>
    expect(finalizeD9Check({ commitAllowed: true, finalize: true, approvedDiffHash: A, stagedTree: A, finalizeSourceTree: null }).ok).toBe(false))
})

describe('[B3] recoveryClassify — finalize 유효성(pending 마커 + source 커밋 tree 기반)', () => {
  const st = (over: Record<string, unknown>) =>
    ({
      id: 'X', phase: 'P', commit_allowed: true, approved_diff_hash: OID,
      approval_evidence: { review_kind: 'phase', response_path: 'p' },
      pending_evidence_for: { source_commit_sha: COMMIT }, ...over,
    } as unknown as WorkflowState)
  it('정상 partial(source tree==approved) → valid', () => expect(recoveryClassify(st({}), OID).valid).toBe(true))
  // B3-P1 회귀: evidence 커밋 후 HEAD=evidence 커밋이어도, source tree(마커 기반)==approved면 valid(consume-only 복구창).
  it('[B3-P1] HEAD가 evidence 커밋이어도 source tree==approved면 valid', () => expect(recoveryClassify(st({}), OID).valid).toBe(true))
  it('pending 마커 없음 → invalid', () => expect(recoveryClassify(st({ pending_evidence_for: undefined }), OID).valid).toBe(false))
  it('source tree!=approved → invalid', () => expect(recoveryClassify(st({}), BASE).valid).toBe(false))
  it('commit_allowed=false → invalid', () => expect(recoveryClassify(st({ commit_allowed: false }), OID).valid).toBe(false))
  it('approval_evidence 없음 → invalid', () => expect(recoveryClassify(st({ approval_evidence: undefined }), OID).valid).toBe(false))
  it('approved_diff_hash 없음 → invalid', () => expect(recoveryClassify(st({ approved_diff_hash: null }), OID).valid).toBe(false))
})

describe('[B3] manifestHasConsumed — 멱등(sourceSha + evidence identity)', () => {
  const line = serializeManifestLine(
    buildManifestEntry(
      {
        response_path: `${T}/responses/phase-A2-doctor-evidence-gates-r04-approved.json`, response_sha256: SHA,
        review_kind: 'phase', phase_id: 'phase-A2-doctor-evidence-gates', review_base_sha: BASE, approved_tree: OID,
        codex_thread_id: 'TID', machine_schema_version: '1.1', status: 'COMPLETE', commit_approved: 'yes', approved_at: AT,
      } as ApprovalEvidence,
      { consumedAt: CAT, consumedByCommitSha: COMMIT, userCommitConfirmed: null },
    ),
  )
  const id = { reviewKind: 'phase' as const, phaseId: 'phase-A2-doctor-evidence-gates', responseSha256: SHA }
  it('동일 sourceSha+identity → true', () => expect(manifestHasConsumed(line, COMMIT, id)).toBe(true))
  // B3-R2: 같은 source SHA를 쓰는 다른 엔트리(design-finalize 등)에 오인 금지 — response_sha256까지 일치해야.
  it('[B3-R2] 동일 sourceSha·다른 response_sha256 → false(오인 방지)', () =>
    expect(manifestHasConsumed(line, COMMIT, { ...id, responseSha256: 'f'.repeat(64) })).toBe(false))
  it('[B3-R2] 동일 sourceSha·다른 phase_id → false', () =>
    expect(manifestHasConsumed(line, COMMIT, { ...id, phaseId: 'phase-other' })).toBe(false))
  it('다른 sourceSha → false', () => expect(manifestHasConsumed(line, BASE, id)).toBe(false))
  it('빈 매니페스트 → false', () => expect(manifestHasConsumed('', COMMIT, id)).toBe(false))
})

describe('[B3] markPendingEvidence / consume 마커 정리', () => {
  it('markPendingEvidence → pending_evidence_for.source_commit_sha 기록', () => {
    const ns = markPendingEvidence({ id: 'X', phase: 'P' } as WorkflowState, COMMIT)
    expect((ns.pending_evidence_for as { source_commit_sha?: string }).source_commit_sha).toBe(COMMIT)
  })
  it('consumeState → pending_evidence_for 제거', () => {
    const withPending = { id: 'X', phase: 'P', commit_allowed: true, approved_diff_hash: OID, current_phase: 'p', pending_evidence_for: { source_commit_sha: COMMIT } } as unknown as WorkflowState
    expect(consumeState(withPending, { sourceCommitSha: COMMIT, consumedAt: CAT }).pending_evidence_for).toBeUndefined()
  })
})

// ─────────────────────────────── [P2] CLI 파싱·--root 전파·packageManager argv ──
const cfgStub = (over: Partial<ResolvedConfig> = {}): ResolvedConfig => ({
  root: '/repo',
  ticketRoot: 'workflow',
  schemaPath: 'workflow/machine.schema.json',
  handoffPath: null,
  reviewPersonaPath: 'workflow/review-persona.md',
  branchPrefix: 'feat/req-',
  packageManager: 'pnpm',
  granularityMaxFiles: 8,
  designDocs: { requirement: '00-requirement.md', design: '01-design.md', plan: '02-plan.md' },
  reviewModel: 'gpt-5.6-terra',
  reviewReasoningEffort: 'high',
  reviewBudget: { autoBudget: 5, hardCap: 8 },
  workflowDirAbs: '/repo/workflow',
  schemaPathAbs: '/repo/workflow/machine.schema.json',
  handoffPathAbs: null,
  reviewPersonaPathAbs: '/repo/workflow/review-persona.md',
  ...over,
})

describe('req:commit — parseArgs/--root 전파 + packageManager argv', () => {
  it('[P2] --root 수용(config 탐색 루트 주입)', () => {
    expect(parseArgs(['2026-017', '--root', '/x']).root).toBe('/x')
    expect(parseArgs(['2026-017']).root).toBe(null)
  })
  it('[P2] --root 값 누락은 throw', () => {
    expect(() => parseArgs(['2026-017', '--root'])).toThrow(/--root/)
  })
  it('--finalize와 --finalize-design 동시 사용은 throw(behavior-preserving)', () => {
    expect(() => parseArgs(['2026-017', '--finalize', '--finalize-design'])).toThrow(/동시/)
  })
  it('REQ id·--ticket 둘 다 없으면 throw', () => {
    expect(() => parseArgs(['--run'])).toThrow(/REQ id/)
  })
  it('[P2] resolveCommitTarget: reqId → workflowDirAbs 기준 ticketDir + doctorArgs에 --root cfg.root 전파', () => {
    const { ticketDir, doctorArgs } = resolveCommitTarget(parseArgs(['2026-017']), cfgStub())
    expect(ticketDir.replace(/\\/g, '/')).toBe('/repo/workflow/REQ-2026-017')
    expect(doctorArgs).toEqual(['2026-017', '--root', '/repo'])
  })
  it('[P2] resolveCommitTarget: --ticket → doctorArgs에 ticket + --root 전파', () => {
    const { doctorArgs } = resolveCommitTarget(parseArgs(['--ticket', '/repo/workflow/REQ-2026-017']), cfgStub())
    expect(doctorArgs).toEqual(['--ticket', resolve('/repo/workflow/REQ-2026-017'), '--root', '/repo'])
  })
  it('[P2] buildScriptInvocation: pnpm은 직접, npm은 `run --` 삽입(runDoctor argv)', () => {
    const args = ['2026-017', '--root', '/repo']
    expect(buildScriptInvocation('pnpm', 'req:doctor', args)).toEqual(['pnpm', 'req:doctor', '2026-017', '--root', '/repo'])
    expect(buildScriptInvocation('npm', 'req:doctor', args)).toEqual(['npm', 'run', 'req:doctor', '--', '2026-017', '--root', '/repo'])
  })
})

// ─────────────────────────────── [REQ-018] req:commit --message-file ──
describe('REQ-018 — buildCommitArgs (source 커밋 args)', () => {
  it('messageFile → commit -F (메시지 내용이 argv에 없음)', () => {
    expect(buildCommitArgs({ message: null, messageFile: '/abs/msg.txt' })).toEqual(['commit', '-F', '/abs/msg.txt'])
  })
  it('message → commit -m (기존 경로 보존)', () => {
    expect(buildCommitArgs({ message: 'subject', messageFile: null })).toEqual(['commit', '-m', 'subject'])
  })
  it('[재발 방지] multi-line 메시지는 -F 파일경로로만 — argv에 newline 없음(pnpm/Windows 이스케이프 불가)', () => {
    // 핵심: 여러 줄 메시지는 파일에 두고 args엔 경로만 → pnpm argv newline 이스케이프 자체가 발생 불가
    const args = buildCommitArgs({ message: null, messageFile: '/abs/multiline-msg.txt' })
    expect(args).toEqual(['commit', '-F', '/abs/multiline-msg.txt'])
    expect(args.some((a) => a.includes('\n'))).toBe(false)
  })
  it('둘 다/둘 다 아님 → throw(방어)', () => {
    expect(() => buildCommitArgs({ message: 'x', messageFile: '/f' })).toThrow()
    expect(() => buildCommitArgs({ message: null, messageFile: null })).toThrow()
  })
})

describe('REQ-018 — resolveMessageSource (출처 해소·절대경로 정규화·존재검증)', () => {
  const exists = (): boolean => true
  it('상호배타: message + messageFile 동시 → throw', () => {
    expect(() => resolveMessageSource({ message: 'x', messageFile: '/abs/f' }, undefined, exists)).toThrow(/동시/)
  })
  it('필수: 둘 다 없음(env도 없음) → throw', () => {
    expect(() => resolveMessageSource({ message: null, messageFile: null }, undefined, exists)).toThrow(/메시지 필요/)
  })
  it('message만 → 그대로(messageFile null)', () => {
    expect(resolveMessageSource({ message: 'subj', messageFile: null }, undefined, exists)).toEqual({ message: 'subj', messageFile: null })
  })
  it('env fallback: CLI 둘 다 없으면 REQ_COMMIT_MESSAGE_FILE 사용(절대경로 정규화)', () => {
    const r = resolveMessageSource({ message: null, messageFile: null }, '/abs/env.txt', exists)
    expect(r.message).toBe(null)
    expect(r.messageFile).toBe(resolve('/abs/env.txt'))
  })
  it('CLI 우선: CLI messageFile 있으면 env 무시', () => {
    const r = resolveMessageSource({ message: null, messageFile: '/abs/cli.txt' }, '/abs/env.txt', exists)
    expect(r.messageFile).toBe(resolve('/abs/cli.txt'))
  })
  it('[r02] 절대경로 정규화: CLI·env 상대경로도 절대경로 반환(isAbsolute)', () => {
    const cli = resolveMessageSource({ message: null, messageFile: 'rel/cli.txt' }, undefined, exists)
    const env = resolveMessageSource({ message: null, messageFile: null }, 'rel/env.txt', exists)
    expect(isAbsolute(cli.messageFile as string)).toBe(true)
    expect(isAbsolute(env.messageFile as string)).toBe(true)
  })
  it('[r02] existsFn은 절대경로로 호출됨(검증 위치 = git -F 읽기 위치)', () => {
    const seen: string[] = []
    resolveMessageSource({ message: null, messageFile: 'rel/x.txt' }, undefined, (p) => {
      seen.push(p)
      return true
    })
    expect(seen).toHaveLength(1)
    expect(seen[0]).toBe(resolve('rel/x.txt'))
    expect(isAbsolute(seen[0] as string)).toBe(true)
  })
  it('존재검증: 파일 부재(existsFn=false) → throw', () => {
    expect(() => resolveMessageSource({ message: null, messageFile: '/abs/missing' }, undefined, () => false)).toThrow(/경로 없음/)
  })
})

describe('REQ-018 — parseArgs --message-file', () => {
  it('--message-file 파싱(미지정 시 null)', () => {
    expect(parseArgs(['2026-018', '--message-file', '/abs/m.txt']).messageFile).toBe('/abs/m.txt')
    expect(parseArgs(['2026-018']).messageFile).toBe(null)
  })
  it('--message-file 값 누락 → throw', () => {
    expect(() => parseArgs(['2026-018', '--message-file'])).toThrow(/--message-file/)
  })
  it('회귀: -m·--finalize 기존 파싱 불변', () => {
    expect(parseArgs(['2026-018', '-m', 'msg']).message).toBe('msg')
    expect(parseArgs(['2026-018', '--finalize']).finalize).toBe(true)
  })
})
