import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import {
  IntegrationCoordinator,
  driftLine,
  type CoordinatorDeps,
  type PreparedIntegration,
  type VerifySummary,
} from '../../scripts/req/lib/integration-coordinator'
import type { GitAdapter } from '../../scripts/req/lib/adapters'

/**
 * 0.22.0 RC 보완 — **검증한 SHA와 실제 병합 SHA의 결속**(실 git).
 *
 * 🔴 이 파일은 실제 `git` 프로세스를 스폰한다(통합 계층 — `tests/tiers.ts`에 등재).
 *    네트워크·gh·원격은 일절 쓰지 않는다 — 전부 임시 로컬 저장소다.
 */

const TRUNK = 'main'
const FEATURE = 'feat/req-2026-999-x'

const OK_VERIFY: VerifySummary = {
  counts: { merge: 0, bookkeeping: 0, approved: 1, attested: 0, 'invalid-evidence': 0, unproven: 0 },
  manifestProblems: 0,
  unproven: [],
  invalid: [],
}

function makeRepo(): { dir: string; g: (...a: string[]) => string } {
  const dir = mkdtempSync(join(tmpdir(), 'cg-coord-'))
  const g = (...args: string[]): string => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
  g('init', '-b', TRUNK)
  g('config', 'user.email', 't@t')
  g('config', 'user.name', 't')
  writeFileSync(join(dir, 'a.txt'), 'base\n')
  g('add', '.')
  g('commit', '-m', 'base')
  g('checkout', '-b', FEATURE)
  writeFileSync(join(dir, 'b.txt'), 'feature\n')
  g('add', '.')
  g('commit', '-m', 'feat: approved work')
  return { dir, g }
}

function adapterFor(dir: string): GitAdapter {
  return { exec: (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }) }
}

function coordFor(dir: string, over?: Partial<CoordinatorDeps>): IntegrationCoordinator {
  return new IntegrationCoordinator({
    git: over?.git ?? adapterFor(dir),
    gitStateExists: over?.gitStateExists ?? ((name) => existsSync(join(dir, '.git', name))),
    trunkBranch: over?.trunkBranch === undefined ? TRUNK : over.trunkBranch,
    branchPrefix: over?.branchPrefix ?? 'feat/req-',
    verify: over?.verify ?? (() => OK_VERIFY),
  })
}

/** 준비 토큰을 얻는다 — 이 시점의 두 SHA가 결속 대상이다. */
function prepare(dir: string, over?: Partial<CoordinatorDeps>): { coord: IntegrationCoordinator; p: PreparedIntegration } {
  const coord = coordFor(dir, over)
  const { prepared, plan } = coord.collect()
  expect(plan.ok, `plan이 차단됨: ${plan.problems.join(' / ')}`).toBe(true)
  expect(prepared).not.toBeNull()
  return { coord, p: prepared as PreparedIntegration }
}

/**
 * 🔴 **merge-base의 입력도 고정한 SHA여야 한다**(0.22.0 2차 보완).
 *
 *    예전 `collect()`는 `trunkHeadSha`를 읽어 토큰에 저장해 놓고, 정작 검증 범위는
 *    `git merge-base <trunkBranch> <head>` 로 **브랜치 이름**을 넘겨 계산했다. 두 호출 사이에 trunk가
 *    움직이면 토큰이 결속한 SHA 쌍과 **다른 범위**를 검증한 것이 되고, trunk가 feature를 이미 삼킨
 *    위치에 있으면 범위가 빈 집합으로 **축소**되기까지 한다(= 아무것도 검증하지 않고 통과).
 *
 *    아래 테스트는 GitAdapter 호출 기록에서 `merge-base`의 첫 인자를 직접 본다.
 */
describe('merge-base — 브랜치 이름이 아니라 고정한 trunk SHA로 계산한다', () => {
  const A = 'a'.repeat(40) // 준비 시점의 trunk
  const B = 'b'.repeat(40) // 그 직후 이동한 trunk
  const FHEAD = 'f'.repeat(40)
  const MBASE = 'c'.repeat(40)

  /** trunk ref 읽기가 호출될 때마다 `trunkRefs`를 순서대로 돌려준다(마지막 값 반복). */
  function recordingGit(trunkRefs: string[]): GitAdapter & { calls: string[][] } {
    const calls: string[][] = []
    let i = 0
    return {
      calls,
      exec(args: string[]): string {
        calls.push(args)
        const [cmd] = args
        if (cmd === 'rev-parse') {
          if (args[1] === '--abbrev-ref') return `${FEATURE}\n`
          const ref = args[2] ?? ''
          if (ref === `refs/heads/${TRUNK}`) {
            const v = trunkRefs[Math.min(i, trunkRefs.length - 1)] as string
            i++
            return `${v}\n`
          }
          if (ref === `refs/heads/${FEATURE}`) return `${FHEAD}\n`
          return `${FHEAD}\n` // HEAD^{commit}
        }
        if (cmd === 'status') return '\n'
        if (cmd === 'merge-base') return `${MBASE}\n`
        throw new Error(`recordingGit: 예상 밖 호출 ${args.join(' ')}`)
      },
    }
  }

  function prepareWith(trunkRefs: string[]) {
    const git = recordingGit(trunkRefs)
    const seen: { base: string; head: string }[] = []
    const coord = new IntegrationCoordinator({
      git,
      gitStateExists: () => false,
      trunkBranch: TRUNK,
      branchPrefix: 'feat/req-',
      verify: (base, head) => {
        seen.push({ base, head })
        return OK_VERIFY
      },
    })
    const r = coord.collect()
    const mergeBaseCalls = git.calls.filter((c) => c[0] === 'merge-base')
    return { git, seen, r, mergeBaseCalls }
  }

  it('merge-base 첫 번째 인자가 trunk 브랜치 이름이 아니라 정확한 trunkHeadSha다', () => {
    const { r, mergeBaseCalls } = prepareWith([A])
    expect(mergeBaseCalls).toHaveLength(1)
    const args = mergeBaseCalls[0] as string[]
    expect(args[1]).toBe(A) // 🔴 여기가 'main' 이면 회귀다
    expect(args[1]).not.toBe(TRUNK)
    expect(args[2]).toBe(FHEAD)
    expect(r.prepared?.trunkHeadSha).toBe(A)
  })

  it('trunkHeadSha를 읽은 직후 trunk가 이동해도 merge-base 입력은 고정한 SHA다', () => {
    // 두 번째 이후의 ref 읽기는 B를 돌려준다 — 그래도 merge-base는 A로 계산돼야 한다.
    const { r, mergeBaseCalls } = prepareWith([A, B])
    expect((mergeBaseCalls[0] as string[])[1]).toBe(A)
    expect((mergeBaseCalls[0] as string[])[1]).not.toBe(B)
    expect(r.prepared?.trunkHeadSha).toBe(A)
  })

  it('ABA — trunk가 A → B → A로 움직여도 기준은 계속 고정 SHA A이고 범위가 축소되지 않는다', () => {
    const { r, seen, mergeBaseCalls } = prepareWith([A, B, A])
    expect((mergeBaseCalls[0] as string[])[1]).toBe(A)
    expect(r.prepared?.trunkHeadSha).toBe(A)
    // 검증 함수가 받은 범위는 mergeBaseSha..featureHeadSha 하나뿐이며, B에서 파생된 것이 아니다.
    expect(seen).toEqual([{ base: MBASE, head: FHEAD }])
    expect(r.prepared?.mergeBaseSha).toBe(MBASE)
  })

  it('토큰의 네 값이 모두 같은 SHA 쌍에서 파생된다', () => {
    const { r, seen } = prepareWith([A])
    const p = r.prepared as PreparedIntegration
    expect(p.featureHeadSha).toBe(FHEAD)
    expect(p.trunkHeadSha).toBe(A)
    expect(p.mergeBaseSha).toBe(MBASE)
    expect(p.verificationSummary).toEqual(OK_VERIFY)
    // verify는 정확히 mergeBaseSha..featureHeadSha 범위로 호출된다.
    expect(seen).toEqual([{ base: p.mergeBaseSha, head: p.featureHeadSha }])
  })
})

describe('merge-base — 실 git으로 값 자체를 대조', () => {
  it('prepared.mergeBaseSha == git merge-base <trunkHeadSha> <featureHeadSha>', () => {
    const { dir, g } = makeRepo()
    const { p } = prepare(dir)
    const expected = g('merge-base', p.trunkHeadSha, p.featureHeadSha).trim()
    expect(p.mergeBaseSha).toBe(expected)
  })

  it('trunk ref를 읽은 직후 trunk가 이동해도(실 git) 검증 범위는 고정 SHA 기준이다', () => {
    const { dir, g } = makeRepo()
    const real = adapterFor(dir)
    const trunkAtPrepare = g('rev-parse', TRUNK).trim()
    let moved = false
    // trunk ref를 처음 읽은 **직후** 다른 작업자가 trunk를 밀어 올린다.
    const racing: GitAdapter = {
      exec(args) {
        const out = real.exec(args)
        if (!moved && args[0] === 'rev-parse' && args[2] === `refs/heads/${TRUNK}`) {
          moved = true
          g('checkout', '--quiet', TRUNK)
          writeFileSync(join(dir, 'trunk-advance.txt'), 'moved\n')
          g('add', '.')
          g('commit', '-q', '-m', 'trunk advance')
          g('checkout', '--quiet', FEATURE)
        }
        return out
      },
    }
    const seen: { base: string; head: string }[] = []
    const coord = coordFor(dir, {
      git: racing,
      verify: (base, head) => {
        seen.push({ base, head })
        return OK_VERIFY
      },
    })
    const { prepared } = coord.collect()
    expect(prepared).not.toBeNull()
    const p = prepared as PreparedIntegration
    expect(p.trunkHeadSha).toBe(trunkAtPrepare)
    expect(p.mergeBaseSha).toBe(g('merge-base', trunkAtPrepare, p.featureHeadSha).trim())
    expect(seen).toEqual([{ base: p.mergeBaseSha, head: p.featureHeadSha }])
  })

  it('ABA(실 git) — trunk가 A → B → A로 돌아오면 병합은 성공하고 부모는 고정 SHA 쌍이다', () => {
    const { dir, g } = makeRepo()
    const { coord, p } = prepare(dir)
    const A = p.trunkHeadSha

    // 🔴 워킹트리를 건드리지 않고 trunk ref만 A → B → A로 움직인다.
    //    (checkout으로 하면 B의 파일이 워킹트리에 남아 untracked가 되고, 그건 ABA가 아니라
    //     "워킹트리가 더러워짐"을 재는 다른 테스트가 된다 — 실제로 처음에 그렇게 틀렸다.)
    const treeA = g('rev-parse', `${A}^{tree}`).trim()
    const B = execFileSync('git', ['commit-tree', treeA, '-p', A, '-m', 'trunk B'], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
    }).trim()
    g('update-ref', `refs/heads/${TRUNK}`, B)
    expect(g('rev-parse', TRUNK).trim()).toBe(B)
    g('update-ref', `refs/heads/${TRUNK}`, A) // 정확히 같은 SHA로 복귀 = ABA
    expect(g('rev-parse', TRUNK).trim()).toBe(A)

    const r = coord.merge(p)
    expect(r.merged).toBe(true)
    expect(r.mergeParents).toEqual([A, p.featureHeadSha]) // B가 부모로 섞이지 않는다
    expect(g('rev-parse', TRUNK).trim()).toBe(r.mergeSha)
    // 검증 범위도 A 기준 그대로 — B에서 파생된 축소 범위가 아니다.
    expect(p.mergeBaseSha).toBe(g('merge-base', A, p.featureHeadSha).trim())
  })
})

describe('collect — 준비 토큰이 두 SHA를 결속한다', () => {
  it('feature/trunk HEAD와 merge-base를 토큰에 담는다', () => {
    const { dir, g } = makeRepo()
    const { p } = prepare(dir)
    expect(p.featureBranch).toBe(FEATURE)
    expect(p.trunkBranch).toBe(TRUNK)
    expect(p.featureHeadSha).toBe(g('rev-parse', FEATURE).trim())
    expect(p.trunkHeadSha).toBe(g('rev-parse', TRUNK).trim())
    expect(p.mergeBaseSha).toBe(g('merge-base', TRUNK, FEATURE).trim())
    expect(p.verificationSummary).toEqual(OK_VERIFY)
  })

  it('strict 차단(미입증)이면 토큰을 만들지 않는다', () => {
    const { dir } = makeRepo()
    const coord = coordFor(dir, {
      verify: () => ({ ...OK_VERIFY, counts: { ...OK_VERIFY.counts, unproven: 1 }, unproven: [{ sha: 'f'.repeat(40), subject: 'wip' }] }),
    })
    const r = coord.collect()
    expect(r.plan.ok).toBe(false)
    expect(r.prepared).toBeNull()
  })

  it('검증 계산 불가(throw)면 토큰을 만들지 않는다 — 추정하지 않는다', () => {
    const { dir } = makeRepo()
    const coord = coordFor(dir, {
      verify: () => {
        throw new Error('수집 실패')
      },
    })
    const r = coord.collect()
    expect(r.plan.ok).toBe(false)
    expect(r.prepared).toBeNull()
  })
})

describe('정상 병합 — 부모가 결속한 두 SHA와 정확히 일치', () => {
  it('merge 부모 = [trunkHeadSha, featureHeadSha] · trunk ref 갱신 · trunk 위에 선다', () => {
    const { dir, g } = makeRepo()
    const { coord, p } = prepare(dir)

    const r = coord.merge(p)
    expect(r.merged).toBe(true)
    expect(r.mergeSha).toMatch(/^[0-9a-f]{40}$/)
    expect(r.mergeParents).toEqual([p.trunkHeadSha, p.featureHeadSha])

    // 저장소의 실제 상태로 재확인 — 반환값만 믿지 않는다.
    const parents = g('rev-list', '--parents', '-n', '1', r.mergeSha as string).trim().split(/\s+/)
    expect(parents).toEqual([r.mergeSha, p.trunkHeadSha, p.featureHeadSha])
    expect(g('rev-parse', TRUNK).trim()).toBe(r.mergeSha)
    expect(g('rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe(TRUNK)
    expect(g('status', '--porcelain').trim()).toBe('')
    expect(r.detail).toContain('push는 하지 않았습니다')
  })

  it('merge 커밋이 만들어진다(--no-ff — FF로 삼켜지지 않는다)', () => {
    const { dir, g } = makeRepo()
    const { coord, p } = prepare(dir)
    const r = coord.merge(p)
    expect(r.merged).toBe(true)
    expect(r.mergeSha).not.toBe(p.featureHeadSha) // FF였다면 feature HEAD 그대로였을 것
    expect(g('rev-list', '--count', `${p.trunkHeadSha}..${TRUNK}`).trim()).toBe('2') // feature 커밋 + merge 커밋
  })
})

describe('검증 이후 상태가 바뀌면 병합하지 않는다', () => {
  /**
   * 준비 후 표류를 만든 다음 merge를 시도한다.
   * 🔴 기준선은 **표류를 만든 직후**의 trunk다 — 표류 자체가 trunk를 옮기는 경우(trunk 이동)에도
   *    "우리가 trunk를 건드리지 않았다"를 재는 것이 목적이기 때문이다.
   */
  function expectBlocked(mutate: (g: (...a: string[]) => string, dir: string) => void, needle: string): void {
    const { dir, g } = makeRepo()
    const { coord, p } = prepare(dir)
    mutate(g, dir)
    const trunkBeforeMerge = g('rev-parse', TRUNK).trim()

    const r = coord.merge(p)
    expect(r.merged).toBe(false)
    expect(r.mergeSha).toBeNull()
    expect(r.detail).toContain('다시 실행하세요')
    expect(r.detail).toContain(needle)
    expect(g('rev-parse', TRUNK).trim()).toBe(trunkBeforeMerge) // 우리가 trunk를 갱신하지 않았다
  }

  it('CI 대기 중 feature ref 이동 → 병합 없음', () => {
    expectBlocked((g, dir) => {
      writeFileSync(join(dir, 'c.txt'), 'sneaky\n')
      g('add', '.')
      g('commit', '-m', 'unverified commit')
    }, 'feature 브랜치가 이동했습니다')
  })

  it('사람 확인 중 trunk ref 이동 → 병합 없음', () => {
    expectBlocked((g, dir) => {
      g('checkout', TRUNK)
      writeFileSync(join(dir, 'd.txt'), 'trunk moved\n')
      g('add', '.')
      g('commit', '-m', 'trunk advance')
      g('checkout', FEATURE)
    }, 'trunk 브랜치가 이동했습니다')
  })

  it('현재 브랜치가 바뀜 → 병합 없음', () => {
    expectBlocked((g) => g('checkout', TRUNK), '현재 브랜치가 바뀌었습니다')
  })

  it('워킹트리가 dirty 로 변경 → 병합 없음', () => {
    expectBlocked((_g, dir) => writeFileSync(join(dir, 'b.txt'), 'dirty\n'), 'clean 하지 않습니다')
  })

  it('merge 진행 상태 발생 → 병합 없음', () => {
    const { dir, g } = makeRepo()
    const { p } = prepare(dir)
    const trunkBefore = g('rev-parse', TRUNK).trim()
    const coord = coordFor(dir, { gitStateExists: (n) => n === 'MERGE_HEAD' })
    const r = coord.merge(p)
    expect(r.merged).toBe(false)
    expect(r.detail).toContain('진행 중인 merge가 생겼습니다')
    expect(g('rev-parse', TRUNK).trim()).toBe(trunkBefore)
  })

  it('rebase 진행 상태 발생 → 병합 없음', () => {
    const { dir, g } = makeRepo()
    const { p } = prepare(dir)
    const coord = coordFor(dir, { gitStateExists: (n) => n === 'rebase-merge' })
    const r = coord.merge(p)
    expect(r.merged).toBe(false)
    expect(r.detail).toContain('진행 중인 rebase가 생겼습니다')
  })

  it('표류 사유는 검증 시점과 현재 값을 함께 보여준다', () => {
    expect(driftLine({ what: 'trunk 이동', expected: 'aaaaaaaa', actual: 'bbbbbbbb' })).toBe(
      'trunk 이동 — 검증 시점 aaaaaaaa · 지금 bbbbbbbb',
    )
  })
})

/**
 * 🔴 재검증만으로는 부족하다 — 재검증과 `update-ref` **사이**에도 창이 있다.
 *    그 창에서 trunk가 움직이면 compare-and-swap이 거부하고 trunk ref는 그대로여야 한다.
 */
describe('compare-and-swap — 재검증 이후에 trunk가 움직여도 trunk를 덮어쓰지 않는다', () => {
  it('merge 직후 trunk가 이동 → update-ref 실패 · trunk 불변 · feature 브랜치로 복귀', () => {
    const { dir, g } = makeRepo()
    const real = adapterFor(dir)
    let moved = false
    // merge가 끝난 직후(= 재검증 이후) 다른 작업자가 trunk를 밀어 올린 상황을 만든다.
    const racing: GitAdapter = {
      exec(args) {
        const out = real.exec(args)
        if (args[0] === 'merge' && !moved) {
          moved = true
          const stray = execFileSync('git', ['commit-tree', `${g('rev-parse', `${TRUNK}^{tree}`).trim()}`, '-p', g('rev-parse', TRUNK).trim(), '-m', 'concurrent trunk write'], {
            cwd: dir,
            encoding: 'utf8',
            env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' },
          }).trim()
          execFileSync('git', ['update-ref', `refs/heads/${TRUNK}`, stray], { cwd: dir })
        }
        return out
      },
    }
    const { p } = prepare(dir)
    const trunkAtPrepare = p.trunkHeadSha

    const coord = coordFor(dir, { git: racing })
    const r = coord.merge(p)

    expect(r.merged).toBe(false)
    expect(r.detail).toContain('비교·교환 실패')
    expect(r.detail).toContain('trunk는 변경하지 않았습니다')
    // trunk는 경쟁 작업자가 쓴 값 그대로 — 우리 merge 커밋이 아니다.
    const trunkNow = g('rev-parse', TRUNK).trim()
    expect(trunkNow).not.toBe(trunkAtPrepare)
    expect(g('log', '-1', '--format=%s', TRUNK).trim()).toBe('concurrent trunk write')
    expect(g('rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe(FEATURE) // 원래 브랜치로 복귀
    expect(g('status', '--porcelain').trim()).toBe('')
  })
})

describe('충돌 — abort 후 원래 feature 브랜치로 복귀', () => {
  it('충돌 병합 → 병합 없음 · trunk 불변 · worktree clean · feature 위', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cg-coord-conflict-'))
    const g = (...args: string[]): string => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
    g('init', '-b', TRUNK)
    g('config', 'user.email', 't@t')
    g('config', 'user.name', 't')
    writeFileSync(join(dir, 'a.txt'), 'base\n')
    g('add', '.')
    g('commit', '-m', 'base')
    g('checkout', '-b', FEATURE)
    writeFileSync(join(dir, 'a.txt'), 'feature\n')
    g('add', '.')
    g('commit', '-m', 'feature')
    g('checkout', TRUNK)
    writeFileSync(join(dir, 'a.txt'), 'trunk\n')
    g('add', '.')
    g('commit', '-m', 'trunk')
    g('checkout', FEATURE)

    const { coord, p } = prepare(dir)
    const trunkBefore = g('rev-parse', TRUNK).trim()

    const r = coord.merge(p)
    expect(r.merged).toBe(false)
    expect(r.detail).toContain('원상 복구함')
    expect(g('rev-parse', TRUNK).trim()).toBe(trunkBefore)
    expect(g('rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe(FEATURE)
    expect(g('status', '--porcelain').trim()).toBe('')
  })
})

/**
 * 🔴 **변이 테스트**: "브랜치 이름으로 병합"이 왜 안 되는지를 저장소 상태로 보인다.
 *
 *    재검증을 의도적으로 눈멀게 한(옛 SHA를 보고한다고 거짓말하는) git 어댑터를 준다.
 *    그래도 병합은 **결속한 SHA**로 일어나므로, 그 사이 얹힌 미검증 커밋은 trunk에 들어오지 않는다.
 *    구현이 `merge <featureBranch>`로 되돌아가면 이 테스트가 red다.
 */
describe('변이 테스트 — 검증하지 않은 SHA는 병합되지 않는다', () => {
  it('재검증을 통과시켜도(눈먼 어댑터) 미검증 커밋은 trunk에 들어오지 않는다', () => {
    const { dir, g } = makeRepo()
    const { p } = prepare(dir)

    // 검증 이후 미검증 커밋이 feature 브랜치에 얹힌다.
    writeFileSync(join(dir, 'c.txt'), 'unverified\n')
    g('add', '.')
    g('commit', '-m', 'UNVERIFIED')
    const unverified = g('rev-parse', FEATURE).trim()
    expect(unverified).not.toBe(p.featureHeadSha)

    // 재검증이 표류를 못 보게 만든다 — 그래도 SHA 병합이라 결과는 안전해야 한다.
    const real = adapterFor(dir)
    const blind: GitAdapter = {
      exec(args) {
        if (args[0] === 'rev-parse' && args[1] === '--verify' && args[2] === `refs/heads/${FEATURE}`) return `${p.featureHeadSha}\n`
        return real.exec(args)
      },
    }
    const r = coordFor(dir, { git: blind }).merge(p)

    expect(r.merged).toBe(true)
    expect(r.mergeParents).toEqual([p.trunkHeadSha, p.featureHeadSha])
    // 핵심 단언: 미검증 커밋은 trunk에서 도달 불가다.
    expect(() => g('merge-base', '--is-ancestor', unverified, TRUNK)).toThrow()
    expect(g('merge-base', '--is-ancestor', p.featureHeadSha, TRUNK)).toBe('') // 검증한 것은 들어와 있다
  })
})
