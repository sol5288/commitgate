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
  const answers = over.answers ?? ['', '', '']
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
    expect(d.asked.map((q) => q.key)).toEqual(['reviewModel', 'reviewReasoningEffort', 'stopGate'])
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
  it('setup이 다루는 키는 모델·effort·stopGate 셋뿐이다(스키마 전체를 묻지 않는다)', () => {
    expect([...SETUP_KEYS]).toEqual(['reviewModel', 'reviewReasoningEffort', 'stopGate'])
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
    const qs = buildQuestions({ reviewModel: 'my-model', reviewReasoningEffort: 'low', stopGate: 'req' })
    expect(qs.map((q) => [q.key, q.current, q.currentIsDefault])).toEqual([
      ['reviewModel', 'my-model', false],
      ['reviewReasoningEffort', 'low', false],
      ['stopGate', 'req', false],
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
    const p = scripted(['', '', ''])
    expect(await askAll(buildQuestions({}), p)).toEqual({})
    expect(p.asked.map((q) => q.key)).toEqual(['reviewModel', 'reviewReasoningEffort', 'stopGate'])
  })

  it('값 입력 → 패치에 담긴다', async () => {
    const patch = await askAll(buildQuestions({}), scripted(['other-model', 'low', 'req']))
    expect(patch).toEqual({ reviewModel: 'other-model', reviewReasoningEffort: 'low', stopGate: 'req' })
  })

  it('sentinel → null 패치(비움)', async () => {
    const patch = await askAll(buildQuestions({}), scripted([NULL_SENTINEL, NULL_SENTINEL, '']))
    expect(patch).toEqual({ reviewModel: null, reviewReasoningEffort: null })
  })

  it('부적합 답변은 재질문되고, 다음 유효 답이 채택된다', async () => {
    const invalid: string[] = []
    const p = scripted(['bad model', 'good-model', 'ultra', 'high', ''])
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
    const d = deps(true, true, { answers: ['new-model', '', ''] })
    await runSetup({ dir: '/tmp/x' }, d)
    expect(d.loginCalls).toBe(0)
    expect(d.writes).toHaveLength(1)
  })

  it('미로그인 → login 실행 후 재검증 성공 → 저장(수용기준 3)', async () => {
    const d = deps(true, true, { answers: ['new-model', '', ''], authSeq: [loggedOut, loggedIn] })
    await runSetup({ dir: '/tmp/x' }, d)
    expect(d.loginCalls).toBe(1)
    expect(JSON.parse(d.writes[0] as string)).toEqual({
      reviewModel: 'new-model',
      setup: { completedVersion: '9.9.9-test', completedAt: '2026-07-26T00:00:00.000Z' },
    })
  })

  it('🔴 로그인 실패 → throw + 설정 미변경(수용기준 4)', async () => {
    const d = deps(true, true, { answers: ['new-model', '', ''], authSeq: [loggedOut, loggedOut] })
    await expect(runSetup({ dir: '/tmp/x' }, d)).rejects.toThrow('변경되지 않았습니다')
    expect(d.writes).toEqual([])
  })

  it('🔴 재검증이 unknown이어도 실패로 처리한다(setup은 엄격 — DEC-9)', async () => {
    const d = deps(true, true, { answers: ['new-model', '', ''], authSeq: [loggedOut, unknown] })
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
    const d = deps(true, true, { answers: ['m1', '', ''], now: '2030-03-04T05:06:07.008Z', cgVersion: '1.2.3' })
    await runSetup({ dir: '/tmp/x' }, d)
    expect(JSON.parse(d.writes[0] as string).setup).toEqual({
      completedVersion: '1.2.3',
      completedAt: '2030-03-04T05:06:07.008Z',
    })
  })

  it('마커가 담긴 설정도 스키마를 통과한다(하위호환)', async () => {
    const existing = JSON.stringify({ setup: { completedVersion: '0.0.1', completedAt: '2026-01-01T00:00:00Z' } })
    const d = deps(true, true, { existing, answers: ['m2', '', ''] })
    await expect(runSetup({ dir: '/tmp/x' }, d)).resolves.toBeUndefined()
  })

  it('기존 키를 보존하며 저장한다', async () => {
    const d = deps(true, true, {
      existing: JSON.stringify({ branchPrefix: 'feat/req-', reviewModel: 'old' }, null, 2),
      answers: ['new-model', 'low', ''],
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

  it('설정이 없으면 기본값 phase 로 표시된다', () => {
    const sg = buildQuestions({}).find((q) => q.key === 'stopGate')
    expect(sg?.current).toBe('phase')
    expect(sg?.currentIsDefault).toBe(true)
  })

  it('선택지는 스키마 enum에서 온다(2값 — merge 없음)', () => {
    expect(choicesFor('stopGate')).toEqual(['phase', 'req'])
  })

  /**
   * 🔴 이 고지가 없으면 `req`를 고른 사용자가 "이제 전부 자동"이라고 오해하고,
   * HIGH 티켓에서 멈출 때 도구가 고장 난 것으로 본다. 그 정지는 정책이다(REQ-2026-019 폐기 사유).
   */
  it('🔴 hint 가 HIGH 예외와 통합 승인 필요를 고지한다', () => {
    const sg = buildQuestions({}).find((q) => q.key === 'stopGate') as Question
    const h = hintFor(sg)
    expect(h).toContain('HIGH')
    expect(h).toContain('매 phase 확인')
    expect(h).toContain('통합')
  })

  // stopGate 는 "전역 상속" 개념이 없다 — 비움 sentinel을 안내하지도, 허용하지도 않는다.
  it('비움 sentinel 을 안내하지 않고 값으로도 거부한다(DEC-7)', () => {
    const sg = buildQuestions({}).find((q) => q.key === 'stopGate') as Question
    expect(hintFor(sg)).not.toContain('비움(전역 상속)')
    expect(validateValue('stopGate', null).length).toBeGreaterThan(0)
  })

  it('enum 밖 값은 거부된다', () => {
    expect(validateValue('stopGate', 'merge').length).toBeGreaterThan(0)
    expect(validateValue('stopGate', 'req')).toEqual([])
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
    const d = deps(true, true, { existing: legacy, answers: ['', '', 'phase'] })
    await runSetup({ dir: '/tmp/x' }, d)
    const written = JSON.parse(d.writes[0] as string)
    expect(written.stopGate).toBe('phase')
    expect(Object.prototype.hasOwnProperty.call(written, 'phaseCommit')).toBe(false)
    expect(written.branchPrefix).toBe('feat/req-') // 무관한 키는 보존
  })

  it('🔴 값이 일치해도 alias 를 남기지 않는다(한쪽만 손으로 고치면 같은 덫이 재발한다)', async () => {
    const d = deps(true, true, { existing: legacy, answers: ['', '', 'req'] })
    await runSetup({ dir: '/tmp/x' }, d)
    const written = JSON.parse(d.writes[0] as string)
    expect(written.stopGate).toBe('req')
    expect(Object.prototype.hasOwnProperty.call(written, 'phaseCommit')).toBe(false)
  })

  it('stopGate 를 Enter로 유지하면 phaseCommit 도 그대로 둔다(건드린 키만 바꾼다)', async () => {
    const d = deps(true, true, { existing: legacy, answers: ['new-model', '', ''] })
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
    const { d, closes } = countingDeps(['new-model', 'low', ''])
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
