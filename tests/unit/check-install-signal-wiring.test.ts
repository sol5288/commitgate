import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectUpgradeStatusInput } from '../../bin/check'
import { evaluateUpgradeAxes, axesNeedingAction } from '../../scripts/req/lib/upgrade-status'
import { collectInstallSignals } from '../../scripts/req/lib/setup-gate'

/**
 * REQ-2026-166 DEC-1 — **배선** 가드(G5).
 *
 * 🔴 순수 테스트는 `installSignals` 를 손으로 넣는다. 수집부가 그 필드를 채우지 않으면 실제 `check` 는
 *    `undefined` 를 넘겨 전 자산 축이 `unknown` 이 되거나(조용한 기능 상실) 옛 코드로 되돌아가도
 *    순수 테스트는 green 이다. **배선 끊김은 순수 테스트가 못 잡는다** — 이 저장소에서 3연속 실증됐다.
 *
 * 그래서 여기서는 **진짜 디렉터리**를 만들어 수집부를 그대로 돌린다.
 */
describe('[check] 업그레이드 축 입력이 설치 신호를 채운다', () => {
  let bare = ''
  let installed = ''

  beforeAll(() => {
    bare = mkdtempSync(join(tmpdir(), 'cg166-bare-'))

    installed = mkdtempSync(join(tmpdir(), 'cg166-inst-'))
    // 신호 둘: req.config.json · workflow/machine.schema.json. persona 는 일부러 만들지 않는다
    // (수정 前 결함이 났던 바로 그 상태를 "설치본"으로 재현한다).
    writeFileSync(join(installed, 'req.config.json'), '{}\n', 'utf8')
    mkdirSync(join(installed, 'workflow'), { recursive: true })
    writeFileSync(join(installed, 'workflow', 'machine.schema.json'), '{}\n', 'utf8')
  })

  afterAll(() => {
    for (const d of [bare, installed]) if (d) rmSync(d, { recursive: true, force: true })
  })

  it('🔴 오라클이 공허하지 않다 — 술어가 두 디렉터리를 실제로 다르게 본다', () => {
    expect(collectInstallSignals(bare, 'workflow')).toEqual([])
    expect(collectInstallSignals(installed, 'workflow').length).toBeGreaterThan(0)
  })

  it('🔴 빈 디렉터리 — 수집부가 신호를 채우고(빈 배열), 조치가 하나도 없다', () => {
    const input = collectUpgradeStatusInput(bare)
    // `undefined` 면 배선이 끊긴 것이다. 빈 배열이어야 "읽었고 없었다"이다.
    expect(input.installSignals).toEqual([])
    expect(axesNeedingAction(evaluateUpgradeAxes(input)).map((r) => r.axis.id)).toEqual([])
  })

  it('🔴 신호가 있는 디렉터리에서는 판정이 살아 있다 — 전제가 축을 통째로 재우지 않는다', () => {
    const input = collectUpgradeStatusInput(installed)
    expect(input.installSignals?.length).toBeGreaterThan(0)
    const ids = axesNeedingAction(evaluateUpgradeAxes(input)).map((r) => r.axis.id)
    // persona 가 없는 설치본이므로 그 축은 **여전히** 조치여야 한다(과잉 완화 검출).
    expect(ids).toContain('review-persona')
  })
})
