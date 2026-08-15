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
import { prose } from '../helpers/md-prose'
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

/**
 * 🔴 REQ-2026-158 — 가드의 **적용 범위**를 공개 문서 전체로 넓힌다.
 *
 * REQ-2026-157 의 "회차 번호 금지" 검사는 quick-start 두 문서에만 걸려 있었다. 그래서 README 첫
 * 소개·workflow·configuration 요약 표·`AGENTS.template.md` 에 옛 표현이 그대로 남았다.
 * **가드 범위가 결함 범위보다 좁았던 것**이 원인이다.
 */
describe('[REQ-2026-158] 공개 문서 전체 — 고정 회차 표현 금지', () => {
  /**
   * 🔴 목록을 **상수로** 둔다. glob 로 훑으면 워크플로 티켓(`workflow/REQ-*`)의 과거 설계문서까지
   *    걸려 **그때의 사실을 고치라고** 요구하게 된다 — 기록은 고치지 않는다.
   */
  const PUBLIC_DOCS = [
    'README.md',
    'README.en.md',
    'docs/quick-start.md',
    'docs/quick-start.en.md',
    'docs/workflow.md',
    'docs/workflow.en.md',
    'docs/configuration.md',
    'docs/configuration.en.md',
    'docs/guarantees.md',
    'docs/guarantees.en.md',
    'AGENTS.template.md',
  ] as const

  /**
   * 🔴 축자 문자열이다 — "회차 같은 것"을 정규식으로 잡으려 들면 그 패턴이 다음 결함이 된다.
   *
   * 🔴 **`9회차`(=9번째 호출)는 금지하지 않는다.** `hardCap` 은 **호출 수**를 세므로 hardCap=8 에서
   *    "9회차는 실행하지 않는다"는 **정확한 서술**이다. 오해를 만드는 것은 **소프트 한도**를
   *    회차 번호로 말하는 쪽이다(`6~8` 등).
   */
  const BANNED = ['6~8', '6–8', 'rounds 6', '9회부터'] as const

  // 🔴 **펜스 코드 블록은 검사하지 않는다** — 그 안은 도구 출력의 축자 인용이다.
  //    구현은 `tests/helpers/md-prose.ts` 에 있다(지역 함수면 회귀 테스트가 부를 수 없다).

  for (const doc of PUBLIC_DOCS) {
    it(`🔴 ${doc} 산문에 고정 회차 표현이 없다`, () => {
      const md = prose(read(doc))
      for (const bad of BANNED)
        expect(md, `${doc} — "${bad}" 는 계수 기준(판정 수 vs 호출 수)을 오해하게 한다`).not.toContain(bad)
    })
  }
})

describe('[REQ-2026-158] 요약·템플릿이 소스와 맞는다', () => {
  /** 🔴 configuration 요약 표는 같은 파일의 상세절과 **모순되면 안 된다**(이번 결함의 한 건). */
  for (const [doc, needles] of [
    ['docs/configuration.md', ['onSoftLimit', '판정이 나온 리뷰', '실제 호출']],
    ['docs/configuration.en.md', ['onSoftLimit', 'produced a verdict', 'calls actually made']],
  ] as [string, string[]][]) {
    it(`🔴 ${doc} 요약 표가 onSoftLimit 과 두 계수 기준을 말한다`, () => {
      const row = read(doc)
        .split(/\r?\n/)
        .find((l) => l.startsWith('| `reviewBudget`'))
      expect(row, `${doc} 에 reviewBudget 요약 행이 없다`).toBeTruthy()
      for (const n of needles) expect(row as string, `${doc} · ${n}`).toContain(n)
    })
  }

  /**
   * 🔴 키 목록을 **손으로 적지 않는다** — `buildQuestions` 에서 파생한다. setup 축이 늘면 자동으로 red 다.
   *    `AGENTS.template.md` 는 설치 프로젝트로 복사되는 **에이전트 계약**이라 특히 중요하다.
   */
  const SETUP_KEYS_FROM_SOURCE = buildQuestions({}).map((q) => q.key)

  it('🔴 AGENTS.template.md 의 setup 행이 네 축을 모두 말한다', () => {
    const row = read('AGENTS.template.md')
      .split(/\r?\n/)
      .find((l) => l.includes('`npx commitgate setup`') && l.startsWith('|'))
    expect(row, 'setup 행이 없다').toBeTruthy()
    // 설정 키를 코드로 적는 축(`stopGate`·`reviewBudget.onSoftLimit`)은 키 자체로 확인한다.
    for (const key of SETUP_KEYS_FROM_SOURCE.filter((k) => k === 'stopGate' || k === 'reviewBudget.onSoftLimit'))
      expect(row as string, `AGENTS.template.md · ${key}`).toContain(key)
    // 모델·추론강도는 한국어 표현으로 적힌다.
    for (const word of ['리뷰 모델', '추론강도']) expect(row as string, word).toContain(word)
  })

  it('🔴 AGENTS.template.md 가 두 정책 축을 근거로 든다 — "왜 에이전트가 실행하면 안 되는가"', () => {
    const md = read('AGENTS.template.md')
    for (const key of ['stopGate', 'reviewBudget.onSoftLimit']) expect(md, key).toContain(key)
  })

  for (const [doc, words] of [
    ['README.md', ['리뷰 모델', '추론강도', 'stopGate', 'reviewBudget.onSoftLimit']],
    ['README.en.md', ['review model', 'reasoning effort', 'stopGate', 'reviewBudget.onSoftLimit']],
  ] as [string, string[]][]) {
    it(`🔴 ${doc} 명령 표의 setup 행이 네 축을 말한다`, () => {
      const row = read(doc)
        .split(/\r?\n/)
        .find((l) => l.startsWith('| `npx commitgate setup`'))
      expect(row, `${doc} 에 setup 명령 표 행이 없다`).toBeTruthy()
      for (const w of words) expect(row as string, `${doc} · ${w}`).toContain(w)
    })
  }

  /** 🔴 `auto` 가 두 곳에 있다는 설명은 quick-start 한 곳(정본)에만 둔다. */
  for (const [doc, needle] of [
    ['docs/quick-start.md', '두 곳'],
    ['docs/quick-start.en.md', 'two places'],
  ] as [string, string][]) {
    it(`🔴 ${doc} 가 두 \`auto\` 의 차이를 밝힌다`, () => {
      const md = read(doc)
      expect(md, doc).toContain(needle)
      expect(md, `${doc} — hardCap 을 해제하지 않는다는 말이 필요하다`).toContain('hardCap')
    })
  }
})

/**
 * 🔴 REQ-2026-158 phase-1 r01 P1 — `prose()` 의 펜스 처리 회귀.
 *
 * CommonMark 의 펜스는 백틱과 **물결(`~~~`) 둘 다**다. 한쪽만 추적하면 물결 블록 안의 **도구 출력
 * 축자 인용**을 산문으로 읽어 잘못 red 를 낸다. 여는 문자와 **같은 문자**로만 닫힌다는 것도 본다.
 */
describe('[REQ-2026-158] prose() — CommonMark 코드를 제외한다', () => {
  const BS = '`'
  const cases: [string, string, boolean][] = [
    ['백틱 펜스 안', `${BS.repeat(3)}text\n6~8\n${BS.repeat(3)}`, false],
    ['물결 펜스 안', '~~~text\n6~8\n~~~', false],
    ['펜스 밖', '6~8', true],
    // 🔴 백틱으로 연 블록은 물결로 닫히지 않는다 — 그 안은 계속 코드다.
    ['백틱으로 열고 물결이 섞인 블록 안', `${BS.repeat(3)}text\n~~~\n6~8\n${BS.repeat(3)}`, false],
    // ── r02 P1 재현 사례: 손수 만든 판별기가 전부 틀렸던 것들 ──
    // 🔴 4칸 들여쓰기는 **펜스가 아니라 들여쓰기 코드 블록**이다. 손수 판별기는 `trimStart()` 뒤에
    //    펜스로 오인해 뒤따르는 산문까지 통째로 지웠다 → 가드가 조용히 통과했다(fail-closed 위반).
    ['4칸 들여쓴 ~~~ 줄 뒤의 본문', '    ~~~\n\n6~8', true],
    // 🔴 block quote 안의 정상 펜스 — 손수 판별기는 `> ` 접두사를 못 봐 코드가 아니라고 읽었다.
    ['block quote 안의 펜스', '> ~~~\n> 6~8\n> ~~~', false],
    // 🔴 닫는 펜스는 **여는 길이 이상**이어야 하고 뒤에 텍스트가 오면 안 된다.
    ['짧은 닫힘은 닫지 못한다', `${BS.repeat(4)}\n~~~\n6~8\n${BS.repeat(4)}`, false],
    ['후행 텍스트가 붙은 줄은 닫지 못한다', `${BS.repeat(3)}\n${BS.repeat(3)} x\n6~8\n${BS.repeat(3)}`, false],
    // 🔴 인라인 코드도 도구의 축자 문자열이다.
    ['인라인 코드 안', `설명 ${BS}6~8${BS} 끝`, false],
  ]

  for (const [label, md, shouldAppear] of cases) {
    it(`🔴 ${label}: 산문에 ${shouldAppear ? '남는다' : '남지 않는다'}`, () => {
      // 🔴 위 문서 검사가 **실제로 쓰는 그 함수**를 부른다 — 규칙을 여기서 다시 적으면 공허하다.
      expect(prose(md).includes('6~8'), label).toBe(shouldAppear)
    })
  }
})
