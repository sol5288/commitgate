import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  UPGRADE_AXES,
  AXES_TABLE_MARKER,
  diagnosisTokens,
  type UpgradeAxis,
} from '../../scripts/req/lib/upgrade-axes'
import { D_CHECK_IDS } from '../../scripts/req/req-doctor'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), 'utf8')

/** `check` 가 실제로 내는 항목 id — 손으로 적지 않고 소스의 유니온에서 뽑는다. */
const CHECK_IDS: string[] = (() => {
  const src = read('bin/check.ts')
  const m = /id:\s*((?:'C\d+'\s*\|\s*)*'C\d+')/.exec(src)
  return (m?.[1] ?? '').match(/'(C\d+)'/g)?.map((x) => x.replace(/'/g, '')) ?? []
})()

const DOCS: { rel: string; lang: string }[] = [
  { rel: 'docs/upgrade.md', lang: 'ko' },
  { rel: 'docs/upgrade.en.md', lang: 'en' },
]

/** 정본 표 구역(마커 사이). 없으면 빈 문자열. */
function tableRegion(body: string): string {
  const i = body.indexOf(AXES_TABLE_MARKER.open)
  const j = body.indexOf(AXES_TABLE_MARKER.close)
  return i < 0 || j < 0 || j < i ? '' : body.slice(i + AXES_TABLE_MARKER.open.length, j)
}

/** 표 구역의 데이터 행(헤더·구분선 제외). */
function tableRows(region: string): string[] {
  return region
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('|') && !/^\|[\s|:-]+\|$/.test(l))
    .filter((l) => !/^\|\s*(축|Axis)\s*\|/.test(l))
}

const rowFor = (rows: string[], axis: UpgradeAxis): string[] => rows.filter((r) => r.includes(`\`${axis.id}\``))

/**
 * REQ-2026-164 — 업그레이드 축 등록부 ↔ 정본 문서.
 *
 * 🔴 **왜 필요한가**: REQ-2026-161 이 명령 표면 축을 추가하며 `docs/upgrade.*` 만 고치고 README 를
 *    빠뜨렸다. 축을 늘린 사람이 문서 네 곳을 기억해야 하는 구조라, 기억에 기대는 한 또 갈라진다.
 *
 * 🔴 **문구를 통째로 고정하지 않는다.** 설명 열은 다듬을 수 있어야 한다 — 고정하면 사소한 표현 변경마다
 *    red 가 되어 사람이 가드를 끈다. 고정하는 것은 **축 id · 진단 토큰 · 조치 명령** 뿐이다.
 */
describe('[upgrade-axes] 등록부 자체의 계약', () => {
  it('🔴 오라클이 공허하지 않다 — 축이 실재하고 체크 id 목록도 비어 있지 않다', () => {
    expect(UPGRADE_AXES.length).toBeGreaterThan(5)
    expect(CHECK_IDS.length).toBeGreaterThan(3)
    expect(D_CHECK_IDS.length).toBeGreaterThan(10)
  })

  it('축 id 가 중복되지 않는다', () => {
    const ids = UPGRADE_AXES.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('🔴 diagnostics 가 비지 않는다 — 빈 배열은 "진단 없음"과 "아직 안 적음"을 구분하지 못한다', () => {
    for (const a of UPGRADE_AXES) expect(a.diagnostics.length, a.id).toBeGreaterThan(0)
  })

  it('🔴 kind=check 인 진단 id 는 실재한다 — 없는 체크를 가리키는 문서를 만들지 않는다', () => {
    const known = new Set<string>([...D_CHECK_IDS, ...CHECK_IDS])
    for (const a of UPGRADE_AXES)
      for (const d of a.diagnostics)
        if (d.kind === 'check') expect(known.has(d.id), `${a.id} → ${d.id}`).toBe(true)
  })

  it('remedy·remedyToken 이 비어 있지 않다', () => {
    for (const a of UPGRADE_AXES) {
      expect(a.remedy.trim().length, a.id).toBeGreaterThan(0)
      expect(a.remedyToken.trim().length, a.id).toBeGreaterThan(0)
    }
  })

  it('🔴 remedyToken 이 언어 독립이다 — 한글이 섞이면 영문 문서가 담을 수 없다', () => {
    for (const a of UPGRADE_AXES) expect(/[가-힣]/.test(a.remedyToken), a.id).toBe(false)
  })
})

describe.each(DOCS)('[upgrade-axes] 정본 문서 $rel 가 모든 축을 표에 담는다', ({ rel }) => {
  const body = read(rel)
  const region = tableRegion(body)
  const rows = tableRows(region)

  it('마커 쌍과 표 구역이 있다', () => {
    expect(body).toContain(AXES_TABLE_MARKER.open)
    expect(body).toContain(AXES_TABLE_MARKER.close)
    expect(region.trim().length).toBeGreaterThan(0)
  })

  it('🔴 표 행 개수 == 등록부 축 개수(문서에만 있는 유령 축 차단)', () => {
    expect(rows.length).toBe(UPGRADE_AXES.length)
  })

  for (const axis of UPGRADE_AXES) {
    it(`${axis.id} — 행이 정확히 하나이고 진단·조치를 담는다`, () => {
      const matched = rowFor(rows, axis)
      expect(matched.length, `${axis.id} 행 수`).toBe(1)
      const row = matched[0] as string
      // 🔴 진단 **전부**를 담아야 한다 — 하나를 다른 실재 id 로 바꾸고 문서를 안 고치면 red 다.
      for (const d of axis.diagnostics) expect(row, `${axis.id} 진단 ${diagnosisTokens(d)}`).toContain(diagnosisTokens(d))
      // 🔴 **언어 독립 토큰**만 고정한다 — 산문 조치는 한/영이 각자 번역하므로 정확 비교가 불가능하다.
      expect(row, `${axis.id} 조치`).toContain(axis.remedyToken)
    })
  }
})
