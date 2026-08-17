import { describe, it, expect } from 'vitest'
import {
  evaluateUpgradeAxes,
  axesNeedingAction,
  countByKind,
  type UpgradeStatusInput,
} from '../../scripts/req/lib/upgrade-status'
import { UPGRADE_AXES } from '../../scripts/req/lib/upgrade-axes'
import { expectedReqScripts } from '../../scripts/req/lib/command-surface'

/**
 * REQ-2026-165 phase-2 — 업그레이드 축 판정.
 *
 * 🔴 헤드라인 단언 셋:
 *   1. **축 목록이 등록부에서 나온다** — 축을 늘리면 결과가 따라 늘고, 판정기를 빠뜨리면 `unknown` 으로 **드러난다**.
 *   2. **판정 불가는 `action` 이 아니다** — 모르는 것을 "조치 필요"로 말하면 사용자가 없는 문제를 고치려 한다.
 *   3. **dogfood 는 자산 축을 보지 않는다** — `doctor` D20/D21/D22 와 같은 기준.
 */

/** 모든 축이 `ok` 로 나오는 정상 입력. 각 테스트가 필요한 축만 덮어쓴다. */
const healthy = (over: Partial<UpgradeStatusInput> = {}): UpgradeStatusInput => ({
  packageRootDiffers: true,
  packageScripts: { ...expectedReqScripts(), build: 'vite build' },
  packagedSchemaSha: 'SHA',
  vendoredSchemaSha: 'SHA',
  schemaPathIsDefault: true,
  unprotectedScratch: [],
  quickstartBackfill: [],
  personaState: 'in-sync',
  contractClaimFiles: [],
  installSignals: ['req.config.json', 'machine.schema.json'],
  ...over,
})

const state = (input: UpgradeStatusInput, id: string) => evaluateUpgradeAxes(input).find((r) => r.axis.id === id)?.state

describe('[upgrade-status] 등록부에서 파생된다', () => {
  it('🔴 결과가 등록부의 축 전부이고 순서도 같다', () => {
    const reports = evaluateUpgradeAxes(healthy())
    expect(reports.map((r) => r.axis.id)).toEqual(UPGRADE_AXES.map((a) => a.id))
    expect(reports.length).toBeGreaterThan(5) // 오라클이 공허하지 않음을 고정
  })

  it('🔴 모든 축에 판정기가 있다 — 없으면 unknown("판정기 미등록")으로 드러난다', () => {
    const missing = evaluateUpgradeAxes(healthy())
      .filter((r) => r.state.kind === 'unknown' && r.state.detail.includes('판정기 미등록'))
      .map((r) => r.axis.id)
    expect(missing, `판정기 없는 축: ${missing.join(', ')}`).toEqual([])
  })

  it('각 결과가 축의 조치(remedy)를 함께 들고 있다 — 호출부가 안내를 만들 수 있다', () => {
    for (const r of evaluateUpgradeAxes(healthy())) expect(r.axis.remedy.length, r.axis.id).toBeGreaterThan(0)
  })
})

describe('[upgrade-status] 정상 입력에서는 조치가 없다', () => {
  it('caret 을 뺀 모든 축이 ok 이고, caret 은 manual 이다', () => {
    const reports = evaluateUpgradeAxes(healthy())
    expect(axesNeedingAction(reports)).toEqual([])
    expect(state(healthy(), 'caret-range')?.kind).toBe('manual')
    const c = countByKind(reports)
    expect(c.action).toBe(0)
    expect(c.manual).toBe(1)
    expect(c.unknown).toBe(0)
  })
})

describe('[upgrade-status] 축별 조치 판정', () => {
  it('req-scripts — 없는 verb 를 이름으로 말한다', () => {
    const partial = { ...expectedReqScripts() }
    delete partial['req:delegate']
    const s = state(healthy({ packageScripts: partial }), 'req-scripts')
    expect(s?.kind).toBe('action')
    expect(s?.detail).toContain('req:delegate')
  })

  it('vendored-schema — sha 가 다르면 조치', () => {
    expect(state(healthy({ vendoredSchemaSha: 'OTHER' }), 'vendored-schema')?.kind).toBe('action')
  })

  it('vendored-schema — custom schemaPath 는 unmanaged(조치 아님)', () => {
    const s = state(healthy({ schemaPathIsDefault: false, vendoredSchemaSha: 'OTHER' }), 'vendored-schema')
    expect(s?.kind).toBe('ok')
    expect(s?.detail).toContain('custom')
  })

  it('workflow-gitignore — 보호되지 않는 경로를 나열한다', () => {
    const s = state(healthy({ unprotectedScratch: ['workflow/.review-calls.jsonl'] }), 'workflow-gitignore')
    expect(s?.kind).toBe('action')
    expect(s?.detail).toContain('.review-calls.jsonl')
  })

  it('managed-blocks — 드리프트 파일을 나열한다', () => {
    const s = state(healthy({ quickstartBackfill: [{ rel: 'CLAUDE.md' }] }), 'managed-blocks')
    expect(s?.kind).toBe('action')
    expect(s?.detail).toContain('CLAUDE.md')
  })

  it('review-persona — 부재와 차이를 구분해 말한다', () => {
    expect(state(healthy({ personaState: 'missing' }), 'review-persona')?.detail).toContain('부재')
    expect(state(healthy({ personaState: 'differs' }), 'review-persona')?.detail).toContain('다름')
    expect(state(healthy({ personaState: 'unmanaged' }), 'review-persona')?.kind).toBe('ok')
  })

  it('contract-claims — 폐기 서술이 남은 파일을 나열한다', () => {
    const s = state(healthy({ contractClaimFiles: ['AGENTS.md'] }), 'contract-claims')
    expect(s?.kind).toBe('action')
    expect(s?.detail).toContain('AGENTS.md')
  })
})

describe('[upgrade-status] mixed-install — 순수 Stage A 는 결함이 아니다', () => {
  const stageA = Object.fromEntries(Object.keys(expectedReqScripts()).map((k) => [k, `tsx scripts/req/${k.slice(4)}.ts`]))

  it('🔴 순수 Stage A 는 ok — D19 와 같은 판정이다', () => {
    expect(state(healthy({ packageScripts: stageA }), 'mixed-install')?.kind).toBe('ok')
  })

  it('🔴 섞였을 때만 조치다', () => {
    const mixed = { ...stageA, 'req:new': 'commitgate req:new' }
    const s = state(healthy({ packageScripts: mixed }), 'mixed-install')
    expect(s?.kind).toBe('action')
    expect(s?.detail).toContain('섞여')
  })

  it('dogfood 여도 설치 모드는 본다(자산 축이 아니다)', () => {
    const mixed = { ...stageA, 'req:new': 'commitgate req:new' }
    expect(state(healthy({ packageRootDiffers: false, packageScripts: mixed }), 'mixed-install')?.kind).toBe('action')
  })
})

describe('[upgrade-status] 🔴 판정 불가는 action 이 아니다', () => {
  it('🔴 새 필드(installSignals) 미수집도 unknown — 하위호환 통과로 읽지 않는다', () => {
    // REQ-2026-166 DEC-1. `undefined` 를 "가드 통과"로 읽으면 미수집을 기본값으로 읽는 것이고,
    // 그것이 phase-2 r01 P1 에서 잡힌 결함이다.
    const reports = evaluateUpgradeAxes(healthy({ installSignals: undefined }))
    expect(axesNeedingAction(reports)).toEqual([])
    for (const id of ['req-scripts', 'vendored-schema', 'workflow-gitignore', 'managed-blocks', 'review-persona'])
      expect(reports.find((r) => r.axis.id === id)?.state.kind, id).toBe('unknown')
  })

  it('미수집(undefined)은 unknown', () => {
    const bare: UpgradeStatusInput = {}
    const reports = evaluateUpgradeAxes(bare)
    expect(axesNeedingAction(reports)).toEqual([])
    // caret 은 언제나 manual, 나머지는 unknown
    expect(countByKind(reports).manual).toBe(1)
    expect(countByKind(reports).unknown).toBe(reports.length - 1)
  })

  it('🔴 축의 전제가 미수집이면 unknown — 미수집을 기본값으로 읽지 않는다(phase-2 r01 P1)', () => {
    // schemaPathIsDefault 만 빠진 조합: sha 가 달라도 custom 경로일 수 있으므로 조치라고 말할 수 없다.
    const s = evaluateUpgradeAxes({
      packageRootDiffers: true,
      packagedSchemaSha: 'new',
      vendoredSchemaSha: 'old',
    }).find((r) => r.axis.id === 'vendored-schema')?.state
    expect(s?.kind).toBe('unknown')
  })

  it('읽기 실패(null)도 unknown — "부족"으로 세지 않는다', () => {
    expect(state(healthy({ packageScripts: null }), 'req-scripts')?.kind).toBe('unknown')
    expect(state(healthy({ packagedSchemaSha: null }), 'vendored-schema')?.kind).toBe('unknown')
    expect(state(healthy({ personaState: null }), 'review-persona')?.kind).toBe('unknown')
  })
})

describe('[upgrade-status] 🔴 dogfood 는 설치 자산 축을 점검하지 않는다', () => {
  it('D20/D21/D22 와 같은 기준으로 ok(점검 불요)', () => {
    const dog = healthy({
      packageRootDiffers: false,
      packageScripts: {},
      vendoredSchemaSha: 'OTHER',
      unprotectedScratch: ['x'],
      quickstartBackfill: [{ rel: 'CLAUDE.md' }],
      personaState: 'missing',
    })
    for (const id of ['req-scripts', 'vendored-schema', 'workflow-gitignore', 'managed-blocks', 'review-persona']) {
      const s = state(dog, id)
      expect(s?.kind, id).toBe('ok')
      expect(s?.detail, id).toContain('dogfood')
    }
  })

  it('🔴 계약 문서 축은 dogfood 여도 본다 — 자산이 아니라 문구다', () => {
    expect(state(healthy({ packageRootDiffers: false, contractClaimFiles: ['AGENTS.md'] }), 'contract-claims')?.kind).toBe('action')
  })
})

/**
 * REQ-2026-166 DEC-1 — 설치가 아닌 곳에서 자산 축은 **모른다**고 말한다.
 *
 * 🔴 실측 결함: 빈 디렉터리에서 `check` 가 `review-persona : persona 부재 → sync --persona` 를 냈다.
 *    `planSync` 는 persona 부재를 설치본이든 아니든 복원 대상으로 보고하기 때문이다. 나머지 축이
 *    안전했던 것은 입력이 비어 자연히 unknown 이 된 **우연**이었다.
 */
describe('[upgrade-status] 🔴 설치 신호가 없으면 자산 축은 판정 대상이 아니다', () => {
  const ASSET_AXES = ['req-scripts', 'vendored-schema', 'workflow-gitignore', 'managed-blocks', 'review-persona']

  it('🔴 신호 0 — 자산 축 다섯이 전부 unknown 이고 조치가 없다', () => {
    // persona 부재까지 실려 있어도(= 실측 재현 입력) 조치가 되어선 안 된다.
    const reports = evaluateUpgradeAxes(healthy({ installSignals: [], personaState: 'missing' }))
    expect(axesNeedingAction(reports)).toEqual([])
    for (const id of ASSET_AXES) {
      const s = reports.find((r) => r.axis.id === id)?.state
      expect(s?.kind, id).toBe('unknown')
      expect(s?.detail, id).toContain('설치 신호 없음')
    }
  })

  it('🔴 신호 1개면 판정한다 — MIN_INSTALL_SIGNALS(2)를 쓰지 않는다(부분 설치를 숨기지 않는다)', () => {
    const s = state(healthy({ installSignals: ['req.config.json'], personaState: 'missing' }), 'review-persona')
    expect(s?.kind).toBe('action')
  })

  it('🔴 과잉 완화가 아니다 — 신호가 있으면 persona 부재는 **여전히** 조치다', () => {
    const reports = evaluateUpgradeAxes(healthy({ personaState: 'missing' }))
    expect(axesNeedingAction(reports).map((r) => r.axis.id)).toEqual(['review-persona'])
  })

  it('읽지 못함(null)은 "신호 없음"과 구분해 말한다', () => {
    const s = state(healthy({ installSignals: null }), 'review-persona')
    expect(s?.kind).toBe('unknown')
    expect(s?.detail).toContain('읽지 못함')
  })

  it('자산이 아닌 두 축은 이 전제를 두지 않는다 — 조건 자체가 설치를 함의한다', () => {
    const bare = healthy({ installSignals: [], contractClaimFiles: ['AGENTS.md'] })
    expect(state(bare, 'contract-claims')?.kind).toBe('action')
    expect(state(bare, 'mixed-install')?.kind).toBe('ok')
  })
})
