/**
 * REQ-2026-142 phase-1 — 승인 시점 아카이브 인벤토리 핀.
 *
 * 🔴 이 phase 가 지키려는 것은 **두 시점의 비교 가능성**이다: 승인 때 만든 값과 복구 때 다시 계산한 값이
 *    같은 목록이면 반드시 같아야 하고, 한 바이트라도 다르면 반드시 달라야 한다. 그래야 phase-2 의
 *    `inventory-tampered` 판정이 성립한다.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { canonicalInventoryForm, buildPinnedInventory, buildArchiveInventory } from '../../scripts/req/lib/evidence'
import { buildApprovalEvidence } from '../../scripts/req/review-codex'
import type { PinnedInventoryItem } from '../../scripts/req/lib/review-types'

const sha = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex')
const H = (n: number): string => String(n).padStart(64, '0')

const ITEMS: PinnedInventoryItem[] = [
  { response_path: 'workflow/REQ-2026-142/responses/design-r01-needs-fix.json', sha256: H(1) },
  { response_path: 'workflow/REQ-2026-142/responses/design-r02-approved.json', sha256: H(2) },
]

describe('canonicalInventoryForm — 두 시점 비교의 전제', () => {
  it('입력 순서가 달라도 같은 값(정렬로 readdir 순서 비의존)', () => {
    expect(canonicalInventoryForm([...ITEMS].reverse())).toBe(canonicalInventoryForm(ITEMS))
  })

  it('🔴 sha 가 한 글자만 달라도 값이 달라진다', () => {
    const tampered = [ITEMS[0]!, { ...ITEMS[1]!, sha256: H(3) }]
    expect(canonicalInventoryForm(tampered)).not.toBe(canonicalInventoryForm(ITEMS))
  })

  it('🔴 항목이 하나 추가되면 값이 달라진다(무관 아카이브 주입 감지)', () => {
    const injected = [...ITEMS, { response_path: 'workflow/REQ-2026-142/responses/design-r99-approved.json', sha256: H(9) }]
    expect(canonicalInventoryForm(injected)).not.toBe(canonicalInventoryForm(ITEMS))
  })

  it('🔴 항목이 하나 빠져도 값이 달라진다', () => {
    expect(canonicalInventoryForm([ITEMS[0]!])).not.toBe(canonicalInventoryForm(ITEMS))
  })

  it('🔴 키 삽입 순서에 비의존 — 객체 리터럴 순서를 뒤집어도 같은 값', () => {
    const flipped = ITEMS.map((i) => ({ sha256: i.sha256, response_path: i.response_path }))
    expect(canonicalInventoryForm(flipped)).toBe(canonicalInventoryForm(ITEMS))
  })

  it('🔴 두 필드만 담는다 — 여분 필드는 값에 영향이 없다', () => {
    const extra = ITEMS.map((i) => ({ ...i, note: 'ignored' })) as PinnedInventoryItem[]
    expect(canonicalInventoryForm(extra)).toBe(canonicalInventoryForm(ITEMS))
  })

  it('빈 목록도 결정적', () => {
    expect(canonicalInventoryForm([])).toBe(canonicalInventoryForm([]))
    expect(canonicalInventoryForm([])).not.toBe(canonicalInventoryForm(ITEMS))
  })
})

describe('buildPinnedInventory', () => {
  const pin = buildPinnedInventory(ITEMS, 'design', null, ITEMS[1]!.response_path, sha)

  it('inventory_sha256 은 정규형의 해시다(재계산 가능)', () => {
    expect(pin.inventory_sha256).toBe(sha(canonicalInventoryForm(ITEMS)))
  })

  it('🔴 source_response_path 가 items 안에 있다(결속)', () => {
    expect(pin.items.map((i) => i.response_path)).toContain(pin.source_response_path)
  })

  it('kind·phase_id 를 결속한다', () => {
    const p = buildPinnedInventory(ITEMS, 'phase', 'phase-1-x', ITEMS[1]!.response_path, sha)
    expect(p.review_kind).toBe('phase')
    expect(p.phase_id).toBe('phase-1-x')
    expect(pin.phase_id).toBeNull()
  })

  it('items 를 복사한다 — 원본 변형이 핀에 새지 않는다', () => {
    const src = [{ ...ITEMS[0]! }]
    const p = buildPinnedInventory(src, 'design', null, src[0]!.response_path, sha)
    src[0]!.sha256 = H(7)
    expect(p.items[0]!.sha256).toBe(H(1))
  })

  it('items 에는 두 필드만 남는다', () => {
    const p = buildPinnedInventory(ITEMS.map((i) => ({ ...i, junk: 1 })) as PinnedInventoryItem[], 'design', null, ITEMS[0]!.response_path, sha)
    expect(Object.keys(p.items[0]!).sort()).toEqual(['response_path', 'sha256'])
  })

  it('🔴 buildArchiveInventory 산출과 그대로 맞물린다(같은 모양)', () => {
    const names = ['design-r01-needs-fix.json', 'design-r02-approved.json']
    const items = buildArchiveInventory(names, 'design', null, 'workflow/REQ-2026-142', () => H(1))
    const p = buildPinnedInventory(items, 'design', null, items[1]!.response_path, sha)
    expect(p.items).toHaveLength(2)
    expect(p.source_response_path).toBe('workflow/REQ-2026-142/responses/design-r02-approved.json')
  })
})

describe('buildApprovalEvidence — 핀 부착', () => {
  const base = {
    verdict: { status: 'COMPLETE', commit_approved: 'yes', machine_schema_version: '1.0.0' },
    binding: { reviewBaseSha: 'a'.repeat(40), reviewTree: 'b'.repeat(40) },
    designHash: 'c'.repeat(40),
    threadId: 'thread-1',
    archive: { path: ITEMS[1]!.response_path, sha256: H(2) },
    approvedAt: '2026-08-14T00:00:00Z',
  }
  const pin = buildPinnedInventory(ITEMS, 'design', null, ITEMS[1]!.response_path, sha)

  it('핀을 주면 실린다(design)', () => {
    const ev = buildApprovalEvidence({ ...base, kind: 'design', phaseId: null, archiveInventory: pin })
    expect(ev.archive_inventory?.inventory_sha256).toBe(pin.inventory_sha256)
  })

  it('핀을 주면 실린다(phase)', () => {
    const ev = buildApprovalEvidence({ ...base, kind: 'phase', phaseId: 'phase-1-x', archiveInventory: pin })
    expect(ev.archive_inventory?.items).toHaveLength(2)
  })

  it('🔴 안 주면 키 자체가 없다 — null·빈 목록으로 채우지 않는다', () => {
    const ev = buildApprovalEvidence({ ...base, kind: 'design', phaseId: null })
    expect('archive_inventory' in ev).toBe(false)
  })

  it('🔴 선택 키다 — 핀 없는 evidence 의 나머지 필드가 그대로다(하위호환)', () => {
    const withPin = buildApprovalEvidence({ ...base, kind: 'design', phaseId: null, archiveInventory: pin })
    const without = buildApprovalEvidence({ ...base, kind: 'design', phaseId: null })
    const { archive_inventory: _drop, ...rest } = withPin
    expect(rest).toEqual(without)
  })
})

describe('🔴 배선 가드 — 순수 테스트가 못 보는 자리', () => {
  const src = readFileSync(join(process.cwd(), 'scripts/req/review-codex.ts'), 'utf8')

  it('아카이브를 **쓴 뒤** 디렉터리를 다시 읽어 인벤토리를 만든다', () => {
    // write 이전 스냅샷(`existing`)으로 만들면 승인본 자신이 빠져 결속이 깨진다.
    const i = src.indexOf('archiveRound = round')
    const j = src.indexOf('buildPinnedInventory(')
    expect(i).toBeGreaterThan(0)
    expect(j).toBeGreaterThan(i)
    expect(src.slice(i, j)).toMatch(/readdirSync\(responsesDir\)/)
  })

  it('산출한 핀이 processResponse 로 전달된다', () => {
    expect(src).toMatch(/processResponse\(\{[^}]*archiveInventory[^}]*\}\)/)
  })

  it('핀은 buildApprovalEvidence 를 통해서만 evidence 에 실린다', () => {
    expect(src).toMatch(/if \(archiveInventory\) ev\.archive_inventory = archiveInventory/)
  })
})
