/**
 * REQ-2026-157 — **문서가 `setup` 을 정확히 말하는지 소스와 대조한다.**
 *
 * 🔴 `setup` 질문이 3개 → 4개로 늘고 `stopGate` 에 `auto` 가 생겼는데, 설치·빠른 시작·보장 문서가
 *    옛 전제를 유지했다. 원인은 **같은 사실을 여러 문서가 각자 적어 둔 것**이다.
 *
 * 🔴 **문서끼리 비교하지 않는다** — 그러면 둘 다 틀린 채로 통과한다. 정본은 **코드**다.
 * 🔴 **산문을 정규식으로 파싱하지 않는다.** 마크다운 표의 행만 센다 — 산문 파서를 만들면 그 파서가
 *    다음 결함이 된다(REQ-2026-041: 손수 검증 oracle 은 바닥이 없다).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildQuestions } from '../../bin/setup'
import { CONFIG_SCHEMA } from '../../scripts/req/lib/config'

const read = (p: string): string => readFileSync(join(process.cwd(), p), 'utf8')

/** `setup이 묻는 것` 절의 질문 표에서 **데이터 행**만 뽑는다(헤더·구분선 제외). */
function questionRows(md: string): string[] {
  const lines = md.split(/\r?\n/)
  // 표는 `| 질문 |` 또는 `| Question |` 헤더로 시작한다.
  const head = lines.findIndex((l) => /^\|\s*(질문|Question)\s*\|/.test(l))
  expect(head, '질문 표를 찾지 못했다').toBeGreaterThan(-1)
  const out: string[] = []
  for (let i = head + 2; i < lines.length; i++) {
    const l = lines[i] ?? ''
    if (!l.startsWith('|')) break
    out.push(l)
  }
  return out
}

/** 표 행에서 설정 키(백틱 안의 코드)를 찾는다 — 행을 **키로 식별**하기 위함이다. */
function rowFor(rows: string[], key: string): string {
  const hit = rows.find((r) => r.includes(`\`${key}\``))
  expect(hit, `표에 \`${key}\` 행이 없다`).toBeTruthy()
  return hit as string
}

const enumOf = (path: string[]): string[] => {
  let node: Record<string, unknown> = CONFIG_SCHEMA as unknown as Record<string, unknown>
  for (const seg of path) {
    const props = node.properties as Record<string, unknown> | undefined
    node = (props?.[seg] ?? {}) as Record<string, unknown>
  }
  const en = node.enum
  expect(Array.isArray(en), `${path.join('.')} 에 enum 이 없다`).toBe(true)
  return en as string[]
}

const DOCS = [
  ['docs/quick-start.md', 'ko'],
  ['docs/quick-start.en.md', 'en'],
] as const

describe('[REQ-2026-157] setup 문서 정합 — 소스가 정본', () => {
  const expectedCount = buildQuestions({}).length

  it('🔴 setup 은 실제로 4개를 묻는다(이 테스트의 전제를 먼저 고정한다)', () => {
    expect(expectedCount).toBe(4)
  })

  for (const [doc, lang] of DOCS) {
    it(`🔴 ${lang}: 질문 표의 행 수가 실제 질문 수와 같다`, () => {
      expect(questionRows(read(doc)).length, doc).toBe(expectedCount)
    })

    /**
     * 🔴 행 수와 `stopGate` 만 보면 **부족하다**(설계 r01 P1): 네 번째 행에서 `auto` 를 지워도
     *    행 수는 4이고 `stopGate` 행은 그대로라 전부 통과한다. **선택지를 적는 행은 키로 결속**한다.
     */
    for (const [key, path] of [
      ['stopGate', ['stopGate']],
      ['reviewBudget.onSoftLimit', ['reviewBudget', 'onSoftLimit']],
    ] as [string, string[]][]) {
      it(`🔴 ${lang}: \`${key}\` 행이 스키마의 모든 선택지를 적는다`, () => {
        const row = rowFor(questionRows(read(doc)), key)
        for (const choice of enumOf(path)) expect(row, `${doc} · ${key} · ${choice}`).toContain(`\`${choice}\``)
      })

      /**
       * 🔴 **선택지만 보면 부족하다**(phase-1 r01 P1). 소스의 **기본값**이 `req`→`phase` 나
       *    `ask`→`auto` 로 바뀌어도 enum 이 그대로면 위 검사는 통과한다 — 그러면 setup 은 새
       *    기본값을 쓰는데 문서는 옛 값을 광고한다. **기본값 칸까지 소스와 결속**한다.
       */
      it(`🔴 ${lang}: \`${key}\` 행의 기본값 칸이 소스의 기본값과 같다`, () => {
        const q = buildQuestions({}).find((x) => x.key === key)
        expect(q, `${key} 질문이 없다`).toBeTruthy()
        expect(q!.currentIsDefault, `${key} 가 기본값 상태가 아니다(테스트 전제)`).toBe(true)
        const cells = rowFor(questionRows(read(doc)), key)
          .split('|')
          .map((c) => c.trim())
          .filter((c) => c !== '')
        // 표는 `| 질문 | 기본값 | 선택지 |` 3칸이다 — 가운데가 기본값이다.
        expect(cells.length, `${doc} · ${key} 행의 칸 수`).toBe(3)
        expect(cells[1], `${doc} · ${key} 기본값 칸`).toBe(`\`${q!.current}\``)
      })
    }

    it(`🔴 ${lang}: 두 축을 구분해 설명한다 — 안전(stopGate) vs 비용(onSoftLimit)`, () => {
      const md = read(doc)
      // 🔴 `auto` 를 "안전을 끄는 옵션"으로 오해하지 않게 하되, **없어지는 것도 감추지 않는다**.
      expect(md, doc).toContain('reviewBudget.onSoftLimit')
      expect(md, doc).toMatch(lang === 'ko' ? /사람 예외 승인/ : /human exception approval/)
    })

    /**
     * 🔴 **회차 번호로 쓰지 않는다**(설계 r02 P1). 소프트 한도는 **판정이 나온 횟수**, `hardCap` 은
     *    **실제 호출 횟수**를 센다 — 무효 응답이 하나 있으면 6번째 호출도 자동 통과한다.
     */
    it(`🔴 ${lang}: "6~8회" 같은 회차 번호로 단정하지 않는다`, () => {
      const md = read(doc)
      for (const bad of ['6~8회', '6–8', 'rounds 6', 'round 9', '9회부터'])
        expect(md, `${doc} — "${bad}" 는 계수 기준을 오해하게 한다`).not.toContain(bad)
    })
  }

  it('🔴 한/영이 같은 개수를 말한다', () => {
    expect(questionRows(read('docs/quick-start.md')).length).toBe(questionRows(read('docs/quick-start.en.md')).length)
  })

  /** 🔴 상세 표는 quick-start 한 곳에만 — 복제가 이번 결함의 원인이다. */
  it('🔴 README·guarantees·agent-prompt 는 setup 질문 표를 복제하지 않는다', () => {
    for (const doc of [
      'README.md',
      'README.en.md',
      'docs/guarantees.md',
      'docs/guarantees.en.md',
      'docs/agent-prompt.md',
      'docs/agent-prompt.en.md',
    ])
      expect(read(doc).split(/\r?\n/).filter((l) => /^\|\s*(질문|Question)\s*\|/.test(l)).length, doc).toBe(0)
  })

  it('🔴 README(한/영)가 질문 개수를 옛 값(세 개)으로 말하지 않는다', () => {
    expect(read('README.md')).not.toContain('질문은 세 개')
    expect(read('README.en.md')).not.toContain('three questions')
  })

  it('🔴 agent-prompt(한/영)의 setup 설명에 리뷰 예산이 있다', () => {
    expect(read('docs/agent-prompt.md')).toContain('reviewBudget.onSoftLimit')
    expect(read('docs/agent-prompt.en.md')).toContain('reviewBudget.onSoftLimit')
  })

  /** 🔴 보장 문서에 설정 종속을 절대 규칙처럼 적지 않는다. */
  it('🔴 guarantees(한/영)가 onSoftLimit 축을 반영한다', () => {
    for (const doc of ['docs/guarantees.md', 'docs/guarantees.en.md']) {
      const md = read(doc)
      expect(md, doc).toContain('onSoftLimit')
      expect(md, doc).toContain('hardCap')
    }
  })
})
