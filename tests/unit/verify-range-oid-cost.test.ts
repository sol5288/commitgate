/**
 * REQ-2026-176 — `collectDeepInput` 이 blob 을 **OID 로** 요청한다.
 *
 * ## 🔴 왜 이렇게 세는가
 *
 * 결과만 보는 테스트는 **공허하다**: 경로 요청으로 되돌아가도 읽히는 blob 이 같으므로 전부 녹색이다.
 * 그래서 **실제 `git cat-file --batch` 에 써 넣은 stdin** 을 가로채 요청 줄의 모양을 본다 —
 * `<ref>:<path>` 인가 hex OID 인가. REQ-2026-169 의 `intake-scan-cost.test.ts` 와 같은 방식이다.
 *
 * 그리고 **`ls-tree` 호출 수**를 함께 고정한다. OID 를 얻겠다고 `ls-tree` 를 한 번 더 부르면
 * 절감의 상당 부분을 되돌려 주기 때문이다(REQ-2026-169 가 같은 자리에서 배운 것).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

/** 🔴 `vi.mock` 은 호이스팅되므로 로그 배열도 `vi.hoisted` 로 먼저 만든다. */
const { gitCalls, batchInputs } = vi.hoisted(() => ({
  gitCalls: [] as string[][],
  batchInputs: [] as string[],
}))

vi.mock('cross-spawn', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  const real = (actual.default ?? actual) as { sync: (...a: unknown[]) => unknown }
  const sync = (cmd: string, args?: readonly string[], opts?: unknown): unknown => {
    if (cmd === 'git') {
      gitCalls.push([...(args ?? [])])
      const input = (opts as { input?: unknown } | undefined)?.input
      if (typeof input === 'string') batchInputs.push(input)
    }
    return real.sync(cmd, args, opts)
  }
  const wrapped = Object.assign(
    function () {
      throw new Error('테스트에서 비동기 spawn 은 쓰지 않는다')
    },
    real,
    { sync },
  )
  return { ...actual, default: wrapped, sync }
})

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    execFileSync: (cmd: string, args?: readonly string[], opts?: unknown) => {
      if (cmd === 'git') gitCalls.push([...(args ?? [])])
      return (actual.execFileSync as (...a: unknown[]) => unknown)(cmd, args, opts)
    },
  }
})

import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectDeepInput } from '../../scripts/req/lib/verify-range'
import { readBlobsAtRef, readBlobsByOid } from '../../scripts/req/lib/git-batch'
import { createGitAdapter } from '../../scripts/req/lib/adapters'

const g = (repo: string, args: string[]): string =>
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    cwd: repo,
    encoding: 'utf8',
  }).replace(/\s+$/, '')

const TICKET_ROOT = 'workflow'

/** manifest + state 를 가진 티켓 N개를 커밋한 저장소. */
function repoWithTickets(count: number): { dir: string; base: string; head: string } {
  const dir = mkdtempSync(join(tmpdir(), 'cg-oid-'))
  g(dir, ['init', '-q', '-b', 'main'])
  writeFileSync(join(dir, 'README.md'), '# t\n')
  g(dir, ['add', '.'])
  g(dir, ['commit', '-qm', 'base'])
  const base = g(dir, ['rev-parse', 'HEAD'])
  for (let i = 1; i <= count; i++) {
    const id = `REQ-2026-${String(i).padStart(3, '0')}`
    const d = join(dir, TICKET_ROOT, id, 'responses')
    mkdirSync(d, { recursive: true })
    writeFileSync(join(dir, TICKET_ROOT, id, 'state.json'), JSON.stringify({ id, phases: [{ id: 'p1' }] }))
    // 🔴 내용을 티켓마다 다르게 둔다 — 같으면 oid 가 겹쳐 중복 접기가 계수를 흐린다.
    writeFileSync(join(d, 'approvals.jsonl'), `{"ticket":"${id}"}\n`)
  }
  g(dir, ['add', '.'])
  g(dir, ['commit', '-qm', 'tickets'])
  return { dir, base, head: g(dir, ['rev-parse', 'HEAD']) }
}

const collect = (dir: string, base: string, head: string): ReturnType<typeof collectDeepInput> =>
  collectDeepInput(
    createGitAdapter(dir),
    (ref, paths) => readBlobsAtRef(dir, ref, paths),
    base,
    head,
    TICKET_ROOT,
    (oids) => readBlobsByOid(dir, oids),
  )

const isHexOid = (s: string): boolean => /^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(s)

beforeEach(() => {
  gitCalls.length = 0
  batchInputs.length = 0
})

describe('[REQ-2026-176] collectDeepInput 은 blob 을 OID 로 요청한다', () => {
  it('🔴 계수 오라클 — cat-file --batch stdin 이 전부 hex OID 다(`<ref>:<path>` 아님)', () => {
    const { dir, base, head } = repoWithTickets(5)
    collect(dir, base, head)

    expect(batchInputs.length, 'cat-file --batch 가 한 번도 안 불렸다 — 오라클이 공허하다').toBeGreaterThan(0)
    const lines = batchInputs.flatMap((i) => i.split('\n').filter((l) => l !== ''))
    expect(lines.length, '요청이 비었다').toBeGreaterThan(0)
    for (const l of lines) {
      expect(l, `경로 요청이 남아 있다: ${l}`).not.toContain(':')
      expect(isHexOid(l), `hex OID 가 아니다: ${l}`).toBe(true)
    }
  })

  it('🔴 ls-tree 는 여전히 1회다(OID 를 얻겠다고 한 번 더 부르지 않는다)', () => {
    const { dir, base, head } = repoWithTickets(5)
    collect(dir, base, head)
    const lsTree = gitCalls.filter((a) => a[0] === 'ls-tree')
    expect(lsTree.length, JSON.stringify(lsTree)).toBe(1)
    expect(lsTree[0], '--name-only 를 떼야 OID 가 나온다').not.toContain('--name-only')
  })

  /**
   * 🔴 **동치 오라클**. 이 REQ 는 *"같은 데이터를 더 싸게"* 다 — 판정 입력이 한 바이트라도
   *    달라지면 게이트가 움직인 것이고, 그것은 이 REQ 의 비목표다.
   */
  it('🔴 판정 입력이 경로 요청 때와 동일하다', () => {
    const { dir, base, head } = repoWithTickets(5)
    const viaOid = collect(dir, base, head)
    // 옛 방식: OID 포트를 **경로 요청으로 되돌린 fake** 로 넘겨 같은 함수를 다시 돌린다.
    const oidToPath = new Map<string, string>()
    for (const line of g(dir, ['ls-tree', '-r', head, '--', TICKET_ROOT]).split('\n')) {
      const tab = line.indexOf('\t')
      if (tab === -1) continue
      const oid = line.slice(0, tab).split(' ')[2] as string
      oidToPath.set(oid, line.slice(tab + 1).trim())
    }
    const viaPath = collectDeepInput(
      createGitAdapter(dir),
      (ref, paths) => readBlobsAtRef(dir, ref, paths),
      base,
      head,
      TICKET_ROOT,
      (oids) => {
        const paths = oids.map((o) => oidToPath.get(o) as string)
        const byPath = readBlobsAtRef(dir, head, paths)
        return new Map(oids.map((o, i) => [o, byPath.get(paths[i] as string) ?? null]))
      },
    )
    expect(viaOid.manifests).toEqual(viaPath.manifests)
    expect([...viaOid.statePhases.entries()]).toEqual([...viaPath.statePhases.entries()])
    expect([...viaOid.archiveSha256.entries()]).toEqual([...viaPath.archiveSha256.entries()])
    expect(viaOid.commits).toEqual(viaPath.commits)
  })

  /**
   * 🔴 **폴백**(DEC-3). OID 를 못 얻은 경로는 **옛 방식으로 반드시 읽는다** —
   *    빠뜨리면 blob 이 조용히 `null` 이 되고, `null` 은 "검증 불가"로 해석돼
   *    **정상 커밋이 미입증으로 떨어진다**.
   */
  it('🔴 OID 를 못 얻어도 그 blob 은 읽힌다(조용히 null 이 되지 않는다)', () => {
    const { dir, base, head } = repoWithTickets(3)
    const gitAdapter = createGitAdapter(dir)
    const stripped = {
      ...gitAdapter,
      // `ls-tree` 만 `--name-only` 형식으로 되돌린다 → oidByPath 가 통째로 빈다.
      exec: (args: string[]): string => {
        const out = gitAdapter.exec(args)
        if (args[0] !== 'ls-tree') return out
        return out
          .split('\n')
          .map((l) => {
            const tab = l.indexOf('\t')
            return tab === -1 ? l : l.slice(tab + 1)
          })
          .join('\n')
      },
    }
    const got = collectDeepInput(
      stripped,
      (ref, paths) => readBlobsAtRef(dir, ref, paths),
      base,
      head,
      TICKET_ROOT,
      () => {
        throw new Error('OID 가 없는데 OID 경로가 불렸다')
      },
    )
    expect(got.manifests.length, '트리 경로가 사라졌다').toBe(3)
    for (const m of got.manifests) expect(m.content, `폴백이 읽지 못했다: ${m.path}`).toContain('"ticket"')
  })
})
