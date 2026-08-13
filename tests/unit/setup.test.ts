import { describe, it, expect } from 'vitest'
import {
  isInteractiveTty,
  runSetup,
  parseArgs,
  HelpRequested,
  NON_TTY_MESSAGE,
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
  writeFileAtomic,
  createReadlinePrompter,
  type SetupDeps,
  type Question,
  type Prompter,
  buildSelectItems,
  allowsNullValue,
  setupBanner,
  savedMessage,
  MODEL_SUGGESTIONS,
  FREE_TEXT_SENTINEL,
  freeInputHint,
  toWritePatch,
} from '../../bin/setup'
import { CONFIG_SCHEMA, DEFAULTS } from '../../scripts/req/lib/config'
import { classifyAuthOutput, type AuthProbeResult, type VersionProbeResult } from '../../scripts/req/lib/adapters'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * REQ-2026-060 phase-1 — TTY 판정 + verb 골격(설계 DEC-1·DEC-2).
 *
 * 🔴 이 파일의 헤드라인 단언은 **"비-TTY에서는 아무 일도 일어나지 않는다"**이다. `setup`은 이 저장소
 *    최초의 대화형 명령이고, 가드가 늦으면 에이전트 세션이 blocking read에서 얼어붙는다. 그래서
 *    "throw 한다"뿐 아니라 **"throw 전에 부작용이 0건이다"**(log 미호출)까지 검증한다.
 */

/**
 * 테스트 deps. 모든 부작용(로그·파일 IO·codex probe·프롬프트)을 기록/주입한다.
 * 기본값은 "codex 설치됨 + 이미 로그인됨 + 모든 질문에 Enter" — 각 테스트가 필요한 축만 덮어쓴다.
 */
function deps(
  stdin: boolean | undefined,
  stdout: boolean | undefined,
  over: Partial<{
    existing: string | null
    answers: string[]
    version: VersionProbeResult
    authSeq: AuthProbeResult[]
    loginStatus: number | null
    now: string
    cgVersion: string
  }> = {},
): SetupDeps & { logs: string[]; writes: string[]; loginCalls: number; asked: Question[] } {
  const logs: string[] = []
  const writes: string[] = []
  const asked: Question[] = []
  const authSeq = over.authSeq ?? [{ state: 'logged-in', reason: 'ok', detail: 'Logged in using ChatGPT' }]
  let authIdx = 0
  let loginCalls = 0
  let answerIdx = 0
  // 기본은 "모든 질문에 Enter" — 질문 수가 늘면 여기도 늘어야 한다(REQ-2026-133: 4개).
  const answers = over.answers ?? ['', '', '', '']
  const self = {
    streams: { stdin, stdout },
    log: (m: string) => void logs.push(m),
    io: {
      read: () => over.existing ?? null,
      write: (t: string) => void writes.push(t),
    },
    probes: {
      version: () => over.version ?? { ok: true, version: 'codex-cli 0.144.1', detail: 'codex-cli 0.144.1' },
      auth: () => authSeq[Math.min(authIdx++, authSeq.length - 1)] as AuthProbeResult,
      login: () => {
        self.loginCalls = ++loginCalls
        return { status: over.loginStatus ?? 0 }
      },
    },
    createPrompter: (): Prompter => ({
      ask: async (q: Question) => {
        asked.push(q)
        const a = answers[answerIdx++]
        if (a === undefined) throw new Error('스크립트된 답변 소진')
        return a
      },
    }),
    now: () => over.now ?? '2026-07-26T00:00:00.000Z',
    version: over.cgVersion ?? '9.9.9-test',
    logs,
    writes,
    loginCalls: 0,
    asked,
  }
  return self
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
  it('비-TTY: NON_TTY_MESSAGE로 reject', async () => {
    const d = deps(undefined, undefined)
    await expect(runSetup({ dir: '/tmp/x' }, d)).rejects.toThrow(NON_TTY_MESSAGE)
  })

  it('🔴 비-TTY: 부작용 0건 — log·읽기·probe·질문·쓰기 모두 발생하지 않는다', async () => {
    const d = deps(undefined, undefined)
    await expect(runSetup({ dir: '/tmp/x' }, d)).rejects.toThrow()
    expect(d.logs).toEqual([])
    expect(d.writes).toEqual([])
    expect(d.asked).toEqual([])
    expect(d.loginCalls).toBe(0)
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

  it('TTY: 정상 진행한다(질문까지 도달)', async () => {
    const d = deps(true, true)
    await expect(runSetup({ dir: '/tmp/x' }, d)).resolves.toBeUndefined()
    expect(d.asked.map((q) => q.key)).toEqual([
      'reviewModel',
      'reviewReasoningEffort',
      'stopGate',
      'reviewBudget.onSoftLimit',
    ])
  })
})

/**
 * REQ-2026-133 — 정지 지점 화면과 중첩 설정 기록.
 *
 * 🔴 이 그룹의 헤드라인: **한 화면 안에서 모순이 없어야 한다.** 값 설명만 고치고 같은 화면의 고지를
 *    두면 사용자는 상반된 두 문장을 동시에 본다 — 설정을 고르는 바로 그 자리에서.
 */
describe('[REQ-2026-133] 정지 지점 화면', () => {
  const q = (key: string) => buildQuestions({}).find((x) => x.key === key) as Question

  it('🔴 stopGate 값 설명이 세 값 모두 정지 지점을 말한다(merge는 묶음 없는 경우 포함)', () => {
    const notes = buildSelectItems(q('stopGate'))
      .map((i) => `${i.label}: ${i.note ?? ''}`)
      .join('\n')
    expect(notes).toContain('매 phase 커밋 전')
    expect(notes).toContain('통합 직전 한 번')
    // 이 문구가 이 REQ의 핵심 — 없으면 사용자는 merge 가 정지를 없앤다고 오해한다.
    expect(notes).toContain('묶음이 없으면 req 와 같다')
  })

  it('🔴 같은 화면의 고지도 같은 사실을 말한다(값 설명과 모순 없음)', () => {
    const hint = hintFor(q('stopGate'))
    expect(hint).toContain('묶음이 없으면 REQ 통합 직전')
    expect(hint).not.toContain('merge: 커밋에서는 멈추지 않음 ·')
  })

  /**
   * 🔴 고지를 붙이는 조건이 `!allowsNullValue`(간접)였다. 새 키도 null 을 못 받으므로 그대로 두면
   *    **예산 질문 화면에 정지 지점 안내가 붙는다** — 완전히 다른 축이다.
   */
  it('🔴 예산 질문에는 정지 지점 고지가 붙지 않는다', () => {
    const hint = hintFor(q('reviewBudget.onSoftLimit'))
    expect(hint).not.toContain('정지 지점은 이 값이 정합니다')
    expect(allowsNullValue('reviewBudget.onSoftLimit'), '전제: 이 키도 null 을 못 받는다').toBe(false)
  })

  it('예산 질문은 스키마 enum 선택지를 쓰고 "비움"이 없다', () => {
    const items = buildSelectItems(q('reviewBudget.onSoftLimit'))
    expect(items.map((i) => i.label)).toEqual(['현재 값 유지', 'ask', 'auto'])
    expect(items.map((i) => i.label)).not.toContain('비움')
  })

  it('질문 문구가 비용 통제임을 말한다(안전 게이트 오해 방지)', () => {
    expect(q('reviewBudget.onSoftLimit').prompt).toContain('안전 게이트가 아닙니다')
  })
})

describe('[REQ-2026-133] toWritePatch — 답변(경로) → 파일 patch(최상위)', () => {
  it('최상위 키는 그대로 옮긴다', () => {
    expect(toWritePatch({ reviewModel: 'm', stopGate: 'req' }, {})).toEqual({ reviewModel: 'm', stopGate: 'req' })
  })

  /** 🔴 leaf 하나만 쓰면 스키마 required(autoBudget·hardCap)를 만족하지 못한다. */
  it('🔴 reviewBudget 이 없던 config: DEFAULTS 로 채워 유효한 객체를 만든다', () => {
    expect(toWritePatch({ 'reviewBudget.onSoftLimit': 'auto' }, {})).toEqual({
      reviewBudget: { autoBudget: DEFAULTS.reviewBudget.autoBudget, hardCap: DEFAULTS.reviewBudget.hardCap, onSoftLimit: 'auto' },
    })
  })

  /** 🔴 사용자가 조정한 값을 setup 이 덮으면 안 된다. */
  it('🔴 기존 autoBudget·hardCap 을 보존한다', () => {
    const raw = { reviewBudget: { autoBudget: 3, hardCap: 6 } }
    expect(toWritePatch({ 'reviewBudget.onSoftLimit': 'auto' }, raw)).toEqual({
      reviewBudget: { autoBudget: 3, hardCap: 6, onSoftLimit: 'auto' },
    })
  })

  it('답변이 없으면 아무것도 만들지 않는다', () => {
    expect(toWritePatch({}, { reviewBudget: { autoBudget: 3, hardCap: 6 } })).toEqual({})
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

describe('[setup] DEC-4 — 질문을 명시하고 검증은 CONFIG_SCHEMA에서 온다', () => {
  it('setup이 다루는 키는 모델·effort·stopGate·예산정책 넷뿐이다(스키마 전체를 묻지 않는다)', () => {
    expect([...SETUP_KEYS]).toEqual(['reviewModel', 'reviewReasoningEffort', 'stopGate', 'reviewBudget.onSoftLimit'])
  })

  it('🔴 검증 SSOT: subSchemaFor 는 CONFIG_SCHEMA 의 해당 서브스키마와 동일 객체를 돌려준다', () => {
    const props = CONFIG_SCHEMA.properties as Record<string, unknown>
    expect(subSchemaFor('reviewModel')).toBe(props.reviewModel)
    expect(subSchemaFor('reviewReasoningEffort')).toBe(props.reviewReasoningEffort)
  })

  /** 🔴 REQ-2026-133: 점 경로 키도 같은 SSOT에서 온다 — 중첩이라고 별도 사본을 두지 않는다. */
  it('🔴 중첩 키(reviewBudget.onSoftLimit)도 스키마를 경로로 따라간다', () => {
    const parent = (CONFIG_SCHEMA.properties as unknown as Record<string, { properties: Record<string, unknown> }>)
      .reviewBudget as { properties: Record<string, unknown> }
    expect(subSchemaFor('reviewBudget.onSoftLimit')).toBe(parent.properties.onSoftLimit)
    expect(choicesFor('reviewBudget.onSoftLimit')).toEqual(['ask', 'auto'])
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
    const qs = buildQuestions({ reviewModel: 'my-model', reviewReasoningEffort: 'low', stopGate: 'req', reviewBudget: { autoBudget: 3, hardCap: 6, onSoftLimit: 'auto' } })
    expect(qs.map((q) => [q.key, q.current, q.currentIsDefault])).toEqual([
      ['reviewModel', 'my-model', false],
      ['reviewReasoningEffort', 'low', false],
      ['stopGate', 'req', false],
      // 🔴 REQ-2026-133: 중첩 키도 **경로 기준**으로 읽는다 — 최상위만 보면 항상 "기본값"으로 보인다.
      ['reviewBudget.onSoftLimit', 'auto', false],
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

  /**
   * 🔴 REQ-2026-067 phase-4(DEC-11)로 **의도적으로 바뀐 계약**이다.
   * 이 문구들(`Enter=유지` · `'-'` · `선택지:`)은 **자유 입력**의 조작법이고, 방향키 메뉴에서는
   * 중복이거나 사용자가 따라 할 수 없는 지시였다(0.10.0 실측 화면). 이제 자유 입력 질문에만 붙는다.
   */
  /**
   * 🔴 phase-4: 세 질문 모두 목록을 갖게 되면서 `hintFor`는 전부 메뉴용이 됐다.
   * 자유 입력 안내는 **degrade 경로**(raw mode 미지원)와 "직접 입력" 항목에서 쓰인다 —
   * 그 화면에서 조작법이 사라지면 사용자가 유지·비움을 할 방법을 알 수 없다.
   */
  it('freeInputHint 는 유지·비움 방법을 모두 알려 준다', () => {
    const model = buildQuestions({}).find((q) => q.key === 'reviewModel') as Question
    const h = freeInputHint(model)
    expect(h).toContain('Enter=유지')
    expect(h).toContain(NULL_SENTINEL)
    expect(h).toContain('추천:') // 목록이 있으면 추천으로 보여 준다(enum 이 아니므로)
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
    const p = scripted(['', '', '', ''])
    expect(await askAll(buildQuestions({}), p)).toEqual({})
    expect(p.asked.map((q) => q.key)).toEqual(['reviewModel', 'reviewReasoningEffort', 'stopGate', 'reviewBudget.onSoftLimit'])
  })

  it('값 입력 → 패치에 담긴다', async () => {
    const patch = await askAll(buildQuestions({}), scripted(['other-model', 'low', 'req', 'auto']))
    expect(patch).toEqual({ reviewModel: 'other-model', reviewReasoningEffort: 'low', stopGate: 'req', 'reviewBudget.onSoftLimit': 'auto' })
  })

  it('sentinel → null 패치(비움)', async () => {
    const patch = await askAll(buildQuestions({}), scripted([NULL_SENTINEL, NULL_SENTINEL, '', '']))
    expect(patch).toEqual({ reviewModel: null, reviewReasoningEffort: null })
  })

  it('부적합 답변은 재질문되고, 다음 유효 답이 채택된다', async () => {
    const invalid: string[] = []
    const p = scripted(['bad model', 'good-model', 'ultra', 'high', '', ''])
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

// ─────────────────── phase-3: 로그인·원자적 쓰기 배선 (DEC-5·DEC-8·DEC-9·DEC-10) ──

describe('[setup] classifyAuthOutput — stdout 기반 3분류(DEC-9)', () => {
  it('실측 문자열: "Logged in using ChatGPT"(exit 0, stdout) → logged-in', () => {
    expect(classifyAuthOutput(0, 'Logged in using ChatGPT\n', '')).toMatchObject({ state: 'logged-in', reason: 'ok' })
  })

  // 🔴 "Not logged in"은 "logged in"을 **포함**한다 — 부정 패턴을 먼저 보지 않으면 뒤집힌다.
  for (const out of ['Not logged in', 'You are not logged in.', 'logged out', 'Not authenticated']) {
    it(`부정 신호가 긍정보다 우선한다: ${JSON.stringify(out)} → logged-out`, () => {
      expect(classifyAuthOutput(1, out, '').state).toBe('logged-out')
    })
  }

  it('🔴 stderr에만 나와도 읽는다(codex는 stdout/stderr가 갈린다)', () => {
    expect(classifyAuthOutput(1, '', 'Not logged in').state).toBe('logged-out')
    expect(classifyAuthOutput(0, '', 'Logged in using ChatGPT').state).toBe('logged-in')
  })

  it('알아볼 수 없는 출력 → unknown(단정하지 않는다)', () => {
    expect(classifyAuthOutput(0, 'some new format', '')).toMatchObject({ state: 'unknown', reason: 'unrecognized-output' })
    expect(classifyAuthOutput(2, '', '')).toMatchObject({ state: 'unknown', reason: 'probe-failed' })
  })
})

describe('[setup] runSetup ①~⑦ — 쓰기는 한 곳뿐(DEC-10)', () => {
  const loggedOut: AuthProbeResult = { state: 'logged-out', reason: 'ok', detail: 'Not logged in' }
  const loggedIn: AuthProbeResult = { state: 'logged-in', reason: 'ok', detail: 'Logged in using ChatGPT' }
  const unknown: AuthProbeResult = { state: 'unknown', reason: 'unrecognized-output', detail: '???' }

  it('이미 로그인돼 있으면 login을 실행하지 않는다(DEC-8)', async () => {
    const d = deps(true, true, { answers: ['new-model', '', '', ''] })
    await runSetup({ dir: '/tmp/x' }, d)
    expect(d.loginCalls).toBe(0)
    expect(d.writes).toHaveLength(1)
  })

  it('미로그인 → login 실행 후 재검증 성공 → 저장(수용기준 3)', async () => {
    const d = deps(true, true, { answers: ['new-model', '', '', ''], authSeq: [loggedOut, loggedIn] })
    await runSetup({ dir: '/tmp/x' }, d)
    expect(d.loginCalls).toBe(1)
    expect(JSON.parse(d.writes[0] as string)).toEqual({
      reviewModel: 'new-model',
      setup: { completedVersion: '9.9.9-test', completedAt: '2026-07-26T00:00:00.000Z' },
    })
  })

  it('🔴 로그인 실패 → throw + 설정 미변경(수용기준 4)', async () => {
    const d = deps(true, true, { answers: ['new-model', '', '', ''], authSeq: [loggedOut, loggedOut] })
    await expect(runSetup({ dir: '/tmp/x' }, d)).rejects.toThrow('변경되지 않았습니다')
    expect(d.writes).toEqual([])
  })

  it('🔴 재검증이 unknown이어도 실패로 처리한다(setup은 엄격 — DEC-9)', async () => {
    const d = deps(true, true, { answers: ['new-model', '', '', ''], authSeq: [loggedOut, unknown] })
    await expect(runSetup({ dir: '/tmp/x' }, d)).rejects.toThrow()
    expect(d.writes).toEqual([])
  })

  it('🔴 codex 미설치 → 질문·로그인·쓰기 모두 없음', async () => {
    const d = deps(true, true, { version: { ok: false, version: null, detail: 'ENOENT' } })
    await expect(runSetup({ dir: '/tmp/x' }, d)).rejects.toThrow('codex CLI')
    expect(d.asked).toEqual([])
    expect(d.loginCalls).toBe(0)
    expect(d.writes).toEqual([])
  })

  it('🔴 기존 설정이 손상됐으면 읽자마자 중단 — 덮어쓰지 않는다', async () => {
    const d = deps(true, true, { existing: '{ broken' })
    await expect(runSetup({ dir: '/tmp/x' }, d)).rejects.toThrow('파싱 실패')
    expect(d.writes).toEqual([])
  })

  // 🔴 REQ-2026-062 DEC-9: 값을 안 바꿔도 **마커는 남긴다** — 마커의 의미는 "값을 바꿨다"가 아니라
  //    "설정을 확인했다"이고, 값을 유지한 것도 확인의 결과다.
  it('모두 Enter인데 마커가 없으면 마커만 기록한다', async () => {
    const d = deps(true, true, { existing: '{\n  "branchPrefix": "feat/req-"\n}\n' })
    await runSetup({ dir: '/tmp/x' }, d)
    expect(JSON.parse(d.writes[0] as string)).toEqual({
      branchPrefix: 'feat/req-',
      setup: { completedVersion: '9.9.9-test', completedAt: '2026-07-26T00:00:00.000Z' },
    })
  })

  it('모두 Enter이고 마커도 이미 있으면 쓰기 0건(무의미한 diff를 만들지 않는다)', async () => {
    const existing = JSON.stringify(
      { branchPrefix: 'feat/req-', setup: { completedVersion: '0.0.1', completedAt: '2026-01-01T00:00:00.000Z' } },
      null,
      2,
    )
    const d = deps(true, true, { existing })
    await runSetup({ dir: '/tmp/x' }, d)
    expect(d.writes).toEqual([])
    expect(d.logs.some((l) => l.includes('변경된 설정이 없습니다'))).toBe(true)
  })

  it('🔴 completedAt 은 주입된 실제 시계에서 온다(날조 금지 — REQ-2026-019 재발 방지)', async () => {
    const d = deps(true, true, { answers: ['m1', '', '', ''], now: '2030-03-04T05:06:07.008Z', cgVersion: '1.2.3' })
    await runSetup({ dir: '/tmp/x' }, d)
    expect(JSON.parse(d.writes[0] as string).setup).toEqual({
      completedVersion: '1.2.3',
      completedAt: '2030-03-04T05:06:07.008Z',
    })
  })

  it('마커가 담긴 설정도 스키마를 통과한다(하위호환)', async () => {
    const existing = JSON.stringify({ setup: { completedVersion: '0.0.1', completedAt: '2026-01-01T00:00:00Z' } })
    const d = deps(true, true, { existing, answers: ['m2', '', '', ''] })
    await expect(runSetup({ dir: '/tmp/x' }, d)).resolves.toBeUndefined()
  })

  it('기존 키를 보존하며 저장한다', async () => {
    const d = deps(true, true, {
      existing: JSON.stringify({ branchPrefix: 'feat/req-', reviewModel: 'old' }, null, 2),
      answers: ['new-model', 'low', '', ''],
    })
    await runSetup({ dir: '/tmp/x' }, d)
    expect(JSON.parse(d.writes[0] as string)).toEqual({
      branchPrefix: 'feat/req-',
      reviewModel: 'new-model',
      reviewReasoningEffort: 'low',
      setup: { completedVersion: '9.9.9-test', completedAt: '2026-07-26T00:00:00.000Z' },
    })
  })
})

// ───────── REQ-2026-063: stopGate 질문 + legacy phaseCommit 정규화 (DEC-6·DEC-6b·DEC-7) ──

describe('[setup] stopGate 질문', () => {
  it('🔴 legacy phaseCommit 에서 현재값을 역파생한다(파일이 low-only인데 phase[기본값]이라 말하지 않는다)', () => {
    const qs = buildQuestions({ phaseCommit: { autoApprove: 'low-only' } })
    const sg = qs.find((q) => q.key === 'stopGate')
    expect(sg?.current).toBe('req')
    expect(sg?.currentIsDefault).toBe(false)
  })

  // 🔴 DEC-18: 기본 멈춤 지점이 phase → req 로 바뀌었다(사용자 지시 · 안전 기본값 완화).
  it('설정이 없으면 기본값 req 로 표시된다', () => {
    const sg = buildQuestions({}).find((q) => q.key === 'stopGate')
    expect(sg?.current).toBe('req')
    expect(sg?.currentIsDefault).toBe(true)
  })

  /**
   * 🔴 REQ-2026-066 p3: `merge`가 **동작과 함께** 착륙하면서 3값이 됐다.
   * 값만 먼저 넣었다면 고를 수는 있는데 동작이 없는 거짓 UI였을 것이다 — 그래서 미뤘던 값이다.
   */
  it('선택지는 스키마 enum에서 온다(4값 — merge·auto 포함)', () => {
    expect(choicesFor('stopGate')).toEqual(['phase', 'req', 'merge', 'auto'])
  })

  /**
   * 🔴 이 고지는 **이 값이 무엇을 정하는지**를 그 자리에서 알려준다. 사용자는 지금 정지 지점을
   * 고르고 있고, 값마다 멈추는 자리가 다르다(`userConfirmGate`). 어떤 값을 골라도 통합 승인은
   * 남는다는 사실이 함께 있어야 "전부 자동이 됐다"는 오해가 생기지 않는다.
   *
   * 🔴 **이 테스트는 REQ-2026-112에서 갱신됐다.** 이전 판은 고지가 위험도에 따라 매 phase 확인이
   *    남는다고 **단언**해서, REQ-2026-071이 그 백스톱을 걷어낸 뒤에도 **거짓 문구를 고정**하고 있었다.
   *    테스트가 옛 계약을 붙들고 있으면 정정 자체가 실패로 보인다 — 문구를 고치는 REQ에서
   *    이 단언을 함께 고쳐야 하는 이유다.
   */
  it('🔴 hint 가 정지 지점을 stopGate가 정한다고 알리고 통합 승인 필요를 남긴다', () => {
    const sg = buildQuestions({}).find((q) => q.key === 'stopGate') as Question
    const h = hintFor(sg)
    for (const v of ['phase', 'req', 'merge']) expect(h).toContain(v)
    expect(h).toContain('통합')
    // 폐기된 보장으로 되돌아가지 않는다(정본 등재 목록은 docs-stale-claims.test.ts).
    expect(h).not.toContain('어느 값에서도 매 phase 확인')
  })

  // stopGate 는 "전역 상속" 개념이 없다 — 비움 sentinel을 안내하지도, 허용하지도 않는다.
  it('비움 sentinel 을 안내하지 않고 값으로도 거부한다(DEC-7)', () => {
    const sg = buildQuestions({}).find((q) => q.key === 'stopGate') as Question
    expect(hintFor(sg)).not.toContain('비움(전역 상속)')
    expect(validateValue('stopGate', null).length).toBeGreaterThan(0)
  })

  it('enum 밖 값은 거부된다', () => {
    expect(validateValue('stopGate', 'always').length).toBeGreaterThan(0)
    expect(validateValue('stopGate', 'req')).toEqual([])
    expect(validateValue('stopGate', 'merge')).toEqual([])
  })
})

describe('[setup] 🔴 legacy phaseCommit 정규화 — setup이 만든 파일이 게이트에 걸리지 않는다(DEC-6b)', () => {
  const legacy = JSON.stringify({ branchPrefix: 'feat/req-', phaseCommit: { autoApprove: 'low-only' } }, null, 2)

  /**
   * 🔴 이 REQ의 필수 오라클. 정규화가 없으면:
   *   기존 `low-only` 프로젝트 → setup에서 `phase` 선택 → merge가 미접촉 키를 보존해
   *   `{stopGate:'phase', phaseCommit:{autoApprove:'low-only'}}` 기록 → config 충돌 검사가 거부 →
   *   **이후 모든 명령이 죽는다.** 즉 setup의 정상 경로가 프로젝트를 벽돌로 만든다.
   */
  it('🔴 stopGate 를 기록하면 legacy phaseCommit 이 같은 쓰기에서 사라진다', async () => {
    const d = deps(true, true, { existing: legacy, answers: ['', '', 'phase', ''] })
    await runSetup({ dir: '/tmp/x' }, d)
    const written = JSON.parse(d.writes[0] as string)
    expect(written.stopGate).toBe('phase')
    expect(Object.prototype.hasOwnProperty.call(written, 'phaseCommit')).toBe(false)
    expect(written.branchPrefix).toBe('feat/req-') // 무관한 키는 보존
  })

  it('🔴 값이 일치해도 alias 를 남기지 않는다(한쪽만 손으로 고치면 같은 덫이 재발한다)', async () => {
    const d = deps(true, true, { existing: legacy, answers: ['', '', 'req', ''] })
    await runSetup({ dir: '/tmp/x' }, d)
    const written = JSON.parse(d.writes[0] as string)
    expect(written.stopGate).toBe('req')
    expect(Object.prototype.hasOwnProperty.call(written, 'phaseCommit')).toBe(false)
  })

  it('stopGate 를 Enter로 유지하면 phaseCommit 도 그대로 둔다(건드린 키만 바꾼다)', async () => {
    const d = deps(true, true, { existing: legacy, answers: ['new-model', '', '', ''] })
    await runSetup({ dir: '/tmp/x' }, d)
    const written = JSON.parse(d.writes[0] as string)
    expect(written.phaseCommit).toEqual({ autoApprove: 'low-only' })
    expect(Object.prototype.hasOwnProperty.call(written, 'stopGate')).toBe(false)
  })

  it('mergeConfigText 의 삭제는 패치와 같은 호출에서 처리된다(중간 상태 없음)', () => {
    const out = mergeConfigText(legacy, { stopGate: 'phase' }, undefined, ['phaseCommit'])
    const parsed = JSON.parse(out)
    expect(parsed.stopGate).toBe('phase')
    expect(Object.prototype.hasOwnProperty.call(parsed, 'phaseCommit')).toBe(false)
  })
})

describe('[setup] Prompter 수명 — 항상 닫는다(phase-3 r01 P1)', () => {
  /**
   * 🔴 `close()`가 없으면 stdin에 붙은 readline 핸들이 남아 **CLI가 종료되지 않는다.**
   *    아래 두 단언이 그 계약의 양 끝이다: (1) 실제 구현이 close를 **노출**하는가,
   *    (2) `runSetup`이 성공·실패 **양쪽에서** 부르는가.
   */
  it('실제 readline Prompter가 close()를 노출한다', () => {
    const p = createReadlinePrompter()
    try {
      expect(typeof p.close).toBe('function')
    } finally {
      p.close?.()
    }
  })

  /** close 호출을 세는 deps(정상 완료 경로). */
  function countingDeps(answers: string[]) {
    const base = deps(true, true, { answers })
    let closes = 0
    return {
      d: { ...base, createPrompter: () => ({ ...base.createPrompter(), close: () => void closes++ }) },
      closes: () => closes,
    }
  }

  it('정상 완료에서 close가 호출된다', async () => {
    const { d, closes } = countingDeps(['new-model', 'low', '', ''])
    await runSetup({ dir: '/tmp/x' }, d)
    expect(closes()).toBe(1)
  })

  it('🔴 질문 도중 실패해도 close가 호출된다(finally)', async () => {
    const { d, closes } = countingDeps(['bad model', 'bad model', 'bad model'])
    await expect(runSetup({ dir: '/tmp/x' }, d)).rejects.toThrow('확정하지 못했습니다')
    expect(closes()).toBe(1)
  })
})

describe('[setup] writeFileAtomic — temp+rename, 실패 시 찌꺼기 없음(DEC-5)', () => {
  it('새 파일 생성 후 내용 일치', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cg-setup-'))
    try {
      const p = join(dir, 'req.config.json')
      writeFileAtomic(p, '{"a":1}\n')
      expect(readFileSync(p, 'utf8')).toBe('{"a":1}\n')
      expect(readdirSync(dir)).toEqual(['req.config.json'])
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
    }
  })

  it('🔴 기존 파일을 교체해도 temp 찌꺼기가 남지 않는다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cg-setup-'))
    try {
      const p = join(dir, 'req.config.json')
      writeFileSync(p, 'old\n', 'utf8')
      writeFileAtomic(p, 'new\n')
      expect(readFileSync(p, 'utf8')).toBe('new\n')
      expect(readdirSync(dir)).toEqual(['req.config.json'])
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
    }
  })

  it('🔴 쓰기 실패 시 원본이 보존되고 temp가 정리된다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cg-setup-'))
    try {
      const p = join(dir, 'req.config.json')
      writeFileSync(p, 'original\n', 'utf8')
      // 존재하지 않는 하위 디렉터리 경로 → writeFileSync 단계에서 실패.
      expect(() => writeFileAtomic(join(dir, 'nope', 'x.json'), 'x')).toThrow()
      expect(readFileSync(p, 'utf8')).toBe('original\n')
      expect(readdirSync(dir)).toEqual(['req.config.json'])
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
    }
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

/**
 * REQ-2026-067 phase-2 — enum 질문의 선택 목록(DEC-6).
 *
 * 🔴 이 그룹의 헤드라인: **첫 항목은 "유지"다.** 커서가 거기서 시작하므로 "Enter만 누르면 아무것도
 *    안 바뀐다"는 기존 계약이 성립한다. 현재 값에 커서를 두면 Enter가 명시 선택이 되어
 *    파일에 없던 키가 조용히 기록된다.
 */
describe('[setup] buildSelectItems — 선택 목록 구성', () => {
  const q = (over: Partial<Question> = {}): Question => ({
    key: 'stopGate',
    prompt: '사람이 멈추는 지점',
    current: 'phase',
    currentIsDefault: true,
    choices: ['phase', 'req', 'merge'],
    ...over,
  })

  it('🔴 첫 항목은 유지이고 빈 문자열을 돌려준다(= 미기록)', () => {
    const items = buildSelectItems(q())
    expect(items[0]!.answer).toBe('')
    expect(items[0]!.label).toContain('유지')
  })

  it('enum 값이 순서대로 뒤따르고 각자 자기 값을 돌려준다', () => {
    const answers = buildSelectItems(q()).map((i) => i.answer)
    expect(answers).toEqual(['', 'phase', 'req', 'merge'])
  })

  /** 🔴 화면과 검증이 같은 근거(`allowsNullValue`)를 써야 한다 — 갈라지면 보여 주고 거부하는 화면이 된다. */
  it('🔴 null 을 받지 않는 키에는 비움 항목이 없다(stopGate)', () => {
    expect(allowsNullValue('stopGate')).toBe(false)
    expect(buildSelectItems(q()).some((i) => i.answer === NULL_SENTINEL)).toBe(false)
  })

  it('🔴 null 을 받는 키에는 비움 항목이 있다(reviewReasoningEffort)', () => {
    expect(allowsNullValue('reviewReasoningEffort')).toBe(true)
    const items = buildSelectItems(
      q({ key: 'reviewReasoningEffort', current: 'high', choices: ['low', 'medium', 'high'] }),
    )
    expect(items[1]!.answer).toBe(NULL_SENTINEL)
    expect(items.map((i) => i.answer)).toEqual(['', NULL_SENTINEL, 'low', 'medium', 'high'])
  })

  // phase-4(DEC-12): 표시가 라벨이 아니라 **설명 줄**로 옮겨졌다 — 라벨은 값 그대로여야 열이 맞는다.
  it('현재 값에 표시가 붙는다(고른 것과 구별)', () => {
    const items = buildSelectItems(q({ current: 'req' }))
    expect(items.find((i) => i.answer === 'req')!.note).toContain('현재 값')
    expect(items.find((i) => i.answer === 'merge')!.label).toBe('merge')
  })

  /**
   * 🔴 목록이 내는 답은 전부 기존 `interpretAnswer`가 이해하는 형태여야 한다 —
   * 그래야 `Prompter`를 넓히지 않고도(DEC-2) 해석·검증·저장 경로가 그대로 돈다.
   */
  it('🔴 모든 항목의 답이 기존 해석 경로를 그대로 탄다', () => {
    for (const key of ['stopGate', 'reviewReasoningEffort'] as const) {
      const choices = choicesFor(key)!
      for (const item of buildSelectItems(q({ key, current: choices[0]!, choices: [...choices] }))) {
        const v = interpretAnswer(item.answer)
        if (item.answer === '') expect(v).toBeUndefined() // 유지 = 패치 없음
        else expect(validateValue(key, v as string | null)).toEqual([])
      }
    }
  })
})

/**
 * REQ-2026-067 phase-2 r01 P1 — readline 격리.
 *
 * 🔴 헤드라인: **자유 입력 질문이 끝나면 stdin 에 readline 리스너가 남아 있으면 안 된다.**
 *    `rl.pause()`는 흐름만 멈출 뿐 리스너를 떼지 않아, 이어지는 raw 선택 위젯과 방향키를 함께 먹는다 —
 *    위젯 출력 위에 readline 이 프롬프트를 다시 그려 화면이 깨진다.
 */
describe('[setup] createReadlinePrompter — raw 위젯과 readline 격리', () => {
  /** 실제 readline 이 붙을 수 있는 최소 TTY 대역(Readable/Writable 기반). */
  function ttyIo() {
    const { Readable, Writable } = require('node:stream') as typeof import('node:stream')
    const stdin = new Readable({ read() {} }) as unknown as NodeJS.ReadStream & { push(c: unknown): boolean }
    Object.assign(stdin, {
      isTTY: true,
      isRaw: false,
      setRawMode(v: boolean) {
        ;(this as { isRaw: boolean }).isRaw = v
        return this
      },
    })
    let out = ''
    const stdout = new Writable({
      write(c: Buffer | string, _e: unknown, cb: () => void) {
        out += String(c)
        cb()
      },
    }) as unknown as NodeJS.WriteStream
    const logs: string[] = []
    return { stdin, stdout, log: (m: string) => logs.push(m), logs, get out() { return out } }
  }

  const freeQ: Question = { key: 'reviewModel', prompt: 'model', current: 'x', currentIsDefault: true }
  const enumQ: Question = {
    key: 'stopGate',
    prompt: 'stop',
    current: 'phase',
    currentIsDefault: true,
    choices: ['phase', 'req', 'merge'],
  }

  it('🔴 자유 입력이 끝나면 stdin 에 readline 리스너가 남지 않는다', async () => {
    const io = ttyIo()
    const p = createReadlinePrompter(io)
    const answer = p.ask(freeQ, hintFor(freeQ))
    io.stdin.push('gpt-x\n')
    expect(await answer).toBe('gpt-x')
    // readline 이 붙였던 리스너가 전부 떨어졌는가 — 이게 격리의 관측 가능한 정의다.
    expect(io.stdin.listenerCount('data')).toBe(0)
    expect(io.stdin.listenerCount('readable')).toBe(0)
    p.close?.()
  })

  it('🔴 자유 입력 뒤 enum 선택에서 방향키를 위젯만 처리한다', async () => {
    const io = ttyIo()
    const p = createReadlinePrompter(io)
    const first = p.ask(freeQ, hintFor(freeQ))
    io.stdin.push('gpt-x\n')
    await first

    const second = p.ask(enumQ, hintFor(enumQ))
    await new Promise((r) => setImmediate(r)) // 위젯이 리스너를 붙일 틈
    // 위젯이 붙인 리스너 하나뿐이어야 한다 — readline 이 남아 있으면 2개가 된다.
    expect(io.stdin.listenerCount('data')).toBe(1)
    io.stdin.push(String.fromCharCode(27) + '[B') // ↓ → '유지' 다음 = 첫 enum 값
    io.stdin.push(String.fromCharCode(13)) // Enter
    expect(await second).toBe('phase')
    expect(io.stdin.listenerCount('data')).toBe(0)
    p.close?.()
  })
})

/** REQ-2026-067 phase-3 — 배너(DEC-7)와 저장 안내(DEC-8). */
describe('[setup] 배너 · 저장 안내', () => {
  it('배너에 버전이 들어가고 ASCII 로만 그려진다', () => {
    const b = setupBanner('1.2.3')
    expect(b).toContain('1.2.3')
    expect(b).toContain('COMMITGATE'.split('').join(' '))
    // 🔴 박스 드로잉 문자를 쓰지 않는다 — Windows 콘솔 기본 폰트에서 깨진다.
    expect(/[─-╿]/.test(b)).toBe(false)
  })

  it('테두리 줄들이 같은 너비다(한글 2칸 계산)', () => {
    const lines = setupBanner('0.10.0').split('\n').filter((l) => l !== '')
    expect(lines[0]).toBe(lines[lines.length - 1])
    for (const l of lines.slice(1, -1)) expect(l.endsWith('|')).toBe(true)
  })

  /**
   * 🔴 실측(matjib-nuxt): 진행 중 티켓이 있는 저장소에서 setup 을 돌리면 req.config.json 이 uncommitted 라
   * req:doctor 가 D10·D13 으로 FAIL 한다. 안내가 없으면 사용자는 setup 이 워크플로를 망가뜨렸다고 읽는다.
   */
  it('🔴 저장 안내가 커밋을 지시하고 그 이유(D10·D13)를 밝힌다', () => {
    const m = savedMessage('/x', ['stopGate'], '/x')
    expect(m).toContain('req.config.json')
    expect(m).toContain('stopGate')
    expect(m).toContain('git add req.config.json')
    expect(m).toContain('git commit')
    expect(m).toContain('D10')
    expect(m).toContain('D13')
  })

  /**
   * 🔴 `--dir` 로 다른 저장소를 대상으로 삼는 정상 경로가 있다(phase-3 r01 P1).
   * 그때 `git add req.config.json` 을 그대로 실행하면 **현재 디렉터리에서 실패하거나 엉뚱한 파일을
   * stage** 한다 — 안내가 해결하려던 D10·D13 차단이 그대로 남는다.
   */
  /**
   * 🔴 phase-3 r02 P1 — **경로를 셸 명령 안에 넣지 않는다.** 디렉터리 이름은 사용자가 정하는 데이터이고,
   * POSIX 셸은 큰따옴표 안에서도 `$()`·백틱을 평가한다. 안내를 그대로 붙여넣으면 코드가 실행된다.
   */
  it('🔴 경로에 $() · 백틱이 있어도 실행되는 명령에 섞이지 않는다', () => {
    const evil = '/tmp/repo-$(touch /tmp/pwn)-`id`'
    const m = savedMessage(evil, ['stopGate'], '/somewhere/else')
    const cmdLine = m.split('\n').find((l) => l.includes('git add'))!
    // 명령 줄에는 경로가 아예 없다 — 인용이 아니라 **부재**가 방어다.
    expect(cmdLine).not.toContain('$(')
    expect(cmdLine).not.toContain('`')
    expect(cmdLine).not.toContain('/tmp/repo-')
    // 경로는 데이터로만 보여 준다.
    expect(m).toContain(evil)
  })

  it('🔴 --dir 가 cwd 와 다르면 어느 저장소에서 실행할지 알려 준다', () => {
    const m = savedMessage('/target/repo', ['stopGate'], '/somewhere/else')
    expect(m).toContain('/target/repo')
    expect(m).toContain('현재 디렉터리가 아닙니다')
  })

  it('--dir 가 cwd 와 같으면 위치 안내를 덧붙이지 않는다', () => {
    expect(savedMessage('/x', ['stopGate'], '/x')).not.toContain('현재 디렉터리가 아닙니다')
  })

  it('바뀐 키가 없어도 setup 완료 기록은 알린다', () => {
    expect(savedMessage('/x', [], '/x')).toContain('setup 완료 기록')
  })
})

/**
 * REQ-2026-067 phase-4 — 안내 분리(DEC-11)와 항목 설명(DEC-12).
 *
 * 🔴 헤드라인: 메뉴 질문에 자유 입력용 문구가 남으면 **거짓 안내**다. 0.10.0 실측 화면이 그랬다 —
 *    `'-'=비움`을 보고 사용자가 `-`를 입력해도 받을 곳이 없다.
 */
describe('[setup] 안내 분리 · 항목 설명', () => {
  const menuQ = buildQuestions({}).find((q) => q.key === 'stopGate')!
  const freeQ2 = buildQuestions({}).find((q) => q.key === 'reviewModel')!

  it('🔴 메뉴 질문 안내에는 자유 입력용 문구가 없다', () => {
    const h = hintFor(menuQ)
    expect(h).not.toContain('선택지:')
    expect(h).not.toContain("'-'")
    expect(h).not.toContain('Enter=유지')
  })

  /** REQ-2026-112: 고지 내용이 "정지 지점을 이 값이 정한다"로 바뀌었다 — 고지가 **붙는다는 사실**을 본다. */
  it('메뉴 질문 안내는 현재 값과 정지 지점 고지를 남긴다', () => {
    const h = hintFor(menuQ)
    expect(h).toContain('현재:')
    expect(h).toContain('정지 지점')
  })

  /** 🔴 자유 입력 안내는 이 REQ의 명시 제외 — 한 글자도 바뀌면 안 된다. */
  it('🔴 degrade 경로 안내는 조작법을 그대로 담는다', () => {
    const h = freeInputHint(freeQ2)
    expect(h).toContain('Enter=유지')
    expect(h).toContain(NULL_SENTINEL)
  })

  it('값에 설명이 붙는다', () => {
    const items = buildSelectItems(menuQ)
    expect(items.find((i) => i.answer === 'merge')!.note).toContain('묶음')
  })

  /**
   * 🔴 설명표는 **부분 사전**이다. 필수 대응이면 enum 이 늘었을 때 여기 빠진 값이 사라지고,
   * 그러면 스키마가 SSOT 라는 계약이 깨진다.
   */
  it('🔴 설명이 없는 값도 선택지에 그대로 남는다', () => {
    const q: Question = { ...menuQ, choices: ['phase', 'brand-new-value'] }
    const items = buildSelectItems(q)
    const fresh = items.find((i) => i.answer === 'brand-new-value')
    expect(fresh).toBeDefined()
    expect(fresh!.note).toBeUndefined()
  })

  it('현재 값 항목에 "현재 값" 표시가 붙는다', () => {
    const items = buildSelectItems({ ...menuQ, current: 'req' })
    expect(items.find((i) => i.answer === 'req')!.note).toContain('현재 값')
  })
})

/**
 * REQ-2026-067 phase-4 — 리뷰 모델 추천 목록(사용자 지시).
 *
 * 🔴 헤드라인: **추천 목록은 enum 이 아니다.** 스키마를 enum 으로 잠그면 다른 모델을 핀한 기존
 *    소비자의 `req.config.json` 이 스키마 위반으로 거부되어 모든 명령이 막힌다.
 */
describe('[setup] 리뷰 모델 추천 목록', () => {
  const modelQ = () => buildQuestions({}).find((q) => q.key === 'reviewModel')!

  it('세 모델이 목록으로 나오고 terra 가 기본값이다', () => {
    expect([...MODEL_SUGGESTIONS]).toEqual(['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'])
    expect(modelQ().current).toBe('gpt-5.6-terra')
    expect(modelQ().currentIsDefault).toBe(true)
  })

  it('🔴 스키마는 여전히 자유 문자열이다 — 목록 밖 모델도 유효하다', () => {
    expect(choicesFor('reviewModel')).toBeUndefined() // enum 아님
    expect(validateValue('reviewModel', 'some-other-model')).toEqual([])
  })

  it('🔴 목록에 "직접 입력" 항목이 있다 — 목록 밖 값을 쓸 길이 남는다', () => {
    const items = buildSelectItems(modelQ())
    expect(items.some((i) => i.answer === FREE_TEXT_SENTINEL)).toBe(true)
  })

  it('enum 질문에는 직접 입력 항목이 없다(값이 정해져 있다)', () => {
    const stop = buildQuestions({}).find((q) => q.key === 'stopGate')!
    expect(buildSelectItems(stop).some((i) => i.answer === FREE_TEXT_SENTINEL)).toBe(false)
  })

  /** 🔴 sentinel 이 설정 파일이나 검증 경로로 새면 안 된다 — `ask` 가 그 자리에서 소비한다. */
  it('🔴 sentinel 은 정상 값과 겹치지 않는다', () => {
    expect(validateValue('reviewModel', FREE_TEXT_SENTINEL).length).toBeGreaterThan(0)
    expect(MODEL_SUGGESTIONS).not.toContain(FREE_TEXT_SENTINEL)
  })

  it('기본 추론강도는 medium 이다(사용자 지시로 high 에서 변경)', () => {
    expect(DEFAULTS.reviewReasoningEffort).toBe('medium')
    expect(buildQuestions({}).find((q) => q.key === 'reviewReasoningEffort')!.current).toBe('medium')
  })
})

/**
 * REQ-2026-067 phase-4 r01 P1 — 메뉴 → 직접 입력 경로.
 *
 * 🔴 헤드라인: **직접 입력 화면에도 조작법이 나와야 한다.** 없으면 `-` 로 비우려는 사용자가
 *    방법을 알 수 없다 — 문서가 "직접 입력에서 `-` 로 비움"이라고 안내하는데 화면에는 그 말이 없다.
 */
describe('[setup] 메뉴 → 직접 입력', () => {
  function ttyIo() {
    const { Readable, Writable } = require('node:stream') as typeof import('node:stream')
    const stdin = new Readable({ read() {} }) as unknown as NodeJS.ReadStream & { push(c: unknown): boolean }
    Object.assign(stdin, { isTTY: true, isRaw: false, setRawMode(v: boolean) { ;(this as { isRaw: boolean }).isRaw = v; return this } })
    const stdout = new Writable({ write(_c: unknown, _e: unknown, cb: () => void) { cb() } }) as unknown as NodeJS.WriteStream
    const logs: string[] = []
    return { stdin, stdout, log: (m: string) => logs.push(m), logs }
  }

  it('🔴 직접 입력 화면에 Enter=유지 · "-"=비움 안내가 나오고 `-` 가 비움으로 해석된다', async () => {
    const io = ttyIo()
    const p = createReadlinePrompter(io)
    const q = buildQuestions({}).find((x) => x.key === 'reviewModel')!
    const answer = p.ask(q, hintFor(q))
    await new Promise((r) => setImmediate(r))
    // 목록: [유지, 비움, sol, terra, luna, 직접 입력…] → ↓ 5번이면 마지막
    const items = buildSelectItems(q)
    const idx = items.findIndex((i) => i.answer === FREE_TEXT_SENTINEL)
    for (let i = 0; i < idx; i++) io.stdin.push(String.fromCharCode(27) + '[B')
    io.stdin.push(String.fromCharCode(13))
    await new Promise((r) => setImmediate(r))
    io.stdin.push(NULL_SENTINEL + '\n')

    expect(await answer).toBe(NULL_SENTINEL)
    expect(interpretAnswer(NULL_SENTINEL)).toBeNull() // 비움으로 해석된다
    p.close?.()
  })

  it('🔴 sentinel 은 답으로 새어 나가지 않는다', async () => {
    const io = ttyIo()
    const p = createReadlinePrompter(io)
    const q = buildQuestions({}).find((x) => x.key === 'reviewModel')!
    const answer = p.ask(q, hintFor(q))
    await new Promise((r) => setImmediate(r))
    const idx = buildSelectItems(q).findIndex((i) => i.answer === FREE_TEXT_SENTINEL)
    for (let i = 0; i < idx; i++) io.stdin.push(String.fromCharCode(27) + '[B')
    io.stdin.push(String.fromCharCode(13))
    await new Promise((r) => setImmediate(r))
    io.stdin.push('my-own-model\n')
    const got = await answer
    expect(got).toBe('my-own-model')
    expect(got).not.toContain('free-text')
    p.close?.()
  })
})
