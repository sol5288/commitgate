import { describe, it, expect, afterEach, vi } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, isAbsolute, join } from 'node:path'
import {
  buildArchiveInventory,
  buildManifestEntry,
  designEvidenceStagePaths,
  serializeManifestLine,
  validateManifest,
  expectedArchivePaths,
  userConfirmGate,
  userConfirmProblem,
  consumeState,
  wouldCompleteReq,
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
  computeDevCompleteProof,
  evidencedPhaseIdsFromManifest,
  designHashFromManifest,
  forbiddenSourceStagedMessage,
  stagedNames,
  looksLikeCollapsedMessage,
  collapsedMessageWarning,
  main as reqCommitMain,
} from '../../scripts/req/req-commit'
import { STAGED_NAMES_Z_ARGS } from '../../scripts/req/review-codex'
import { sourceCommitForbiddenStaged } from '../../scripts/req/lib/scratch'
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
  phaseCommit: { autoApprove: 'never' },
  lockfilePromptFull: false,
  setup: null,
  stopGate: 'phase',
  trunkBranch: 'main',
  granularityGate: 'block',
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

/** REQ-2026-030 — ISO 달력 검증 통일(isValidIsoInstant). 달력 불가능 값 거부 + 정상 값 약화 없음. */
describe('REQ-2026-030 — ISO 달력 검증(req-commit)', () => {
  const T2 = 'workflow/REQ-2026-001'
  const opts = { ticketRel: T2, validPhaseIds: ['p1'] }
  const validManifest = (over: Record<string, unknown> = {}): string => JSON.stringify({
    kind: 'phase', phase_id: 'p1',
    response_path: `${T2}/responses/p1-r02-approved.json`,
    response_sha256: 'a'.repeat(64), review_base_sha: 'b'.repeat(40),
    approved_tree: 'c'.repeat(40), approved_at: '2026-07-18T00:00:00.000Z',
    consumed_at: '2026-07-18T00:00:01.000Z', consumed_by_commit_sha: 'd'.repeat(40),
    user_commit_confirmed: null, ...over,
  }) + '\n'
  const hasProblem = (line: string): boolean => validateManifest(line, opts).length > 0

  it('O1-1 🔴 approved_at·consumed_at에 달력 불가능 값 → 거부(2026-99-99, 13월, 2월30일)', () => {
    expect(hasProblem(validManifest({ approved_at: '2026-99-99T99:99:99Z' }))).toBe(true)
    expect(hasProblem(validManifest({ approved_at: '2026-13-01T00:00:00Z' }))).toBe(true)
    expect(hasProblem(validManifest({ consumed_at: '2026-02-30T00:00:00Z' }))).toBe(true)
  })
  it('O1-2 🔴 정상 ISO(밀리초 유·무)는 통과 — 약화 없음', () => {
    expect(hasProblem(validManifest({ approved_at: '2026-07-18T00:00:00Z', consumed_at: '2026-07-18T00:00:01Z' }))).toBe(false)
    expect(hasProblem(validManifest({ approved_at: '2026-07-18T00:00:00.480Z' }))).toBe(false)
  })
  it('O1-3 형식 위반 거부(통일 후에도 유지)', () => {
    expect(hasProblem(validManifest({ approved_at: 'not-a-date' }))).toBe(true)
    expect(hasProblem(validManifest({ consumed_at: '2026-07-18' }))).toBe(true)
  })

  it('O1-1/O1-2/O1-3 🔴 userConfirmProblem(confirmed_at)도 동일하게', () => {
    const ucc = (at: unknown) => ({ confirmed: true, method: 'user-direct', confirmed_at: at })
    expect(userConfirmProblem(ucc('2026-99-99T99:99:99Z'))).not.toBeNull() // 달력 거부
    expect(userConfirmProblem(ucc('2026-07-18T00:00:00Z'))).toBeNull()     // 정상 통과
    expect(userConfirmProblem(ucc('2026-07-18T00:00:00.480Z'))).toBeNull() // 밀리초 통과
    expect(userConfirmProblem(ucc('not-a-date'))).not.toBeNull()           // 형식 거부
  })
})

// ───────────────────────── archive_inventory (REQ-2026-048 phase-2) ──

describe('[REQ-2026-048] archive_inventory — 라운드 아카이브 전량 영속화', () => {
  const opts = { ticketRel: T, validPhaseIds: ['phase-A2-doctor-evidence-gates'] }
  const APPROVED_REL = `${T}/responses/design-r02-approved.json`
  const NEEDSFIX_REL = `${T}/responses/design-r01-needs-fix.json`
  const designRow = (over: Record<string, unknown> = {}): string =>
    `${JSON.stringify({
      kind: 'design',
      phase_id: null,
      response_path: APPROVED_REL,
      response_sha256: SHA,
      review_base_sha: BASE,
      design_hash: DHASH,
      approved_at: AT,
      consumed_at: CAT,
      consumed_by_commit_sha: COMMIT,
      user_commit_confirmed: null,
      ...over,
    })}\n`

  it('필드 부재 = 매니페스트 검증상 유효(기존 행 무회귀)', () => {
    expect(validateManifest(designRow(), opts)).toEqual([])
  })

  it('정상 인벤토리(needs-fix 포함) → 문제 없음', () => {
    const inv = [
      { response_path: NEEDSFIX_REL, sha256: DHASH },
      { response_path: APPROVED_REL, sha256: SHA },
    ]
    expect(validateManifest(designRow({ archive_inventory: inv }), opts)).toEqual([])
  })

  /** 🔴 인벤토리는 needs-fix를 허용하지만, **행 최상위 response_path는 여전히 approved만**이다(의미가 다르다). */
  it('행 최상위 response_path가 needs-fix면 여전히 거부된다', () => {
    const problems = validateManifest(designRow({ response_path: NEEDSFIX_REL }), opts)
    expect(problems.join(' ')).toMatch(/design-rNN-approved\.json 아님/)
  })

  it('비-confined 경로·타 티켓 → 거부', () => {
    for (const p of [`workflow/REQ-2026-999/responses/design-r01-approved.json`, `${T}/responses/../x-r01-approved.json`, `${T}/responses/approvals.jsonl`]) {
      const problems = validateManifest(designRow({ archive_inventory: [{ response_path: p, sha256: SHA }] }), opts)
      expect(problems.join(' '), p).toMatch(/archive_inventory\[0\]: response_path 비confined/)
    }
  })

  it('sha256 형식 오류 → 거부', () => {
    const problems = validateManifest(designRow({ archive_inventory: [{ response_path: APPROVED_REL, sha256: 'nope' }] }), opts)
    expect(problems.join(' ')).toMatch(/archive_inventory\[0\]: sha256 형식 오류/)
  })

  it('배열 아님 · 항목 object 아님 · 예상 외 필드 → 거부', () => {
    expect(validateManifest(designRow({ archive_inventory: 'x' }), opts).join(' ')).toMatch(/배열 아님/)
    expect(validateManifest(designRow({ archive_inventory: ['x'] }), opts).join(' ')).toMatch(/object 아님/)
    expect(
      validateManifest(designRow({ archive_inventory: [{ response_path: APPROVED_REL, sha256: SHA, evil: 1 }] }), opts).join(' '),
    ).toMatch(/예상 외 필드: evil/)
  })

  it('인벤토리 내 중복 경로 → 거부(주입 방지)', () => {
    const inv = [
      { response_path: APPROVED_REL, sha256: SHA },
      { response_path: APPROVED_REL, sha256: SHA },
    ]
    expect(validateManifest(designRow({ archive_inventory: inv }), opts).join(' ')).toMatch(/중복 response_path/)
  })

  it('buildManifestEntry: 미지정이면 키 자체가 없다(기존 행과 바이트 동일)', () => {
    const e = buildManifestEntry(phaseEv, consume)
    expect('archive_inventory' in e).toBe(false)
    expect(serializeManifestLine(e)).toBe(serializeManifestLine(buildManifestEntry(phaseEv, consume)))
  })

  /**
   * 🔴 수집 범위의 **결정성**: 현재 티켓 responses/ 직계의 해당 kind 아카이브 전부를 rNN **오름차순**으로,
   * 디렉터리 읽기 순서와 무관하게 담는다. phase 아카이브·비아카이브는 제외된다.
   */
  it('buildArchiveInventory: design 아카이브만 rNN 오름차순으로, 읽기 순서 비의존', () => {
    const names = [
      'design-r02-approved.json',
      'approvals.jsonl',
      'phase-A2-doctor-evidence-gates-r04-approved.json',
      'design-r01-needs-fix.json',
      'design-r10-needs-fix.json',
    ]
    const shaOf = (p: string): string => (p.includes('r01') ? DHASH : SHA)
    const inv = buildArchiveInventory(names, 'design', null, T, shaOf)
    expect(inv.map((i) => i.response_path)).toEqual([
      `${T}/responses/design-r01-needs-fix.json`,
      `${T}/responses/design-r02-approved.json`,
      `${T}/responses/design-r10-needs-fix.json`,
    ])
    expect(inv[0]?.sha256).toBe(DHASH)
    // 입력 순서를 뒤집어도 결과가 같다(결정적).
    expect(buildArchiveInventory([...names].reverse(), 'design', null, T, shaOf)).toEqual(inv)
  })

  it('buildArchiveInventory 결과가 validateManifest를 그대로 통과한다(왕복)', () => {
    const names = ['design-r01-needs-fix.json', 'design-r02-approved.json']
    const inv = buildArchiveInventory(names, 'design', null, T, () => SHA)
    expect(validateManifest(designRow({ archive_inventory: inv }), opts)).toEqual([])
  })

  /** ④ 인벤토리 **전량**이 stage 목록에 들어간다 — 이것이 needs-fix 라운드가 커밋 이력에 남는 유일한 경로다. */
  it('designEvidenceStagePaths: 인벤토리 전량 + 승인본 + approvals.jsonl, 중복 없음', () => {
    const inv = [
      { response_path: NEEDSFIX_REL, sha256: DHASH },
      { response_path: APPROVED_REL, sha256: SHA },
    ]
    expect(designEvidenceStagePaths(inv, APPROVED_REL, T)).toEqual([
      NEEDSFIX_REL,
      APPROVED_REL, // 승인본이 인벤토리에 이미 있어도 중복되지 않는다
      `${T}/responses/approvals.jsonl`,
    ])
  })

  it('designEvidenceStagePaths: 인벤토리가 비어도 승인본·매니페스트는 남는다(퇴화 안전)', () => {
    expect(designEvidenceStagePaths([], APPROVED_REL, T)).toEqual([APPROVED_REL, `${T}/responses/approvals.jsonl`])
  })

  /** ⑯ REQ-2026-051: 원장이 있으면 같은 커밋에 합류한다. 없으면 넣지 않는다(없는 pathspec으로 커밋 실패 방지). */
  it('designEvidenceStagePaths: ledgerExists=true면 원장이 합류, false면 미포함', () => {
    expect(designEvidenceStagePaths([], APPROVED_REL, T, false)).toEqual([APPROVED_REL, `${T}/responses/approvals.jsonl`])
    expect(designEvidenceStagePaths([], APPROVED_REL, T, true)).toEqual([
      APPROVED_REL,
      `${T}/responses/approvals.jsonl`,
      `${T}/responses/review-ledger.jsonl`,
    ])
  })

  it('designEvidenceStagePaths: 3-arg 호출은 원장 없이(기존 호출부 무회귀)', () => {
    expect(designEvidenceStagePaths([], APPROVED_REL, T)).not.toContain(`${T}/responses/review-ledger.jsonl`)
  })

  /** 🔴 무관한 index 변경이 evidence 커밋에 딸려 들어가지 못하게 — 티켓 responses/ 밖 경로는 절대 stage하지 않는다. */
  it('designEvidenceStagePaths: 티켓 responses/ 밖 경로는 걸러낸다', () => {
    const evil = [
      { response_path: 'src/secret.ts', sha256: SHA },
      { response_path: `workflow/REQ-2026-999/responses/design-r01-approved.json`, sha256: SHA },
      { response_path: `${T}/responses/../../escape-r01-approved.json`, sha256: SHA },
    ]
    expect(designEvidenceStagePaths(evil, APPROVED_REL, T)).toEqual([APPROVED_REL, `${T}/responses/approvals.jsonl`])
  })
})

// ─────────────────── REQ-2026-052 phase-3a: self-verifying dev-complete 발행 결정(순수) ───────────────────
describe('[REQ-2026-052] computeDevCompleteProof — 마지막 phase 발행 결정(순수)', () => {
  const T = 'REQ-2026-052'
  // 🔴 DEC-B5: phase 행은 승인 시점 design 결속(phase_design_ref)을 갖는다. 기본값 'DREF'(현재 design과 일치).
  const phaseEntry = (pid: string, ref: string | null = 'DREF'): string =>
    JSON.stringify({ kind: 'phase', phase_id: pid, response_path: `x`, response_sha256: 's', review_base_sha: 'b', approved_tree: 't', ...(ref === null ? {} : { phase_design_ref: ref }), approved_at: 'A', consumed_at: 'C', consumed_by_commit_sha: 'X', user_commit_confirmed: null }) + '\n'
  const designEntry = (hash: string): string =>
    JSON.stringify({ kind: 'design', phase_id: null, response_path: 'd', response_sha256: 's', review_base_sha: 'b', design_hash: hash, approved_at: 'A', consumed_at: 'C', consumed_by_commit_sha: 'X', user_commit_confirmed: null }) + '\n'

  it('㊱ 아직 마지막 phase 아님(inventory 중 미증거) → null', () => {
    const manifest = designEntry('DREF') + phaseEntry('p1') // p2 아직 없음
    expect(computeDevCompleteProof({ ticketId: T, phaseIds: ['p1', 'p2'], reviewKind: 'phase', manifestContent: manifest, nowIso: 'N' })).toBeNull()
  })

  it('마지막 phase(inventory 전 phase 증거) → dev-complete proof(정렬·중복없는 inventory + design_ref)', () => {
    const manifest = designEntry('DREF') + phaseEntry('p2') + phaseEntry('p1')
    const proof = computeDevCompleteProof({ ticketId: T, phaseIds: ['p2', 'p1', 'p1'], reviewKind: 'phase', manifestContent: manifest, nowIso: 'N' })
    expect(proof).not.toBeNull()
    expect(proof!.event).toBe('dev-complete')
    expect(proof!.phase_inventory).toEqual(['p1', 'p2']) // 정렬·중복 제거
    expect(proof!.design_ref).toBe('DREF')
    expect(proof!.ticket_id).toBe(T)
  })

  it('㊺ 🔴 design-bound: inventory 중 하나가 이전 design 결속(phase_design_ref≠현재)이면 → null(D1 검토분이 D2에 안 샌다)', () => {
    // p1은 옛 design 'OLD' 결속, p2는 현재 'DREF' 결속. designHashFromManifest=현재 design 'DREF'.
    const manifest = designEntry('DREF') + phaseEntry('p1', 'OLD') + phaseEntry('p2', 'DREF')
    expect(computeDevCompleteProof({ ticketId: T, phaseIds: ['p1', 'p2'], reviewKind: 'phase', manifestContent: manifest, nowIso: 'N' })).toBeNull()
  })

  it('⓶ 🔴 phase_design_ref 부재(레거시·보정 이전) 행은 durable 완료 증거로 불산입 → null', () => {
    const manifest = designEntry('DREF') + phaseEntry('p1', null) + phaseEntry('p2', 'DREF')
    expect(computeDevCompleteProof({ ticketId: T, phaseIds: ['p1', 'p2'], reviewKind: 'phase', manifestContent: manifest, nowIso: 'N' })).toBeNull()
  })

  it('㊻ 전 phase가 현재 design 결속을 얻은 뒤에만 dev-complete', () => {
    const manifest = designEntry('DREF') + phaseEntry('p1', 'DREF') + phaseEntry('p2', 'DREF')
    const proof = computeDevCompleteProof({ ticketId: T, phaseIds: ['p1', 'p2'], reviewKind: 'phase', manifestContent: manifest, nowIso: 'N' })
    expect(proof).not.toBeNull()
    expect(proof!.design_ref).toBe('DREF')
  })

  it('design finalize(kind=design)는 dev-complete 아님 → null', () => {
    const manifest = designEntry('DREF') + phaseEntry('p1')
    expect(computeDevCompleteProof({ ticketId: T, phaseIds: ['p1'], reviewKind: 'design', manifestContent: manifest, nowIso: 'N' })).toBeNull()
  })

  it('미분해(phaseIds 비어 있음) → null', () => {
    expect(computeDevCompleteProof({ ticketId: T, phaseIds: [], reviewKind: 'phase', manifestContent: '', nowIso: 'N' })).toBeNull()
  })

  it('🔴 마지막 phase인데 committed design 승인 없음 → throw(fail-closed)', () => {
    const manifest = phaseEntry('p1') // design 엔트리 없음
    expect(() => computeDevCompleteProof({ ticketId: T, phaseIds: ['p1'], reviewKind: 'phase', manifestContent: manifest, nowIso: 'N' })).toThrow(/design 승인/)
  })

  it('㊾ evidencedPhaseIdsFromManifest / designHashFromManifest 파서(design-bound 필터)', () => {
    const manifest = designEntry('DREF') + phaseEntry('p1', 'DREF') + phaseEntry('p2', 'OLD')
    // designRef 미지정 → 결속 무관 전량(하위호환).
    expect(evidencedPhaseIdsFromManifest(manifest).sort()).toEqual(['p1', 'p2'])
    // 🔴 designRef 지정 → phase_design_ref 일치 행만.
    expect(evidencedPhaseIdsFromManifest(manifest, 'DREF')).toEqual(['p1'])
    expect(evidencedPhaseIdsFromManifest(manifest, 'OLD')).toEqual(['p2'])
    expect(evidencedPhaseIdsFromManifest(manifest, 'NONE')).toEqual([])
    expect(designHashFromManifest(manifest)).toBe('DREF')
    expect(designHashFromManifest(phaseEntry('p1'))).toBeNull()
  })
})

// ─── REQ-2026-052 phase-3a: HEAD-only self-verification (실 git, 커밋된 blob만) ───
import { execFileSync as _execFileSync } from 'node:child_process'
import { mkdtempSync as _mkdtempSync, mkdirSync as _mkdirSync, writeFileSync as _writeFileSync, rmSync as _rmSync } from 'node:fs'
import { tmpdir as _tmpdir } from 'node:os'
import { join as _join } from 'node:path'
import { deriveBaseState, parseCloseProof, serializeCloseProofRow, type CloseProofRow } from '../../scripts/req/lib/close-proof'

describe('[REQ-2026-052] dev-complete HEAD-only 검증(실 git — runtime state 미사용)', () => {
  const g = (repo: string, args: string[]) => _execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', ...args], { cwd: repo, encoding: 'utf8' })
  const headBlob = (repo: string, rel: string): string | null => {
    try { return g(repo, ['show', `HEAD:${rel}`]) } catch { return null }
  }
  // 티켓의 커밋된 close proof + 매니페스트에서 HEAD-only로 dev-complete를 판정하는 조립(req:new/req:commit이 쓸 방식).
  // 🔴 DEC-B5: 실제 req-commit과 동일하게 **design-bound** — evidencedPhaseIds를 현재 committed design_ref로 필터.
  const deriveFromHead = (repo: string, ticketRel: string): string => {
    const cp = headBlob(repo, `${ticketRel}/responses/ticket-close.jsonl`)
    const mf = headBlob(repo, `${ticketRel}/responses/approvals.jsonl`)
    const rows = cp ? parseCloseProof(cp).rows : []
    const committedDesignRef = mf ? designHashFromManifest(mf) : null
    const evidencedPhaseIds = mf ? evidencedPhaseIdsFromManifest(mf, committedDesignRef) : []
    return deriveBaseState({ durabilityRequired: true, closeProofRows: rows, ledgerHasApprovedClose: false, committedEvidenceComplete: true, evidencedPhaseIds, committedDesignRef })
  }
  // 🔴 DEC-B5: phase 행은 결속(phase_design_ref)을 갖는다. ref=null이면 결속 부재(레거시) 모사.
  const phaseEntry = (pid: string, ref: string | null = 'DREF'): string =>
    JSON.stringify({ kind: 'phase', phase_id: pid, response_path: 'x', response_sha256: 's', review_base_sha: 'b', approved_tree: 't', ...(ref === null ? {} : { phase_design_ref: ref }), approved_at: 'A', consumed_at: 'C', consumed_by_commit_sha: 'X', user_commit_confirmed: null }) + '\n'
  const designEntry = (hash: string): string =>
    JSON.stringify({ kind: 'design', phase_id: null, response_path: 'd', response_sha256: 's', review_base_sha: 'b', design_hash: hash, approved_at: 'A', consumed_at: 'C', consumed_by_commit_sha: 'X', user_commit_confirmed: null }) + '\n'
  const dcRow = (inv: string[], ref: string): CloseProofRow =>
    ({ ticket_id: 'REQ-2026-001', event: 'dev-complete', series_id: null, resolution: null, phase_inventory: [...inv].sort(), design_ref: ref, at: '2026-07-24T05:00:00.000Z', reconstructed: false, evidence_basis: null })

  // evidencedRef: phase 행 결속(기본=designRef). 결속을 옛 design/부재로 두면 design-bound 미달을 모사.
  const setup = (o: { inventory: string[]; evidencedPhases: string[]; designRef: string; proofRef: string; evidencedRef?: string | null }): { repo: string; ticketRel: string } => {
    const repo = _mkdtempSync(_join(_tmpdir(), 'req052-dc-'))
    g(repo, ['init', '-q']); g(repo, ['config', 'user.email', 't@t.t']); g(repo, ['config', 'user.name', 't'])
    const ticketRel = 'workflow/REQ-2026-001'
    const bindRef = o.evidencedRef === undefined ? o.designRef : o.evidencedRef
    _mkdirSync(_join(repo, ticketRel, 'responses'), { recursive: true })
    _writeFileSync(_join(repo, ticketRel, 'state.json'), JSON.stringify({ id: 'REQ-2026-001', review_series_model_version: 1 }))
    _writeFileSync(_join(repo, ticketRel, 'responses', 'approvals.jsonl'), designEntry(o.designRef) + o.evidencedPhases.map((p) => phaseEntry(p, bindRef)).join(''))
    _writeFileSync(_join(repo, ticketRel, 'responses', 'ticket-close.jsonl'), serializeCloseProofRow(dcRow(o.inventory, o.proofRef)))
    g(repo, ['add', '-A']); g(repo, ['commit', '-qm', 'evidence'])
    return { repo, ticketRel }
  }

  it('㉛ inventory 전 phase가 committed evidence에 있고 design_ref 일치 → dev-complete', () => {
    const { repo, ticketRel } = setup({ inventory: ['p1', 'p2'], evidencedPhases: ['p1', 'p2'], designRef: 'DREF', proofRef: 'DREF' })
    try { expect(deriveFromHead(repo, ticketRel)).toBe('dev-complete') } finally { _rmSync(repo, { recursive: true, force: true }) }
  })
  it('㉜ inventory 중 하나라도 evidence 없음 → dev-complete 아님(developing)', () => {
    const { repo, ticketRel } = setup({ inventory: ['p1', 'p2'], evidencedPhases: ['p1'], designRef: 'DREF', proofRef: 'DREF' })
    try { expect(deriveFromHead(repo, ticketRel)).toBe('developing') } finally { _rmSync(repo, { recursive: true, force: true }) }
  })
  it('㉝ design_ref 불일치(재승인 모사) → dev-complete 아님', () => {
    const { repo, ticketRel } = setup({ inventory: ['p1'], evidencedPhases: ['p1'], designRef: 'NEW', proofRef: 'OLD' })
    try { expect(deriveFromHead(repo, ticketRel)).toBe('developing') } finally { _rmSync(repo, { recursive: true, force: true }) }
  })
  it('㉞ scratch state.json 삭제·변조해도 HEAD 판정 불변(runtime 미사용)', () => {
    const { repo, ticketRel } = setup({ inventory: ['p1'], evidencedPhases: ['p1'], designRef: 'DREF', proofRef: 'DREF' })
    try {
      expect(deriveFromHead(repo, ticketRel)).toBe('dev-complete')
      // 워킹 state.json을 지우거나 엉뚱하게 바꿔도(HEAD blob만 보므로) 판정 불변.
      _writeFileSync(_join(repo, ticketRel, 'state.json'), '{"garbage":true}')
      expect(deriveFromHead(repo, ticketRel)).toBe('dev-complete')
      _rmSync(_join(repo, ticketRel, 'state.json'))
      expect(deriveFromHead(repo, ticketRel)).toBe('dev-complete')
    } finally { _rmSync(repo, { recursive: true, force: true }) }
  })
  it('㊹ 🔴 실 git: inventory phase가 옛 design 결속(phase_design_ref≠현재 design_ref)이면 → dev-complete 아님', () => {
    // design 행은 D2(=현재), proof도 D2, 그러나 phase 증거는 D1 결속 → design-bound 미달 → developing.
    const { repo, ticketRel } = setup({ inventory: ['p1'], evidencedPhases: ['p1'], designRef: 'D2ref', proofRef: 'D2ref', evidencedRef: 'D1ref' })
    try { expect(deriveFromHead(repo, ticketRel)).toBe('developing') } finally { _rmSync(repo, { recursive: true, force: true }) }
  })
  it('⓵ 🔴 실 git: 결속 부재(레거시 phase 행) → dev-complete 아님(durable 완료 증거 불산입)', () => {
    const { repo, ticketRel } = setup({ inventory: ['p1'], evidencedPhases: ['p1'], designRef: 'DREF', proofRef: 'DREF', evidencedRef: null })
    try { expect(deriveFromHead(repo, ticketRel)).toBe('developing') } finally { _rmSync(repo, { recursive: true, force: true }) }
  })
})

// ─── REQ-2026-052 phase-3a: finalize 멱등성 = HEAD 기준(㉟ 재시도 안전) ───
import { __setGitForTest, finalizeEvidenceAndConsume } from '../../scripts/req/req-commit'
import { serializeManifestLine as _serMf, buildManifestEntry as _bldMf } from '../../scripts/req/lib/evidence'
import { createHash as _createHash } from 'node:crypto'

describe('[REQ-2026-052] finalize 멱등성 HEAD 기준(re-commit 재시도)', () => {
  const g = (repo: string, args: string[]) =>
    _execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', ...args], { cwd: repo, encoding: 'utf8' })
  // 🔴 DEC-B6: phase 승인 archive 내용은 결정적(pid·round)이고 manifest.response_sha256 == 그 내용의 sha여야
  //    발행 후 verifyDevCompleteAtHead(phase archive 무결성)를 통과한다. 아래 phaseEntry·evFor·archive write가 공유.
  const arContent = (pid: string, round: string): string => JSON.stringify({ phase: pid, round, approved: true })
  const arSha = (pid: string, round: string): string => _createHash('sha256').update(arContent(pid, round), 'utf8').digest('hex')
  // 🔴 DEC-B7: design 승인 archive도 verifyDevCompleteAtHead가 무결성 검증 → 결정적 내용 + inventory + 실제 blob.
  //    inventory는 그 시점의 **HEAD design archive 전체**여야 한다(verifyCommittedDesignEvidence step7: HEAD 집합 정합).
  const designArContentOf = (name: string): string => JSON.stringify({ archive: name })
  const designArShaOf = (name: string): string => _createHash('sha256').update(designArContentOf(name), 'utf8').digest('hex')
  const designRel = (name: string): string => `workflow/REQ-2026-001/responses/${name}`
  const writeDesignArchiveNamed = (responsesDir: string, name: string): void => _writeFileSync(_join(responsesDir, name), designArContentOf(name))
  /** design manifest 행 — approvedName=승인본, invNames=archive_inventory 전체(HEAD 집합과 일치해야). */
  const designEntryFull = (hash: string, approvedName: string, invNames: string[]): string =>
    _serMf(_bldMf(
      { response_path: designRel(approvedName), response_sha256: designArShaOf(approvedName), review_kind: 'design', phase_id: null, review_base_sha: 'b'.repeat(40), design_hash: hash, codex_thread_id: 'T', machine_schema_version: '1.1', status: 'COMPLETE', commit_approved: 'yes', approved_at: '2026-07-24T00:00:00.000Z' } as never,
      { consumedAt: '2026-07-24T01:00:00.000Z', consumedByCommitSha: 'c'.repeat(40), userCommitConfirmed: null, archiveInventory: invNames.map((n) => ({ response_path: designRel(n), sha256: designArShaOf(n) })) },
    ))
  const designEntry = (hash: string): string => designEntryFull(hash, 'design-r01-approved.json', ['design-r01-approved.json'])
  // 🔴 committed state.json은 phases 배열 + durability marker 필요(verifyCommittedDesignEvidence step1·isDurabilityRequired).
  const committedState = JSON.stringify({ id: 'REQ-2026-001', phase: 'INTAKE', phases: [], review_series_model_version: 1, evidence_durability_required: true })
  const writeDesignArchive = (responsesDir: string): void => writeDesignArchiveNamed(responsesDir, 'design-r01-approved.json')
  // 🔴 DEC-B5: phase 행에 design 결속(phase_design_ref). 기본 'e'*64(이 블록의 기본 design). round로 r01/r02 구분.
  const phaseEntry = (pid: string, ref: string = 'e'.repeat(64), round = 'r01'): string =>
    _serMf(
      _bldMf(
        {
          response_path: 'workflow/REQ-2026-001/responses/' + pid + '-' + round + '-approved.json',
          response_sha256: arSha(pid, round), // 🔴 실제 archive 내용의 sha(DEC-B6 무결성 통과)
          review_kind: 'phase',
          phase_id: pid,
          review_base_sha: 'b'.repeat(40),
          approved_tree: 'c'.repeat(40),
          phase_design_ref: ref,
          codex_thread_id: 'T',
          machine_schema_version: '1.1',
          status: 'COMPLETE',
          commit_approved: 'yes',
          approved_at: '2026-07-24T00:00:00.000Z',
        } as never,
        { consumedAt: '2026-07-24T01:00:00.000Z', consumedByCommitSha: 'c'.repeat(40), userCommitConfirmed: null },
      ),
    )

  const cpRows = (repo: string): Array<Record<string, unknown>> => {
    let t: string
    try {
      t = g(repo, ['show', 'HEAD:workflow/REQ-2026-001/responses/ticket-close.jsonl'])
    } catch {
      return []
    }
    return t.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as Record<string, unknown>)
  }
  const mfLines = (repo: string): string[] => {
    let t: string
    try {
      t = g(repo, ['show', 'HEAD:workflow/REQ-2026-001/responses/approvals.jsonl'])
    } catch {
      return []
    }
    return t.split('\n').filter((l) => l.trim())
  }
  const evFor = (pid: string, ref: string = 'e'.repeat(64), round = 'r01'): unknown => ({
    response_path: 'workflow/REQ-2026-001/responses/' + pid + '-' + round + '-approved.json',
    response_sha256: arSha(pid, round), // 🔴 실제 archive 내용의 sha(round별 상이 → r01/r02 dup-key 충돌도 자연 해소)
    review_kind: 'phase',
    phase_id: pid,
    review_base_sha: 'b'.repeat(40),
    approved_tree: 'c'.repeat(40),
    phase_design_ref: ref, // 🔴 DEC-B5: 승인 시점 design 결속
    codex_thread_id: 'T',
    machine_schema_version: '1.1',
    status: 'COMPLETE',
    commit_approved: 'yes',
    approved_at: '2026-07-24T00:00:00.000Z',
  })

  it('디스크 매니페스트에 마지막 phase 엔트리가 있으나 HEAD엔 없음(커밋 실패 모사) → 재시도가 재커밋·dev-complete 발행·중복 없음', () => {
    const repo = _mkdtempSync(_join(_tmpdir(), 'req052-retry-'))
    try {
      g(repo, ['init', '-q'])
      g(repo, ['config', 'user.email', 't@t.t'])
      g(repo, ['config', 'user.name', 't'])
      const ticketRel = 'workflow/REQ-2026-001'
      const ticketDir = _join(repo, ticketRel)
      const responsesDir = _join(ticketDir, 'responses')
      _mkdirSync(responsesDir, { recursive: true })
      const headManifest = designEntry('e'.repeat(64)) + phaseEntry('p1')
      _writeFileSync(_join(responsesDir, 'approvals.jsonl'), headManifest)
      writeDesignArchive(responsesDir) // 🔴 design 승인 archive blob(DEC-B7 무결성)
      _writeFileSync(_join(responsesDir, 'p1-r01-approved.json'), arContent('p1', 'r01'))
      _writeFileSync(_join(ticketDir, 'state.json'), committedState)
      g(repo, ['add', '-A'])
      g(repo, ['commit', '-qm', 'design+p1 evidence'])
      // 🔴 실패한 커밋 모사: p2 엔트리를 **디스크에만** 써 둔다(HEAD엔 없음).
      _writeFileSync(_join(responsesDir, 'approvals.jsonl'), headManifest + phaseEntry('p2'))
      _writeFileSync(_join(responsesDir, 'p2-r01-approved.json'), arContent('p2', 'r01'))

      __setGitForTest(repo)
      const state = {
        id: 'REQ-2026-001',
        current_phase: 'p2',
        phases: [{ id: 'p1', approved: true }, { id: 'p2', approved: true }],
        review_series_model_version: 1,
      }
      const ctx = {
        ticketDir,
        ticketRel,
        responsesDir,
        manifestPath: _join(responsesDir, 'approvals.jsonl'),
        state,
        ev: evFor('p2'),
        archiveNames: ['p1-r01-approved.json', 'p2-r01-approved.json'],
        validPhaseIds: ['p1', 'p2'],
        sourceSha: 'd'.repeat(40),
        rootForClose: repo,
      }

      finalizeEvidenceAndConsume(ctx as never)
      const dc1 = cpRows(repo).filter((r) => r.event === 'dev-complete')
      expect(dc1.length).toBe(1)
      expect(dc1[0]!.phase_inventory).toEqual(['p1', 'p2'])
      expect(mfLines(repo).length).toBe(3) // design + p1 + p2, 중복 없음

      // 재시도 → HEAD에 이미 있음 → skip. 중복 없음.
      finalizeEvidenceAndConsume(ctx as never)
      expect(cpRows(repo).filter((r) => r.event === 'dev-complete').length).toBe(1)
      expect(mfLines(repo).length).toBe(3)
    } finally {
      _rmSync(repo, { recursive: true, force: true })
    }
  })

  it('🔴 재승인(design_ref 변경) 후 재완료 → 새 dev-complete가 supersede로 append·HEAD-verify 통과(중복/충돌 없음)', () => {
    const repo = _mkdtempSync(_join(_tmpdir(), 'req052-reissue-'))
    try {
      g(repo, ['init', '-q'])
      g(repo, ['config', 'user.email', 't@t.t'])
      g(repo, ['config', 'user.name', 't'])
      const ticketRel = 'workflow/REQ-2026-001'
      const ticketDir = _join(repo, ticketRel)
      const responsesDir = _join(ticketDir, 'responses')
      _mkdirSync(responsesDir, { recursive: true })
      const D1 = 'e'.repeat(64)
      const D2 = 'f'.repeat(64)
      // HEAD: design(D1) + p1 + p2 evidence + dev-complete(D1) 커밋(완료된 티켓).
      const dcD1 =
        JSON.stringify({ ticket_id: 'REQ-2026-001', event: 'dev-complete', series_id: null, resolution: null, phase_inventory: ['p1', 'p2'], design_ref: D1, at: '2026-07-24T05:00:00.000Z', reconstructed: false, evidence_basis: null }) + '\n'
      _writeFileSync(_join(responsesDir, 'approvals.jsonl'), designEntry(D1) + phaseEntry('p1') + phaseEntry('p2'))
      _writeFileSync(_join(responsesDir, 'ticket-close.jsonl'), dcD1)
      writeDesignArchive(responsesDir) // design-r01-approved
      _writeFileSync(_join(responsesDir, 'p1-r01-approved.json'), arContent('p1', 'r01'))
      _writeFileSync(_join(responsesDir, 'p2-r01-approved.json'), arContent('p2', 'r01'))
      _writeFileSync(_join(ticketDir, 'state.json'), committedState)
      g(repo, ['add', '-A'])
      g(repo, ['commit', '-qm', 'complete with D1'])
      // 🔴 design 재승인: 매니페스트에 design(D2) 추가 커밋(HEAD). D2 inventory는 HEAD design archive 전체(r01·r02).
      const designEntryV2 = designEntryFull(D2, 'design-r02-approved.json', ['design-r01-approved.json', 'design-r02-approved.json'])
      writeDesignArchiveNamed(responsesDir, 'design-r02-approved.json')
      _writeFileSync(_join(responsesDir, 'approvals.jsonl'), designEntry(D1) + phaseEntry('p1') + phaseEntry('p2') + designEntryV2)
      g(repo, ['add', '-A'])
      g(repo, ['commit', '-qm', 're-approve design D2'])

      __setGitForTest(repo)
      const state = {
        id: 'REQ-2026-001',
        current_phase: 'p2',
        phases: [{ id: 'p1', approved: true }, { id: 'p2', approved: true }],
        review_series_model_version: 1,
      }
      // 🔴 DEC-B5: 재승인 lifecycle — 각 phase를 D2에 결속해 재검토·재커밋해야 D2 dev-complete가 성립한다.
      //    재검토는 distinct 아카이브(r02·distinct sha)를 낸다.
      _writeFileSync(_join(responsesDir, 'p1-r02-approved.json'), arContent('p1', 'r02'))
      _writeFileSync(_join(responsesDir, 'p2-r02-approved.json'), arContent('p2', 'r02'))
      const mkCtx = (pid: string, ev: unknown): unknown => ({
        ticketDir, ticketRel, responsesDir,
        manifestPath: _join(responsesDir, 'approvals.jsonl'),
        state, ev,
        archiveNames: ['p1-r01-approved.json', 'p2-r01-approved.json', 'p1-r02-approved.json', 'p2-r02-approved.json'],
        validPhaseIds: ['p1', 'p2'],
        sourceSha: (pid === 'p1' ? 'a' : 'b').repeat(40), // 새 source(각 재커밋 distinct)
        rootForClose: repo,
      })

      // ── ㊺: p1만 D2에 재결속 재커밋 → p2는 아직 D1 결속 → dev-complete(D2) **아직 미발행** ──
      // (r02 아카이브는 내용이 달라 r01과 sha가 다르므로 manifest dup-key도 자연 해소.)
      finalizeEvidenceAndConsume(mkCtx('p1', evFor('p1', D2, 'r02')) as never)
      const afterP1 = cpRows(repo).filter((r) => r.event === 'dev-complete')
      expect(afterP1.length).toBe(1) // 아직 D1 하나뿐(D2 미발행 — 전 phase가 D2 결속이 아니다)
      expect(afterP1[0]!.design_ref).toBe(D1)

      // ── ㊻: p2도 D2에 재결속 재커밋 → 전 phase가 D2 결속 → D2 dev-complete supersede append ──
      finalizeEvidenceAndConsume(mkCtx('p2', evFor('p2', D2, 'r02')) as never)
      const dcs = cpRows(repo).filter((r) => r.event === 'dev-complete')
      expect(dcs.length).toBe(2) // D1 + D2 공존(append-only supersede)
      expect(dcs.map((r) => r.design_ref).sort()).toEqual([D1, D2].sort())
      // 🔴 재시도(멱등) → 중복 없음.
      finalizeEvidenceAndConsume(mkCtx('p2', evFor('p2', D2, 'r02')) as never)
      expect(cpRows(repo).filter((r) => r.event === 'dev-complete').length).toBe(2)
    } finally {
      _rmSync(repo, { recursive: true, force: true })
    }
  })

  it('⓽ 🔴 발행 후 verifyDevCompleteAtHead도 phase archive 무결성 강제 — 다른 phase archive가 변조돼 있으면 throw(공유 규칙)', () => {
    const repo = _mkdtempSync(_join(_tmpdir(), 'req052-archverify-'))
    try {
      g(repo, ['init', '-q']); g(repo, ['config', 'user.email', 't@t.t']); g(repo, ['config', 'user.name', 't'])
      const ticketRel = 'workflow/REQ-2026-001'
      const ticketDir = _join(repo, ticketRel)
      const responsesDir = _join(ticketDir, 'responses')
      _mkdirSync(responsesDir, { recursive: true })
      const D = 'e'.repeat(64)
      // HEAD: design(D) + p1(D 결속) evidence. 🔴 단 p1 archive는 **변조된 바이트**로 커밋(sha 불일치).
      _writeFileSync(_join(responsesDir, 'approvals.jsonl'), designEntry(D) + phaseEntry('p1'))
      writeDesignArchive(responsesDir) // design은 정상
      _writeFileSync(_join(responsesDir, 'p1-r01-approved.json'), 'TAMPERED-BYTES') // 🔴 p1 archive sha != arSha('p1','r01')
      _writeFileSync(_join(ticketDir, 'state.json'), committedState)
      g(repo, ['add', '-A']); g(repo, ['commit', '-qm', 'design+p1(변조 archive)'])
      // p2 evidence 준비(정상 archive). p2 finalize가 마지막 phase → dev-complete 발행 → 발행 후 verify가 p1 변조 포착.
      _writeFileSync(_join(responsesDir, 'p2-r01-approved.json'), arContent('p2', 'r01'))
      __setGitForTest(repo)
      const state = { id: 'REQ-2026-001', current_phase: 'p2', phases: [{ id: 'p1', approved: true }, { id: 'p2', approved: true }], review_series_model_version: 1 }
      const ctx = {
        ticketDir, ticketRel, responsesDir, manifestPath: _join(responsesDir, 'approvals.jsonl'),
        state, ev: evFor('p2'), archiveNames: ['p1-r01-approved.json', 'p2-r01-approved.json'],
        validPhaseIds: ['p1', 'p2'], sourceSha: 'd'.repeat(40), rootForClose: repo,
      }
      // 🔴 intake와 동일 규칙(verifyCommittedEvidenceIntegrity 공유) — p1 archive 변조로 발행 후 재검증이 fail-closed.
      expect(() => finalizeEvidenceAndConsume(ctx as never)).toThrow(/phase archive|committed 증거 손상/)
    } finally { _rmSync(repo, { recursive: true, force: true }) }
  })

  it('⒁ 🔴 DEC-B7: 발행 후 verifyDevCompleteAtHead가 **design** archive 손상에서도 throw(공유 규칙)', () => {
    const repo = _mkdtempSync(_join(_tmpdir(), 'req052-designverify-'))
    try {
      g(repo, ['init', '-q']); g(repo, ['config', 'user.email', 't@t.t']); g(repo, ['config', 'user.name', 't'])
      const ticketRel = 'workflow/REQ-2026-001'
      const ticketDir = _join(repo, ticketRel)
      const responsesDir = _join(ticketDir, 'responses')
      _mkdirSync(responsesDir, { recursive: true })
      const D = 'e'.repeat(64)
      // HEAD: design(D)+p1(D 결속). 🔴 design archive는 **변조된 바이트**로 커밋(sha 불일치), phase는 정상.
      _writeFileSync(_join(responsesDir, 'approvals.jsonl'), designEntry(D) + phaseEntry('p1'))
      _writeFileSync(_join(responsesDir, 'design-r01-approved.json'), 'TAMPERED-DESIGN') // 🔴 design archive 변조
      _writeFileSync(_join(responsesDir, 'p1-r01-approved.json'), arContent('p1', 'r01'))
      _writeFileSync(_join(ticketDir, 'state.json'), committedState)
      g(repo, ['add', '-A']); g(repo, ['commit', '-qm', 'design(변조)+p1'])
      _writeFileSync(_join(responsesDir, 'p2-r01-approved.json'), arContent('p2', 'r01'))
      __setGitForTest(repo)
      const state = { id: 'REQ-2026-001', current_phase: 'p2', phases: [{ id: 'p1', approved: true }, { id: 'p2', approved: true }], review_series_model_version: 1 }
      const ctx = {
        ticketDir, ticketRel, responsesDir, manifestPath: _join(responsesDir, 'approvals.jsonl'),
        state, ev: evFor('p2'), archiveNames: ['p1-r01-approved.json', 'p2-r01-approved.json'],
        validPhaseIds: ['p1', 'p2'], sourceSha: 'd'.repeat(40), rootForClose: repo,
      }
      expect(() => finalizeEvidenceAndConsume(ctx as never)).toThrow(/design 증거 무결성|committed 증거 손상/)
    } finally { _rmSync(repo, { recursive: true, force: true }) }
  })

  it('㊱ 마지막 phase 아니면 dev-complete 미발행', () => {
    const repo = _mkdtempSync(_join(_tmpdir(), 'req052-notlast-'))
    try {
      g(repo, ['init', '-q'])
      g(repo, ['config', 'user.email', 't@t.t'])
      g(repo, ['config', 'user.name', 't'])
      const ticketRel = 'workflow/REQ-2026-001'
      const ticketDir = _join(repo, ticketRel)
      const responsesDir = _join(ticketDir, 'responses')
      _mkdirSync(responsesDir, { recursive: true })
      _writeFileSync(_join(responsesDir, 'approvals.jsonl'), designEntry('e'.repeat(64)))
      _writeFileSync(_join(responsesDir, 'p1-r01-approved.json'), arContent('p1', 'r01'))
      _writeFileSync(_join(ticketDir, 'state.json'), JSON.stringify({ id: 'REQ-2026-001', review_series_model_version: 1 }))
      g(repo, ['add', '-A'])
      g(repo, ['commit', '-qm', 'design'])
      __setGitForTest(repo)
      const state = {
        id: 'REQ-2026-001',
        current_phase: 'p1',
        phases: [{ id: 'p1', approved: true }, { id: 'p2', approved: false }],
        review_series_model_version: 1,
      }
      const ctx = {
        ticketDir,
        ticketRel,
        responsesDir,
        manifestPath: _join(responsesDir, 'approvals.jsonl'),
        state,
        ev: evFor('p1'),
        archiveNames: ['p1-r01-approved.json'],
        validPhaseIds: ['p1', 'p2'],
        sourceSha: 'd'.repeat(40),
        rootForClose: repo,
      }
      finalizeEvidenceAndConsume(ctx as never)
      expect(cpRows(repo).filter((r) => r.event === 'dev-complete').length).toBe(0) // p2 미완 → 미발행
    } finally {
      _rmSync(repo, { recursive: true, force: true })
    }
  })
})

// ─── REQ-2026-057 phase-2: 소비 상태 durable checkpoint(완주 직후 clean) ───
import { findReqNewDirtyEntries } from '../../scripts/req/req-new'
import { STATUS_Z_ARGS } from '../../scripts/req/lib/porcelain'

/**
 * REQ-2026-057 phase-2 — **완주 직후 워킹트리가 clean이고 다음 `req:new`가 통과한다.**
 *
 * 🔴 "state.json이 커밋된다"만 단언하면 공허하다. 이 REQ가 고치는 결함은 **마지막 상태 쓰기가 마지막
 *    커밋보다 뒤에 남는 것**이라, 커밋 자체는 있는데도 dirty가 남는 형태였다. 그래서 오라클은
 *    ① `git status` 전체가 비었는가 ② `req:new`의 clean-tree 판정이 통과하는가 — 둘 다여야 한다.
 */
describe('[REQ-2026-057] finalize 후 완주 상태 durable checkpoint', () => {
  const g = (repo: string, args: string[]) =>
    _execFileSync('git', ['-c', 'user.email=t@t.t', '-c', 'user.name=t', ...args], { cwd: repo, encoding: 'utf8' })
  const arContent = (pid: string, round: string): string => JSON.stringify({ phase: pid, round, approved: true })
  const arSha = (pid: string, round: string): string => _createHash('sha256').update(arContent(pid, round), 'utf8').digest('hex')
  const designArContentOf = (name: string): string => JSON.stringify({ archive: name })
  const designArShaOf = (name: string): string => _createHash('sha256').update(designArContentOf(name), 'utf8').digest('hex')
  const designRel = (name: string): string => `workflow/REQ-2026-001/responses/${name}`
  const designEntry = (hash: string): string =>
    _serMf(_bldMf(
      { response_path: designRel('design-r01-approved.json'), response_sha256: designArShaOf('design-r01-approved.json'), review_kind: 'design', phase_id: null, review_base_sha: 'b'.repeat(40), design_hash: hash, codex_thread_id: 'T', machine_schema_version: '1.1', status: 'COMPLETE', commit_approved: 'yes', approved_at: '2026-07-24T00:00:00.000Z' } as never,
      { consumedAt: '2026-07-24T01:00:00.000Z', consumedByCommitSha: 'c'.repeat(40), userCommitConfirmed: null, archiveInventory: [{ response_path: designRel('design-r01-approved.json'), sha256: designArShaOf('design-r01-approved.json') }] },
    ))
  const evFor = (pid: string): unknown => ({
    response_path: `workflow/REQ-2026-001/responses/${pid}-r01-approved.json`,
    response_sha256: arSha(pid, 'r01'),
    review_kind: 'phase',
    phase_id: pid,
    review_base_sha: 'b'.repeat(40),
    approved_tree: 'c'.repeat(40),
    phase_design_ref: 'e'.repeat(64),
    codex_thread_id: 'T',
    machine_schema_version: '1.1',
    status: 'COMPLETE',
    commit_approved: 'yes',
    approved_at: '2026-07-24T00:00:00.000Z',
  })

  /** 승인·아카이브가 커밋된 티켓 + 미소비 상태(승인 핀·pending 마커 보유). */
  const setup = (): { repo: string; ticketRel: string; ctx: Record<string, unknown> } => {
    const repo = _mkdtempSync(_join(_tmpdir(), 'req057-'))
    g(repo, ['init', '-q'])
    g(repo, ['config', 'user.email', 't@t.t'])
    g(repo, ['config', 'user.name', 't'])
    const ticketRel = 'workflow/REQ-2026-001'
    const ticketDir = _join(repo, ticketRel)
    const responsesDir = _join(ticketDir, 'responses')
    _mkdirSync(responsesDir, { recursive: true })
    _writeFileSync(_join(responsesDir, 'approvals.jsonl'), designEntry('e'.repeat(64)))
    _writeFileSync(_join(responsesDir, 'design-r01-approved.json'), designArContentOf('design-r01-approved.json'))
    _writeFileSync(_join(responsesDir, 'p1-r01-approved.json'), arContent('p1', 'r01'))
    const state = {
      id: 'REQ-2026-001',
      phase: 'INTAKE',
      current_phase: 'p1',
      phases: [{ id: 'p1', approved: true }],
      review_series_model_version: 1,
      evidence_durability_required: true,
      commit_allowed: true,
      approval_evidence: evFor('p1'),
      pending_evidence_for: { source_commit_sha: 'd'.repeat(40) },
    }
    _writeFileSync(_join(ticketDir, 'state.json'), JSON.stringify(state, null, 2) + '\n')
    g(repo, ['add', '-A'])
    g(repo, ['commit', '-qm', 'ticket evidence'])
    __setGitForTest(repo)
    return {
      repo,
      ticketRel,
      ctx: {
        ticketDir,
        ticketRel,
        responsesDir,
        manifestPath: _join(responsesDir, 'approvals.jsonl'),
        state,
        ev: evFor('p1'),
        archiveNames: ['p1-r01-approved.json'],
        validPhaseIds: ['p1'],
        sourceSha: 'd'.repeat(40),
        rootForClose: repo,
      },
    }
  }

  it('🔴 완주 직후 워킹트리가 clean이고 req:new clean-tree 판정이 통과한다', () => {
    const { repo, ctx } = setup()
    try {
      finalizeEvidenceAndConsume(ctx as never)

      // ① 워킹트리 전체가 clean — 소비 상태가 커밋됐다.
      expect(g(repo, ['status', '--porcelain']).trim()).toBe('')
      // ② 다음 티켓을 열 수 있다(F-1이 막던 지점).
      const raw = _execFileSync('git', [...STATUS_Z_ARGS], { cwd: repo, encoding: 'utf8' })
      expect(findReqNewDirtyEntries(raw, 'workflow')).toEqual([])
      // 커밋된 상태가 소비 결과다(승인 핀·pending 마커 제거).
      const committed = JSON.parse(g(repo, ['show', 'HEAD:workflow/REQ-2026-001/state.json'])) as Record<string, unknown>
      expect(committed.commit_allowed).toBe(false)
      expect(committed.approval_evidence).toBeUndefined()
      expect(committed.pending_evidence_for).toBeUndefined()
    } finally {
      _rmSync(repo, { recursive: true, force: true })
    }
  })

  it('🔴 재실행(복구 경로) 뒤에도 워킹트리가 clean으로 남는다', () => {
    const { repo, ctx } = setup()
    try {
      finalizeEvidenceAndConsume(ctx as never)
      expect(g(repo, ['status', '--porcelain']).trim()).toBe('')

      // `--finalize` 재실행과 같은 경로: evidence는 HEAD에 이미 있어 skip되고 소비만 재수행된다.
      // ⚠️ 이때 커밋이 하나 더 생길 수 있다 — `consumeState`가 `consumed_approvals`에 **매번 append**하는
      //    기존 동작 때문에 상태 내용이 실제로 달라지기 때문이다(이 REQ가 바꾸는 규약이 아니다).
      //    이 REQ가 보장하는 것은 "**어느 경우에도 소비 상태가 미커밋으로 남지 않는다**"이므로 그것을 단언한다.
      //    (내용이 같을 때 커밋하지 않는 멱등은 `commitStateCheckpoint` 단위 테스트가 고정한다.)
      finalizeEvidenceAndConsume(ctx as never)
      expect(g(repo, ['status', '--porcelain']).trim()).toBe('')
    } finally {
      _rmSync(repo, { recursive: true, force: true })
    }
  })
})

/**
 * REQ-2026-071 phase-1 — 확인 범위(`scope`)와 `stopGate`별 차단 지점.
 *
 * 🔴 헤드라인 둘:
 *   1. **`stopGate:'phase'` 는 현행과 완전히 동일하다** — 이 값을 고른 사용자에게 매 phase 차단이 정본이다.
 *   2. **넓은 scope 가 phase 게이트를 우회하지 못한다** — 넓은 확인은 커밋마다 소비되지 않으므로,
 *      한 번 통과시키면 이후 모든 phase 가 무확인으로 진행된다(설계 r03 P1).
 */
describe('[REQ-2026-071] userConfirmGate — stopGate 가 차단 지점을 정한다', () => {
  const st = (over: Partial<WorkflowState>): WorkflowState => ({ id: 'X', phase: 'P', ...over }) as WorkflowState
  const ok = (scope?: 'phase' | 'req' | 'delivery') => ({
    confirmed: true,
    method: '사용자 확인',
    confirmed_at: '2026-07-27T00:00:00.000Z',
    ...(scope ? { scope } : {}),
  })

  it('LOW 는 어떤 stopGate 에서도 막지 않는다', () => {
    for (const sg of ['phase', 'req', 'merge'] as const)
      expect(userConfirmGate(st({ risk_level: 'LOW' }), sg, true).blocked).toBe(false)
  })

  /** 🔴 헤드라인 1 — 무회귀. */
  it('🔴 phase: HIGH + 확인 없음 → 차단(현행 무회귀)', () => {
    expect(userConfirmGate(st({ risk_level: 'HIGH' }), 'phase').blocked).toBe(true)
  })

  it('phase: HIGH + scope:phase 확인 → 통과', () => {
    expect(userConfirmGate(st({ risk_level: 'HIGH', user_commit_confirmed: ok('phase') }), 'phase').blocked).toBe(false)
  })

  it('scope 부재 확인은 phase 로 읽는다(하위호환)', () => {
    expect(userConfirmGate(st({ risk_level: 'HIGH', user_commit_confirmed: ok() }), 'phase').blocked).toBe(false)
  })

  /** 🔴 헤드라인 2 — 이걸 허용하면 phase 값이 보장하려던 것이 정상 경로로 사라진다. */
  it('🔴 phase: 넓은 scope(req) 확인으로 우회할 수 없다', () => {
    const g = userConfirmGate(st({ risk_level: 'HIGH', user_commit_confirmed: ok('req') }), 'phase')
    expect(g.blocked).toBe(true)
    expect(g.reason).toContain('범위 불일치')
  })

  it('🔴 req: 좁은 scope(phase) 확인도 통하지 않는다(정확 일치)', () => {
    expect(userConfirmGate(st({ risk_level: 'HIGH', user_commit_confirmed: ok('phase') }), 'req', true).blocked).toBe(true)
  })

  /** 🔴 중간 phase 를 막으면 REQ 종료 지점에 도달할 수 없다(설계 r01 P1). */
  it('🔴 req: 중간 phase 는 막지 않는다', () => {
    expect(userConfirmGate(st({ risk_level: 'HIGH' }), 'req', false).blocked).toBe(false)
  })

  it('🔴 req: REQ 를 완성시키는 커밋은 확인 없이 막힌다', () => {
    expect(userConfirmGate(st({ risk_level: 'HIGH' }), 'req', true).blocked).toBe(true)
  })

  it('req: 완성 커밋 + scope:req 확인 → 통과', () => {
    expect(userConfirmGate(st({ risk_level: 'HIGH', user_commit_confirmed: ok('req') }), 'req', true).blocked).toBe(false)
  })

  /** merge 는 커밋이 아니라 delivery integrate 자격에서 요구한다(phase-3). */
  it('merge: 커밋에서는 막지 않는다', () => {
    expect(userConfirmGate(st({ risk_level: 'HIGH' }), 'merge', true).blocked).toBe(false)
  })

  it('차단 메시지가 기록 방법(req:confirm)을 알려 준다', () => {
    const g = userConfirmGate(st({ risk_level: 'HIGH' }), 'phase')
    expect(g.reason).toContain('req:confirm')
    expect(g.reason).toContain('--scope phase')
  })
})

describe('[REQ-2026-071] consumeState — 범위가 닫힐 때만 소비한다', () => {
  const st = (over: Partial<WorkflowState>): WorkflowState => ({ id: 'X', phase: 'P', ...over }) as WorkflowState
  const conf = (scope?: 'phase' | 'req' | 'delivery') => ({
    confirmed: true,
    method: 'm',
    confirmed_at: '2026-07-27T00:00:00.000Z',
    ...(scope ? { scope } : {}),
  })
  const consume = (ucc: unknown) =>
    consumeState(st({ user_commit_confirmed: ucc as never }), {
      sourceCommitSha: 'a'.repeat(40),
      consumedAt: '2026-07-27T00:00:00.000Z',
    }).user_commit_confirmed

  it('scope:phase 는 커밋마다 소비된다(현행 무회귀)', () => {
    expect(consume(conf('phase'))).toBeNull()
    expect(consume(conf())).toBeNull() // 부재 = phase
  })

  /** 🔴 커밋마다 지우면 첫 커밋에서 사라져 결국 매 phase 확인이 된다 — 이 REQ 가 무의미해진다. */
  it('🔴 넓은 scope 는 커밋으로 소비되지 않는다', () => {
    expect(consume(conf('req'))).not.toBeNull()
    expect(consume(conf('delivery'))).not.toBeNull()
  })
})

/**
 * REQ-2026-071 phase-3 — 완료 판정(`wouldCompleteReq`)은 **한 곳**이다.
 *
 * 🔴 DRY-RUN·LIVE·복구가 같은 계산을 써야 한다. 미리보기가 보수적으로 true 를 쓰면 중간 phase 에서
 *    "확인이 필요하다"고 잘못 표시해, 미리보기 계약과 실제 정지 지점이 어긋난다(phase-3 r01 P1).
 */
describe('[REQ-2026-071] wouldCompleteReq — 완료 판정 단일 지점', () => {
  const D = '1'.repeat(64)
  const T = 'workflow/REQ-2026-001'
  const iso = '2026-07-27T00:00:00.000Z'
  const design = JSON.stringify({
    kind: 'design', phase_id: null,
    response_path: `${T}/responses/design-r01-approved.json`,
    response_sha256: 'a'.repeat(64), review_base_sha: 'b'.repeat(40), design_hash: D,
    approved_at: iso, consumed_at: iso, consumed_by_commit_sha: 'd'.repeat(40), user_commit_confirmed: null,
  })
  const phase = (pid: string) => JSON.stringify({
    kind: 'phase', phase_id: pid,
    response_path: `${T}/responses/${pid}-r01-approved.json`,
    response_sha256: 'a'.repeat(64), review_base_sha: 'b'.repeat(40), approved_tree: 'c'.repeat(40),
    phase_design_ref: D, approved_at: iso, consumed_at: iso,
    consumed_by_commit_sha: 'd'.repeat(40), user_commit_confirmed: null,
  })
  const doc = (...rows: string[]) => rows.join('\n') + '\n'

  it('🔴 중간 phase 는 완료가 아니다', () => {
    const r = wouldCompleteReq({
      phaseIds: ['p1', 'p2'],
      manifestContent: doc(design),
      pending: { phaseId: 'p1', designRef: D },
    })
    expect(r.complete).toBe(false)
  })

  it('🔴 마지막 phase 는 완료다(pending 포함해서 판정)', () => {
    const r = wouldCompleteReq({
      phaseIds: ['p1', 'p2'],
      manifestContent: doc(design, phase('p1')),
      pending: { phaseId: 'p2', designRef: D },
    })
    expect(r.complete).toBe(true)
    expect(r.designRef).toBe(D)
  })

  it('pending 의 결속이 현재 design 과 다르면 산입하지 않는다', () => {
    const r = wouldCompleteReq({
      phaseIds: ['p1'],
      manifestContent: doc(design),
      pending: { phaseId: 'p1', designRef: '9'.repeat(64) },
    })
    expect(r.complete).toBe(false)
  })

  it('design 승인이 없으면 완료가 아니다', () => {
    expect(wouldCompleteReq({ phaseIds: ['p1'], manifestContent: '' }).complete).toBe(false)
  })

  it('phases[] 가 비면 완료가 아니다', () => {
    expect(wouldCompleteReq({ phaseIds: [], manifestContent: doc(design) }).complete).toBe(false)
  })

  /**
   * 🔴 복구 경로(멱등 skip)의 오라클(phase-3 r02 P1). 엔트리가 **이미 매니페스트에 있는** 상태에서
   *    `pending` 없이도 완료로 판정돼야 한다 — 아니면 이미 REQ 를 닫은 `scope:'req'` 확인이
   *    소비되지 않고 다음 REQ 까지 따라간다.
   */
  it('🔴 엔트리가 이미 있으면 pending 없이도 완료로 판정한다(복구 경로)', () => {
    const r = wouldCompleteReq({ phaseIds: ['p1', 'p2'], manifestContent: doc(design, phase('p1'), phase('p2')) })
    expect(r.complete).toBe(true)
  })

  it('복구 경로에서도 남은 phase 가 있으면 완료가 아니다', () => {
    expect(wouldCompleteReq({ phaseIds: ['p1', 'p2'], manifestContent: doc(design, phase('p1')) }).complete).toBe(false)
  })
})

/**
 * 🔴 설계 r06 P1 회귀 가드: **기록과 소비는 다른 명령이 한다**(DEC-6b).
 *
 * `req:confirm` 은 확인을 쓰고 state checkpoint 를 남기지만 **소비하지 않는다** — 소비는
 * `consumeState` 가 하고, 그 호출처는 `req:commit` 의 evidence-finalize 한 곳뿐이다.
 * checkpoint 가 소비하면 `scope:'phase'` 확인이 기록되자마자 사라져 `phase` 값이 영영 통과할 수 없다.
 */
describe('[REQ-2026-071] 확인 기록은 커밋 전까지 살아 있다', () => {
  const st2 = (over: Partial<WorkflowState>): WorkflowState => ({ id: 'X', phase: 'P', ...over }) as WorkflowState
  const conf = { confirmed: true, method: 'm', confirmed_at: '2026-07-27T00:00:00.000Z', scope: 'phase' as const }

  it('🔴 기록 직후 상태는 게이트를 통과한다(소비되지 않았다)', () => {
    const recorded = st2({ risk_level: 'HIGH', user_commit_confirmed: conf })
    expect(userConfirmGate(recorded, 'phase').blocked).toBe(false)
  })

  it('🔴 소비는 커밋(consumeState)에서만 일어난다', () => {
    const recorded = st2({ risk_level: 'HIGH', user_commit_confirmed: conf })
    const after = consumeState(recorded, { sourceCommitSha: 'a'.repeat(40), consumedAt: '2026-07-27T00:00:00.000Z' })
    expect(after.user_commit_confirmed).toBeNull()
    // 그리고 그 다음 phase 는 다시 요구한다.
    expect(userConfirmGate(after, 'phase').blocked).toBe(true)
  })
})

/**
 * REQ-2026-092 DEC-1 — source 커밋 금지 술어의 **호출부 파리티**.
 *
 * 술어 자체의 경계 케이스는 `scratch.test.ts`가 표로 고정한다. 여기서 지키는 것은 다른 것이다:
 * 두 호출부가 **서로 다른 형태의 입력**을 같은 함수에 넣는다.
 *
 *   - `req:commit`      → `git diff --cached --name-only` (개행 split, 이미 슬래시 정규화됨)
 *   - `req:review-codex`→ `git diff --cached --name-only -z` (NUL split, 마지막에 빈 조각이 남음)
 *
 * 두 형태가 **같은 판정**을 내야 SSOT가 성립한다. 갈라지면 리뷰가 통과시킨 것을 커밋이 거부하는
 * 원래 버그가 형태만 바꿔 재발한다.
 */
describe('[REQ-2026-092] source 커밋 금지 술어 — 두 호출부 입력 형태 파리티', () => {
  const TICKET = 'workflow/REQ-2026-016'
  // 실제 phase 커밋에서 나올 법한 혼합: 코드 + 티켓 설계문서 + 워크플로 파일.
  const NAMES = ['scripts/req/req-commit.ts', `${TICKET}/01-design.md`, `${TICKET}/state.json`, `${TICKET}/responses/approvals.jsonl`]

  it('`--name-only` 형태(req:commit)와 `-z` 형태(req:review-codex)가 같은 판정을 낸다', () => {
    const fromNameOnly = sourceCommitForbiddenStaged(NAMES.join('\n').split('\n'), TICKET)
    // `-z`는 각 경로 뒤에 NUL을 붙이므로 split 결과 **마지막에 빈 조각**이 남는다.
    const fromZ = sourceCommitForbiddenStaged(`${NAMES.join('\0')}\0`.split('\0'), TICKET)
    expect(fromNameOnly).toEqual(fromZ)
    expect(fromNameOnly).toEqual([`${TICKET}/state.json`, `${TICKET}/responses/approvals.jsonl`])
  })

  it('🔴 술어 자신은 두 형태 모두에서 공백을 보존한다 — 갈림이 있다면 원인은 호출부 상류 정규화다', () => {
    // `stagedNames()`가 상류에서 trim하는 것은 알려진 한계(별도 REQ). 술어는 어느 쪽 입력에서도
    // 공백 경로를 금지 대상으로 오인하지 않는다 — 그래야 상류를 고칠 때 판정이 저절로 일치한다.
    const spaced = [` ${TICKET}/state.json`]
    expect(sourceCommitForbiddenStaged(spaced, TICKET)).toEqual([])
    expect(sourceCommitForbiddenStaged(`${spaced.join('\0')}\0`.split('\0'), TICKET)).toEqual([])
  })

  it('🔴 req:commit이 의존하는 계약: 설계문서·코드는 통과시키고 state/responses만 잡는다', () => {
    // 이 계약이 깨지면 정상 phase 커밋(설계문서 동반)이 통째로 막힌다 — 이 저장소의 관례가 그렇다.
    expect(sourceCommitForbiddenStaged([`${TICKET}/01-design.md`, `${TICKET}/codex-request.md`, 'src/a.ts'], TICKET)).toEqual([])
  })

  it('🔴 거부 문구가 위반 경로를 **전부** 나열한다 — 개수만 알리면 사용자가 여러 번 왕복한다', () => {
    const flagged = sourceCommitForbiddenStaged(NAMES, TICKET)
    const msg = forbiddenSourceStagedMessage(flagged)
    expect(msg).toContain('source 커밋에 비-코드 staged 금지')
    for (const p of flagged) expect(msg).toContain(p)
  })
})

/**
 * REQ-2026-092 phase-1 r02 P1 — `stagedNames()`가 phase 게이트와 **같은 바이트**를 본다(실 git).
 *
 * 예전엔 `-z` 없이 개행 split + `trim()`이었다. 그러면 `core.quotePath=true` 기본값에서 비ASCII 경로가
 * C-인용된 표시 문자열(`"workflow/…/\355\225\234…"`)로 들어와 접두사 비교가 빗나가고, **금지 경로 위반을
 * 통째로 놓쳤다(fail-open)**. 게다가 phase 게이트는 `-z` 원문을 보므로 두 판정이 갈렸다 — 갈림 자체가
 * 이 REQ가 없애려는 교착의 재료다.
 */
describe('[REQ-2026-092] stagedNames — phase 게이트와 동일한 -z 원문 (실 git)', () => {
  const TICKET_REL = 'workflow/REQ-2026-001'
  const repos: string[] = []
  afterEach(() => {
    while (repos.length) rmSync(repos.pop() as string, { recursive: true, force: true })
  })

  const setup = (): { repo: string; git: (a: string[]) => string } => {
    const repo = mkdtempSync(join(tmpdir(), 'req092-sn-'))
    repos.push(repo)
    const git = (a: string[]): string =>
      execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { cwd: repo, encoding: 'utf8' }).replace(/\s+$/, '')
    git(['init', '-q'])
    writeFileSync(join(repo, 'seed.txt'), 'seed\n')
    git(['add', '-A'])
    git(['commit', '-qm', 'baseline'])
    mkdirSync(join(repo, TICKET_REL, 'responses'), { recursive: true })
    return { repo, git }
  }

  it('🔴 비ASCII 경로의 금지 위반을 놓치지 않는다(예전 --name-only는 C-인용 때문에 fail-open이었다)', () => {
    const { repo, git } = setup()
    // 티켓 responses/ 아래 한글 파일 — 승인 증거가 코드 커밋에 새는 실제 위반.
    const rel = `${TICKET_REL}/responses/한글-증거.json`
    writeFileSync(join(repo, rel), '{}\n')
    writeFileSync(join(repo, 'src.ts'), 'export const a = 1\n')
    git(['add', '-A'])
    __setGitForTest(repo)
    const names = stagedNames()
    // `-z`라 인용되지 않은 실제 경로가 나온다.
    expect(names).toContain(rel)
    expect(names.some((p) => p.includes('\\3'))).toBe(false) // C-인용 8진 이스케이프가 없다
    // 그래서 금지 술어가 이 위반을 **잡는다**.
    expect(sourceCommitForbiddenStaged(names, TICKET_REL)).toEqual([rel])
  })

  it('🔴 phase 게이트와 바이트 파리티 — 같은 인덱스에서 두 호출부가 같은 배열을 얻는다', () => {
    const { repo, git } = setup()
    writeFileSync(join(repo, `${TICKET_REL}/state.json`), '{}\n')
    writeFileSync(join(repo, `${TICKET_REL}/responses/한글-증거.json`), '{}\n')
    writeFileSync(join(repo, 'src.ts'), 'export const a = 1\n')
    git(['add', '-A'])
    __setGitForTest(repo)
    // review-codex(phase 게이트)가 쓰는 획득 방식 — 같은 인자·같은 split.
    const fromGate = git([...STAGED_NAMES_Z_ARGS]).split('\0').map((p) => p.replace(/\\/g, '/')).filter((p) => p.length > 0)
    expect(stagedNames()).toEqual(fromGate)
    // 판정도 당연히 같다.
    expect(sourceCommitForbiddenStaged(stagedNames(), TICKET_REL)).toEqual(sourceCommitForbiddenStaged(fromGate, TICKET_REL))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// REQ-2026-095: -F 별칭 + 붕괴 의심 경고
// ─────────────────────────────────────────────────────────────────────────────
describe('[REQ-2026-095] -F 별칭', () => {
  it('-F 가 --message-file 과 같은 자리에 담긴다(git commit -F 규약)', () => {
    expect(parseArgs(['2026-001', '-F', 'msg.txt'])).toMatchObject({ messageFile: 'msg.txt', message: null })
    expect(parseArgs(['2026-001', '--message-file', 'msg.txt'])).toMatchObject({ messageFile: 'msg.txt' })
  })

  it('값 누락은 어느 표기든 거부하고, 오류가 실제 쓴 표기를 말한다', () => {
    expect(() => parseArgs(['2026-001', '-F'])).toThrow(/-F 값 필요/)
    expect(() => parseArgs(['2026-001', '--message-file'])).toThrow(/--message-file 값 필요/)
  })

  it('-m 과 함께 쓰면 기존 상호배타 규칙이 그대로 적용된다', () => {
    const o = parseArgs(['2026-001', '-m', 'x', '-F', 'msg.txt'])
    expect(() => resolveMessageSource({ message: o.message, messageFile: o.messageFile }, undefined, () => true)).toThrow(
      /동시 지정 불가/,
    )
  })
})

describe('[REQ-2026-095] looksLikeCollapsedMessage — 붕괴 의심 판정', () => {
  it('🔴 리터럴 \\n 있고 실제 개행 없음 → true (pnpm 재직렬화 흔적)', () => {
    expect(looksLikeCollapsedMessage('subject\\n\\nbody')).toBe(true)
    expect(looksLikeCollapsedMessage('a\\nb')).toBe(true)
  })

  it('🔴 실제 개행이 하나라도 있으면 false — 정상 전달된 여러 줄이다', () => {
    expect(looksLikeCollapsedMessage('subject\n\nbody')).toBe(false)
    // 리터럴과 실제가 섞여 있으면 전달은 성공한 것이므로 경고하지 않는다.
    expect(looksLikeCollapsedMessage('subject\nbody with literal \\n inside')).toBe(false)
  })

  it('리터럴 \\n 이 없으면 false · 빈 값·null·한 줄 평문도 false', () => {
    expect(looksLikeCollapsedMessage('fix(x): 한 줄 메시지')).toBe(false)
    expect(looksLikeCollapsedMessage('')).toBe(false)
    expect(looksLikeCollapsedMessage(null)).toBe(false)
  })

  it('경고 문구가 탐지의 한계를 밝힌다 — "경고 없음 = 안전"으로 읽히면 안 된다', () => {
    const w = collapsedMessageWarning()
    expect(w).toContain('--message-file')
    expect(w).toContain('-F')
    expect(w).toContain('npm')
    expect(w).toMatch(/안전하다는 뜻은 아닙니다/) // npm의 조용한 절단은 탐지 불가
    expect(w).toMatch(/고치지 않습니다/) // 자동 복원 금지를 사용자에게 명시
  })
})

describe('[REQ-2026-095] 경고 배선 — 실제 진입점에서 관측 (실 git)', () => {
  const repos: string[] = []
  afterEach(() => {
    while (repos.length) rmSync(repos.pop() as string, { recursive: true, force: true })
  })

  /** setup 마커만 갖춘 최소 저장소. 경고는 doctor·게이트보다 앞이라 뒤 단계가 실패해도 관측된다. */
  const mkMinimalRepo = (): string => {
    const repo = mkdtempSync(join(tmpdir(), 'req095-'))
    repos.push(repo)
    execFileSync('git', ['init', '-q'], { cwd: repo })
    writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.0' }))
    writeFileSync(
      join(repo, 'req.config.json'),
      JSON.stringify({ setup: { completedVersion: '0.0.0-test', completedAt: '2026-01-01T00:00:00Z' }, packageManager: 'npm' }),
    )
    return repo
  }

  it('🔴 붕괴 조건의 -m 이면 경고가 **실제로 나온다** — 순수 판정만 고정하면 배선이 빠져도 통과한다', () => {
    const repo = mkMinimalRepo()
    const warns: string[] = []
    const spy = vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => void warns.push(a.join(' ')))
    try {
      // 티켓이 없어 뒤에서 실패하지만, 경고는 그보다 **앞**에서 나온다(설계 DEC-4).
      try { reqCommitMain(['2026-999', '-m', 'subject\\n\\nbody', '--root', repo]) } catch { /* 뒤 단계 실패는 무관 */ }
    } finally {
      spy.mockRestore()
    }
    expect(warns.join('\n')).toContain('한 줄로 붕괴했을 수 있습니다')
  })

  it('🔴 정상 한 줄 메시지에는 경고가 나오지 않는다(오탐 대조군)', () => {
    const repo = mkMinimalRepo()
    const warns: string[] = []
    const spy = vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => void warns.push(a.join(' ')))
    try {
      try { reqCommitMain(['2026-999', '-m', 'fix(x): 한 줄', '--root', repo]) } catch { /* 무관 */ }
    } finally {
      spy.mockRestore()
    }
    expect(warns.join('\n')).not.toContain('붕괴')
  })

  it('🔴 경고는 차단하지 않고 메시지를 고치지도 않는다', () => {
    // 판정이 true여도 예외를 던지지 않는다(경고는 자문이다).
    expect(() => looksLikeCollapsedMessage('a\\nb')).not.toThrow()
    // 그리고 어떤 함수도 메시지를 변형하지 않는다 — 입력이 그대로 유지된다.
    const msg = 'subject\\n\\nbody'
    const o = parseArgs(['2026-001', '-m', msg])
    expect(o.message).toBe(msg)
    expect(resolveMessageSource({ message: o.message, messageFile: null }, undefined, () => true).message).toBe(msg)
  })
})
