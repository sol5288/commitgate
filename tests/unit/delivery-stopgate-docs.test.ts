/**
 * REQ-2026-161 phase-5 — 묶음(delivery)의 `stopGate` 조건 서술이 코드와 갈라지지 않는가.
 *
 * 🔴 **왜 필요한가**: `defersToIntegration`(`'merge' | 'auto'`)이 코드의 정본인데, 문서 3곳(한/영
 *    `workflow`, `delivery --help`)이 묶음을 **`merge` 전용**인 것처럼 적어 두었다. 그래서 `auto`
 *    사용자는 정지를 가장 크게 줄이는 조합(`auto` + 묶음)을 문서에서 볼 수 없었다.
 *
 * 🔴 **새 절 추가는 갱신이 아니다**(REQ-2026-073). 안전·정지 속성을 바꾸는 서술은 **전수**로 고쳐야
 *    하므로, 여기서는 "`auto`가 함께 적혔는가"뿐 아니라 **묶음 문맥에 `merge` 단독 서술이 남았는가**도
 *    본다. 한쪽만 검사하면 절반만 지킨다.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defersToIntegration, DEFAULTS, type StopGate } from '../../scripts/req/lib/config'
import { planIntegration, type IntegrationFacts } from '../../scripts/req/lib/merge-gate'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), 'utf8')

/** 묶음이 동작하는 `stopGate` 값 — **코드에서 파생**한다(문서와 대조할 기대값을 손으로 적지 않는다). */
const DEFERRING: StopGate[] = (['phase', 'req', 'merge', 'auto'] as StopGate[]).filter((v) => defersToIntegration(v))

describe('[delivery] 묶음의 stopGate 서술이 코드와 같다', () => {
  it('🔴 코드의 정본은 merge 와 auto 둘이다(오라클이 공허해지지 않게 먼저 고정)', () => {
    expect(DEFERRING).toEqual(['merge', 'auto'])
  })

  for (const rel of ['docs/workflow.md', 'docs/workflow.en.md']) {
    it(`${rel} 의 delivery 절이 두 값을 모두 적는다`, () => {
      const body = read(rel)
      const start = body.indexOf('## delivery set')
      expect(start, 'delivery 절을 찾지 못했다').toBeGreaterThan(-1)
      const next = body.indexOf('\n## ', start + 1)
      const section = body.slice(start, next < 0 ? undefined : next)
      for (const v of DEFERRING) expect(section, `${rel} 에 ${v} 서술 없음`).toContain(`\`${v}\``)
      // 사전 위임이 `auto` 의 조건임을 말해야 실행 가능한 안내다.
      expect(section).toContain('req:delegate')
      expect(section).toContain('delivery:')
      // 🔴 위임이 묶음 통합에 쓰이는 **조건**(branchPrefix)까지 적어야 실행 가능한 안내다.
      expect(section).toContain('branchPrefix')
    })

    /**
     * 🔴 **`merge` 라는 단어를 금지하는 것이 아니다**(그러면 `auto` 와 대비하는 정확한 문장까지 막는다).
     *    옛 주장은 "묶음은 `merge` 전용"이었으므로, 검사할 것은 **`merge` 를 말하면서 `auto` 를
     *    빠뜨린 덩어리가 남았는가** 다. 한 덩어리 = 하나의 불릿 또는 문단.
     */
    it(`🔴 ${rel} 의 delivery 절에 merge 단독 서술이 남아 있지 않다`, () => {
      const body = read(rel)
      const start = body.indexOf('## delivery set')
      const next = body.indexOf('\n## ', start + 1)
      const section = body.slice(start, next < 0 ? undefined : next)
      const blocks = section.split(/\n(?=- |\n)/)
      const offenders = blocks.filter((b) => b.includes('stopGate: "merge"') && !b.includes('auto'))
      expect(offenders, `merge 만 말하는 덩어리 ${offenders.length}건`).toEqual([])
    })
  }

  it('🔴 delivery --help 도 두 값을 적는다(문서만 고치면 CLI 가 옛 주장을 계속 말한다)', () => {
    const src = read('bin/delivery.ts')
    const start = src.indexOf('export function printHelp')
    expect(start).toBeGreaterThan(-1)
    const help = src.slice(start, src.indexOf('`)', start))
    for (const v of DEFERRING) expect(help, `help 에 ${v} 서술 없음`).toContain(v)
    expect(help).not.toContain('stopGate: "merge"')
    // 🔴 help 안에서 위임의 적용 범위가 모순되지 않아야 한다(phase-5 r04 P1).
    expect(help).toContain('기본 설정에서 쓰이지 않습니다')
  })

  /**
   * 🔴 **3회의 "구성"까지 본다**(phase-5 r01 P1). 앞선 판은 `seal`·`approve`·(auto면)위임 만 열거해
   *    `merge` 경로의 **통합 승인**을 빠뜨렸다 — 그러면 merge 사용자는 2회로 읽고, 실제 절차와 어긋난다.
   */
  it('정지 회계 3회와 그 구성을 한/영 문서가 말한다', () => {
    const ko = read('docs/workflow.md')
    expect(ko).toContain('3회로 고정')
    expect(ko).toContain('통합 승인')
    const en = read('docs/workflow.en.md')
    expect(en).toContain('fixed at three')
    expect(en).toContain('integration approval')
  })

  /**
   * 🔴 **문자열이 아니라 동작으로 묶는다**(phase-5 r03 P1). 앞선 판은 "`auto` 면 `commitgate integrate`
   *    가 delivery→main 을 수행한다"고 적었는데, **기본 설정에서 실행 불가능**했다 —
   *    `commitgate integrate` 는 feature→trunk 명령이고 `merge-gate` 전제가 `branchPrefix` 를 요구한다.
   *    정적 문자열 검사는 이런 실행 가능성 위반을 못 잡는다(리뷰어 observation). 그래서 전제 자체를 본다.
   */
  it('🔴 기본 branchPrefix 에서 delivery 브랜치는 integrate 전제에서 걸러진다 — 문서가 약속하지 않아야 하는 것', () => {
    const facts: IntegrationFacts = {
      currentBranch: 'delivery/payment-improvement',
      trunkBranch: 'main',
      branchPrefix: DEFAULTS.branchPrefix,
      worktreeClean: true,
      mergeInProgress: false,
      rebaseInProgress: false,
      trunkExists: true,
      verify: null,
    }
    const plan = planIntegration(facts)
    expect(plan.ok).toBe(false)
    expect(plan.problems.join(' | ')).toContain('feature 브랜치가 아닙니다')

    // 대비: 표준 feature 브랜치는 이 전제를 통과한다(오라클이 공허하지 않음을 고정).
    const featurePlan = planIntegration({ ...facts, currentBranch: `${DEFAULTS.branchPrefix}2026-161-x` })
    expect(featurePlan.problems.join(' | ')).not.toContain('feature 브랜치가 아닙니다')
  })

  it('🔴 그래서 문서·help 가 auto 에서 도구가 delivery→main 을 병합한다고 약속하지 않는다', () => {
    const ko = read('docs/workflow.md')
    const en = read('docs/workflow.en.md')
    const src = read('bin/delivery.ts')
    const start = src.indexOf('export function printHelp')
    const help = src.slice(start, src.indexOf('`)', start))
    // 실행 불가능한 약속의 형태: "auto 이면 commitgate integrate 가 (묶음을) 수행한다"
    for (const [label, body] of [['ko', ko], ['en', en], ['help', help]] as const) {
      const idx = body.indexOf('## delivery set') >= 0 ? body.indexOf('## delivery set') : 0
      const section = body.slice(idx)
      const bad = new RegExp('auto[^\\n]{0,120}commitgate integrate[^\\n]{0,120}(수행|performs)').test(section)
      expect(bad, `${label} 에 실행 불가능한 auto 통합 약속이 남아 있다`).toBe(false)
    }
    // 대신 "사람이 통제점에서 한다"를 말해야 한다.
    expect(ko).toContain('통제점표(I1/I2/B1)에서 사람이 실행합니다')
    expect(en).toContain('performed by a human at the existing control points')
  })

  /**
   * 🔴 **HIGH 예외를 회계가 말하는가**(phase-5 r02 P1). `bin/delivery.ts` 의 통합 자격 검사는
   *    `defersToIntegration`(= `merge`·`auto` 둘 다)에서 HIGH member 에게 `req:confirm --scope delivery`
   *    를 **따로** 요구한다. `--high-risk` 위임으로도 대체되지 않으므로 그 묶음은 3회가 아니다.
   *    "3회 고정"만 적으면 사용자가 문서대로 하다가 필수 확인에서 막힌다.
   */
  it('🔴 HIGH member 예외를 한/영 문서와 help 가 모두 적는다', () => {
    const ko = read('docs/workflow.md')
    expect(ko).toContain('req:confirm --scope delivery')
    expect(ko).toContain('3 + HIGH member 수')
    expect(ko).toContain('--high-risk')
    const en = read('docs/workflow.en.md')
    expect(en).toContain('req:confirm --scope delivery')
    expect(en).toContain('three plus one per HIGH member')
    expect(en).toContain('--high-risk')
    const src = read('bin/delivery.ts')
    const start = src.indexOf('export function printHelp')
    const help = src.slice(start, src.indexOf('`)', start))
    expect(help).toContain('req:confirm --scope delivery')
    expect(help).toContain('HIGH member')
  })

  /**
   * 🔴 **"하지 않는 일"이 auto 예외와 모순되지 않는가**(phase-5 r01 P1). help 가 한쪽에서
   *    "위임이 있으면 다시 묻지 않는다"고 하고 다른 쪽에서 "병합은 언제나 사람이 한다"고 하면,
   *    auto 사용자는 계약과 반대되는 안내를 받는다.
   */
  it('🔴 delivery --help 의 "하지 않는 일"이 auto 경로를 함께 적는다', () => {
    const src = read('bin/delivery.ts')
    const start = src.indexOf('export function printHelp')
    const help = src.slice(start, src.indexOf('`)', start))
    const notDoing = help.slice(help.indexOf('하지 않는 일:'))
    expect(notDoing).toContain('auto')
    expect(notDoing).toContain('commitgate integrate')
    // merge 경로 서술도 남아 있어야 한다(한쪽만 적으면 반대 오해가 생긴다).
    expect(notDoing).toContain('I1/I2/B1')
  })
})

/**
 * 업그레이드 문서가 **명령 표면 축**을 절차에 포함하는가(REQ-2026-161).
 *
 * 🔴 실측 결함의 절반은 "절차를 그대로 따라도 새 verb 를 못 얻는다" 였다. 진단·복구가 생겨도
 *    업그레이드 절차가 그것을 부르지 않으면 사용자는 여전히 도달하지 못한다.
 */
describe('[upgrade] 문서 절차가 명령 표면 축을 포함한다', () => {
  for (const rel of ['docs/upgrade.md', 'docs/upgrade.en.md']) {
    it(`${rel} 이 sync --scripts 와 진단(C6/D33)을 안내한다`, () => {
      const body = read(rel)
      expect(body).toContain('sync --apply --scripts')
      expect(body).toContain('C6')
      expect(body).toContain('D33')
      // 🔴 D19 로는 알 수 없다는 사실까지 적어야 사용자가 엉뚱한 곳을 보지 않는다.
      expect(body).toContain('D19')
    })
  }
})
