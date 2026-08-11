/**
 * 테스트 계층 가드(REQ-2026-122 R3 · 0.22.0 2차 보완) — 목록·정의·**실제 파일 선택**의 정합.
 *
 * 🔴 **왜 실행 기반 가드가 생겼는가**: 예전 가드는 `vitest.workspace.ts`의 **정의 모양**만 검사했다.
 *    정의는 옳아 보였는데 vitest가 `extends` 상속 시 `include` 배열을 **이어붙여** 해석하는 바람에
 *    integration 프로젝트가 목록 16개가 아니라 전체 77개를 돌고 있었다 —
 *    `npm test`가 고유 77파일을 **138번** 실행했고 구조 가드는 통과했다.
 *    같은 종류의 거짓을 다시 허용하지 않으려면 **선택 결과를 실행해서** 봐야 한다.
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
// 🔴 Windows에서 `npx`는 `.cmd`라 execFileSync가 해소하지 못한다(ENOENT). 저장소의 안전 spawn 경계를 쓴다.
import { safeSpawnSync } from '../../scripts/req/lib/adapters'
import { INTEGRATION_TIER } from '../tiers'
import workspace from '../../vitest.workspace'
import { SHARED_TEST_CONFIG, ALL_TESTS_GLOB } from '../../vitest.shared'

const ROOT = join(__dirname, '..', '..')

// 전체 스위트가 보는 것과 같은 대상: tests 하위 *.test.ts 전부(vitest.config include와 동일 의미).
// (블록 주석에 글롭을 쓰면 `*·/` 조합이 주석을 조기 종료시킨다 — 줄 주석으로 둔다.)
function allTestFiles(): string[] {
  const out: string[] = []
  const walk = (rel: string): void => {
    for (const e of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
      const childRel = `${rel}/${e.name}`
      if (e.isDirectory()) walk(childRel)
      else if (e.name.endsWith('.test.ts')) out.push(childRel)
    }
  }
  walk('tests')
  return out.sort()
}

/** `vitest list --filesOnly`가 **실제로** 고른 파일 목록. 프로젝트 접두(`[name] `)를 떼고 정규화한다. */
function listedFiles(project: string): string[] {
  const out = safeSpawnSync('npx', ['vitest', 'list', '--project', project, '--filesOnly'], { cwd: ROOT })
  return out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.endsWith('.test.ts'))
    .map((l) => l.replace(/^\[[^\]]+\]\s*/, '').split('\\').join('/'))
    .sort()
}

describe('[REQ-2026-122] 테스트 계층 가드', () => {
  it('🔴 목록의 모든 파일이 실재한다 — 이동·개명·오탈자가 조용히 계층을 비우지 못한다(완료 기준 4)', () => {
    for (const rel of INTEGRATION_TIER) {
      expect(existsSync(join(ROOT, ...rel.split('/'))), `실재하지 않는 계층 항목: ${rel}`).toBe(true)
    }
  })

  it('목록에 중복이 없다', () => {
    expect(new Set(INTEGRATION_TIER).size).toBe(INTEGRATION_TIER.length)
  })

  it('🔴 fast ∪ integration = 전체 — 어떤 테스트 파일도 계층 사이에서 유실되지 않는다(완료 기준 5)', () => {
    const all = allTestFiles()
    const tier = new Set(INTEGRATION_TIER)
    // fast = 전체 − tier (workspace의 exclude 정의와 같은 산식 — 같은 원천 INTEGRATION_TIER를 본다).
    const fast = all.filter((f) => !tier.has(f))
    expect(fast.length + INTEGRATION_TIER.length).toBe(all.length)
    // tier의 모든 항목이 전체에 포함된다(실재성과 함께, glob 범위 밖 경로 방지).
    for (const t of INTEGRATION_TIER) expect(all).toContain(t)
  })

  it('🔴 workspace 실정의 — fast는 목록만 제외하고, integration은 목록만 포함한다', () => {
    const entries = workspace as unknown as {
      extends?: string
      test?: { name?: string; include?: string[]; exclude?: string[]; maxWorkers?: number; setupFiles?: readonly string[] }
    }[]
    const byName = new Map(entries.map((e) => [e.test?.name, e]))
    const fast = byName.get('fast')
    const integ = byName.get('integration')
    expect(fast, 'fast 프로젝트 부재').toBeTruthy()
    expect(integ, 'integration 프로젝트 부재').toBeTruthy()

    // fast: 전체 글롭 − (node_modules + 목록). 목록 밖 제외가 하나라도 생기면 그 파일은 어느 계층도 안 돈다.
    expect(fast!.test!.include).toEqual([ALL_TESTS_GLOB])
    expect(fast!.test!.exclude).toEqual(['**/node_modules/**', ...INTEGRATION_TIER])
    // integration: include = 목록 정확 일치, exclude 미정의.
    expect(integ!.test!.include).toEqual([...INTEGRATION_TIER])
    expect(integ!.test!.exclude).toBeUndefined()

    // 🔴 `extends` 금지 — 이것이 include 배열을 이어붙여 계층을 무너뜨렸던 원인이다.
    expect(fast!.extends, 'extends가 되살아나면 include가 병합돼 계층이 무너진다').toBeUndefined()
    expect(integ!.extends).toBeUndefined()

    // 인프라 값은 SSOT에서 온 같은 값이어야 한다(이원화 금지).
    for (const p of [fast!, integ!]) {
      expect(p.test!.maxWorkers).toBe(SHARED_TEST_CONFIG.maxWorkers)
      expect(p.test!.setupFiles).toEqual(SHARED_TEST_CONFIG.setupFiles)
    }

    // 프로젝트가 이 둘뿐이다 — 제3 프로젝트가 기본 실행 의미를 바꾸는 것을 막는다.
    expect(entries).toHaveLength(2)
  })
})

/**
 * 🔴 **실행 기반 가드**. 정의가 아니라 vitest가 **실제로 고른 파일**을 본다.
 *    이 describe가 이 파일을 통합 계층으로 만든다(프로세스 스폰) — `tests/tiers.ts`에 등재돼 있다.
 */
describe('[0.22.0] 계층 선택 — 실제 실행 결과로 확인한다', () => {
  it('integration은 INTEGRATION_TIER만 고른다(전체를 다시 돌지 않는다)', () => {
    expect(listedFiles('integration')).toEqual([...INTEGRATION_TIER].sort())
  })

  it('fast는 전체 − INTEGRATION_TIER를 고른다', () => {
    const tier = new Set(INTEGRATION_TIER)
    expect(listedFiles('fast')).toEqual(allTestFiles().filter((f) => !tier.has(f)))
  })

  it('🔴 fast ∩ integration = 0 · fast ∪ integration = 전체 · 실행 파일 수 = 고유 파일 수', () => {
    const fast = listedFiles('fast')
    const integ = listedFiles('integration')
    const all = allTestFiles()

    const inter = fast.filter((f) => integ.includes(f))
    expect(inter, `두 계층이 겹칩니다(중복 실행): ${inter.join(', ')}`).toEqual([])
    expect([...fast, ...integ].sort()).toEqual(all)
    // 실행 총량 = 고유 파일 수. 예전에는 61 + 77 = 138 이었다.
    expect(fast.length + integ.length).toBe(all.length)
  })
})
