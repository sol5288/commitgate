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
  durableDesignEvidence,
  findEvidenceRow,
  isDurabilityRequired,
  verifyCommittedDesignEvidence,
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
  const ports = (head: Record<string, string | null>): Pick<EvidencePorts, 'headText' | 'headBlobSha256'> => ({
    headText: (p) => head[p] ?? null,
    headBlobSha256: (p) => (p === NF ? S_NEEDSFIX : p === AP ? S_APPROVED : null),
  })

  it('완비 → durable', () => {
    expect(verifyCommittedDesignEvidence({ ticketRel: T3, ports: ports({ [MAN]: row() }) }).durable).toBe(true)
  })
  it('커밋된 매니페스트 없음 → 미완', () => {
    const r = verifyCommittedDesignEvidence({ ticketRel: T3, ports: ports({}) })
    expect(r.durable).toBe(false)
    expect(r.reason).toContain('커밋된')
  })
  it('design 행 없음 → 미완', () => {
    const phaseOnly = `${JSON.stringify({ kind: 'phase' })}\n`
    const r = verifyCommittedDesignEvidence({ ticketRel: T3, ports: ports({ [MAN]: phaseOnly }) })
    expect(r.durable).toBe(false)
    expect(r.reason).toContain('design 승인 행이 없음')
  })
  /** marker 켜진 티켓에서는 구버전(인벤토리 없는) 행을 완비로 보지 않는다. */
  it('archive_inventory 없음 → 미완(재-finalize 유도)', () => {
    const r = verifyCommittedDesignEvidence({ ticketRel: T3, ports: ports({ [MAN]: row({ archive_inventory: undefined }) }) })
    expect(r.durable).toBe(false)
    expect(r.reason).toContain('archive_inventory 없음')
  })
  it('인벤토리 아카이브가 HEAD에 없음 → 미완', () => {
    const missing = ports({ [MAN]: row() })
    const r = verifyCommittedDesignEvidence({
      ticketRel: T3,
      ports: { headText: missing.headText, headBlobSha256: (p) => (p === AP ? S_APPROVED : null) },
    })
    expect(r.durable).toBe(false)
    expect(r.reason).toContain('HEAD에 없음')
  })
  it('인벤토리 SHA 불일치 → 미완', () => {
    const p0 = ports({ [MAN]: row() })
    const r = verifyCommittedDesignEvidence({
      ticketRel: T3,
      ports: { headText: p0.headText, headBlobSha256: (p) => (p === NF ? 'f'.repeat(64) : S_APPROVED) },
    })
    expect(r.durable).toBe(false)
    expect(r.reason).toContain('SHA 불일치')
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
      writeFileSync(statePath, JSON.stringify({ id: 'REQ-2026-001', evidence_durability_required: true }, null, 2))
      git(['add', '--', `${tRel}/state.json`])
      git(['commit', '-q', '-m', 'scaffold'])

      const ports = createEvidencePorts(dir, `${tRel}/responses`)
      const stateRel = `${tRel}/state.json`

      // 🔴 워킹 캐시에서 marker를 지워도 HEAD blob 기준이므로 여전히 엄격하다(캐시 소실 우회 차단).
      writeFileSync(statePath, JSON.stringify({ id: 'REQ-2026-001' }, null, 2))
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
