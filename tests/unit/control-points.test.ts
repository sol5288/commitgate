import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { I1_APPROVAL, I2_APPROVAL, B1_APPROVAL, integrationPathGuidance } from '../../scripts/req/lib/control-points'
import { retiredClaimsIn } from '../../scripts/req/lib/retired-claims'

/**
 * **통제점 승인 문장의 코드↔문서 결속** — 0.22.0 최종 보완.
 *
 * 🔴 문서는 마크다운이라 상수를 import할 수 없다. 그래서 "문서가 그 값을 담고 있는가"를 검사해
 *    같은 원천에 묶는다. 한쪽만 갱신되면 red다 — 실제로 `req:next`의 delivery 경로가 그렇게 갈라졌다.
 * 🔴 **역사 문서는 대상이 아니다.** 과거 기록은 그 시점의 문장을 담는 것이 정상이다.
 */

const ROOT = join(__dirname, '..', '..')
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8')

/** 현재 계약을 서술하는 문서 — I2 정본 문장을 담아야 한다. */
const CONTRACT_DOCS = [
  'AGENTS.template.md',
  join('docs', 'RELEASING.md'),
  join('docs', 'ssot-design', '04-user-roles-and-permissions.md'),
] as const

describe('[0.22.0] 통제점 승인 문장 SSOT', () => {
  it('I2 정본 문장은 정확히 이 값이다', () => {
    expect(I2_APPROVAL).toBe('검증 결과 확인 후 PR merge 승인')
  })

  it('통합 경로 안내가 세 통제점을 모두 담는다', () => {
    const full = integrationPathGuidance()
    expect(full).toContain(I1_APPROVAL)
    expect(full).toContain(I2_APPROVAL)
    expect(full).toContain(B1_APPROVAL)
    // 축약형도 같은 I2 문장을 쓴다 — 축약이 새 변형이 되지 않는다.
    expect(integrationPathGuidance({ short: true })).toContain(I2_APPROVAL)
  })

  it('🔴 안내 어디에도 옛 CI 전제 문구가 없다', () => {
    for (const g of [integrationPathGuidance(), integrationPathGuidance({ short: true })])
      for (const stale of ['checks green', 'required checks', 'CI green'])
        expect(g, `안내에 옛 문구: ${stale}`).not.toContain(stale)
  })

  it('🔴 현재 계약 문서가 I2 정본 문장을 담는다(코드↔문서 결속)', () => {
    for (const rel of CONTRACT_DOCS) expect(read(rel), `${rel} 에 I2 정본 문장이 없습니다`).toContain(I2_APPROVAL)
  })

  it('🔴 현재 계약 문서에 폐기된 주장이 없다(정본 매처 재사용)', () => {
    for (const rel of CONTRACT_DOCS) {
      const found = retiredClaimsIn(read(rel)).map((c) => c.why)
      expect(found, `${rel}: ${found.join(' / ')}`).toEqual([])
    }
  })
})


/**
 * **배포되는 계약 템플릿의 릴리즈 전제** — 0.22.0 릴리스 직전 보완.
 *
 * 🔴 이 두 조건은 **동시에** 성립해야 한다:
 *    ① R1/R2/R3 전에 `verify-range --strict`(로컬 승인 증거 검증)가 요구된다.
 *    ② GitHub CI green 은 릴리즈 전제로 요구되지 **않는다**.
 *
 *    실제로 ②를 고치면서 ①을 템플릿에만 넣지 않아 전제가 통째로 사라졌었다 —
 *    "CI가 선택"과 "strict 가 필수"는 **다른 축**인데 한 번의 편집으로 둘 다 날아갔다.
 *    그래서 한쪽만 보는 테스트가 아니라 **둘을 함께** 고정한다.
 */
describe('[0.22.0] AGENTS.template.md — 릴리즈 전제(strict 필수 · CI 선택)', () => {
  const template = read('AGENTS.template.md')
  /** R1/R2/R3 를 다루는 줄들(강조 표시에 의존하지 않도록 정규화 후 비교). */
  const releaseLines = template
    .split(/\r?\n/)
    .filter((l) => /R1/.test(l) && /R2/.test(l) && /R3/.test(l))
    .map((l) => l.replace(/[*_`~]/g, '').replace(/\s+/g, ' ').trim())

  it('R1/R2/R3 안내 줄이 존재한다', () => {
    expect(releaseLines.length).toBeGreaterThan(0)
  })

  it('🔴 ① R1/R2/R3 전에 verify-range --strict 통과가 요구된다', () => {
    const line = releaseLines.find((l) => l.includes('verify-range --strict'))
    expect(line, `R1/R2/R3 줄에 strict 전제가 없습니다: ${releaseLines.join(' | ')}`).toBeDefined()
    expect(line).toContain('통과')
  })

  it('🔴 ② GitHub CI green 은 릴리즈 전제가 아니라고 명시한다', () => {
    const line = releaseLines.find((l) => l.includes('CI green'))
    expect(line, 'R1/R2/R3 줄에 CI green 비전제 명시가 없습니다').toBeDefined()
    expect(line).toContain('전제가 아니다')
  })

  it('🔴 CI green 을 릴리즈 전제로 되돌리지 않았다', () => {
    for (const l of releaseLines) {
      expect(l).not.toContain('CI green을 확인한 뒤')
      expect(l).not.toContain('CI green 확인 후')
    }
  })

  it('strict 는 로컬 검증이지 GitHub CI 가 아님을 구분해 적는다', () => {
    const norm = template.replace(/[*_`~]/g, '').replace(/\s+/g, ' ')
    expect(norm).toContain('로컬 승인 증거 검증')
    expect(norm).toContain('같은 검사로 취급하지 않는다')
  })

  it('🔴 옛 승인 명칭이 배포 템플릿에 없다(회귀 방지)', () => {
    for (const stale of ['merge/push 승인', 'required status checks bypass 승인'])
      expect(template, `배포 템플릿에 옛 승인 명칭: ${stale}`).not.toContain(stale)
  })

  it('승인 범위 비동일성은 현재 정본 두 문장으로 설명한다', () => {
    const norm = template.replace(/[*_`~]/g, '').replace(/\s+/g, ' ')
    expect(norm).toContain(`${I2_APPROVAL}(I2)은 ${B1_APPROVAL}(B1)이 아니다`)
  })
})
