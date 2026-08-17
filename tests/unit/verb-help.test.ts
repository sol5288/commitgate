import { describe, it, expect } from 'vitest'
import { VERB_MODULES } from '../../bin/dispatch.mjs'
import { REQ_VERB_HELP, renderVerbHelp, wantsHelp, isContinuation, type VerbOption } from '../../scripts/req/lib/verb-help'

import { parseArgs as pNew } from '../../scripts/req/req-new'
import { parseArgs as pNext } from '../../scripts/req/req-next'
import { parseArgs as pCommit } from '../../scripts/req/req-commit'
import { parseArgs as pClose } from '../../scripts/req/req-close'
import { parseArgs as pConfirm } from '../../scripts/req/req-confirm'
import { parseArgs as pDoctor } from '../../scripts/req/req-doctor'
import { parseArgs as pRebind } from '../../scripts/req/req-rebind'
import { parseArgs as pReconstruct } from '../../scripts/req/req-reconstruct'
import { parseArgs as pRepolicy } from '../../scripts/req/req-repolicy'
import { parseArgs as pException } from '../../scripts/req/req-review-exception'
import { parseArgs as pDelegate } from '../../scripts/req/req-delegate'
import { parseArgs as pReviewCodex } from '../../scripts/req/review-codex'

/**
 * REQ-2026-166 DEC-2 — `req:*` 사용법 표면.
 *
 * 🔴 실측 결함: 12개 verb 중 11개가 `--help` 를 *"알 수 없는 옵션"* 으로 거부했다. 사람 전용 통제점
 *    명령(`req:confirm`·`req:rebind`·`req:review-exception`)이 그 안에 있었다.
 *
 * 🔴 이 파일은 **등록부와 파서의 관계**만 본다. exit code·실제 출력은 `tests/e2e/verb-help-cli.test.ts`
 *    가 진짜 진입점을 spawn 해서 본다 — 소스만 보는 가드로는 ②를 처음부터 다시 놓친다.
 */

/** `VERB_MODULES` 에서 파생 — 손으로 적지 않는다. */
const REQ_VERBS: string[] = Object.keys(VERB_MODULES).filter((v) => v.startsWith('req:'))

type Parser = (argv: string[]) => unknown

/** verb → (파서, 그 파서가 정상 파싱하는 최소 argv). */
const PARSERS: Record<string, { parse: Parser; base: string[] }> = {
  'req:new': { parse: pNew as Parser, base: ['some-slug'] },
  'req:next': { parse: pNext as Parser, base: ['2026-000'] },
  'req:commit': { parse: pCommit as Parser, base: ['2026-000'] },
  'req:close': { parse: pClose as Parser, base: ['2026-000'] },
  'req:confirm': { parse: pConfirm as Parser, base: ['2026-000'] },
  'req:doctor': { parse: pDoctor as Parser, base: ['2026-000'] },
  'req:rebind': { parse: pRebind as Parser, base: ['2026-000'] },
  'req:reconstruct': { parse: pReconstruct as Parser, base: ['2026-000'] },
  'req:repolicy': { parse: pRepolicy as Parser, base: ['2026-000'] },
  'req:review-exception': { parse: pException as Parser, base: ['2026-000'] },
  'req:delegate': { parse: pDelegate as Parser, base: [] },
  'req:review-codex': { parse: pReviewCodex as Parser, base: ['2026-000'] },
}

const NONEXISTENT = '--__상존하지_않는_플래그__'

/**
 * 🔴 **관측 문맥**. 어떤 플래그는 기본값과 같은 값을 세팅해서(예: `--dry-run` → `run=false`) base 만으로는
 *    차이가 보이지 않는다. 그 플래그를 "수용되지 않음"으로 읽으면 오라클이 틀린 것이지 코드가 틀린 게
 *    아니다. 그래서 **그 효과가 보이는 argv 접두**를 준다 — 차이를 요구하는 성질은 그대로 남는다.
 *
 * 여기 없는 플래그는 접두 없이 검사한다. 접두를 남발하면 오라클이 약해지므로 필요한 것만 적는다.
 */
const PROBE_PREFIX: Record<string, Record<string, string[]>> = {
  // `--dry-run` 은 `--run` 을 되돌리는 플래그다(기본이 이미 dry-run).
  'req:review-codex': { '--dry-run': ['--run'] },
}

/** 옵션 하나를 파서에 넣을 argv 조각. 값을 받는 플래그면 표본값을 붙인다. */
function argvFor(o: VerbOption): string[] {
  return o.value === undefined ? [o.flag] : [o.flag, o.sample ?? 'sample-value']
}

describe('[verb-help] 등록부가 명령 표면에서 파생된다', () => {
  it('🔴 오라클이 공허하지 않다 — req:* verb 가 실재한다', () => {
    expect(REQ_VERBS.length).toBeGreaterThan(10)
  })

  it('🔴 G1: VERB_MODULES 의 req:* 전부에 사용법이 있다 — 새 verb 를 더하면 자동으로 red', () => {
    const missing = REQ_VERBS.filter((v) => !REQ_VERB_HELP[v])
    expect(missing, `사용법 없는 verb: ${missing.join(', ')}`).toEqual([])
  })

  it('🔴 등록부에만 있는 유령 verb 가 없다', () => {
    const ghosts = Object.keys(REQ_VERB_HELP).filter((v) => !REQ_VERBS.includes(v))
    expect(ghosts, `명령 표면에 없는 verb: ${ghosts.join(', ')}`).toEqual([])
  })

  it('모든 verb 에 파서 표본이 등록돼 있다(G3 가 조용히 건너뛰지 않는다)', () => {
    expect(REQ_VERBS.filter((v) => !PARSERS[v])).toEqual([])
  })
})

describe.each(REQ_VERBS)('[verb-help] %s 렌더링', (verb) => {
  const body = renderVerbHelp(verb)

  it('제목에 verb 이름과 요약이 있다', () => {
    expect(body.split('\n')[0]).toContain(verb)
    expect(body.split('\n')[0]?.length).toBeGreaterThan(verb.length + 5)
  })

  it('사용법 줄이 실행 가능한 형태다', () => {
    expect(body).toContain('사용법:')
    expect(body).toContain(`npx commitgate ${verb}`)
  })

  it('등록된 옵션이 모두 본문에 보인다', () => {
    for (const o of REQ_VERB_HELP[verb]!.options) expect(body, o.flag).toContain(o.flag)
  })

  /**
   * 🔴 phase-2 r01 P1 — **여러 줄 사용법이 셸에서 그대로 실행 가능해야 한다.**
   *
   * 렌더러가 이어짐 줄에도 `npx commitgate` 를 붙였을 때, 사용자가 백슬래시로 이어진 두 줄을 붙여넣으면
   * 명령 **중간**에 `npx commitgate` 가 끼어 파서가 위치 인자 `npx` 를 거부했다. 안내가 실행 불가능해지는
   * 정확히 그 부류의 결함이다.
   */
  it('🔴 셸 이어짐을 합쳐도 명령이 하나다 — 이어짐 줄에 접두어가 붙지 않는다', () => {
    const lines = body.split('\n')
    const from = lines.indexOf('사용법:') + 1
    expect(from, '사용법 구역이 없다').toBeGreaterThan(0)
    const rest = lines.slice(from)
    const end = rest.findIndex((l) => l === '옵션:')
    const usage = (end < 0 ? rest : rest.slice(0, end)).filter((l) => l.trim().length > 0).join('\n')
    expect(usage.trim().length, '사용법 줄이 비어 있다 — 오라클이 공허하다').toBeGreaterThan(0)
    // POSIX 셸이 하는 일: 줄 끝 백슬래시 + 개행을 지우고 이어 붙인다.
    for (const cmd of usage.replace(/\\\n\s*/g, ' ').split('\n')) {
      if (!cmd.trim()) continue
      const hits = cmd.match(/npx commitgate/g) ?? []
      expect(hits.length, `합친 명령에 접두어가 ${hits.length}번: ${cmd}`).toBe(1)
      expect(cmd.trim().startsWith('npx commitgate'), cmd).toBe(true)
    }
  })

  it('등록부의 이어짐 줄 판별이 실제로 쓰인다(오라클 비공허)', () => {
    for (const u of REQ_VERB_HELP[verb]!.usage)
      if (isContinuation(u)) expect(body).toContain(u.trim())
  })
})

/**
 * 🔴 **G3 — 수용 오라클**(design r02·r03 P1).
 *
 * "소스에 그 문자열이 있는가"로는 부족하다 — 주석·오류 문구에 이름이 있어도 통과한다. 반대로 "상존하지
 * 않는 플래그는 던져야 한다"도 쓸 수 없다: `req:review-codex` 의 파서는 **permissive** 해서 매칭되지
 * 않는 `-` 인자를 조용히 무시한다(실측).
 *
 * 그래서 수용을 이렇게 정의한다 — **문서에 적힌 플래그는 파싱 결과를 바꾼다.**
 *   앵커 ① base 가 던지지 않는다        (던지면 이하 전부가 공허해진다)
 *   앵커 ② 상존하지 않는 이름은 결과를 바꾸지 않는다(또는 거부된다) — 차이의 출처를 고정한다
 */
describe.each(REQ_VERBS)('[verb-help] 🔴 G3 %s — 적힌 플래그를 파서가 실제로 수용한다', (verb) => {
  const { parse, base } = PARSERS[verb]!
  const options = REQ_VERB_HELP[verb]!.options

  it('앵커 ①: base argv 가 정상 파싱된다', () => {
    expect(() => parse([...base])).not.toThrow()
  })

  it('🔴 앵커 ②: 상존하지 않는 플래그는 결과를 바꾸지 않거나 거부된다', () => {
    const baseline = JSON.stringify(parse([...base]))
    let changed = false
    try {
      changed = JSON.stringify(parse([...base, NONEXISTENT])) !== baseline
    } catch {
      return // 거부 = 엄격한 파서. 둘 다 허용된다.
    }
    expect(changed, '상존하지 않는 이름이 결과를 바꿨다 — 이 verb 의 차이 비교는 무의미하다').toBe(false)
  })

  it('옵션이 하나 이상 등록돼 있다', () => {
    expect(options.length).toBeGreaterThan(0)
  })

  for (const o of options) {
    it(`${o.flag} — 파싱 결과를 바꾼다`, () => {
      const prefix = PROBE_PREFIX[verb]?.[o.flag] ?? []
      const baseline = JSON.stringify(parse([...base, ...prefix]))
      // 🔴 여기서 던지면 등록부가 값 유무를 틀리게 적은 것이다(예: 값이 필요합니다) — 모양까지 고정된다.
      const withFlag = JSON.stringify(parse([...base, ...prefix, ...argvFor(o)]))
      expect(withFlag, `${verb} ${o.flag} 가 파싱 결과에 아무 영향이 없다`).not.toBe(baseline)
    })
  }
})

describe('[verb-help] wantsHelp', () => {
  it('-h · --help 를 인식하고 그 밖은 아니다', () => {
    expect(wantsHelp(['-h'])).toBe(true)
    expect(wantsHelp(['2026-000', '--help'])).toBe(true)
    expect(wantsHelp(['--run'])).toBe(false)
    expect(wantsHelp([])).toBe(false)
  })
})
