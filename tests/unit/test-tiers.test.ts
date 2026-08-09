/**
 * 테스트 계층 가드(REQ-2026-122 R3) — 목록·정의·전체 스위트의 정합.
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { INTEGRATION_TIER } from '../tiers'
import workspace from '../../vitest.workspace'

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

  /**
   * 🔴 phase r01 P1: 위 산식 검증만으로는 **실제 workspace 정의의 드리프트**를 못 잡는다 — fast의
   * exclude에 목록 밖 파일을 추가하면 어느 계층도 그 테스트를 안 돌리는데 산식 가드는 통과한다.
   * 그래서 실제 `vitest.workspace.ts`의 프로젝트 정의를 import해 **정확 일치**로 고정한다:
   * fast.exclude = node_modules + INTEGRATION_TIER **뿐**(임의 제외 금지·include 미정의 = 전체 상속),
   * integration.include = INTEGRATION_TIER **뿐**. 이 두 사실 + 위 산식이면 유실이 구조적으로 불가능하다.
   */
  it('🔴 workspace 실정의 검증 — fast는 목록 외 아무것도 제외하지 않고, integration은 목록만 포함한다(완료 기준 1·2·5)', () => {
    const entries = workspace as unknown as { extends?: string; test?: { name?: string; include?: string[]; exclude?: string[] } }[]
    const byName = new Map(entries.map((e) => [e.test?.name, e]))
    const fast = byName.get('fast')
    const integ = byName.get('integration')
    expect(fast, 'fast 프로젝트 부재').toBeTruthy()
    expect(integ, 'integration 프로젝트 부재').toBeTruthy()
    // fast: exclude = node_modules + 목록 정확 일치 — 목록 밖 제외가 하나라도 생기면 그 파일은 어느 계층도 안 돈다.
    expect(fast!.test!.exclude).toEqual(['**/node_modules/**', ...INTEGRATION_TIER])
    // fast: include 미정의(전체 상속) — include를 좁히는 것도 같은 유실 경로다.
    expect(fast!.test!.include).toBeUndefined()
    // integration: include = 목록 정확 일치, exclude 미정의.
    expect(integ!.test!.include).toEqual([...INTEGRATION_TIER])
    expect(integ!.test!.exclude).toBeUndefined()
    // 두 프로젝트 다 base config를 상속한다(인프라 값 이원화 금지).
    expect(fast!.extends).toBe('./vitest.config.ts')
    expect(integ!.extends).toBe('./vitest.config.ts')
    // 프로젝트가 이 둘뿐이다 — 제3 프로젝트가 기본 실행 의미를 바꾸는 것을 막는다.
    expect(entries).toHaveLength(2)
  })
})
