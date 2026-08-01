import { describe, it, expect } from 'vitest'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { packageRoot } from '../../scripts/req/lib/config'
import {
  archiveBaseName,
  isValidIsoInstant,
  isConfinedArchivePath,
  buildManifestEntry,
  validateManifest,
  evidencedPhaseIdsFromManifest,
  verifyPhaseArchives,
  serializeManifestLine,
  durableDesignEvidence,
  findEvidenceRow,
  isDurabilityRequired,
  verifyCommittedDesignEvidence,
  verifyCommittedEvidenceIntegrity,
  splitUnboundPhases,
  type EvidencePorts,
} from '../../scripts/req/lib/evidence'
import { createEvidencePorts } from '../../scripts/req/lib/evidence-ports'
import type { ApprovalEvidence } from '../../scripts/req/review-codex'

/**
 * REQ-2026-048 phase-1 — `lib/evidence.ts`의 **leaf 불변식**을 고정한다.
 *
 * 🔴 이 파일이 `review-codex`·`req-doctor`·`req-commit` 에서 **값(런타임) import**를 하면
 *    `review-codex → lib/evidence → review-codex` 런타임 순환이 되살아난다. 그 순환이 바로
 *    design evidence 내구화를 승인 경로에 흡수하지 못하게 막던 구조적 원인이다.
 *    타입 전용(`import type`)은 컴파일 시 소거되므로 허용한다.
 *
 * 오라클은 **소스 텍스트**다 — 번들러/런타임이 순환을 조용히 견디는 경우에도 의도 위반을 잡아야 한다.
 */
const EVIDENCE_SRC = join(packageRoot(), 'scripts', 'req', 'lib', 'evidence.ts')

/** 소스에서 `import`/`export ... from` 구문을 (typeOnly, 모듈경로)로 뽑는다. */
function moduleEdges(src: string): { typeOnly: boolean; from: string }[] {
  const out: { typeOnly: boolean; from: string }[] = []
  const re = /^\s*(?:import|export)\s+(type\s+)?([^'"]*?)\s*from\s*['"]([^'"]+)['"]/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    // `import { type A, type B } from` 처럼 절 내부에만 type이 붙은 경우도 타입 전용으로 본다.
    const clause = m[2] ?? ''
    const namedOnlyTypes = /^\{[^}]*\}$/.test(clause.trim()) && !/\{\s*[A-Za-z_$][^}]*?\}/.test(clause.replace(/type\s+[A-Za-z_$][\w$]*/g, ''))
    out.push({ typeOnly: Boolean(m[1]) || namedOnlyTypes, from: m[3] ?? '' })
  }
  return out
}

describe('[REQ-2026-048] lib/evidence.ts — leaf 불변식', () => {
  const src = readFileSync(EVIDENCE_SRC, 'utf8')
  const edges = moduleEdges(src)

  it('상위 모듈(review-codex·req-doctor·req-commit)에서 런타임 import를 하지 않는다', () => {
    const forbidden = ['review-codex', 'req-doctor', 'req-commit']
    const runtimeViolations = edges.filter((e) => !e.typeOnly && forbidden.some((f) => e.from.includes(f)))
    expect(
      runtimeViolations.map((e) => e.from),
      'lib/evidence.ts 는 leaf 여야 한다 — 상위 모듈의 값 import는 review-codex↔req-commit 순환을 되살린다',
    ).toEqual([])
  })

  it('런타임 import 대상은 leaf(lib/*)로만 제한된다', () => {
    const runtime = edges.filter((e) => !e.typeOnly).map((e) => e.from)
    for (const from of runtime) {
      expect(from.startsWith('./') || from.startsWith('node:'), `예상 외 런타임 의존: ${from}`).toBe(true)
      expect(from.includes('../'), `상위 디렉터리 런타임 의존 금지: ${from}`).toBe(false)
    }
  })

  it('상위 모듈 참조는 타입 전용으로만 존재한다(있다면)', () => {
    const upper = edges.filter((e) => e.from.includes('../review-codex'))
    for (const e of upper) expect(e.typeOnly, `../review-codex 참조는 import type 이어야 한다: ${e.from}`).toBe(true)
  })
})

/**
 * 이동이 **동작을 바꾸지 않았다**는 최소 확인. 상세 동작 계약은 기존 `req-commit.test.ts`가 그대로 검증하며
 * (re-export 덕에 무수정 그린), 여기서는 새 경로로도 같은 결과가 나오는지만 본다.
 */
describe('[REQ-2026-048] 이동한 술어 — 새 경로에서 동작 동일', () => {
  it('archiveBaseName: design은 phaseId 무시, phase는 phaseId(없으면 phase)', () => {
    expect(archiveBaseName('design', 'phase-A')).toBe('design')
    expect(archiveBaseName('phase', 'phase-A')).toBe('phase-A')
    expect(archiveBaseName('phase', null)).toBe('phase')
  })

  it('isValidIsoInstant: 형식 + 달력 유효성 둘 다', () => {
    expect(isValidIsoInstant('2026-07-22T04:05:06Z')).toBe(true)
    expect(isValidIsoInstant('2026-99-99T99:99:99Z')).toBe(false)
    expect(isValidIsoInstant('nope')).toBe(false)
  })

  it('isConfinedArchivePath: 현재 티켓 responses/ 직계 아카이브만', () => {
    const t = 'workflow/REQ-2026-001'
    expect(isConfinedArchivePath(`${t}/responses/design-r01-approved.json`, t)).toBe(true)
    expect(isConfinedArchivePath(`${t}/responses/approvals.jsonl`, t)).toBe(false)
    expect(isConfinedArchivePath(`${t}/responses/../../escape-r01-approved.json`, t)).toBe(false)
    expect(isConfinedArchivePath(`workflow/REQ-2026-002/responses/design-r01-approved.json`, t)).toBe(false)
    expect(isConfinedArchivePath(`${t}/responses/design-r01-approved.json`, undefined)).toBe(false)
  })

  it('buildManifestEntry/validateManifest: design 행이 왕복 검증을 통과한다', () => {
    const t = 'workflow/REQ-2026-001'
    const sha = 'a'.repeat(64)
    const oid = 'b'.repeat(40)
    const entry = buildManifestEntry(
      {
        review_kind: 'design',
        phase_id: null,
        response_path: `${t}/responses/design-r01-approved.json`,
        response_sha256: sha,
        review_base_sha: oid,
        design_hash: sha,
        approved_at: '2026-07-22T00:00:00.000Z',
      } as Parameters<typeof buildManifestEntry>[0],
      { consumedAt: '2026-07-22T00:00:01.000Z', consumedByCommitSha: oid, userCommitConfirmed: null },
    )
    expect(entry.kind).toBe('design')
    expect(validateManifest(`${JSON.stringify(entry)}\n`, { ticketRel: t, validPhaseIds: [] })).toEqual([])
  })

  // ── REQ-2026-052 DEC-B5(phase-3a2): phase_design_ref 스키마 ──
  const t = 'workflow/REQ-2026-001'
  const sha = 'a'.repeat(64)
  const oid = 'b'.repeat(40)
  const dref = 'd'.repeat(64)
  const phaseEv = (extra: Record<string, unknown> = {}) => buildManifestEntry(
    {
      review_kind: 'phase', phase_id: 'p1',
      response_path: `${t}/responses/p1-r01-approved.json`,
      response_sha256: sha, review_base_sha: oid, approved_tree: oid,
      approved_at: '2026-07-22T00:00:00.000Z', ...extra,
    } as Parameters<typeof buildManifestEntry>[0],
    { consumedAt: '2026-07-22T00:00:01.000Z', consumedByCommitSha: oid, userCommitConfirmed: null },
  )

  it('㊾ buildManifestEntry: phase_design_ref가 있으면 phase 행에 포함, 없으면 키 부재(바이트 무회귀)', () => {
    const withRef = phaseEv({ phase_design_ref: dref })
    expect((withRef as { phase_design_ref?: unknown }).phase_design_ref).toBe(dref)
    const without = phaseEv({})
    expect('phase_design_ref' in without).toBe(false) // 레거시 무회귀 — 키 자체가 없다
  })

  it('㊾ validateManifest: phase 행 phase_design_ref는 선택(부재 OK)·있으면 64hex', () => {
    const vp = { ticketRel: t, validPhaseIds: ['p1'] }
    expect(validateManifest(`${JSON.stringify(phaseEv({}))}\n`, vp)).toEqual([]) // 부재 OK
    expect(validateManifest(`${JSON.stringify(phaseEv({ phase_design_ref: dref }))}\n`, vp)).toEqual([]) // 64hex OK
    const bad = validateManifest(`${JSON.stringify(phaseEv({ phase_design_ref: 'nothex' }))}\n`, vp)
    expect(bad.some((p) => /phase_design_ref 비-64hex/.test(p))).toBe(true)
  })

  // ── REQ-2026-094 DEC-4·4a: 복원 행 어휘 ──
  //
  // 🔴 이 블록의 첫 테스트가 가장 중요하다. 새 키를 어휘에 더하면서 기존 커밋 행을 깨면
  //    업그레이드만으로 모든 티켓이 corrupt가 되어 req:new가 전부 막힌다(직전 REQ에서 같은 자리 지뢰).
  const vp1 = { ticketRel: t, validPhaseIds: ['p1'] }
  /** 복원 행: consumed_at·user_commit_confirmed **없음** + reconstructed/evidence_basis 있음. */
  const reconRow = (over: Record<string, unknown> = {}): Record<string, unknown> => {
    const { consumed_at: _c, user_commit_confirmed: _u, ...rest } = phaseEv({}) as unknown as Record<string, unknown>
    return { ...rest, reconstructed: true, evidence_basis: [`${t}/state.json#approval_evidence`], ...over }
  }

  it('🔴 REQ-2026-094: 새 키가 **없는** 기존 행이 그대로 유효하다(업그레이드 무회귀)', () => {
    const legacy = phaseEv({}) as unknown as Record<string, unknown>
    expect('reconstructed' in legacy).toBe(false)
    expect('evidence_basis' in legacy).toBe(false)
    expect(validateManifest(`${JSON.stringify(legacy)}\n`, vp1)).toEqual([])
    // 명시적 false도 원본 행으로 유효(consumed_at·ucc는 여전히 필수).
    expect(validateManifest(`${JSON.stringify({ ...legacy, reconstructed: false })}\n`, vp1)).toEqual([])
  })

  it('🔴 REQ-2026-094: 복원 행은 consumed_at·user_commit_confirmed **없이** 유효하다', () => {
    expect(validateManifest(`${JSON.stringify(reconRow())}\n`, vp1)).toEqual([])
  })

  it('🔴 REQ-2026-094: 복원 행에 consumed_at·user_commit_confirmed를 채우면 거부(모르는 값 날조 금지)', () => {
    const withConsumed = validateManifest(`${JSON.stringify(reconRow({ consumed_at: '2026-07-22T00:00:01.000Z' }))}\n`, vp1)
    expect(withConsumed.some((p) => /복원 행에 consumed_at 금지/.test(p))).toBe(true)
    const withUcc = validateManifest(`${JSON.stringify(reconRow({ user_commit_confirmed: null }))}\n`, vp1)
    expect(withUcc.some((p) => /복원 행에 user_commit_confirmed 금지/.test(p))).toBe(true)
  })

  it('🔴 REQ-2026-094: 근거 없는 복원 금지 — evidence_basis가 비면 거부', () => {
    expect(validateManifest(`${JSON.stringify(reconRow({ evidence_basis: [] }))}\n`, vp1).some((p) => /evidence_basis가 비어 있음/.test(p))).toBe(true)
    const { evidence_basis: _e, ...noBasis } = reconRow()
    expect(validateManifest(`${JSON.stringify(noBasis)}\n`, vp1).some((p) => /evidence_basis가 비어 있음/.test(p))).toBe(true)
    expect(validateManifest(`${JSON.stringify(reconRow({ evidence_basis: [''] }))}\n`, vp1).some((p) => /비지 않은 문자열/.test(p))).toBe(true)
  })

  it('🔴 REQ-2026-094: 원본 행에 evidence_basis 금지(원본과 복원의 구별이 무너지면 안 된다)', () => {
    const legacy = phaseEv({}) as unknown as Record<string, unknown>
    const problems = validateManifest(`${JSON.stringify({ ...legacy, evidence_basis: ['x'] })}\n`, vp1)
    expect(problems.some((p) => /원본 행.*evidence_basis 금지/.test(p))).toBe(true)
  })

  it('REQ-2026-094: reconstructed는 phase 전용(design 행에 금지) · boolean이어야', () => {
    const designRow = buildManifestEntry(
      { review_kind: 'design', phase_id: null, response_path: `${t}/responses/design-r01-approved.json`, response_sha256: sha, review_base_sha: oid, design_hash: sha, approved_at: '2026-07-22T00:00:00.000Z' } as Parameters<typeof buildManifestEntry>[0],
      { consumedAt: '2026-07-22T00:00:01.000Z', consumedByCommitSha: oid, userCommitConfirmed: null },
    ) as unknown as Record<string, unknown>
    const { consumed_at: _c, user_commit_confirmed: _u, ...d } = designRow
    const problems = validateManifest(`${JSON.stringify({ ...d, reconstructed: true, evidence_basis: ['x'] })}\n`, { ticketRel: t, validPhaseIds: [] })
    expect(problems.some((p) => /design 행에는 reconstructed 금지/.test(p))).toBe(true)
    expect(validateManifest(`${JSON.stringify(reconRow({ reconstructed: 'yes' }))}\n`, vp1).some((p) => /reconstructed는 boolean/.test(p))).toBe(true)
  })

  it('㊾ validateManifest: design 행에 phase_design_ref 금지(kind 격리)', () => {
    const designRow = buildManifestEntry(
      { review_kind: 'design', phase_id: null, response_path: `${t}/responses/design-r01-approved.json`, response_sha256: sha, review_base_sha: oid, design_hash: sha, approved_at: '2026-07-22T00:00:00.000Z' } as Parameters<typeof buildManifestEntry>[0],
      { consumedAt: '2026-07-22T00:00:01.000Z', consumedByCommitSha: oid, userCommitConfirmed: null },
    ) as unknown as Record<string, unknown>
    designRow.phase_design_ref = dref // 주입
    const problems = validateManifest(`${JSON.stringify(designRow)}\n`, { ticketRel: t, validPhaseIds: [] })
    expect(problems.some((p) => /design entry에 phase_design_ref 금지/.test(p))).toBe(true)
  })

  // ── REQ-2026-052 DEC-B6(phase-3b2): verifyPhaseArchives 순수 검증(headBlobSha256 포트) ──
  it('⓸⓹⓺ verifyPhaseArchives: 존재+일치=문제없음 · 부재=missing · 불일치=sha-mismatch', () => {
    const p1 = `${t}/responses/p1-r01-approved.json`
    const p2 = `${t}/responses/p2-r01-approved.json`
    const mf = serializeManifestLine(phaseEv({ phase_design_ref: dref })) // p1, sha=sha('a'*64)
      + serializeManifestLine(buildManifestEntry(
        { review_kind: 'phase', phase_id: 'p2', response_path: p2, response_sha256: 'b'.repeat(64), review_base_sha: oid, approved_tree: oid, phase_design_ref: dref, approved_at: '2026-07-22T00:00:00.000Z' } as Parameters<typeof buildManifestEntry>[0],
        { consumedAt: '2026-07-22T00:00:01.000Z', consumedByCommitSha: oid, userCommitConfirmed: null }))
    // 둘 다 존재+일치 → 문제 없음.
    expect(verifyPhaseArchives(mf, (p) => (p === p1 ? sha : p === p2 ? 'b'.repeat(64) : null))).toEqual([])
    // p1 부재 → missing.
    expect(verifyPhaseArchives(mf, (p) => (p === p2 ? 'b'.repeat(64) : null)).map((x) => x.reason)).toEqual(['missing'])
    // p2 변조(sha 불일치) → sha-mismatch.
    const probs = verifyPhaseArchives(mf, (p) => (p === p1 ? sha : p === p2 ? 'c'.repeat(64) : null))
    expect(probs).toEqual([{ phaseId: 'p2', responsePath: p2, reason: 'sha-mismatch' }])
  })

  it('⓸ verifyPhaseArchives: onlyDesignRef 지정 시 그 design 결속 phase만(강한 정책 기본=전량)', () => {
    const p1 = `${t}/responses/p1-r01-approved.json`
    const mf = serializeManifestLine(phaseEv({ phase_design_ref: dref })) // p1 결속=dref
    // onlyDesignRef=다른 값 → p1 제외 → 검증 대상 없음(문제 없음).
    expect(verifyPhaseArchives(mf, () => null, 'f'.repeat(64))).toEqual([])
    // onlyDesignRef=dref → p1 포함 → 부재 감지.
    expect(verifyPhaseArchives(mf, () => null, dref).map((x) => x.phaseId)).toEqual(['p1'])
    // design 행은 대상 아님(phase만).
    const withDesign = mf + serializeManifestLine(buildManifestEntry(
      { review_kind: 'design', phase_id: null, response_path: `${t}/responses/design-r01-approved.json`, response_sha256: sha, review_base_sha: oid, design_hash: sha, approved_at: '2026-07-22T00:00:00.000Z' } as Parameters<typeof buildManifestEntry>[0],
      { consumedAt: '2026-07-22T00:00:01.000Z', consumedByCommitSha: oid, userCommitConfirmed: null }))
    expect(verifyPhaseArchives(withDesign, (p) => (p === p1 ? sha : null))).toEqual([]) // p1 일치·design 무시
  })
})

// ───────────── durableDesignEvidence — HEAD 기준 멱등 + 실패 주입 (REQ-2026-048 phase-3) ──

const T2 = 'workflow/REQ-2026-048'
const MANIFEST = `${T2}/responses/approvals.jsonl`
const APPROVED = `${T2}/responses/design-r02-approved.json`
const NEEDSFIX = `${T2}/responses/design-r01-needs-fix.json`
const S_APPROVED = '1'.repeat(64)
const S_NEEDSFIX = '2'.repeat(64)
const OID40 = 'c'.repeat(40)

const designEv = {
  review_kind: 'design',
  phase_id: null,
  response_path: APPROVED,
  response_sha256: S_APPROVED,
  review_base_sha: OID40,
  design_hash: '3'.repeat(64),
  approved_at: '2026-07-22T00:00:00.000Z',
} as unknown as ApprovalEvidence

/**
 * 실패 주입 가능한 가짜 포트. `head`는 **커밋된 상태**를, `disk`는 워킹트리를 나타낸다.
 * `commit()`이 실패하도록 만들면 "매니페스트는 썼는데 커밋만 실패한" 부분 상태를 정확히 재현할 수 있다.
 */
function fakePorts(opts: { failCommit?: boolean } = {}): EvidencePorts & {
  disk: Map<string, string>
  head: Map<string, string>
  commits: string[]
  staged: string[][]
} {
  const disk = new Map<string, string>([
    [NEEDSFIX, 'needs-fix-body'],
    [APPROVED, 'approved-body'],
  ])
  const head = new Map<string, string>()
  const commits: string[] = []
  const staged: string[][] = []
  let pending: string[] = []
  const sha = (s: string): string => (s === 'needs-fix-body' ? S_NEEDSFIX : s === 'approved-body' ? S_APPROVED : `x${s.length}`.padEnd(64, '0'))
  return {
    disk,
    head,
    commits,
    staged,
    readText: (p) => disk.get(p) ?? null,
    writeText: (p, c) => void disk.set(p, c),
    listArchiveNames: () => ['design-r01-needs-fix.json', 'design-r02-approved.json'],
    sha256: (p) => sha(disk.get(p) ?? ''),
    headText: (p) => head.get(p) ?? null,
    headBlobSha256: (p) => (head.has(p) ? sha(head.get(p) as string) : null),
    headArchivePaths: () => [...head.keys()].filter((p) => /-r\d{2,}-(approved|needs-fix)\.json$/.test(p)),
    headCommitSha: () => OID40,
    commitPaths: (paths, msg) => {
      pending = [...paths]
      if (opts.failCommit) throw new Error('git commit 실패(주입)')
      staged.push([...pending])
      // 커밋 = 지정 경로만 HEAD로 이동(pathspec 범위 — 나머지 index는 무관)
      for (const p of pending) head.set(p, disk.get(p) as string)
      commits.push(msg)
      pending = []
    },
  }
}

const run = (ports: EvidencePorts): ReturnType<typeof durableDesignEvidence> =>
  durableDesignEvidence({
    ticketId: 'REQ-2026-048',
    ticketRel: T2,
    evidence: designEv,
    validPhaseIds: [],
    nowIso: '2026-07-22T00:00:01.000Z',
    ports,
  })

describe('[REQ-2026-048] durableDesignEvidence — 정상 경로', () => {
  it('needs-fix 포함 인벤토리 전량 + 승인본 + 매니페스트를 커밋한다', () => {
    const p = fakePorts()
    const r = run(p)
    expect(r.outcome).toBe('committed')
    expect(p.commits).toHaveLength(1)
    // 🔴 needs-fix 라운드가 실제로 stage된다 — 기존 구현이 놓치던 바로 그것.
    expect(p.staged[0]).toEqual([NEEDSFIX, APPROVED, MANIFEST])
    const row = findEvidenceRow(p.disk.get(MANIFEST) as string, { kind: 'design', phaseId: null, responseSha256: S_APPROVED })
    expect(row?.archive_inventory?.map((i) => i.response_path)).toEqual([NEEDSFIX, APPROVED])
  })

  it('완전 내구화 후 재실행은 진짜 no-op(새 커밋 0건)', () => {
    const p = fakePorts()
    run(p)
    const before = p.disk.get(MANIFEST)
    const r2 = run(p)
    expect(r2.outcome).toBe('already-durable')
    expect(p.commits).toHaveLength(1) // 새 커밋 없음
    expect(p.disk.get(MANIFEST)).toBe(before) // 매니페스트 무변경(중복 행 없음)
  })
})

describe('[REQ-2026-048] durableDesignEvidence — 실패 주입(DEC-5)', () => {
  it('커밋 실패 시 throw하되 매니페스트 append는 남는다(부분 상태)', () => {
    const p = fakePorts({ failCommit: true })
    expect(() => run(p)).toThrow(/git commit 실패/)
    expect(p.commits).toHaveLength(0)
    expect(findEvidenceRow(p.disk.get(MANIFEST) as string, { kind: 'design', phaseId: null, responseSha256: S_APPROVED })).not.toBeNull()
    expect(p.head.has(MANIFEST)).toBe(false) // HEAD엔 없다
  })

  /**
   * 🔴 design r01 P1-2 회귀 고정. 온디스크 엔트리 존재만으로 skip했다면 여기서 재시도가 아무것도 하지 않아
   * HEAD 증거를 **영원히** 복구하지 못한다. 멱등 판정이 HEAD 기준이어야 복구된다.
   */
  it('부분 상태에서 재시도하면 중복 append 없이 stage·commit을 재수행해 복구한다', () => {
    const failing = fakePorts({ failCommit: true })
    expect(() => run(failing)).toThrow()
    const manifestAfterFail = failing.disk.get(MANIFEST) as string

    // 같은 디스크 상태에서 커밋이 되는 포트로 재시도.
    const retry = fakePorts()
    retry.disk.set(MANIFEST, manifestAfterFail)
    const r = run(retry)

    expect(r.outcome).toBe('recommitted')
    expect(retry.commits).toHaveLength(1)
    expect(retry.staged[0]).toEqual([NEEDSFIX, APPROVED, MANIFEST])
    // 중복 append가 없어야 한다 — 행이 정확히 1개.
    const rows = (retry.disk.get(MANIFEST) as string).split('\n').filter(Boolean)
    expect(rows).toHaveLength(1)
    expect(retry.disk.get(MANIFEST)).toBe(manifestAfterFail) // 내용 자체가 변하지 않았다
  })

  it('HEAD에 행은 있으나 인벤토리 아카이브 sha가 어긋나면 재커밋한다', () => {
    const p = fakePorts()
    run(p)
    p.head.set(NEEDSFIX, 'tampered') // HEAD 쪽 내용이 기록된 sha와 불일치
    const r = run(p)
    expect(r.outcome).toBe('recommitted')
    expect(p.commits).toHaveLength(2)
  })

  it('design이 아닌 evidence는 거부한다(fail-fast)', () => {
    const p = fakePorts()
    expect(() =>
      durableDesignEvidence({
        ticketId: 'X',
        ticketRel: T2,
        evidence: { ...designEv, review_kind: 'phase' } as ApprovalEvidence,
        validPhaseIds: [],
        nowIso: '2026-07-22T00:00:01.000Z',
        ports: p,
      }),
    ).toThrow(/review_kind != design/)
  })

  /**
   * 🔴 phase-3 리뷰 P1 회귀 고정 — 가드는 **커밋 대상 경로**에만 건다.
   * 호출부가 설계 문서를 미리 stage해 둔 정상 경로(design 리뷰는 index의 문서를 본다)에서
   * index 전체를 leak으로 보면 자동 내구화가 **항상** 실패한다.
   */
  it('무관한 staged 변경이 있어도 evidence는 정상 커밋된다(pathspec 범위)', () => {
    const p = fakePorts()
    // 설계 문서를 미리 stage해 둔 상황을 모사 — 포트는 pathspec 범위라 이를 알 필요조차 없다.
    const r = run(p)
    expect(r.outcome).toBe('committed')
    expect(p.commits).toHaveLength(1)
    // 커밋된 것은 evidence 경로뿐이다.
    expect(p.staged[0]?.every((x) => x.startsWith(`${T2}/responses/`))).toBe(true)
  })
})

/**
 * 실제 git 저장소 + 실제 포트로 도는 통합 검증(phase-2 리뷰 관찰 대응).
 * 가짜 포트는 로직을 고정하지만 `createEvidencePorts`의 실제 동작(특히 **HEAD blob 바이트 해시**)은 못 잡는다.
 */
describe('[REQ-2026-048] createEvidencePorts + durableDesignEvidence — 실제 git 통합', () => {
  it('실제 저장소에서 인벤토리 전량을 커밋하고, 재실행은 no-op이다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cg-ev-'))
    try {
      const git = (args: string[]): string => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
      git(['init', '-q'])
      git(['config', 'user.email', 't@t.t'])
      git(['config', 'user.name', 't'])
      const tRel = 'workflow/REQ-2026-001'
      const respDir = join(dir, ...`${tRel}/responses`.split('/'))
      mkdirSync(respDir, { recursive: true })
      // 초기 커밋(HEAD가 있어야 rev-parse/cat-file이 동작)
      writeFileSync(join(dir, 'seed.txt'), 'seed\n')
      git(['add', 'seed.txt'])
      git(['commit', '-q', '-m', 'seed'])

      const needsFixBody = '{"status":"NEEDS_FIX"}\n'
      const approvedBody = '{"status":"COMPLETE"}\n'
      writeFileSync(join(respDir, 'design-r01-needs-fix.json'), needsFixBody)
      writeFileSync(join(respDir, 'design-r02-approved.json'), approvedBody)
      const shaOf = (s: string): string => createHash('sha256').update(Buffer.from(s)).digest('hex')

      const ev = {
        review_kind: 'design',
        phase_id: null,
        response_path: `${tRel}/responses/design-r02-approved.json`,
        response_sha256: shaOf(approvedBody),
        review_base_sha: git(['rev-parse', 'HEAD']).trim(),
        design_hash: 'd'.repeat(64),
        approved_at: '2026-07-22T00:00:00.000Z',
      } as unknown as ApprovalEvidence

      const ports = createEvidencePorts(dir, `${tRel}/responses`)
      const r1 = durableDesignEvidence({
        ticketId: 'REQ-2026-001',
        ticketRel: tRel,
        evidence: ev,
        validPhaseIds: [],
        nowIso: '2026-07-22T00:00:01.000Z',
        ports,
      })
      expect(r1.outcome).toBe('committed')

      // HEAD에 needs-fix까지 실제로 들어갔는가.
      const tracked = git(['ls-tree', '-r', '--name-only', 'HEAD']).split('\n').map((l) => l.trim())
      expect(tracked).toContain(`${tRel}/responses/design-r01-needs-fix.json`)
      expect(tracked).toContain(`${tRel}/responses/design-r02-approved.json`)
      expect(tracked).toContain(`${tRel}/responses/approvals.jsonl`)

      // 기록된 sha가 **HEAD blob 바이트**와 일치한다(autocrlf 환경에서도 성립해야 하는 핵심).
      const row = findEvidenceRow(ports.headText(`${tRel}/responses/approvals.jsonl`) ?? '', {
        kind: 'design',
        phaseId: null,
        responseSha256: ev.response_sha256,
      })
      expect(row).not.toBeNull()
      for (const item of row?.archive_inventory ?? []) {
        expect(ports.headBlobSha256(item.response_path), item.response_path).toBe(item.sha256)
      }

      // 재실행 = 진짜 no-op(새 커밋 없음).
      const before = git(['rev-parse', 'HEAD']).trim()
      const r2 = durableDesignEvidence({
        ticketId: 'REQ-2026-001',
        ticketRel: tRel,
        evidence: ev,
        validPhaseIds: [],
        nowIso: '2026-07-22T00:00:02.000Z',
        ports,
      })
      expect(r2.outcome).toBe('already-durable')
      expect(git(['rev-parse', 'HEAD']).trim()).toBe(before)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

/**
 * 🔴 phase-3 리뷰 P1 회귀 고정(실제 git) — **설계 문서가 이미 stage된 정상 승인 경로**.
 *
 * design 리뷰는 index의 설계 문서를 대상으로 돌 수 있으므로, 문서를 stage한 채 승인하는 것은 정상이다.
 * 그 상태에서 evidence 내구화가 실패하면(과거 구현) 승인만 남고 증거는 영영 커밋되지 않는다.
 * 요구: evidence **만** 커밋되고, 기존 staged 변경은 **index에 그대로 남는다**.
 */
describe('[REQ-2026-048] 무관한 staged 변경 보존 — 실제 git', () => {
  it('설계 문서가 stage된 상태에서도 evidence만 커밋되고 index는 보존된다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cg-ev2-'))
    try {
      const git = (args: string[]): string => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
      git(['init', '-q'])
      git(['config', 'user.email', 't@t.t'])
      git(['config', 'user.name', 't'])
      const tRel = 'workflow/REQ-2026-001'
      const respDir = join(dir, ...`${tRel}/responses`.split('/'))
      mkdirSync(respDir, { recursive: true })
      writeFileSync(join(dir, 'seed.txt'), 'seed\n')
      git(['add', 'seed.txt'])
      git(['commit', '-q', '-m', 'seed'])

      // 무관한 staged 변경 2종: 신규 파일 + 기존 파일 수정.
      writeFileSync(join(dir, 'workflow', 'REQ-2026-001', '01-design.md'), '# design\n')
      writeFileSync(join(dir, 'seed.txt'), 'seed-modified\n')
      git(['add', '--', `${tRel}/01-design.md`, 'seed.txt'])
      const stagedBefore = git(['diff', '--cached', '--name-only']).trim().split('\n').sort()
      expect(stagedBefore).toEqual(['seed.txt', `${tRel}/01-design.md`])

      const approvedBody = '{"status":"COMPLETE"}\n'
      writeFileSync(join(respDir, 'design-r01-approved.json'), approvedBody)
      const ev = {
        review_kind: 'design',
        phase_id: null,
        response_path: `${tRel}/responses/design-r01-approved.json`,
        response_sha256: createHash('sha256').update(Buffer.from(approvedBody)).digest('hex'),
        review_base_sha: git(['rev-parse', 'HEAD']).trim(),
        design_hash: 'd'.repeat(64),
        approved_at: '2026-07-22T00:00:00.000Z',
      } as unknown as ApprovalEvidence

      const r = durableDesignEvidence({
        ticketId: 'REQ-2026-001',
        ticketRel: tRel,
        evidence: ev,
        validPhaseIds: [],
        nowIso: '2026-07-22T00:00:01.000Z',
        ports: createEvidencePorts(dir, `${tRel}/responses`),
      })
      expect(r.outcome, '설계 문서가 staged여도 내구화는 성공해야 한다').toBe('committed')

      // evidence만 커밋됐다.
      const committed = git(['show', '--name-only', '--format=', 'HEAD']).trim().split('\n').map((l) => l.trim()).filter(Boolean).sort()
      expect(committed).toEqual([`${tRel}/responses/approvals.jsonl`, `${tRel}/responses/design-r01-approved.json`])

      // 🔴 기존 staged 변경은 index에 그대로 남아 있다.
      const stagedAfter = git(['diff', '--cached', '--name-only']).trim().split('\n').filter(Boolean).sort()
      expect(stagedAfter).toEqual(['seed.txt', `${tRel}/01-design.md`])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// ───────────── DONE 게이트 판정 함수 (REQ-2026-048 phase-4) ──

describe('[REQ-2026-048] isDurabilityRequired — HEAD blob 기준 신규/legacy 판별', () => {
  it('marker=true → 엄격', () => {
    expect(isDurabilityRequired(JSON.stringify({ evidence_durability_required: true }))).toBe(true)
  })
  it('marker 부재/false → legacy(관대)', () => {
    expect(isDurabilityRequired(JSON.stringify({ id: 'REQ-2026-001' }))).toBe(false)
    expect(isDurabilityRequired(JSON.stringify({ evidence_durability_required: false }))).toBe(false)
  })
  /** 🔴 design r01 P1-1 — 캐시 소실로 게이트를 우회할 수 없어야 한다. HEAD blob 부재/파손은 **엄격**. */
  it('HEAD blob 부재·파손 → 보수적으로 엄격', () => {
    expect(isDurabilityRequired(null)).toBe(true)
    expect(isDurabilityRequired('{not json')).toBe(true)
    expect(isDurabilityRequired('[]')).toBe(true)
  })
})

describe('[REQ-2026-048] verifyCommittedDesignEvidence — HEAD blob만 본다', () => {
  const T3 = 'workflow/REQ-2026-001'
  const MAN = `${T3}/responses/approvals.jsonl`
  const AP = `${T3}/responses/design-r02-approved.json`
  const NF = `${T3}/responses/design-r01-needs-fix.json`
  const row = (over: Record<string, unknown> = {}): string =>
    `${JSON.stringify({
      kind: 'design',
      phase_id: null,
      response_path: AP,
      response_sha256: S_APPROVED,
      review_base_sha: OID40,
      design_hash: '9'.repeat(64),
      approved_at: '2026-07-22T00:00:00.000Z',
      consumed_at: '2026-07-22T00:00:01.000Z',
      consumed_by_commit_sha: OID40,
      user_commit_confirmed: null,
      archive_inventory: [
        { response_path: NF, sha256: S_NEEDSFIX },
        { response_path: AP, sha256: S_APPROVED },
      ],
      ...over,
    })}\n`
  const STATE = `${T3}/state.json`
  const OK_STATE = JSON.stringify({ id: 'REQ-2026-001', phases: [] })
  type VPorts = Pick<EvidencePorts, 'headText' | 'headBlobSha256' | 'headArchivePaths'>
  /** 기본 HEAD: state OK · 매니페스트 지정 · design 아카이브 2종 존재(sha 일치). */
  const ports = (over: Partial<{ state: string | null; manifest: string | null; archives: string[]; sha: (p: string) => string | null }> = {}): VPorts => {
    const state = 'state' in over ? over.state : OK_STATE
    const manifest = 'manifest' in over ? over.manifest : row()
    const archives = over.archives ?? [NF, AP]
    const sha = over.sha ?? ((p: string): string | null => (p === NF ? S_NEEDSFIX : p === AP ? S_APPROVED : null))
    return {
      headText: (p) => (p === STATE ? (state ?? null) : p === MAN ? (manifest ?? null) : null),
      headBlobSha256: sha,
      headArchivePaths: () => archives,
    }
  }
  const bad = (o: Parameters<typeof ports>[0], match: RegExp): void => {
    const r = verifyCommittedDesignEvidence({ ticketRel: T3, ports: ports(o) })
    expect(r.durable, `durable이면 안 된다 — reason=${r.reason}`).toBe(false)
    expect(r.reason).toMatch(match)
  }

  it('완비 → durable(위양성 없음)', () => {
    const r = verifyCommittedDesignEvidence({ ticketRel: T3, ports: ports() })
    expect(r.durable, r.reason).toBe(true)
  })

  // ── HEAD state 해석 ──
  it('HEAD state 부재·파손·phases 비배열 → 미완', () => {
    bad({ state: null }, /state\.json 없음/)
    bad({ state: '{not json' }, /파싱 실패/)
    bad({ state: JSON.stringify({ phases: 'nope' }) }, /phases가 배열이 아님/)
  })

  it('커밋된 매니페스트 없음 → 미완', () => bad({ manifest: null }, /approvals\.jsonl 없음/))
  it('design 행 없음 → 미완', () => bad({ manifest: `${JSON.stringify({ kind: 'phase', phase_id: 'p1' })}\n` }, /무결성 실패|design 승인 행이 없음/))

  // ── 🔴 REQ-2026-049가 닫는 fail-open 4종 ──
  it('빈 archive_inventory → 미완(공허 참 회귀 고정)', () => bad({ manifest: row({ archive_inventory: [] }) }, /비어 있음/))

  it('top-level response_sha256 불일치 → 미완(존재만으로 통과 금지)', () =>
    bad({ manifest: row({ response_sha256: 'd'.repeat(64) }) }, /무결성 실패|SHA 불일치/))

  it('response_path가 HEAD의 임의 blob(아카이브 아님) → 미완', () =>
    bad({ manifest: row({ response_path: `${T3}/responses/approvals.jsonl` }) }, /무결성 실패/))

  it('response_path가 needs-fix → 미완(approved 파일명 규칙)', () =>
    bad({ manifest: row({ response_path: NF }) }, /무결성 실패/))

  // ── 집합 완전성 ──
  it('inventory에서 needs-fix 누락 → 미완', () =>
    bad({ manifest: row({ archive_inventory: [{ response_path: AP, sha256: S_APPROVED }] }) }, /빠져 있음/))

  it('inventory에 HEAD에 없는 잉여 항목 → 미완', () =>
    bad(
      {
        manifest: row({
          archive_inventory: [
            { response_path: NF, sha256: S_NEEDSFIX },
            { response_path: AP, sha256: S_APPROVED },
            { response_path: `${T3}/responses/design-r09-needs-fix.json`, sha256: S_NEEDSFIX },
          ],
        }),
      },
      /HEAD에 없는 항목/,
    ))

  it('타 티켓 경로·extra field 주입 → 미완(validateManifest)', () => {
    bad({ manifest: row({ archive_inventory: [{ response_path: 'workflow/REQ-2026-999/responses/design-r01-approved.json', sha256: S_APPROVED }] }) }, /무결성 실패/)
    bad({ manifest: row({ evil: 1 }) }, /무결성 실패/)
  })

  it('매니페스트 malformed → 미완', () => bad({ manifest: '{not json\n' }, /무결성 실패/))

  /**
   * 인벤토리 항목의 SHA가 HEAD blob과 어긋나면 미완.
   * (경로가 HEAD에 아예 없는 경우는 7단계의 집합 일치가 먼저 "잉여"로 잡는다 — 8단계의 null 분기는
   *  도달 불가한 이중 방어다. 도달 불가 분기를 억지로 만드는 테스트는 두지 않는다.)
   */
  it('인벤토리 항목 SHA 불일치 → 미완', () => {
    bad({ sha: (p) => (p === NF ? 'f'.repeat(64) : p === AP ? S_APPROVED : null) }, /SHA 불일치/)
  })

  /**
   * ⚠️ phase_id **멤버십**만 무효화된다는 사실을 명시적으로 고정한다 — `state.json`이 재커밋되지 않아
   * HEAD의 `phases`가 항상 `[]`이기 때문이다. 나머지 불변식은 위 케이스들이 전부 강제함을 보인다.
   */
  it('phase 행의 phase_id 멤버십은 검사하지 않는다(HEAD state가 알 수 없음)', () => {
    const withPhase = `${JSON.stringify({
      kind: 'phase',
      phase_id: 'phase-not-in-head-state',
      response_path: `${T3}/responses/phase-not-in-head-state-r01-approved.json`,
      response_sha256: S_NEEDSFIX,
      review_base_sha: OID40,
      approved_tree: OID40,
      approved_at: '2026-07-22T00:00:00.000Z',
      consumed_at: '2026-07-22T00:00:01.000Z',
      consumed_by_commit_sha: OID40,
      user_commit_confirmed: null,
    })}\n${row()}`
    const r = verifyCommittedDesignEvidence({ ticketRel: T3, ports: ports({ manifest: withPhase }) })
    expect(r.durable, r.reason).toBe(true)
  })

  // ── REQ-2026-052 DEC-B7: verifyCommittedEvidenceIntegrity(design+phase 종합, 재사용) ──
  const P1 = `${T3}/responses/p1-r01-approved.json`
  const S_P1 = '7'.repeat(64)
  const phaseLine = (over: Record<string, unknown> = {}): string =>
    `${JSON.stringify({ kind: 'phase', phase_id: 'p1', response_path: P1, response_sha256: S_P1, review_base_sha: OID40, approved_tree: OID40, phase_design_ref: '9'.repeat(64), approved_at: '2026-07-22T00:00:00.000Z', consumed_at: '2026-07-22T00:00:01.000Z', consumed_by_commit_sha: OID40, user_commit_confirmed: null, ...over })}\n`
  // design(row) + phase(phaseLine) 둘 다 온전한 기본 ports.
  const intPorts = (over: Partial<{ manifest: string | null; sha: (p: string) => string | null; archives: string[] }> = {}): VPorts => {
    const sha = over.sha ?? ((p: string): string | null => (p === NF ? S_NEEDSFIX : p === AP ? S_APPROVED : p === P1 ? S_P1 : null))
    return {
      headText: (p) => (p === STATE ? OK_STATE : p === MAN ? ('manifest' in over ? (over.manifest ?? null) : row() + phaseLine()) : null),
      headBlobSha256: sha,
      headArchivePaths: () => over.archives ?? [NF, AP],
    }
  }

  it('DEC-B7: design·phase 온전 → problems 없음·designEvidenceComplete=true', () => {
    const r = verifyCommittedEvidenceIntegrity({ ticketRel: T3, manifestText: row() + phaseLine(), ports: intPorts() })
    expect(r.problems).toEqual([])
    expect(r.designEvidenceComplete).toBe(true)
  })
  it('DEC-B7: design archive SHA 불일치 → design 무결성 problem', () => {
    const r = verifyCommittedEvidenceIntegrity({ ticketRel: T3, manifestText: row() + phaseLine(), ports: intPorts({ sha: (p) => (p === NF ? S_NEEDSFIX : p === P1 ? S_P1 : p === AP ? 'f'.repeat(64) : null) }) })
    expect(r.problems.some((x) => /design 증거 무결성/.test(x))).toBe(true)
    expect(r.designEvidenceComplete).toBe(false)
  })
  it('DEC-B7: phase archive 부재 → phase archive problem', () => {
    const r = verifyCommittedEvidenceIntegrity({ ticketRel: T3, manifestText: row() + phaseLine(), ports: intPorts({ sha: (p) => (p === NF ? S_NEEDSFIX : p === AP ? S_APPROVED : null) }) })
    expect(r.problems.some((x) => /phase archive missing/.test(x))).toBe(true)
  })
  it('🔴 DEC-B7: design 행 없음(불완전≠손상) → 검사 대상 아님·problems 없음·designEvidenceComplete=false', () => {
    const r = verifyCommittedEvidenceIntegrity({ ticketRel: T3, manifestText: phaseLine(), ports: intPorts({ manifest: phaseLine() }) })
    expect(r.problems).toEqual([]) // design 행 없으면 손상 아님(미완)
    expect(r.designEvidenceComplete).toBe(false)
  })
  it('DEC-B7: manifest 없음 → problems 없음·designEvidenceComplete=false', () => {
    const r = verifyCommittedEvidenceIntegrity({ ticketRel: T3, manifestText: null, ports: intPorts({ manifest: null }) })
    expect(r).toEqual({ problems: [], designEvidenceComplete: false })
  })
})

/** phase-4 실제 경로: marker·증거를 모두 **HEAD blob**에서 읽는다(워킹 파일 수정에 흔들리지 않음). */
describe('[REQ-2026-048] DONE 게이트 실제 git 통합 — marker·증거 모두 HEAD 기준', () => {
  it('워킹 state.json에서 marker를 지워도 HEAD 기준으로 여전히 엄격하고, 증거 커밋 후 durable이 된다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cg-ev3-'))
    try {
      const git = (args: string[]): string => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
      git(['init', '-q'])
      git(['config', 'user.email', 't@t.t'])
      git(['config', 'user.name', 't'])
      const tRel = 'workflow/REQ-2026-001'
      const respDir = join(dir, ...`${tRel}/responses`.split('/'))
      mkdirSync(respDir, { recursive: true })
      const statePath = join(dir, 'workflow', 'REQ-2026-001', 'state.json')
      writeFileSync(statePath, JSON.stringify({ id: 'REQ-2026-001', phases: [], evidence_durability_required: true }, null, 2))
      git(['add', '--', `${tRel}/state.json`])
      git(['commit', '-q', '-m', 'scaffold'])

      const ports = createEvidencePorts(dir, `${tRel}/responses`)
      const stateRel = `${tRel}/state.json`

      // 🔴 워킹 캐시에서 marker를 지워도 HEAD blob 기준이므로 여전히 엄격하다(캐시 소실 우회 차단).
      writeFileSync(statePath, JSON.stringify({ id: 'REQ-2026-001', phases: [] }, null, 2))
      expect(isDurabilityRequired(ports.headText(stateRel))).toBe(true)

      // 증거 커밋 전 → 미완.
      expect(verifyCommittedDesignEvidence({ ticketRel: tRel, ports }).durable).toBe(false)

      // 증거를 내구화하면 durable이 된다.
      const approvedBody = '{"status":"COMPLETE"}\n'
      writeFileSync(join(respDir, 'design-r01-approved.json'), approvedBody)
      durableDesignEvidence({
        ticketId: 'REQ-2026-001',
        ticketRel: tRel,
        evidence: {
          review_kind: 'design',
          phase_id: null,
          response_path: `${tRel}/responses/design-r01-approved.json`,
          response_sha256: createHash('sha256').update(Buffer.from(approvedBody)).digest('hex'),
          review_base_sha: git(['rev-parse', 'HEAD']).trim(),
          design_hash: 'd'.repeat(64),
          approved_at: '2026-07-22T00:00:00.000Z',
        } as unknown as ApprovalEvidence,
        validPhaseIds: [],
        nowIso: '2026-07-22T00:00:01.000Z',
        ports,
      })
      const v = verifyCommittedDesignEvidence({ ticketRel: tRel, ports })
      expect(v.durable, v.reason).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

/**
 * 🔴 REQ-2026-049 — 게이트가 **온디스크를 보지 않음**을 실제 git으로 증명한다.
 *
 * HEAD에는 손상된 증거를 커밋해 두고 워킹 트리만 올바르게 고친다. 게이트가 워킹 파일을 조금이라도
 * 참조하면 durable로 오판한다. REQ-048 구현이 D17과 같은 사각(온디스크 통과)에 빠지지 않았는지의
 * 최종 확인이다.
 */
describe('[REQ-2026-049] 워킹 트리만 고치고 HEAD는 손상 → 여전히 미완', () => {
  it('HEAD의 inventory가 비어 있으면 워킹 매니페스트가 완전해도 durable이 아니다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cg-headonly-'))
    try {
      const git = (args: string[]): string => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
      git(['init', '-q'])
      git(['config', 'user.email', 't@t.t'])
      git(['config', 'user.name', 't'])
      const tRel = 'workflow/REQ-2026-001'
      const ticket = join(dir, 'workflow', 'REQ-2026-001')
      const respDir = join(ticket, 'responses')
      mkdirSync(respDir, { recursive: true })
      writeFileSync(join(ticket, 'state.json'), JSON.stringify({ id: 'REQ-2026-001', phases: [] }, null, 2))

      const nfBody = '{"status":"NEEDS_FIX"}\n'
      const apBody = '{"status":"COMPLETE"}\n'
      writeFileSync(join(respDir, 'design-r01-needs-fix.json'), nfBody)
      writeFileSync(join(respDir, 'design-r02-approved.json'), apBody)
      const shaOf = (s: string): string => createHash('sha256').update(Buffer.from(s)).digest('hex')
      const NFP = `${tRel}/responses/design-r01-needs-fix.json`
      const APP = `${tRel}/responses/design-r02-approved.json`

      const rowFor = (inventory: { response_path: string; sha256: string }[]): string =>
        `${JSON.stringify({
          kind: 'design',
          phase_id: null,
          response_path: APP,
          response_sha256: shaOf(apBody),
          review_base_sha: 'a'.repeat(40),
          design_hash: 'd'.repeat(64),
          approved_at: '2026-07-22T00:00:00.000Z',
          consumed_at: '2026-07-22T00:00:01.000Z',
          consumed_by_commit_sha: 'a'.repeat(40),
          user_commit_confirmed: null,
          archive_inventory: inventory,
        })}\n`

      // HEAD에는 **손상된**(빈 inventory) 매니페스트를 커밋한다.
      writeFileSync(join(respDir, 'approvals.jsonl'), rowFor([]))
      git(['add', '-A'])
      git(['commit', '-q', '-m', 'corrupt evidence'])

      const ports = createEvidencePorts(dir, `${tRel}/responses`)
      const before = verifyCommittedDesignEvidence({ ticketRel: tRel, ports })
      expect(before.durable, before.reason).toBe(false)

      // 워킹 트리만 **완전하게** 고친다(커밋하지 않는다).
      writeFileSync(
        join(respDir, 'approvals.jsonl'),
        rowFor([
          { response_path: NFP, sha256: shaOf(nfBody) },
          { response_path: APP, sha256: shaOf(apBody) },
        ]),
      )
      const after = verifyCommittedDesignEvidence({ ticketRel: tRel, ports })
      expect(after.durable, `워킹 트리를 참조하고 있다 — reason=${after.reason}`).toBe(false)
      expect(after.reason).toMatch(/비어 있음/)

      // 커밋하면 비로소 durable이 된다(위양성 없음 확인).
      git(['add', '-A'])
      git(['commit', '-q', '-m', 'fix evidence'])
      const fixed = verifyCommittedDesignEvidence({ ticketRel: tRel, ports })
      expect(fixed.durable, fixed.reason).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

/**
 * REQ-2026-069 phase-1 — phase 재결속(rebind).
 *
 * 🔴 헤드라인 둘:
 *   1. **rebind 행이 없는 매니페스트의 검증 결과가 한 글자도 바뀌지 않는다** — 새 어휘가 기존 행을
 *      "예상 외 필드"로 만들면 이미 커밋된 모든 티켓이 무효화된다(REQ-2026-064 가 원장에서 겪은 함정).
 *   2. **`from_design_ref` 가 실제 결속과 다르면 산입하지 않는다** — 아무 해시에서나 재결속됐다고
 *      주장할 수 있으면 **없던 승인을 지어내는** 경로가 된다.
 */
describe('[evidence] rebind 행 — 재결속 모델(REQ-2026-069)', () => {
  const D1 = '1'.repeat(64)
  const D2 = '2'.repeat(64)
  const TICKET = 'workflow/REQ-2026-001'
  const iso = '2026-07-27T00:00:00.000Z'

  const phaseRow = (pid: string, designRef?: string) =>
    JSON.stringify({
      kind: 'phase',
      phase_id: pid,
      response_path: `${TICKET}/responses/${pid}-r01-approved.json`,
      response_sha256: 'a'.repeat(64),
      review_base_sha: 'b'.repeat(40),
      approved_tree: 'c'.repeat(40),
      ...(designRef ? { phase_design_ref: designRef } : {}),
      approved_at: iso,
      consumed_at: iso,
      consumed_by_commit_sha: 'd'.repeat(40),
      user_commit_confirmed: null,
    })

  const designRow = (h: string) =>
    JSON.stringify({
      kind: 'design',
      phase_id: null,
      response_path: `${TICKET}/responses/design-r01-approved.json`,
      response_sha256: 'a'.repeat(64),
      review_base_sha: 'b'.repeat(40),
      design_hash: h,
      approved_at: iso,
      consumed_at: iso,
      consumed_by_commit_sha: 'd'.repeat(40),
      user_commit_confirmed: null,
    })

  const rebindRow = (over: Record<string, unknown> = {}) =>
    JSON.stringify({
      kind: 'rebind',
      phase_id: 'p1',
      from_design_ref: D1,
      to_design_ref: D2,
      confirmation: 'rebind REQ-2026-001 p1',
      confirmed_at: iso,
      ...over,
    })

  const lines = (...rows: string[]) => rows.join('\n') + '\n'

  /** 🔴 헤드라인 1 — 기존 매니페스트 무회귀. */
  it('🔴 rebind 행이 없는 매니페스트는 검증 결과가 그대로다', () => {
    const content = lines(designRow(D1), phaseRow('p1', D1))
    expect(validateManifest(content, { ticketRel: TICKET, validPhaseIds: ['p1'] })).toEqual([])
  })

  it('재결속 전에는 옛 해시 phase 가 산입되지 않는다', () => {
    const content = lines(designRow(D1), phaseRow('p1', D1), designRow(D2))
    expect(evidencedPhaseIdsFromManifest(content, D2)).toEqual([])
  })

  it('재결속 후에는 산입된다', () => {
    const content = lines(designRow(D1), phaseRow('p1', D1), designRow(D2), rebindRow())
    expect(evidencedPhaseIdsFromManifest(content, D2)).toEqual(['p1'])
  })

  /** 🔴 헤드라인 2 — 이게 없으면 없던 승인을 지어낼 수 있다. */
  it('🔴 from_design_ref 가 실제 결속과 다르면 산입하지 않는다', () => {
    const wrongFrom = rebindRow({ from_design_ref: '9'.repeat(64) })
    const content = lines(designRow(D1), phaseRow('p1', D1), designRow(D2), wrongFrom)
    expect(evidencedPhaseIdsFromManifest(content, D2)).toEqual([])
  })

  it('🔴 대상 phase 행이 없으면 산입하지 않는다', () => {
    const content = lines(designRow(D2), rebindRow())
    expect(evidencedPhaseIdsFromManifest(content, D2)).toEqual([])
  })

  it('🔴 to_design_ref 가 조회 대상과 다르면 산입하지 않는다', () => {
    const content = lines(designRow(D1), phaseRow('p1', D1), designRow(D2), rebindRow({ to_design_ref: '8'.repeat(64) }))
    expect(evidencedPhaseIdsFromManifest(content, D2)).toEqual([])
  })

  it('designRef 미지정(레거시 경로)은 그대로 전부 낸다', () => {
    const content = lines(phaseRow('p1', D1), phaseRow('p2'))
    expect(evidencedPhaseIdsFromManifest(content).sort()).toEqual(['p1', 'p2'])
  })

  /**
   * REQ-2026-072 — 미결속 phase를 **재결속 가능/불가**로 가르는 분류. `req:close --migrate`의 자격 판정과
   * `req:new` intake 안내가 이 한 함수를 공유하므로, 여기가 두 경로의 유일한 정의다.
   */
  describe('splitUnboundPhases — 미결속 분류(REQ-2026-072)', () => {
    it('전부 결속돼 있으면 미결속 없음', () => {
      const content = lines(designRow(D1), phaseRow('p1', D1))
      expect(splitUnboundPhases(content, D1)).toEqual({ unbound: [], rebindable: [], legacy: [] })
    })

    it('설계 재승인으로 끊긴 phase는 재결속 가능으로 분류된다(phase_design_ref 보유)', () => {
      const content = lines(designRow(D1), phaseRow('p1', D1), phaseRow('p2', D1), designRow(D2), phaseRow('p3', D2))
      expect(splitUnboundPhases(content, D2)).toEqual({ unbound: ['p1', 'p2'], rebindable: ['p1', 'p2'], legacy: [] })
    })

    it('🔴 phase_design_ref 부재 행은 legacy — req:rebind가 거부하는 대상이라 권해서는 안 된다', () => {
      const content = lines(designRow(D1), phaseRow('p1', D1), phaseRow('p-old'), designRow(D2))
      const s = splitUnboundPhases(content, D2)
      expect(s.unbound).toEqual(['p-old', 'p1'])
      expect(s.rebindable).toEqual(['p1'])
      expect(s.legacy).toEqual(['p-old'])
    })

    it('이미 재결속된 phase는 미결속이 아니다(rebind 행 산입)', () => {
      const content = lines(designRow(D1), phaseRow('p1', D1), designRow(D2), rebindRow())
      expect(splitUnboundPhases(content, D2).unbound).toEqual([])
    })

    it('designRef가 null이면 빈 분류 — 없는 재결속을 권하지 않는다(호출부가 그 상태를 따로 처리)', () => {
      const content = lines(phaseRow('p1', D1))
      expect(splitUnboundPhases(content, null)).toEqual({ unbound: [], rebindable: [], legacy: [] })
    })
  })

  describe('행 검증', () => {
    const check = (row: string) => validateManifest(lines(designRow(D2), phaseRow('p1', D1), row), { ticketRel: TICKET, validPhaseIds: ['p1'] })

    it('정상 rebind 행은 통과', () => {
      expect(check(rebindRow())).toEqual([])
    })

    it('from == to 는 거부(재결속할 것이 없다)', () => {
      expect(check(rebindRow({ from_design_ref: D2 })).some((p) => p.includes('동일'))).toBe(true)
    })

    it('해시 형식·확인 문구·시각을 검증한다', () => {
      expect(check(rebindRow({ from_design_ref: 'nope' })).some((p) => p.includes('64hex'))).toBe(true)
      expect(check(rebindRow({ confirmation: '  ' })).some((p) => p.includes('confirmation'))).toBe(true)
      expect(check(rebindRow({ confirmed_at: '2026-99-99T00:00:00Z' })).some((p) => p.includes('confirmed_at'))).toBe(true)
    })

    /** 🔴 kind 격리 — 두 방향 모두. */
    it('🔴 승인 행에 rebind 전용 필드가 있으면 거부', () => {
      const polluted = JSON.parse(phaseRow('p1', D1))
      polluted.to_design_ref = D2
      const problems = validateManifest(lines(designRow(D2), JSON.stringify(polluted)), { ticketRel: TICKET, validPhaseIds: ['p1'] })
      expect(problems.some((p) => p.includes('rebind 전용 필드'))).toBe(true)
    })

    it('🔴 rebind 행에 승인 전용 필드가 있으면 거부', () => {
      expect(check(rebindRow({ design_hash: D2 })).some((p) => p.includes('승인 전용 필드'))).toBe(true)
    })
  })
})
