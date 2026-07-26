import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parseArgs,
  HelpRequested,
  deliveryBranchName,
  deliveryRecordPath,
  validateSlug,
  integrateEligibilityProblems,
  collectEligibility,
  readRecord,
  cmdCreate,
  cmdBegin,
  cmdIntegrate,
  cmdSeal,
  cmdApprove,
  cmdReopen,
  confirmSentence,
  ctxFor,
  type Io,
} from '../../bin/delivery'
import { resolveDispatch, VERB_MODULES } from '../../bin/dispatch.mjs'
import { deliveryGateVerdict } from '../../scripts/req/lib/delivery'
import { buildArchiveInventory, buildManifestEntry, serializeManifestLine } from '../../scripts/req/lib/evidence'
import { createHash } from 'node:crypto'

const LF = String.fromCharCode(10)

const IO_SILENT: Io = { log: () => {}, now: () => '2026-07-26T00:00:00.000Z' }

const DESIGN_HASH = 'a'.repeat(64)

/**
 * **실제로 검수를 마친 것과 같은 증거**를 feature 에 만든다.
 *
 * 🔴 구조만 맞는 가짜 manifest 로는 안 된다(phase-2 r04 P1-c) — 통합 자격 검사가 manifest 가 가리키는
 *    **응답 파일의 존재와 SHA-256**, 그리고 `approved_tree` 가 **feature 이력에 실재하는지**(r04 P1-d)까지
 *    본다. 그래서 아카이브 파일을 실제로 쓰고, 그 커밋의 트리를 승인 트리로 기록한다.
 */
function writeApprovedEvidence(dir: string, reqId: string, phaseIds: string[], gitFn: (d: string, a: string[]) => string): void {
  const ticketRel = `workflow/${reqId}`
  const responses = join(dir, ticketRel, 'responses')
  mkdirSync(responses, { recursive: true })
  const designName = 'design-r01-approved.json'
  const designBody = JSON.stringify({ status: 'STEP_COMPLETE', commit_approved: 'yes', design_hash: DESIGN_HASH })
  writeFileSync(join(responses, designName), designBody, 'utf8')
  const phaseBodies = phaseIds.map((pid) => {
    const name = `${pid}-r01-approved.json`
    const body = JSON.stringify({ status: 'STEP_COMPLETE', commit_approved: 'yes', phase_id: pid })
    writeFileSync(join(responses, name), body, 'utf8')
    return { pid, name, body }
  })
  // 아카이브를 먼저 커밋해야 그 커밋의 **트리**를 승인 트리로 쓸 수 있다(이력에 실재하는 값).
  gitFn(dir, ['add', '-A'])
  gitFn(dir, ['commit', '-qm', `chore(${reqId}): archives`])
  const approvedTree = gitFn(dir, ['rev-parse', 'HEAD^{tree}'])
  const sha = (t: string) => createHash('sha256').update(Buffer.from(t, 'utf8')).digest('hex')
  const archiveNames = [designName, ...phaseBodies.map((p) => p.name)]
  const shaOfRel = (rel: string) => sha(readFileSync(join(dir, rel), 'utf8'))

  const design = buildManifestEntry(
    {
      review_kind: 'design',
      phase_id: null,
      response_path: `${ticketRel}/responses/${designName}`,
      response_sha256: sha(designBody),
      review_base_sha: 'c'.repeat(40),
      approved_at: '2026-07-26T00:00:00.000Z',
      design_hash: DESIGN_HASH,
    } as never,
    {
      consumedAt: '2026-07-26T00:00:00.000Z',
      consumedByCommitSha: 'd'.repeat(40),
      userCommitConfirmed: null,
      // 🔴 인벤토리 없이 만들면 검증기가 "구버전 형식"으로 거부한다 — 픽스처도 실제 형식을 따라야 한다.
      archiveInventory: buildArchiveInventory(archiveNames, 'design', null, ticketRel, shaOfRel),
    },
  )
  const phases = phaseBodies.map(({ pid, name, body }) =>
    buildManifestEntry(
      {
        review_kind: 'phase',
        phase_id: pid,
        response_path: `${ticketRel}/responses/${name}`,
        response_sha256: sha(body),
        review_base_sha: 'c'.repeat(40),
        approved_at: '2026-07-26T00:00:00.000Z',
        approved_tree: approvedTree,
        phase_design_ref: DESIGN_HASH,
      } as never,
      {
        consumedAt: '2026-07-26T00:00:00.000Z',
        consumedByCommitSha: 'd'.repeat(40),
        userCommitConfirmed: null,
        archiveInventory: buildArchiveInventory(archiveNames, 'phase', pid, ticketRel, shaOfRel),
      },
    ),
  )
  writeFileSync(
    join(responses, 'approvals.jsonl'),
    [design, ...phases].map(serializeManifestLine).join(''),
    'utf8',
  )
  writeFileSync(
    join(responses, 'ticket-close.jsonl'),
    JSON.stringify({
      ticket_id: reqId,
      event: 'dev-complete',
      series_id: null,
      resolution: null,
      phase_inventory: phaseIds,
      design_ref: DESIGN_HASH,
      at: '2026-07-26T00:00:00.000Z',
      reconstructed: false,
      evidence_basis: null,
    }) + LF,
    'utf8',
  )
  gitFn(dir, ['add', '--', `${ticketRel}/responses/`])
  gitFn(dir, ['commit', '-qm', `chore(${reqId}): dev-complete`])
}

function git(dir: string, args: string[]): string {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim()
}

/** 최소 CommitGate repo(설정·티켓 루트·setup 마커). */
function setupRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cg-delivery-'))
  git(dir, ['init', '-q', '-b', 'main', '.'])
  git(dir, ['config', 'user.email', 't@t'])
  git(dir, ['config', 'user.name', 't'])
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts: { 'req:new': 'commitgate req:new' } }), 'utf8')
  writeFileSync(
    join(dir, 'req.config.json'),
    JSON.stringify({
      packageManager: 'npm',
      setup: { completedVersion: '0.0.0-test', completedAt: '2026-01-01T00:00:00Z' },
    }),
    'utf8',
  )
  mkdirSync(join(dir, 'workflow'), { recursive: true })
  writeFileSync(join(dir, 'workflow', 'machine.schema.json'), '{}', 'utf8')
  writeFileSync(join(dir, 'src.txt'), 'base\n', 'utf8')
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-qm', 'base'])
  return dir
}

/** `makeFeature` 가 만드는 브랜치 이름 — member 레코드의 feature_ref 와 짝을 이룬다. */
function featureBranchOf(reqId: string): string {
  return `feat/req-${reqId.replace(/^REQ-/, '')}-x`
}

/** feature 브랜치에 티켓 + (옵션) dev-complete close-proof 를 만든다. */
function makeFeature(dir: string, reqId: string, opts: { devComplete: boolean; extraCodeCommit?: boolean }): string {
  const branch = featureBranchOf(reqId)
  git(dir, ['checkout', '-qb', branch])
  const ticket = join(dir, 'workflow', reqId)
  mkdirSync(join(ticket, 'responses'), { recursive: true })
  // `phases: []` 는 실물과 같다 — 스캐폴드 이후 state.json 은 재커밋되지 않아 HEAD 에서는 항상 빈 배열이다.
  writeFileSync(join(ticket, 'state.json'), JSON.stringify({ id: reqId, phases: [] }), 'utf8')
  writeFileSync(join(dir, 'src.txt'), 'feature work\n', 'utf8')
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-qm', `feat(${reqId}): work`])
  if (opts.devComplete) writeApprovedEvidence(dir, reqId, ['p1'], git)
  if (opts.extraCodeCommit) {
    writeFileSync(join(dir, 'src.txt'), 'sneaky unreviewed change\n', 'utf8')
    git(dir, ['add', '-A'])
    git(dir, ['commit', '-qm', 'unreviewed'])
  }
  return branch
}

/**
 * 실제 순서대로 member를 등록하고 feature를 **delivery HEAD에서** 만든다.
 * 🔴 순서가 계약이다 — feature를 먼저 만들면 이후 delivery 커밋 때문에 delivery가 조상이 아니게 되고,
 *    그 상태는 순차 불변식 위반이라 integrate가 (정당하게) 거부한다.
 */
function addMemberAndBranch(dir: string, slug: string, reqId: string, opts: { devComplete: boolean; extraCodeCommit?: boolean }): string {
  git(dir, ['checkout', '-q', deliveryBranchName(slug)])
  const rel = deliveryRecordPath('workflow', slug)
  const rec = JSON.parse(git(dir, ['show', `${deliveryBranchName(slug)}:${rel}`]))
  // base = member 레코드를 커밋하기 **전**의 delivery HEAD. 커밋 뒤 HEAD는 이 값의 자손이 된다 —
  // 🔴 동일성이 아니라 **이력 선상**을 보는 것이 계약이다(design r02).
  const base = git(dir, ['rev-parse', 'HEAD'])
  rec.members.push({
    req_id: reqId,
    order: rec.members.length + 1,
    delivery_base_sha: base,
    status: 'active',
    successor_of: null,
    // `begin` 이 기록하는 값과 같다 — integrate 는 현재 위치가 아니라 이 ref 를 쓴다.
    feature_ref: featureBranchOf(reqId),
    integrated_at: null,
    superseded_evidence: null,
  })
  writeFileSync(join(dir, rel), JSON.stringify(rec, null, 2) + '\n', 'utf8')
  git(dir, ['add', '--', rel])
  git(dir, ['commit', '-qm', `member ${reqId}`])
  // 🔴 feature 는 member 커밋 **뒤**의 delivery HEAD 에서 갈라진다 → integrate 시 delivery 가 feature 의 조상.
  return makeFeature(dir, reqId, opts)
}

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
}

describe('[delivery] parseArgs — fail-closed', () => {
  it('하위 명령 라우팅', () => {
    expect(parseArgs(['create', 'payment']).sub).toBe('create')
    expect(parseArgs(['create', 'payment']).slug).toBe('payment')
    expect(parseArgs(['status', '--slug', 'p']).sub).toBe('status')
  })

  it('알 수 없는 하위 명령·옵션 거부', () => {
    expect(() => parseArgs(['bogus'])).toThrow('알 수 없는 하위 명령')
    expect(() => parseArgs(['status', '--force'])).toThrow('알 수 없는 옵션')
  })

  // 🔴 REQ-2026-061 r01 P1과 같은 함정 — 값 자리의 옵션을 삼키면 엉뚱한 대상을 조작한다.
  it('🔴 값 자리에 온 옵션을 삼키지 않는다', () => {
    expect(() => parseArgs(['status', '--slug', '--run'])).toThrow('--slug 값이 필요합니다')
    expect(() => parseArgs(['status', '--root', '--slug'])).toThrow('경로가 필요합니다')
  })

  it('-h/--help 는 HelpRequested', () => {
    expect(() => parseArgs(['-h'])).toThrow(HelpRequested)
  })

  it('slug 는 kebab-case 만', () => {
    expect(() => validateSlug('Payment Improvement')).toThrow()
    expect(() => validateSlug('payment-improvement')).not.toThrow()
  })

  it('브랜치·레코드 경로 규칙', () => {
    expect(deliveryBranchName('p')).toBe('delivery/p')
    expect(deliveryRecordPath('workflow', 'p')).toBe('workflow/delivery/p.json')
  })
})

describe('[delivery] dispatch 등록', () => {
  it('delivery verb 라우팅', () => {
    expect('delivery' in VERB_MODULES).toBe(true)
    expect(resolveDispatch(['delivery', 'status'])).toEqual({ entry: 'delivery.ts', rest: ['status'] })
  })
})

describe('[delivery] 🔴 통합 자격 — 미승인 변경은 통합되지 않는다(DEC-2b)', () => {
  const okFacts = {
    hasDevComplete: true,
    evidenceReadable: true,
    manifestProblems: [] as string[],
    designRefMatches: true,
    phaseInventoryMatches: true,
    postEvidenceCodeCommits: [] as string[],
    integrityProblems: [] as string[],
    unknownApprovedTrees: [] as string[],
  }

  it('완료·정합·무추가면 통과', () => {
    expect(integrateEligibilityProblems(okFacts)).toEqual([])
  })

  it('dev-complete 가 없으면 거부', () => {
    expect(integrateEligibilityProblems({ ...okFacts, hasDevComplete: false })).toHaveLength(1)
  })

  it('증거를 읽을 수 없으면 거부', () => {
    expect(integrateEligibilityProblems({ ...okFacts, evidenceReadable: false })[0]).toContain('읽을 수 없습니다')
  })

  // 🔴 r03 P1-a: close-proof 행은 스스로를 증명하지 못한다 — 손으로 써 넣은 행 하나로 통합되면 안 된다.
  it('🔴 승인 매니페스트가 손상·부재면 거부', () => {
    const p = integrateEligibilityProblems({ ...okFacts, manifestProblems: ['approvals.jsonl 없음'] })
    expect(p.some((x) => x.includes('승인 증거'))).toBe(true)
  })

  it('🔴 design_ref 가 실제 승인과 다르면 거부(위조·낡은 증거)', () => {
    const p = integrateEligibilityProblems({ ...okFacts, designRefMatches: false })
    expect(p.some((x) => x.includes('design_ref'))).toBe(true)
  })

  it('🔴 phase 목록이 실제 증거와 다르면 거부', () => {
    const p = integrateEligibilityProblems({ ...okFacts, phaseInventoryMatches: false })
    expect(p.some((x) => x.includes('phase 목록'))).toBe(true)
  })

  // 🔴 r03 P1-b: 증거 커밋 자신을 제외하면 같은 커밋에 미검수 소스를 끼워 넣어 우회한다.
  it('🔴 증거와 함께/이후의 티켓 밖 변경이 있으면 거부', () => {
    const p = integrateEligibilityProblems({ ...okFacts, postEvidenceCodeCommits: ['abc12345(증거 커밋)'] })
    expect(p.some((x) => x.includes('미검수 코드'))).toBe(true)
  })

  // 🔴 r04 P1-c: manifest 는 구조만으로 스스로를 증명하지 못한다 — 가리키는 응답 파일과 SHA 까지 봐야 한다.
  it('🔴 승인 응답 파일·SHA 무결성이 깨지면 거부', () => {
    const p = integrateEligibilityProblems({ ...okFacts, integrityProblems: ['design 증거 무결성 실패'] })
    expect(p.some((x) => x.includes('무결성'))).toBe(true)
  })

  // 🔴 r04 P1-d: 증거 **이후**만 보면 승인 이전 커밋을 amend/rebase 해 미검수 코드를 넣는 우회가 남는다.
  it('🔴 승인 트리가 feature 이력에 없으면 거부(history rewrite)', () => {
    const p = integrateEligibilityProblems({ ...okFacts, unknownApprovedTrees: ['f'.repeat(40)] })
    expect(p.some((x) => x.includes('이력이 다시 쓰인'))).toBe(true)
  })
})

describe('[delivery] create/begin/integrate — 실제 git repo', () => {
  it('create 가 브랜치와 레코드를 만든다(수용기준 1)', () => {
    const dir = setupRepo()
    try {
      const ctx = ctxFor(dir)
      cmdCreate(ctx, 'payment', IO_SILENT)
      expect(git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('delivery/payment')
      const r = readRecord(ctx, 'payment')
      expect(r.state).toBe('open')
      expect(r.members).toEqual([])
    } finally {
      cleanup(dir)
    }
  })

  /**
   * 🔴 phase-2 r01 P1 회귀 가드. `create`가 현재 HEAD에서 분기하면, 미승인 커밋이 있는 feature 브랜치에서
   * 실행했을 때 **그 커밋이 delivery의 조상**이 된다. 이후 member들은 그 HEAD에서 갈라지므로 그 변경은
   * active member도 통합 자격 검증도 거치지 않은 채 묶음에 포함되고 결국 target으로 간다.
   */
  it('🔴 feature 브랜치에서 만들어도 미승인 커밋이 base로 들어가지 않는다(target에서 분기)', () => {
    const dir = setupRepo()
    try {
      const mainSha = git(dir, ['rev-parse', 'main'])
      // 미승인 변경을 담은 feature 브랜치로 이동(워킹트리는 clean).
      git(dir, ['checkout', '-qb', 'feat/sneaky'])
      writeFileSync(join(dir, 'src.txt'), 'unreviewed\n', 'utf8')
      git(dir, ['add', '-A'])
      git(dir, ['commit', '-qm', 'unreviewed'])
      const sneaky = git(dir, ['rev-parse', 'HEAD'])

      cmdCreate(ctxFor(dir), 'payment', IO_SILENT)

      // delivery 는 main 에서 갈라졌다 — 미승인 커밋은 조상이 아니다.
      const parent = git(dir, ['rev-parse', 'HEAD~1'])
      expect(parent).toBe(mainSha)
      let sneakyIsAncestor = true
      try {
        git(dir, ['merge-base', '--is-ancestor', sneaky, 'HEAD'])
      } catch {
        sneakyIsAncestor = false
      }
      expect(sneakyIsAncestor).toBe(false)
      expect(git(dir, ['show', 'HEAD:src.txt'])).toContain('base')
    } finally {
      cleanup(dir)
    }
  })

  it('대상 브랜치가 없으면 거부한다', () => {
    const dir = setupRepo()
    try {
      git(dir, ['checkout', '-qb', 'other'])
      git(dir, ['branch', '-D', 'main'])
      expect(() => cmdCreate(ctxFor(dir), 'payment', IO_SILENT)).toThrow('대상 브랜치가 없습니다')
    } finally {
      cleanup(dir)
    }
  })

  it('중복 create 거부 · dirty 트리 거부', () => {
    const dir = setupRepo()
    try {
      const ctx = ctxFor(dir)
      cmdCreate(ctx, 'payment', IO_SILENT)
      expect(() => cmdCreate(ctx, 'payment', IO_SILENT)).toThrow('이미 존재')
      writeFileSync(join(dir, 'dirty.txt'), 'x', 'utf8')
      expect(() => cmdCreate(ctx, 'other', IO_SILENT)).toThrow('clean')
    } finally {
      cleanup(dir)
    }
  })

  /**
   * 🔴 **정상 경로 end-to-end**(phase-2 r02 P1). `begin`이 member를 기록하지 않던 동안에는 안내대로 따라가도
   * `integrate`가 "활성 member 없음"으로 항상 실패했다 — 경로가 통째로 끊겨 있었다.
   */
  it('🔴 create → begin → integrate 정상 경로가 end-to-end 로 성립한다', () => {
    const dir = setupRepo()
    try {
      const ctx = ctxFor(dir)
      cmdCreate(ctx, 'payment', IO_SILENT)
      git(dir, ['checkout', '-q', 'main']) // 사용자가 수동으로 이탈해도 무관해야 한다(DEC-7)

      const rec = cmdBegin(ctx, 'payment', 'api', IO_SILENT)
      // member 가 실제로 등록됐다.
      expect(rec.members).toHaveLength(1)
      const reqId = rec.members[0]!.req_id
      expect(reqId).toMatch(/^REQ-\d{4}-\d{3,}$/)
      // begin 이 끝나면 사용자는 feature 브랜치에 있다.
      const feature = git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])
      expect(feature.startsWith('feat/req-')).toBe(true)
      // delivery ref 의 레코드에도 반영돼 있다(읽기 정본 — DEC-3).
      expect(readRecord(ctx, 'payment').members[0]!.req_id).toBe(reqId)

      // 리뷰를 마친 상태를 만든다(아카이브·매니페스트·close-proof 를 실제로 생성).
      writeApprovedEvidence(dir, reqId!, ['p1'], git)

      const res = cmdIntegrate(ctx, 'payment', reqId!, IO_SILENT)
      expect(res.merged).toBe(true)
      // 🔴 begin 의 member 커밋으로 delivery 가 한 걸음 앞섰지만, 그 변경이 레코드뿐이라 통과한다(r03).
      const parents = git(dir, ['rev-list', '--parents', '-n1', deliveryBranchName('payment')]).split(' ').length - 1
      expect(parents).toBe(2)
      expect(readRecord(ctx, 'payment').members[0]!.status).toBe('integrated')
    } finally {
      cleanup(dir)
    }
  })

  // 🔴 r03 조건의 음성 테스트: delivery 에서 **코드**가 움직였으면 거부한다.
  it('🔴 분기 이후 delivery 에 레코드 외 변경이 있으면 integrate 를 거부한다', () => {
    const dir = setupRepo()
    try {
      const ctx = ctxFor(dir)
      cmdCreate(ctx, 'payment', IO_SILENT)
      const feat = addMemberAndBranch(dir, 'payment', 'REQ-2026-009', { devComplete: true })
      // delivery 에서 코드 파일을 건드린다(다른 사람이 밀어 넣은 상황).
      git(dir, ['checkout', '-q', 'delivery/payment'])
      writeFileSync(join(dir, 'src.txt'), 'delivery-side code change\n', 'utf8')
      git(dir, ['add', '-A'])
      git(dir, ['commit', '-qm', 'code on delivery'])
      const headBefore = git(dir, ['rev-parse', 'HEAD'])

      expect(() => cmdIntegrate(ctx, 'payment', 'REQ-2026-009', IO_SILENT)).toThrow('레코드 외 변경')
      expect(git(dir, ['rev-parse', 'HEAD'])).toBe(headBefore)
    } finally {
      cleanup(dir)
    }
  })

  /**
   * 🔴 이 REQ의 **필수 음성 테스트**. 위상 전제만 검증하면 이 시나리오가 통과하고
   * 리뷰 게이트가 통째로 뚫린다.
   */
  it('🔴 미승인 변경만 있는 feature 는 통합되지 않고 delivery 가 변하지 않는다(수용기준 5)', () => {
    const dir = setupRepo()
    try {
      const ctx = ctxFor(dir)
      cmdCreate(ctx, 'payment', IO_SILENT)
      const base = git(dir, ['rev-parse', 'HEAD'])
      const feat = makeFeature(dir, 'REQ-2026-001', { devComplete: false })
      // 레코드에 활성 member 를 직접 넣어 integrate 조건을 만든다(begin 의 req:new 위임은 phase-3 범위).
      git(dir, ['checkout', '-q', 'delivery/payment'])
      const rel = deliveryRecordPath('workflow', 'payment')
      const rec = JSON.parse(git(dir, ['show', `delivery/payment:${rel}`]))
      rec.members.push({
        req_id: 'REQ-2026-001',
        order: 1,
        delivery_base_sha: base,
        status: 'active',
        successor_of: null,
        feature_ref: featureBranchOf('REQ-2026-001'),
        integrated_at: null,
        superseded_evidence: null,
      })
      writeFileSync(join(dir, rel), JSON.stringify(rec, null, 2) + '\n', 'utf8')
      git(dir, ['add', '--', rel])
      git(dir, ['commit', '-qm', 'member'])
      const headBefore = git(dir, ['rev-parse', 'HEAD'])

      expect(() => cmdIntegrate(ctx, 'payment', 'REQ-2026-001', IO_SILENT)).toThrow('통합 자격 미충족')
      // 🔴 delivery HEAD 가 그대로 — merge·레코드 write 0건.
      expect(git(dir, ['rev-parse', 'HEAD'])).toBe(headBefore)
    } finally {
      cleanup(dir)
    }
  })

  it('🔴 승인 뒤 덧붙인 코드 커밋이 있으면 거부한다', () => {
    const dir = setupRepo()
    try {
      const ctx = ctxFor(dir)
      const feat = 'feat/req-2026-002-x'
      cmdCreate(ctx, 'p2', IO_SILENT)
      makeFeature(dir, 'REQ-2026-002', { devComplete: true, extraCodeCommit: true })
      const facts = collectEligibility(ctx, feat, 'REQ-2026-002')
      expect(facts.hasDevComplete).toBe(true)
      expect(facts.postEvidenceCodeCommits.length).toBeGreaterThan(0)
      expect(integrateEligibilityProblems(facts).length).toBeGreaterThan(0)
    } finally {
      cleanup(dir)
    }
  })

  // 🔴 r06 P1: 기준점이 close-proof 파일의 **마지막 수정 커밋**이면, 미검수 코드를 커밋한 뒤
  //    close-proof 를 의미 동일하게 재포맷하는 ticket-only 커밋 하나로 기준점이 앞으로 밀린다.
  //    기준점은 리뷰어가 실제로 본 **승인 트리**여야 한다.
  it('🔴 완료 후 코드 커밋 → close-proof 재포맷으로는 미검수 코드를 숨길 수 없다', () => {
    const dir = setupRepo()
    try {
      const ctx = ctxFor(dir)
      cmdCreate(ctx, 'shift', IO_SILENT)
      const feat = addMemberAndBranch(dir, 'shift', 'REQ-2026-007', { devComplete: true })
      git(dir, ['checkout', '-q', feat])
      // ① 승인 뒤 미검수 코드 커밋
      writeFileSync(join(dir, 'src.txt'), 'unreviewed after approval\n', 'utf8')
      git(dir, ['add', '-A'])
      git(dir, ['commit', '-qm', 'sneaky'])
      // ② close-proof 를 **의미는 그대로** 두고 키 순서만 바꿔 다시 커밋(ticket-only)
      const cpRel = 'workflow/REQ-2026-007/responses/ticket-close.jsonl'
      const row = JSON.parse(readFileSync(join(dir, cpRel), 'utf8').trim())
      const reordered: Record<string, unknown> = {}
      for (const k of Object.keys(row).reverse()) reordered[k] = row[k]
      writeFileSync(join(dir, cpRel), JSON.stringify(reordered) + LF, 'utf8')
      git(dir, ['add', '--', cpRel])
      git(dir, ['commit', '-qm', 'chore: reformat close-proof'])

      const facts = collectEligibility(ctx, feat, 'REQ-2026-007')
      expect(facts.hasDevComplete).toBe(true)
      expect(facts.postEvidenceCodeCommits.length).toBeGreaterThan(0)
      const headBefore = git(dir, ['rev-parse', deliveryBranchName('shift')])
      expect(() => cmdIntegrate(ctx, 'shift', 'REQ-2026-007', IO_SILENT)).toThrow(/통합 자격 미충족/)
      expect(git(dir, ['rev-parse', deliveryBranchName('shift')])).toBe(headBefore)
    } finally {
      cleanup(dir)
    }
  })

  // 🔴 r05 P1: DEC-7 은 "현재 브랜치 위치에 의존하지 않는다"이다. feature ref 를 HEAD 에서 읽으면
  //    사용자가 main 으로 이탈한 순간 통합이 불가능해진다 — ref 는 레코드에서 와야 한다.
  it('🔴 다른 브랜치로 이탈한 상태에서도 integrate 가 성립한다', () => {
    const dir = setupRepo()
    try {
      const ctx = ctxFor(dir)
      cmdCreate(ctx, 'roam', IO_SILENT)
      addMemberAndBranch(dir, 'roam', 'REQ-2026-006', { devComplete: true })
      git(dir, ['checkout', '-q', 'main']) // 사용자가 이탈한다

      const res = cmdIntegrate(ctx, 'roam', 'REQ-2026-006', IO_SILENT)
      expect(res.merged).toBe(true)
      expect(readRecord(ctx, 'roam').members[0]!.status).toBe('integrated')
    } finally {
      cleanup(dir)
    }
  })

  // 🔴 design r07 P1: delivery 쪽 경로만 보면 무충돌이 아니다. feature 가 분기 시점 레코드 사본을
  //    편집하면 delivery 의 member 등록 변경과 **같은 파일**에서 충돌한다.
  it('🔴 feature 가 delivery 레코드 사본을 수정했으면 integrate 를 거부한다', () => {
    const dir = setupRepo()
    try {
      const ctx = ctxFor(dir)
      cmdCreate(ctx, 'clash', IO_SILENT)
      const feat = addMemberAndBranch(dir, 'clash', 'REQ-2026-010', { devComplete: true })
      git(dir, ['checkout', '-q', feat])
      const rel = deliveryRecordPath('workflow', 'clash')
      const rec = JSON.parse(readFileSync(join(dir, rel), 'utf8'))
      rec.slug = 'tampered'
      writeFileSync(join(dir, rel), JSON.stringify(rec, null, 2) + LF, 'utf8')
      git(dir, ['add', '--', rel])
      git(dir, ['commit', '-qm', 'edit delivery record copy'])

      const headBefore = git(dir, ['rev-parse', deliveryBranchName('clash')])
      expect(() => cmdIntegrate(ctx, 'clash', 'REQ-2026-010', IO_SILENT)).toThrow('위상 전제 미충족')
      expect(git(dir, ['rev-parse', deliveryBranchName('clash')])).toBe(headBefore)
      expect(git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe(feat)
    } finally {
      cleanup(dir)
    }
  })

  // 🔴 도구의 브랜치 이동은 **수단**이지 결과가 아니다(DEC-7). 성공하든 거부하든 사용자를 옮겨 놓지 않는다.
  it('🔴 integrate 는 성공·거부 모두 사용자를 원래 브랜치에 남긴다', () => {
    const dir = setupRepo()
    try {
      const ctx = ctxFor(dir)
      cmdCreate(ctx, 'stay', IO_SILENT)
      const feat = addMemberAndBranch(dir, 'stay', 'REQ-2026-008', { devComplete: true })
      git(dir, ['checkout', '-q', feat])

      cmdIntegrate(ctx, 'stay', 'REQ-2026-008', IO_SILENT)
      expect(git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe(feat)

      // 거부 경로: 이미 integrated 라 활성 member 가 아니다 → 이동 없이 거부.
      expect(() => cmdIntegrate(ctx, 'stay', 'REQ-2026-008', IO_SILENT)).toThrow('활성 member가 아닙니다')
      expect(git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe(feat)
    } finally {
      cleanup(dir)
    }
  })

  // 🔴 clean 가드가 이동 **뒤**에 있으면 dirty 변경이 delivery 로 따라오고, merge 커밋은 인덱스 전체를
  //    담으므로 무관한 변경이 통합 커밋에 섞인다. 가드는 이동 전이어야 한다.
  it('🔴 dirty 워킹트리면 브랜치를 옮기지 않고 거부한다', () => {
    const dir = setupRepo()
    try {
      const ctx = ctxFor(dir)
      cmdCreate(ctx, 'dirty', IO_SILENT)
      const feat = addMemberAndBranch(dir, 'dirty', 'REQ-2026-009', { devComplete: true })
      git(dir, ['checkout', '-q', feat])
      writeFileSync(join(dir, 'src.txt'), 'uncommitted edit\n', 'utf8')

      expect(() => cmdIntegrate(ctx, 'dirty', 'REQ-2026-009', IO_SILENT)).toThrow('clean')
      expect(git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe(feat)
      expect(readFileSync(join(dir, 'src.txt'), 'utf8')).toContain('uncommitted edit')
      expect(readRecord(ctx, 'dirty').members[0]!.status).toBe('active')
    } finally {
      cleanup(dir)
    }
  })

  // 🔴 r04 P1-c E2E: 손으로 쓴 "승인" 아카이브는 SHA 가 맞지 않아 통과하면 안 된다.
  //    구조 검증만 하던 r03 까지는 이 시나리오가 그대로 통과했다.
  it('🔴 위조한 승인 응답 파일로는 integrate 가 거부된다', () => {
    const dir = setupRepo()
    try {
      const ctx = ctxFor(dir)
      cmdCreate(ctx, 'forge', IO_SILENT)
      const feat = addMemberAndBranch(dir, 'forge', 'REQ-2026-004', { devComplete: true })
      // 승인된 것으로 기록된 응답 파일의 내용을 바꾼다(기록된 SHA-256 과 어긋난다).
      git(dir, ['checkout', '-q', feat])
      const rel = 'workflow/REQ-2026-004/responses/p1-r01-approved.json'
      writeFileSync(join(dir, rel), JSON.stringify({ status: 'STEP_COMPLETE', commit_approved: 'yes', forged: true }), 'utf8')
      git(dir, ['add', '--', rel])
      git(dir, ['commit', '-qm', 'forge'])

      const facts = collectEligibility(ctx, feat, 'REQ-2026-004')
      expect(facts.integrityProblems.length).toBeGreaterThan(0)
      const headBefore = git(dir, ['rev-parse', deliveryBranchName('forge')])
      expect(() => cmdIntegrate(ctx, 'forge', 'REQ-2026-004', IO_SILENT)).toThrow(/통합 자격 미충족/)
      expect(git(dir, ['rev-parse', deliveryBranchName('forge')])).toBe(headBefore)
    } finally {
      cleanup(dir)
    }
  })

  // 🔴 r04 P1-d E2E: 증거 **이전** 커밋을 다시 쓰면 "증거 이후 커밋 0건"은 여전히 참이다.
  //    승인 트리가 이력에 실재하는지 보지 않으면 이 우회가 남는다.
  it('🔴 증거 이전 커밋을 rebase 로 바꾸면 integrate 가 거부된다', () => {
    const dir = setupRepo()
    try {
      const ctx = ctxFor(dir)
      cmdCreate(ctx, 'rewrite', IO_SILENT)
      const feat = addMemberAndBranch(dir, 'rewrite', 'REQ-2026-005', { devComplete: true })
      git(dir, ['checkout', '-q', feat])
      // 증거는 손대지 않고 **승인 시점 아래**의 코드 커밋만 바꿔치기한다 → 승인 트리가 이력에서 사라진다.
      const evidenceHead = git(dir, ['rev-parse', 'HEAD'])
      const approvedCommit = git(dir, ['rev-parse', 'HEAD~1'])
      git(dir, ['checkout', '-q', `${approvedCommit}~1`])
      writeFileSync(join(dir, 'src.txt'), 'unreviewed replacement\n', 'utf8')
      git(dir, ['add', '-A'])
      git(dir, ['commit', '-qm', 'feat: work (rewritten)'])
      git(dir, ['cherry-pick', '-n', approvedCommit, evidenceHead])
      git(dir, ['commit', '-qm', 'evidence (replayed)'])
      git(dir, ['branch', '-qf', feat, 'HEAD'])
      git(dir, ['checkout', '-q', feat])

      const facts = collectEligibility(ctx, feat, 'REQ-2026-005')
      expect(facts.postEvidenceCodeCommits.length).toBe(0) // 이 축만으로는 잡히지 않는다
      expect(facts.unknownApprovedTrees.length).toBeGreaterThan(0)
      const headBefore = git(dir, ['rev-parse', deliveryBranchName('rewrite')])
      expect(() => cmdIntegrate(ctx, 'rewrite', 'REQ-2026-005', IO_SILENT)).toThrow(/통합 자격 미충족/)
      expect(git(dir, ['rev-parse', deliveryBranchName('rewrite')])).toBe(headBefore)
    } finally {
      cleanup(dir)
    }
  })

  it('완료 REQ 는 단일 merge commit 으로 반영되고 레코드가 같은 커밋에 담긴다(수용기준 4)', () => {
    const dir = setupRepo()
    try {
      const ctx = ctxFor(dir)
      cmdCreate(ctx, 'payment', IO_SILENT)
      const feat = addMemberAndBranch(dir, 'payment', 'REQ-2026-003', { devComplete: true })
      const res = cmdIntegrate(ctx, 'payment', 'REQ-2026-003', IO_SILENT)
      expect(res.merged).toBe(true)
      // 🔴 부모 2개 = merge commit 하나에 feature 반영과 레코드 갱신이 함께 들어갔다(spike 실측 근거).
      const parents = git(dir, ['rev-list', '--parents', '-n1', deliveryBranchName('payment')]).split(' ').length - 1
      expect(parents).toBe(2)
      const after = readRecord(ctx, 'payment')
      expect(after.members[0]!.status).toBe('integrated')
      expect(git(dir, ['show', `${deliveryBranchName('payment')}:src.txt`])).toContain('feature work')
    } finally {
      cleanup(dir)
    }
  })

  it('base 불일치면 거부하고 delivery 가 변하지 않는다', () => {
    const dir = setupRepo()
    try {
      const ctx = ctxFor(dir)
      cmdCreate(ctx, 'payment', IO_SILENT)
      const feat = makeFeature(dir, 'REQ-2026-004', { devComplete: true })
      git(dir, ['checkout', '-q', 'delivery/payment'])
      const rel = deliveryRecordPath('workflow', 'payment')
      const rec = JSON.parse(git(dir, ['show', `delivery/payment:${rel}`]))
      rec.members.push({
        req_id: 'REQ-2026-004',
        order: 1,
        delivery_base_sha: 'f'.repeat(40), // 일부러 어긋난 base
        status: 'active',
        successor_of: null,
        feature_ref: featureBranchOf('REQ-2026-004'),
        integrated_at: null,
        superseded_evidence: null,
      })
      writeFileSync(join(dir, rel), JSON.stringify(rec, null, 2) + '\n', 'utf8')
      git(dir, ['add', '--', rel])
      git(dir, ['commit', '-qm', 'member'])
      const headBefore = git(dir, ['rev-parse', 'HEAD'])
      expect(() => cmdIntegrate(ctx, 'payment', 'REQ-2026-004', IO_SILENT)).toThrow('위상 전제 미충족')
      expect(git(dir, ['rev-parse', 'HEAD'])).toBe(headBefore)
    } finally {
      cleanup(dir)
    }
  })

  it('손상된 레코드는 조용히 넘기지 않는다', () => {
    const dir = setupRepo()
    try {
      const ctx = ctxFor(dir)
      cmdCreate(ctx, 'payment', IO_SILENT)
      const rel = deliveryRecordPath('workflow', 'payment')
      writeFileSync(join(dir, rel), '{ broken', 'utf8')
      git(dir, ['add', '--', rel])
      git(dir, ['commit', '-qm', 'break'])
      expect(() => readRecord(ctx, 'payment')).toThrow('파싱 실패')
    } finally {
      cleanup(dir)
    }
  })

  it('존재하지 않는 묶음은 명확히 실패한다', () => {
    const dir = setupRepo()
    try {
      expect(() => readRecord(ctxFor(dir), 'nope')).toThrow('delivery 브랜치가 없습니다')
    } finally {
      cleanup(dir)
    }
  })
})

/**
 * REQ-2026-066 phase-3 — seal/approve/reopen 통제점과 최종 게이트(DEC-8·DEC-8a·DEC-11).
 *
 * 🔴 수용기준 9: **마지막 integrate → seal** 과 **seal → 마지막 integrate** **양쪽**에서 `AWAIT_HUMAN`이
 *    나와야 한다. 한쪽만 검증하면 전이 지점을 한 곳만 배선해도 통과한다.
 */
describe('[delivery] seal/approve/reopen — 확인 문구 통제점', () => {
  it('확인 문구가 없거나 틀리면 아무것도 하지 않는다', () => {
    const dir = setupRepo()
    try {
      const ctx = ctxFor(dir)
      cmdCreate(ctx, 'gate', IO_SILENT)
      addMemberAndBranch(dir, 'gate', 'REQ-2026-020', { devComplete: true })
      const before = git(dir, ['rev-parse', deliveryBranchName('gate')])
      expect(() => cmdSeal(ctx, 'gate', null, IO_SILENT)).toThrow('확인 문구가 필요합니다')
      // 🔴 다른 묶음의 문구로는 못 닫는다 — 복사-붙여넣기 사고 방지.
      expect(() => cmdSeal(ctx, 'gate', 'seal payment', IO_SILENT)).toThrow('확인 문구가 필요합니다')
      expect(git(dir, ['rev-parse', deliveryBranchName('gate')])).toBe(before)
      expect(readRecord(ctx, 'gate').state).toBe('open')
    } finally {
      cleanup(dir)
    }
  })

  it('member 없는 묶음은 닫지 않는다', () => {
    const dir = setupRepo()
    try {
      const ctx = ctxFor(dir)
      cmdCreate(ctx, 'empty', IO_SILENT)
      expect(() => cmdSeal(ctx, 'empty', confirmSentence('seal', 'empty'), IO_SILENT)).toThrow('닫을 내용이 없습니다')
    } finally {
      cleanup(dir)
    }
  })

  it('🔴 수용기준 9-A: 마지막 integrate → seal 순서에서 AWAIT_HUMAN', () => {
    const dir = setupRepo()
    try {
      const ctx = ctxFor(dir)
      cmdCreate(ctx, 'ordera', IO_SILENT)
      addMemberAndBranch(dir, 'ordera', 'REQ-2026-021', { devComplete: true })
      const res = cmdIntegrate(ctx, 'ordera', 'REQ-2026-021', IO_SILENT)
      // 아직 open 이므로 integrate 시점에는 게이트가 뜨지 않는다.
      expect(res.gate.kind).toBe('continue')
      const sealed = cmdSeal(ctx, 'ordera', confirmSentence('seal', 'ordera'), IO_SILENT)
      expect(deliveryGateVerdict(sealed).kind).toBe('await-human')
    } finally {
      cleanup(dir)
    }
  })

  it('🔴 수용기준 9-B: seal → 마지막 integrate 순서에서도 AWAIT_HUMAN', () => {
    const dir = setupRepo()
    try {
      const ctx = ctxFor(dir)
      cmdCreate(ctx, 'orderb', IO_SILENT)
      addMemberAndBranch(dir, 'orderb', 'REQ-2026-022', { devComplete: true })
      cmdSeal(ctx, 'orderb', confirmSentence('seal', 'orderb'), IO_SILENT)
      // seal 시점에는 member 가 아직 active 라 게이트가 뜨지 않는다.
      expect(deliveryGateVerdict(readRecord(ctx, 'orderb')).kind).toBe('continue')
      const res = cmdIntegrate(ctx, 'orderb', 'REQ-2026-022', IO_SILENT)
      // 🔴 여기가 유일한 발생지다 — seal 한 사용자는 req:next 를 다시 부를 이유가 없다.
      expect(res.gate.kind).toBe('await-human')
    } finally {
      cleanup(dir)
    }
  })

  it('approve 는 sealed + 전부 terminal 일 때만 · reopen 은 이력을 남긴다', () => {
    const dir = setupRepo()
    try {
      const ctx = ctxFor(dir)
      cmdCreate(ctx, 'appr', IO_SILENT)
      addMemberAndBranch(dir, 'appr', 'REQ-2026-023', { devComplete: true })
      // open 상태에서는 거부.
      expect(() => cmdApprove(ctx, 'appr', confirmSentence('approve', 'appr'), IO_SILENT)).toThrow('열려 있습니다')
      cmdSeal(ctx, 'appr', confirmSentence('seal', 'appr'), IO_SILENT)
      // sealed 지만 member 가 active → 거부.
      expect(() => cmdApprove(ctx, 'appr', confirmSentence('approve', 'appr'), IO_SILENT)).toThrow('종결되지 않은 member')
      cmdIntegrate(ctx, 'appr', 'REQ-2026-023', IO_SILENT)
      const approved = cmdApprove(ctx, 'appr', confirmSentence('approve', 'appr'), IO_SILENT)
      expect(approved.state).toBe('approved')

      // 🔴 reopen 은 상태만 되돌리는 것이 아니라 **이력을 남긴다** — 승인이 있었다는 사실이 사라지면 안 된다.
      const reopened = cmdReopen(ctx, 'appr', confirmSentence('reopen', 'appr'), IO_SILENT)
      expect(reopened.state).toBe('open')
      expect(reopened.events.map((e) => e.event)).toEqual(['created', 'sealed', 'approved', 'reopened'])
      // 실제 시계에서 읽는다(고정값 위조 금지) — IO_SILENT 는 테스트 주입이고, 기본 Io 는 new Date() 다.
      expect(reopened.events.every((e) => typeof e.at === 'string' && e.at.length > 0)).toBe(true)
    } finally {
      cleanup(dir)
    }
  })

  it('🔴 approve 는 병합하지 않는다(DEC-11) — target 브랜치가 움직이지 않는다', () => {
    const dir = setupRepo()
    try {
      const ctx = ctxFor(dir)
      cmdCreate(ctx, 'nomerge', IO_SILENT)
      addMemberAndBranch(dir, 'nomerge', 'REQ-2026-024', { devComplete: true })
      const mainBefore = git(dir, ['rev-parse', 'main'])
      cmdIntegrate(ctx, 'nomerge', 'REQ-2026-024', IO_SILENT)
      cmdSeal(ctx, 'nomerge', confirmSentence('seal', 'nomerge'), IO_SILENT)
      cmdApprove(ctx, 'nomerge', confirmSentence('approve', 'nomerge'), IO_SILENT)
      expect(git(dir, ['rev-parse', 'main'])).toBe(mainBefore)
    } finally {
      cleanup(dir)
    }
  })
})

/**
 * 🔴 phase-3 r01 P1: detached HEAD 는 브랜치 이름이 아니라 커밋 SHA 로 기억해야 한다.
 * `rev-parse --abbrev-ref HEAD` 는 detached 에서 문자열 "HEAD" 를 주므로, 그것으로 복원을 건너뛰면
 * 사용자가 **delivery 브랜치에 남고** 이후 작업이 통합 브랜치에서 이뤄진다.
 */
describe('[delivery] detached HEAD 에서도 원래 자리로 되돌린다', () => {
  it('seal 이 detached HEAD 를 보존한다', () => {
    const dir = setupRepo()
    try {
      const ctx = ctxFor(dir)
      cmdCreate(ctx, 'det', IO_SILENT)
      addMemberAndBranch(dir, 'det', 'REQ-2026-030', { devComplete: true })
      const feat = featureBranchOf('REQ-2026-030')
      git(dir, ['checkout', '-q', feat])
      const at = git(dir, ['rev-parse', 'HEAD'])
      git(dir, ['checkout', '-q', '--detach', at])

      cmdSeal(ctx, 'det', confirmSentence('seal', 'det'), IO_SILENT)
      expect(git(dir, ['rev-parse', 'HEAD'])).toBe(at)
      // 여전히 detached — 도구가 브랜치에 붙여 놓지 않는다.
      expect(git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('HEAD')
    } finally {
      cleanup(dir)
    }
  })

  it('integrate 도 detached HEAD 를 보존한다', () => {
    const dir = setupRepo()
    try {
      const ctx = ctxFor(dir)
      cmdCreate(ctx, 'det2', IO_SILENT)
      addMemberAndBranch(dir, 'det2', 'REQ-2026-031', { devComplete: true })
      git(dir, ['checkout', '-q', featureBranchOf('REQ-2026-031')])
      const at = git(dir, ['rev-parse', 'HEAD'])
      git(dir, ['checkout', '-q', '--detach', at])

      expect(cmdIntegrate(ctx, 'det2', 'REQ-2026-031', IO_SILENT).merged).toBe(true)
      expect(git(dir, ['rev-parse', 'HEAD'])).toBe(at)
      expect(git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('HEAD')
    } finally {
      cleanup(dir)
    }
  })
})
