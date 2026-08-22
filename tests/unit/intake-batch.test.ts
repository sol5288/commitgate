import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readBlobsByOid } from '../../scripts/req/lib/git-batch'
import {
  parseLsTreeZ,
  ticketIdsFromEntries,
  intakePrefetchEntries,
  createBatchView,
  withBatchedHeadReads,
  listHeadTreeEntries,
  type HeadTreeEntry,
} from '../../scripts/req/lib/intake-batch'
import type { EvidencePorts } from '../../scripts/req/lib/evidence'

/** REQ-2026-169 phase-1 — intake 배치 뷰(순수 부분) + OID 배치 읽기. */

const OID = (n: number): string => String(n).padStart(40, '0')

function entry(path: string, oid: string, type = 'blob'): HeadTreeEntry {
  return { oid, type, path }
}

// ───────────────────────────────── parseLsTreeZ ──

describe('parseLsTreeZ — `<mode> <type> <oid>\\t<path>\\x00` 프레이밍(순수)', () => {
  it('여러 항목 + 마지막 NUL 유무 모두 처리', () => {
    const out = `100644 blob ${OID(1)}\tworkflow/REQ-2026-001/state.json\x00100644 blob ${OID(2)}\tworkflow/REQ-2026-001/responses/a.json\x00`
    expect(parseLsTreeZ(out)).toEqual([
      entry('workflow/REQ-2026-001/state.json', OID(1)),
      entry('workflow/REQ-2026-001/responses/a.json', OID(2)),
    ])
  })

  it('🔴 경로에 탭이 있어도 **첫 탭**에서만 자른다(공백 split 이면 경로가 깨진다)', () => {
    const out = `100644 blob ${OID(3)}\tworkflow/REQ-2026-001/we\tird name.json\x00`
    expect(parseLsTreeZ(out)).toEqual([entry('workflow/REQ-2026-001/we\tird name.json', OID(3))])
  })

  it('경로에 공백이 있어도 온전하다', () => {
    const out = `100644 blob ${OID(4)}\tworkflow/REQ-2026-001/a b c.json\x00`
    expect(parseLsTreeZ(out)[0]?.path).toBe('workflow/REQ-2026-001/a b c.json')
  })

  it('형식 밖 레코드는 항목으로 세지 않는다', () => {
    expect(parseLsTreeZ(`쓰레기\x00100644 blob\x00`)).toEqual([])
  })

  it('빈 출력 → 빈 배열', () => {
    expect(parseLsTreeZ('')).toEqual([])
  })
})

// ───────────────────────────────── ticketIdsFromEntries (DEC-8) ──

describe('ticketIdsFromEntries — 재귀 열거에서 티켓 id 파생(DEC-8, 순수)', () => {
  const entries = [
    entry('workflow/REQ-2026-002/state.json', OID(1)),
    entry('workflow/REQ-2026-002/responses/x.json', OID(2)), // 같은 티켓 중복 → 1건
    entry('workflow/REQ-2026-001/01-design.md', OID(3)),
    entry('workflow/delivery/slug.json', OID(4)), // 티켓 아님
    entry('workflow/delegations.jsonl', OID(5)), // 티켓 루트 직계 파일 — 티켓 아님
    entry('workflow/REQ-99/state.json', OID(6)), // 형식 불일치
  ]

  it('중복 제거 + 정렬', () => {
    expect(ticketIdsFromEntries(entries, 'workflow')).toEqual(['REQ-2026-001', 'REQ-2026-002'])
  })

  it('🔴 티켓 루트 **직계 파일**은 티켓 디렉터리가 아니다', () => {
    expect(ticketIdsFromEntries([entry('workflow/REQ-2026-001', OID(1))], 'workflow')).toEqual([])
  })

  it('ticketRoot 표기 흔들림(후행 슬래시·역슬래시)에 무관', () => {
    expect(ticketIdsFromEntries(entries, 'workflow/')).toEqual(['REQ-2026-001', 'REQ-2026-002'])
    expect(ticketIdsFromEntries(entries, 'workflow\\')).toEqual(['REQ-2026-001', 'REQ-2026-002'])
  })

  it('중첩 ticketRoot 도 동작', () => {
    const nested = [entry('docs/wf/REQ-2026-007/state.json', OID(1))]
    expect(ticketIdsFromEntries(nested, 'docs/wf')).toEqual(['REQ-2026-007'])
    expect(ticketIdsFromEntries(nested, 'docs')).toEqual([]) // `wf` 는 티켓 형식이 아니다
  })
})

// ───────────────────────────────── intakePrefetchEntries (DEC-3) ──

describe('intakePrefetchEntries — state.json ∪ responses/** 만(DEC-3, 순수)', () => {
  const entries = [
    entry('workflow/REQ-2026-001/state.json', OID(1)),
    entry('workflow/REQ-2026-001/responses/approvals.jsonl', OID(2)),
    entry('workflow/REQ-2026-001/responses/design-r01-approved.json', OID(3)),
    entry('workflow/REQ-2026-001/responses/nested/deep.json', OID(4)),
    entry('workflow/REQ-2026-001/01-design.md', OID(5)), // intake 가 읽지 않는다
    entry('workflow/REQ-2026-001/codex-request.md', OID(6)),
    entry('workflow/delegations.jsonl', OID(7)), // 티켓 밖
    entry('workflow/REQ-2026-001/responses/sub', OID(8), 'commit'), // blob 아님(submodule)
  ]

  it('설계 문서·티켓 밖·non-blob 은 제외', () => {
    expect(intakePrefetchEntries(entries, 'workflow').map((e) => e.path)).toEqual([
      'workflow/REQ-2026-001/state.json',
      'workflow/REQ-2026-001/responses/approvals.jsonl',
      'workflow/REQ-2026-001/responses/design-r01-approved.json',
      'workflow/REQ-2026-001/responses/nested/deep.json',
    ])
  })

  it('`state.json` 접두만 같은 다른 파일은 포함하지 않는다', () => {
    const e = [entry('workflow/REQ-2026-001/state.json.bak', OID(1))]
    expect(intakePrefetchEntries(e, 'workflow')).toEqual([])
  })

  it('`responses` 접두만 같은 디렉터리는 포함하지 않는다', () => {
    const e = [entry('workflow/REQ-2026-001/responses-old/x.json', OID(1))]
    expect(intakePrefetchEntries(e, 'workflow')).toEqual([])
  })
})

// ───────────────────────────── withBatchedHeadReads (DEC-2 · DEC-6) ──

/** 폴백이 실제로 일어났는지 세는 base 포트. 값은 "폴백이 준 것"임을 알아볼 수 있게 만든다. */
function countingBase(): { ports: EvidencePorts; calls: string[] } {
  const calls: string[] = []
  const ports = {
    readText: () => null,
    writeText: () => undefined,
    listArchiveNames: () => [],
    sha256: () => '',
    headText: (p: string) => {
      calls.push(`headText:${p}`)
      return `FALLBACK:${p}`
    },
    headBlobSha256: (p: string) => {
      calls.push(`headBlobSha256:${p}`)
      return `fallbacksha:${p}`
    },
    headArchivePaths: (d: string) => {
      calls.push(`headArchivePaths:${d}`)
      return [`FALLBACK/${d}`]
    },
    headCommitSha: () => 'deadbeef',
    commitPaths: () => undefined,
  } as unknown as EvidencePorts
  return { ports, calls }
}

describe('withBatchedHeadReads — 미스 4분기(DEC-6)', () => {
  const entries = [
    entry('workflow/REQ-2026-001/state.json', OID(1)),
    entry('workflow/REQ-2026-001/responses/approvals.jsonl', OID(2)),
    entry('workflow/REQ-2026-001/responses/design-r01-approved.json', OID(3)),
    entry('workflow/REQ-2026-001/responses/design-r01-needs-fix.json', OID(4)),
    entry('workflow/REQ-2026-001/01-design.md', OID(9)), // 열거엔 있으나 프리페치 대상 아님
  ]
  const body = (s: string): Buffer => Buffer.from(s, 'utf8')
  const blobs = new Map<string, Buffer | null>([
    [OID(1), body('{"id":"REQ-2026-001"}')],
    [OID(2), body('{"kind":"design"}\n')],
    [OID(3), body('approved-bytes')],
    [OID(4), body('needs-fix-bytes')],
  ])
  const view = createBatchView(entries, blobs, 'workflow')

  it('① 프리페치 적중 → 캐시 사용(폴백 0회)', () => {
    const { ports, calls } = countingBase()
    const p = withBatchedHeadReads(ports, view)
    expect(p.headText('workflow/REQ-2026-001/state.json')).toBe('{"id":"REQ-2026-001"}')
    expect(calls).toEqual([])
  })

  it('① headBlobSha256 은 **바이트 그대로** 해시한다', () => {
    const { ports } = countingBase()
    const p = withBatchedHeadReads(ports, view)
    expect(p.headBlobSha256('workflow/REQ-2026-001/responses/design-r01-approved.json')).toBe(
      createHash('sha256').update(body('approved-bytes')).digest('hex'),
    )
  })

  it('🔴 ② 열거엔 있으나 프리페치 대상이 아니면 **폴백**한다(부재로 단정하지 않는다)', () => {
    const { ports, calls } = countingBase()
    const p = withBatchedHeadReads(ports, view)
    expect(p.headText('workflow/REQ-2026-001/01-design.md')).toBe('FALLBACK:workflow/REQ-2026-001/01-design.md')
    expect(calls).toEqual(['headText:workflow/REQ-2026-001/01-design.md'])
  })

  it('③ ticketRoot 아래인데 열거에 없음 → 확정 부재(null · 폴백 0회)', () => {
    const { ports, calls } = countingBase()
    const p = withBatchedHeadReads(ports, view)
    expect(p.headText('workflow/REQ-2026-001/responses/ticket-close.jsonl')).toBeNull()
    expect(p.headBlobSha256('workflow/REQ-2026-001/responses/gone.json')).toBeNull()
    expect(calls).toEqual([])
  })

  it('🔴 ④ ticketRoot **밖**이면 폴백한다 — confinement 를 어긴 매니페스트에서 옛 동작과 갈리지 않게', () => {
    const { ports, calls } = countingBase()
    const p = withBatchedHeadReads(ports, view)
    expect(p.headBlobSha256('src/secret.json')).toBe('fallbacksha:src/secret.json')
    expect(p.headText('../outside.json')).toBe('FALLBACK:../outside.json')
    expect(calls).toEqual(['headBlobSha256:src/secret.json', 'headText:../outside.json'])
  })

  it('역슬래시 경로도 같은 판정을 받는다', () => {
    const { ports, calls } = countingBase()
    const p = withBatchedHeadReads(ports, view)
    expect(p.headText('workflow\\REQ-2026-001\\state.json')).toBe('{"id":"REQ-2026-001"}')
    expect(calls).toEqual([])
  })

  it('headArchivePaths — 아카이브 파일명만, 재귀로(폴백 0회)', () => {
    const { ports, calls } = countingBase()
    const p = withBatchedHeadReads(ports, view)
    expect(p.headArchivePaths('workflow/REQ-2026-001/responses').sort()).toEqual([
      'workflow/REQ-2026-001/responses/design-r01-approved.json',
      'workflow/REQ-2026-001/responses/design-r01-needs-fix.json',
    ])
    expect(calls).toEqual([])
  })

  it('🔴 headArchivePaths 가 ticketRoot 밖을 물으면 폴백', () => {
    const { ports, calls } = countingBase()
    const p = withBatchedHeadReads(ports, view)
    expect(p.headArchivePaths('elsewhere/responses')).toEqual(['FALLBACK/elsewhere/responses'])
    expect(calls).toEqual(['headArchivePaths:elsewhere/responses'])
  })

  it('덮어쓰지 않은 포트는 base 그대로다(스텁이 아니다 — DEC-2)', () => {
    const { ports } = countingBase()
    const p = withBatchedHeadReads(ports, view)
    expect(p.headCommitSha()).toBe('deadbeef')
    expect(p.readText('anything')).toBeNull()
  })
})

// ───────────────────────────── 실 git: OID 배치 읽기 + 열거 ──

function g(repo: string, args: string[]): string {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    cwd: repo,
    encoding: 'utf8',
  }).replace(/\s+$/, '')
}

function newRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), 'cg-intake-batch-'))
  g(repo, ['init', '-q', '-b', 'main'])
  return repo
}

describe('실 git — readBlobsByOid(DEC-4) · listHeadTreeEntries(DEC-5)', () => {
  it('oid 로 읽은 바이트가 원문과 동일(멀티바이트·중복 oid 포함)', () => {
    const repo = newRepo()
    mkdirSync(join(repo, 'workflow', 'REQ-2026-001', 'responses'), { recursive: true })
    const korean = '{"결론":"승인"}\n'
    writeFileSync(join(repo, 'workflow', 'REQ-2026-001', 'state.json'), korean, 'utf8')
    // 같은 내용 두 경로 → oid 동일(중복 접기 경로를 태운다)
    writeFileSync(join(repo, 'workflow', 'REQ-2026-001', 'responses', 'a.json'), korean, 'utf8')
    writeFileSync(join(repo, 'workflow', 'REQ-2026-001', 'responses', 'b.json'), 'other\n', 'utf8')
    g(repo, ['add', '-A'])
    g(repo, ['commit', '-q', '-m', 'seed'])

    const entries = listHeadTreeEntries(repo, 'workflow')
    expect(entries.map((e) => e.path).sort()).toEqual([
      'workflow/REQ-2026-001/responses/a.json',
      'workflow/REQ-2026-001/responses/b.json',
      'workflow/REQ-2026-001/state.json',
    ])
    const blobs = readBlobsByOid(repo, entries.map((e) => e.oid))
    const view = createBatchView(entries, blobs, 'workflow')
    const { ports } = countingBase()
    const p = withBatchedHeadReads(ports, view)
    expect(p.headText('workflow/REQ-2026-001/state.json')).toBe(korean)
    expect(p.headBlobSha256('workflow/REQ-2026-001/responses/a.json')).toBe(
      createHash('sha256').update(Buffer.from(korean, 'utf8')).digest('hex'),
    )
  })

  it('HEAD 에 ticketRoot 가 없으면 빈 열거(첫 REQ) — throw 하지 않는다', () => {
    const repo = newRepo()
    writeFileSync(join(repo, 'a.txt'), 'x\n', 'utf8')
    g(repo, ['add', '-A'])
    g(repo, ['commit', '-q', '-m', 'seed'])
    // 🔴 이 경로는 git 이 **exit 0 + 빈 출력**을 내므로 실패 판별을 태우지 않는다(실측).
    expect(listHeadTreeEntries(repo, 'workflow')).toEqual([])
  })

  it('커밋이 하나도 없으면(unborn HEAD) 빈 열거 — 티켓이 있을 수 없으므로 **사실**이다', () => {
    const repo = newRepo() // init 만 — 커밋 없음
    expect(listHeadTreeEntries(repo, 'workflow')).toEqual([])
  })

  it('🔴 커밋이 있는데 ref 를 열거하지 못하면 **throw** — 실패를 "티켓 없음"으로 삼키면 게이트가 우회된다', () => {
    const repo = newRepo()
    writeFileSync(join(repo, 'a.txt'), 'x\n', 'utf8')
    g(repo, ['add', '-A'])
    g(repo, ['commit', '-q', '-m', 'seed'])
    expect(() => listHeadTreeEntries(repo, 'workflow', 'NO-SUCH-REF')).toThrow(/열거하지 못했다/)
  })

  it('🔴 저장소가 아닌 경로도 throw(조용한 빈 목록 금지)', () => {
    expect(() => listHeadTreeEntries(join(tmpdir(), 'cg-nonexistent-repo-for-intake-batch'), 'workflow')).toThrow()
  })

  it('존재하지 않는 oid → null(요청 순서 유지)', () => {
    const repo = newRepo()
    writeFileSync(join(repo, 'a.txt'), 'x\n', 'utf8')
    g(repo, ['add', '-A'])
    g(repo, ['commit', '-q', '-m', 'seed'])
    const got = readBlobsByOid(repo, [OID(7)])
    expect(got.get(OID(7))).toBeNull()
  })

  it('빈 요청 → git 호출 없이 빈 Map', () => {
    expect(readBlobsByOid('/definitely/not/a/repo', []).size).toBe(0)
  })

  it('🔴 배치 읽기 실패는 **throw** 한다 — 빈 뷰로 흡수하면 게이트가 통째로 우회된다', () => {
    expect(() => readBlobsByOid(join(tmpdir(), 'cg-nonexistent-dir-for-intake-batch'), [OID(1)])).toThrow()
  })
})
