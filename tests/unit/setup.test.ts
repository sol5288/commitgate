import { describe, it, expect } from 'vitest'
import {
  isInteractiveTty,
  runSetup,
  parseArgs,
  HelpRequested,
  NON_TTY_MESSAGE,
  PHASE1_INTERACTIVE_NOTICE,
  SETUP_KEYS,
  NULL_SENTINEL,
  MAX_ANSWER_ATTEMPTS,
  subSchemaFor,
  validateValue,
  choicesFor,
  buildQuestions,
  hintFor,
  interpretAnswer,
  askAll,
  parseConfigText,
  mergeConfigText,
  type SetupDeps,
  type Question,
  type Prompter,
} from '../../bin/setup'
import { CONFIG_SCHEMA, DEFAULTS } from '../../scripts/req/lib/config'

/**
 * REQ-2026-060 phase-1 — TTY 판정 + verb 골격(설계 DEC-1·DEC-2).
 *
 * 🔴 이 파일의 헤드라인 단언은 **"비-TTY에서는 아무 일도 일어나지 않는다"**이다. `setup`은 이 저장소
 *    최초의 대화형 명령이고, 가드가 늦으면 에이전트 세션이 blocking read에서 얼어붙는다. 그래서
 *    "throw 한다"뿐 아니라 **"throw 전에 부작용이 0건이다"**(log 미호출)까지 검증한다.
 */

/** log 호출을 기록하는 deps. 부작용 0건 단언의 관측점. */
function deps(stdin: boolean | undefined, stdout: boolean | undefined): SetupDeps & { logs: string[] } {
  const logs: string[] = []
  return { streams: { stdin, stdout }, log: (m) => logs.push(m), logs }
}

describe('[setup] isInteractiveTty — stdin·stdout 둘 다 true일 때만 대화형(DEC-2)', () => {
  /**
   * 🔴 **정상 경로 회귀 가드**(phase-1 r01 P1). 실측(Windows 11 · Git for Windows 2.46.0 · Node v24.18.0):
   * PowerShell 대화형과 **Git Bash(mintty) 대화형이 둘 다 `true`/`true`** 를 보고했고, `npx` 경유에서도 유지됐다.
   * 즉 통상 경로 `npx commitgate setup`은 두 터미널 모두에서 통과한다 — "mintty는 undefined"는 ConPTY 이전의
   * 옛 동작이다. 이 단언이 깨지면 **실제 터미널 사용자를 거부**하는 회귀다.
   */
  const supportedTerminals: Array<[string, boolean, boolean]> = [
    ['PowerShell 대화형(실측)', true, true],
    ['Git Bash(mintty) 대화형(실측)', true, true],
    ['npx 경유 — 두 터미널 모두 유지(실측)', true, true],
  ]
  for (const [name, stdin, stdout] of supportedTerminals) {
    it(`지원 터미널을 거부하지 않는다: ${name}`, () => {
      expect(isInteractiveTty({ stdin, stdout })).toBe(true)
    })
  }

  // 🔴 `undefined`는 비-TTY의 **실제** 값이다(phase-1 spike 실측: PowerShell·Git Bash 양쪽 에이전트 셸에서
  //    stdin/stdout/stderr 모두 undefined). `!isTTY`가 아니라 `=== true`로 판정하는 이유가 이것이다.
  const rejected: Array<[unknown, unknown]> = [
    [undefined, undefined],
    [true, undefined],
    [undefined, true],
    [false, false],
    [true, false],
    [false, true],
  ]
  for (const [stdin, stdout] of rejected) {
    it(`stdin=${String(stdin)} stdout=${String(stdout)} → 비대화형(거부)`, () => {
      expect(isInteractiveTty({ stdin: stdin as boolean | undefined, stdout: stdout as boolean | undefined })).toBe(false)
    })
  }
})

describe('[setup] runSetup — 비-TTY는 질문 없이 즉시 실패(DEC-1)', () => {
  it('비-TTY: NON_TTY_MESSAGE로 throw', () => {
    const d = deps(undefined, undefined)
    expect(() => runSetup({ dir: '/tmp/x' }, d)).toThrow(NON_TTY_MESSAGE)
  })

  it('🔴 비-TTY: throw 전에 부작용 0건 — log가 한 번도 호출되지 않는다', () => {
    const d = deps(undefined, undefined)
    expect(() => runSetup({ dir: '/tmp/x' }, d)).toThrow()
    expect(d.logs).toEqual([])
  })

  it('거부 메시지는 에이전트에게 "요청하라"를, 사람에게 통상 실행법을 지시한다', () => {
    expect(NON_TTY_MESSAGE).toContain('에이전트')
    expect(NON_TTY_MESSAGE).toContain('사용자에게 실행을 요청')
    expect(NON_TTY_MESSAGE).toContain('npx commitgate setup')
  })

  // winpty는 **정상 실행법이 아니라 구형 환경 탈출로**다(phase-1 r01 P1 반영). 실측상 지원 터미널은
  // 그대로 통과하므로, 메시지가 winpty를 기본 경로처럼 제시하면 안 된다.
  it('winpty는 예외 경로로만 제시된다(기본 실행법으로 제시하지 않는다)', () => {
    expect(NON_TTY_MESSAGE).toContain('winpty')
    expect(NON_TTY_MESSAGE).toContain('구형 Git for Windows')
    expect(NON_TTY_MESSAGE).toContain('PowerShell·Git Bash 모두 그대로 동작')
  })

  it('TTY: 안내만 출력하고 아무것도 쓰지 않는다(phase-1 범위)', () => {
    const d = deps(true, true)
    expect(() => runSetup({ dir: '/tmp/x' }, d)).not.toThrow()
    expect(d.logs).toEqual([PHASE1_INTERACTIVE_NOTICE])
  })
})

describe('[setup] parseArgs — fail-closed', () => {
  it('--dir 는 절대경로로 해소된다', () => {
    expect(parseArgs(['--dir', '.']).dir).toBe(process.cwd())
  })

  it('--dir 값 누락 → throw', () => {
    expect(() => parseArgs(['--dir'])).toThrow('--dir')
  })

  it('알 수 없는 옵션 → throw(조용히 무시하지 않는다)', () => {
    expect(() => parseArgs(['--set', 'reviewModel=x'])).toThrow('알 수 없는 옵션')
  })

  // 비대화형 경로를 만들지 않는다는 것이 R1의 핵심이므로, `--set` 류가 **거부되는 것**이 계약이다.
  it('비대화형 설정 경로(--set/--non-interactive)는 존재하지 않는다', () => {
    expect(() => parseArgs(['--non-interactive'])).toThrow('알 수 없는 옵션')
    expect(() => parseArgs(['--yes'])).toThrow('알 수 없는 옵션')
  })

  it('-h/--help 는 HelpRequested(오류 아님)', () => {
    expect(() => parseArgs(['-h'])).toThrow(HelpRequested)
    expect(() => parseArgs(['--help'])).toThrow(HelpRequested)
  })

  it('인자 없음 → cwd', () => {
    expect(parseArgs([]).dir).toBe(process.cwd())
  })
})

// ─────────────────────────────── phase-2: 순수 코어 (DEC-3·DEC-4·DEC-6·DEC-7) ──

/** 스크립트된 Prompter — 답변 배열을 순서대로 반환한다(실제 readline 없이 전 경로 구동). */
function scripted(answers: string[]): Prompter & { asked: Question[] } {
  const asked: Question[] = []
  let i = 0
  return {
    asked,
    ask: async (q) => {
      asked.push(q)
      if (i >= answers.length) throw new Error(`스크립트된 답변 소진(질문 ${asked.length}개)`)
      const a = answers[i++]
      return a as string
    },
  }
}

describe('[setup] DEC-4 — 질문은 2개로 명시하되 검증은 CONFIG_SCHEMA에서 온다', () => {
  it('setup이 다루는 키는 모델·effort 둘뿐이다(스키마 전체를 묻지 않는다)', () => {
    expect([...SETUP_KEYS]).toEqual(['reviewModel', 'reviewReasoningEffort'])
  })

  it('🔴 검증 SSOT: subSchemaFor 는 CONFIG_SCHEMA 의 해당 서브스키마와 동일 객체를 돌려준다', () => {
    const props = CONFIG_SCHEMA.properties as Record<string, unknown>
    expect(subSchemaFor('reviewModel')).toBe(props.reviewModel)
    expect(subSchemaFor('reviewReasoningEffort')).toBe(props.reviewReasoningEffort)
  })

  it('effort 선택지는 스키마 enum에서 파생된다(문자열만 — null은 sentinel로 표현)', () => {
    const enumValues = (CONFIG_SCHEMA.properties.reviewReasoningEffort as { enum: readonly unknown[] }).enum
    expect(choicesFor('reviewReasoningEffort')).toEqual(enumValues.filter((v) => typeof v === 'string'))
    expect(choicesFor('reviewReasoningEffort')).not.toContain(null)
  })

  it('model 은 enum이 아니므로 선택지가 없다', () => {
    expect(choicesFor('reviewModel')).toBeUndefined()
  })
})

describe('[setup] validateValue — 스키마 규칙이 그대로 적용된다', () => {
  it('유효한 모델 slug 통과 / null(비움) 통과', () => {
    expect(validateValue('reviewModel', 'gpt-5.6-terra')).toEqual([])
    expect(validateValue('reviewModel', null)).toEqual([])
  })

  // 🔴 이 거부가 adapters.ts 의 TOML 조립 안전(model="…")을 떠받친다 — 따옴표·공백·선행 대시가
  //    입력단에서 막히지 않으면 override 주입이 열린다.
  for (const bad of ['-leading-dash', 'has space', 'quote"inside', 'nl\nvalue', '']) {
    it(`부적합 모델 거부: ${JSON.stringify(bad)}`, () => {
      expect(validateValue('reviewModel', bad).length).toBeGreaterThan(0)
    })
  }

  it('effort enum 전체 통과 + null 통과', () => {
    for (const v of choicesFor('reviewReasoningEffort') ?? []) expect(validateValue('reviewReasoningEffort', v)).toEqual([])
    expect(validateValue('reviewReasoningEffort', null)).toEqual([])
  })

  it('effort enum 밖 거부', () => {
    expect(validateValue('reviewReasoningEffort', 'ultra').length).toBeGreaterThan(0)
    expect(validateValue('reviewReasoningEffort', 'HIGH').length).toBeGreaterThan(0)
  })
})

describe('[setup] buildQuestions — 현재값과 출처(파일/기본값)', () => {
  it('파일에 값이 있으면 그 값이 현재값이고 기본값 표시가 없다', () => {
    const qs = buildQuestions({ reviewModel: 'my-model', reviewReasoningEffort: 'low' })
    expect(qs.map((q) => [q.key, q.current, q.currentIsDefault])).toEqual([
      ['reviewModel', 'my-model', false],
      ['reviewReasoningEffort', 'low', false],
    ])
  })

  it('파일에 없으면 DEFAULTS 값 + 기본값 표시', () => {
    const [model, effort] = buildQuestions({}) as [Question, Question]
    expect(model.current).toBe(DEFAULTS.reviewModel)
    expect(model.currentIsDefault).toBe(true)
    expect(effort.current).toBe(DEFAULTS.reviewReasoningEffort)
    expect(effort.currentIsDefault).toBe(true)
  })

  it('파일에 명시적 null이면 현재값 null + 파일 출처', () => {
    const [model] = buildQuestions({ reviewModel: null }) as [Question]
    expect(model.current).toBeNull()
    expect(model.currentIsDefault).toBe(false)
  })

  it('hint 는 유지·비움 방법을 모두 알려 준다', () => {
    const h = hintFor((buildQuestions({}) as [Question, Question])[1])
    expect(h).toContain('Enter=유지')
    expect(h).toContain(NULL_SENTINEL)
    expect(h).toContain('선택지')
  })
})

describe('[setup] interpretAnswer — 유지/비움/값', () => {
  it('빈 입력·공백만 → undefined(패치 없음 = 유지)', () => {
    expect(interpretAnswer('')).toBeUndefined()
    expect(interpretAnswer('   ')).toBeUndefined()
  })

  it('sentinel → null(비움)', () => {
    expect(interpretAnswer(NULL_SENTINEL)).toBeNull()
    expect(interpretAnswer(`  ${NULL_SENTINEL}  `)).toBeNull()
  })

  it('그 외는 trim된 문자열', () => {
    expect(interpretAnswer('  gpt-5.6-terra ')).toBe('gpt-5.6-terra')
  })

  // 🔴 sentinel 선택 근거의 회귀 가드: none 은 effort의 **유효 값**이므로 비움 sentinel이 될 수 없다.
  it('none 은 비움이 아니라 유효한 effort 값이다', () => {
    expect(interpretAnswer('none')).toBe('none')
    expect(validateValue('reviewReasoningEffort', 'none')).toEqual([])
  })
})

describe('[setup] askAll — 스크립트된 Prompter로 전 경로 구동', () => {
  it('둘 다 Enter → 패치 없음(건드린 키 0개)', async () => {
    const p = scripted(['', ''])
    expect(await askAll(buildQuestions({}), p)).toEqual({})
    expect(p.asked.map((q) => q.key)).toEqual(['reviewModel', 'reviewReasoningEffort'])
  })

  it('값 입력 → 패치에 담긴다', async () => {
    const patch = await askAll(buildQuestions({}), scripted(['other-model', 'low']))
    expect(patch).toEqual({ reviewModel: 'other-model', reviewReasoningEffort: 'low' })
  })

  it('sentinel → null 패치(비움)', async () => {
    const patch = await askAll(buildQuestions({}), scripted([NULL_SENTINEL, NULL_SENTINEL]))
    expect(patch).toEqual({ reviewModel: null, reviewReasoningEffort: null })
  })

  it('부적합 답변은 재질문되고, 다음 유효 답이 채택된다', async () => {
    const invalid: string[] = []
    const p = scripted(['bad model', 'good-model', 'ultra', 'high'])
    const patch = await askAll(buildQuestions({}), p, (m) => invalid.push(m))
    expect(patch).toEqual({ reviewModel: 'good-model', reviewReasoningEffort: 'high' })
    expect(invalid).toHaveLength(2)
  })

  it(`🔴 ${MAX_ANSWER_ATTEMPTS}회 초과 실패는 무한 재질문 대신 throw(fail-closed)`, async () => {
    const p = scripted(Array(MAX_ANSWER_ATTEMPTS).fill('bad model'))
    await expect(askAll(buildQuestions({}), p)).rejects.toThrow('확정하지 못했습니다')
  })
})

describe('[setup] parseConfigText — 손상된 설정을 덮어쓰지 않는다', () => {
  it('null·빈 문자열 → 빈 객체', () => {
    expect(parseConfigText(null)).toEqual({})
    expect(parseConfigText('   ')).toEqual({})
  })

  it('BOM이 있어도 파싱된다', () => {
    expect(parseConfigText('﻿{"branchPrefix":"feat/req-"}')).toEqual({ branchPrefix: 'feat/req-' })
  })

  it('깨진 JSON → throw(쓰기 없음)', () => {
    expect(() => parseConfigText('{ not json')).toThrow('파싱 실패')
  })

  it('배열·스칼라 → throw', () => {
    expect(() => parseConfigText('[]')).toThrow('JSON 객체가 아닙니다')
    expect(() => parseConfigText('"x"')).toThrow('JSON 객체가 아닙니다')
  })
})

describe('[setup] mergeConfigText — 건드린 키만, 나머지는 보존(DEC-6·DEC-7)', () => {
  const existing = JSON.stringify(
    { ticketRoot: 'workflow', branchPrefix: 'feat/req-', reviewModel: 'old-model', packageManager: 'npm' },
    null,
    2,
  )

  it('🔴 무관한 키의 값과 순서를 보존한다', () => {
    const out = mergeConfigText(existing, { reviewModel: 'new-model' })
    expect(Object.keys(JSON.parse(out))).toEqual(['ticketRoot', 'branchPrefix', 'reviewModel', 'packageManager'])
    expect(JSON.parse(out)).toMatchObject({ ticketRoot: 'workflow', branchPrefix: 'feat/req-', packageManager: 'npm' })
    expect(JSON.parse(out).reviewModel).toBe('new-model')
  })

  it('신규 키는 뒤에 추가된다', () => {
    const out = mergeConfigText(existing, { reviewReasoningEffort: 'low' })
    expect(Object.keys(JSON.parse(out))).toEqual([
      'ticketRoot',
      'branchPrefix',
      'reviewModel',
      'packageManager',
      'reviewReasoningEffort',
    ])
  })

  it('null 패치는 명시적 null로 기록된다(키 삭제가 아니다)', () => {
    const parsed = JSON.parse(mergeConfigText(existing, { reviewModel: null }))
    expect(Object.prototype.hasOwnProperty.call(parsed, 'reviewModel')).toBe(true)
    expect(parsed.reviewModel).toBeNull()
  })

  it('파일이 없으면 선택된 키만 담은 새 설정을 만든다', () => {
    expect(JSON.parse(mergeConfigText(null, { reviewReasoningEffort: 'medium' }))).toEqual({
      reviewReasoningEffort: 'medium',
    })
  })

  it('🔴 줄바꿈은 LF 고정 + 파일 끝 개행', () => {
    const out = mergeConfigText(existing, { reviewModel: 'new-model' })
    expect(out).not.toContain('\r')
    expect(out.endsWith('\n')).toBe(true)
  })

  it('🔴 병합 결과가 스키마를 위반하면 throw(쓰기 없음)', () => {
    expect(() => mergeConfigText(existing, { reviewReasoningEffort: 'ultra' as never })).toThrow('스키마를 위반')
  })

  it('🔴 기존 파일이 이미 스키마 위반이면 병합도 거부한다(조용히 통과시키지 않는다)', () => {
    const broken = JSON.stringify({ branchPrefix: '' })
    expect(() => mergeConfigText(broken, { reviewModel: 'x' })).toThrow('스키마를 위반')
  })

  it('빈 패치는 기존 내용을 정규화만 한다(내용 동등)', () => {
    expect(JSON.parse(mergeConfigText(existing, {}))).toEqual(JSON.parse(existing))
  })
})
