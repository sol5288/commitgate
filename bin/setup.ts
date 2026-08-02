#!/usr/bin/env tsx
/**
 * commitgate setup — 리뷰어 설정 대화형 마법사 (REQ-2026-060).
 *
 * 🔴 **이 저장소 최초의 대화형 명령이자 최초의 "사람 전용" 명령이다**(설계 DEC-1·DEC-12).
 *    다른 모든 verb는 flag 기반이고 **에이전트가 비대화형으로 실행하는 것이 설계 전제**였다
 *    (`readline`/`isTTY`/`process.stdin` 사용처가 이 REQ 전까지 0건이었다).
 *    대화형 전용으로 두는 이유는 편의가 아니라 **에이전트가 게이트 정책을 스스로 바꾸는 경로를
 *    구조적으로 닫기 위해서**다(`req-commit.ts`의 "가장 강한 보장 = 사용자가 직접 실행"과 같은 축).
 *
 * 🔴 **절대 blocking read에 들어가지 않는다.** TTY 판정을 **가장 먼저** 하고, 실패하면 질문을 하나도 던지지
 *    않은 채 즉시 실패한다. 들어가면 에이전트 세션이 그대로 얼어붙는다.
 *
 * 흐름은 `runSetup`의 ①~⑦(설계 DEC-10)이고, **쓰기는 ⑦ 한 곳뿐**이다.
 */
import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline/promises'
import { canUseRawMode, colorEnabled, colorize, displayWidth, runSelect } from './select-prompt'
import Ajv from 'ajv'
import { CONFIG_SCHEMA, DEFAULTS, stripBom, STOP_GATE_OF, type SetupMarker, type PhaseCommitPolicy } from '../scripts/req/lib/config'
import { createReviewerProbes, codexMissingSetupMessage, type ReviewerProbes } from '../scripts/req/lib/adapters'
import { isEntrypoint } from '../scripts/req/lib/cli-boundary'

/**
 * TTY 판정 입력(주입 가능 — 테스트). `process.std*.isTTY`는 **비-TTY에서 `undefined`**이지 `false`가 아니므로
 * 타입이 `boolean | undefined`다. 이 구분이 판정식(`=== true`)의 이유다.
 */
export interface TtyStreams {
  stdin: boolean | undefined
  stdout: boolean | undefined
}

/**
 * 대화형 판정(설계 DEC-2 — **실측으로 확정한 판정식**).
 *
 * **stdin·stdout이 모두 `true`일 때만** 대화형으로 본다. 질문을 읽으려면 stdin이, 그 질문을 보여 주려면
 * stdout이 각각 터미널이어야 하므로 둘 다 요구한다. `undefined`(비-TTY의 실제 값)와 `false`는 모두 거부다.
 *
 * ## phase-1 spike 실측 (Windows 11 · Git for Windows 2.46.0 · Node v24.18.0)
 *
 * | 조합                                   | stdin/stdout        | 판정 |
 * |----------------------------------------|---------------------|------|
 * | PowerShell 대화형 콘솔                  | `true` / `true`     | 허용 |
 * | **Git Bash(mintty) 대화형**             | **`true` / `true`** | 허용 |
 * | 위 두 터미널에서 `npx` 경유             | 유지(true/true)      | 허용 |
 * | 에이전트/파이프 셸(stdio 리다이렉트)     | `undefined`         | 거부 |
 *
 * (`npm run` 경유 조합은 **존재하지 않는다** — `setup`은 `req:` 접두 verb가 아니라 대상 repo의
 *  `package.json`에 스크립트가 주입되지 않는다. 설계 DEC-13 / `init.ts`의 `STAGE_B_REQ_VERBS`.)
 *
 * 🔴 **"mintty는 `isTTY`가 `undefined`"는 옛 이야기다.** Git for Windows가 ConPTY를 쓰면서 대화형 mintty도
 *    `true`를 보고한다(위 실측). 따라서 `=== true` 판정식이 **정상 경로를 거부하지 않는다** — 통상 경로인
 *    `npx commitgate setup`이 두 터미널 모두에서 그대로 통과한다.
 *
 * ⚠️ **env 휴리스틱(`TERM`·`MSYSTEM` 등)으로 보완하지 않는다 — 실측으로 배제했다.**
 *    비대화형 에이전트 셸에서도 `TERM=xterm-256color`·`MSYSTEM=MINGW64`가 그대로 존재한다.
 *    즉 env는 대화형/비대화형을 **구분하지 못하며**, env로 보완하면 이 가드가 막아야 할 바로 그 에이전트
 *    경로를 false-allow 한다.
 */
export function isInteractiveTty(streams: TtyStreams): boolean {
  return streams.stdin === true && streams.stdout === true
}

/**
 * 비-TTY 거부 메시지(설계 DEC-1).
 *
 * 주 독자는 **에이전트**다 — "네가 실행할 명령이 아니다, 사용자에게 요청하라". 이것이 통상적으로 이 메시지가
 * 뜨는 유일한 상황이다: 실측상 **지원 터미널(PowerShell·Git Bash)에서 직접 실행하면 그대로 통과**하므로
 * (`isInteractiveTty` 실측표), 사람이 이 메시지를 보는 것은 stdio가 리다이렉트됐거나(파이프·CI) ConPTY 이전
 * 구형 Git for Windows인 예외적 경우다. 마지막 줄은 그 잔여 경우를 위한 **탈출로**이며, 정상 실행법이 아니다.
 */
export const NON_TTY_MESSAGE = [
  '이 명령은 대화형 전용입니다 — 터미널이 아니어서 실행할 수 없습니다.',
  '',
  '  · 에이전트(Claude/Codex)는 이 명령을 실행하지 않습니다. 사용자에게 실행을 요청하세요.',
  '  · 사람이라면 터미널 창에서 직접 실행하세요:  npx commitgate setup',
  '    (PowerShell·Git Bash 모두 그대로 동작합니다. 파이프·리다이렉트·CI에서는 동작하지 않습니다.)',
  '  · 터미널에서 직접 실행했는데도 이 메시지가 보인다면 구형 Git for Windows(ConPTY 이전)일 수 있습니다.',
  '    그때만 예외적으로:  winpty npx commitgate setup',
].join('\n')

// ─────────────────────────────────────────── 순수 코어 (phase-2) ──

/**
 * setup이 다루는 설정 키(설계 DEC-4). **의도적으로 2개다.**
 *
 * ⚠️ `CONFIG_SCHEMA` **전체에서 질문을 파생하지 않는다** — 그러면 `ticketRoot`·`handoffPath`·`designDocs`까지
 *    묻게 되어 이 REQ의 범위(모델·effort)를 넘는다. 대신 **질문은 여기서 명시하고, 검증 규칙만 스키마에서
 *    가져온다**(`subSchemaFor`). 그래서 enum이 늘어도 질문이 자동으로 따라가고 스키마와 갈라지지 않는다.
 */
export const SETUP_KEYS = ['reviewModel', 'reviewReasoningEffort', 'stopGate'] as const
export type SetupKey = (typeof SETUP_KEYS)[number]

/**
 * "값을 비운다(= codex 전역 설정 상속)"를 뜻하는 입력 sentinel.
 *
 * `-`를 쓰는 이유: `reviewModel`의 패턴(`^[A-Za-z0-9]…`)은 선행 `-`를 **거부**하고,
 * `reviewReasoningEffort`의 enum에도 `-`가 없다. 즉 두 키 모두에서 **정상 값과 충돌하지 않는다**.
 * (`none`은 쓸 수 없다 — effort의 **유효한 enum 값**이라 "비움"과 구별되지 않는다.)
 */
export const NULL_SENTINEL = '-'

/**
 * "직접 입력하겠다"를 뜻하는 **내부 전용** 항목 값(REQ-2026-067 phase-4).
 *
 * 🔴 이 값은 `interpretAnswer`에 도달하지 않는다 — `ask` 구현이 그 자리에서 자유 입력으로 넘긴다.
 *    설정 파일이나 검증 경로에 새면 안 되므로 정상 값과 겹칠 수 없는 형태로 둔다.
 */
/**
 * 🔴 제어문자는 **코드로 만든다**. 소스에 원시 NUL을 박으면 git이 파일을 binary로 취급해
 *    diff·grep·리뷰가 통째로 깨진다(REQ-2026-066에서 실제로 겪은 함정).
 */
export const FREE_TEXT_SENTINEL = String.fromCharCode(0) + 'free-text'


export interface Question {
  key: SetupKey
  prompt: string
  /** 현재 해소값(파일 또는 DEFAULTS). `null` = 비움(전역 상속). */
  current: string | null
  /** 현재값이 파일이 아니라 `DEFAULTS`에서 왔는지 — 프롬프트가 "(기본값)"을 붙이는 근거. */
  currentIsDefault: boolean
  /** enum 키일 때 선택지(표시용). 검증 자체는 스키마가 한다. */
  choices?: readonly string[]
  /**
   * 🔴 선택지가 **enum이 아니라 추천 목록**인가(REQ-2026-067 phase-4).
   *
   * `reviewModel`은 스키마가 자유 문자열이다 — codex가 받는 모델은 우리가 아는 셋보다 많고,
   * enum으로 잠그면 다른 모델을 핀한 기존 소비자가 **설정을 못 쓰게 된다**. 그래서 셋을 목록으로
   * 보여 주되 **"직접 입력" 항목**을 함께 둔다. 스키마는 건드리지 않는다.
   */
  freeTextAllowed?: boolean
}

export interface Prompter {
  ask(q: Question, hint: string): Promise<string>
  /** readline 자원 정리. 없으면 no-op — 스크립트된 테스트 Prompter는 구현하지 않아도 된다. */
  close?(): void
}

/** `CONFIG_SCHEMA`에서 해당 키의 서브스키마를 꺼낸다(검증 SSOT — DEC-4). 없으면 fail-closed. */
export function subSchemaFor(key: SetupKey): Record<string, unknown> {
  const props = CONFIG_SCHEMA.properties as Record<string, unknown>
  const sub = props[key]
  if (!sub || typeof sub !== 'object')
    throw new Error(`CONFIG_SCHEMA에 '${key}' 서브스키마가 없습니다 — 설정 검증 SSOT가 깨졌습니다(fail-closed).`)
  return sub as Record<string, unknown>
}

const ajv = new Ajv({ allErrors: true })

/** 값 하나를 해당 키의 서브스키마로 검증. 문제 목록(빈 배열 = 통과). */
export function validateValue(key: SetupKey, value: string | null): string[] {
  const validate = ajv.compile(subSchemaFor(key))
  if (validate(value)) return []
  return (validate.errors ?? []).map((e) => `${e.message ?? 'invalid'}${e.params ? ` (${JSON.stringify(e.params)})` : ''}`)
}

/**
 * 이 키가 **비움(`null`)을 받을 수 있는가** — 스키마가 근거다(REQ-2026-067 DEC-6).
 *
 * 🔴 화면(안내·선택 목록)과 검증이 **같은 근거**를 써야 한다. `q.key === 'stopGate'` 같은 하드코딩을
 *    두 곳에 두면 갈라지고, 그러면 "비움" 항목을 보여 놓고 고르면 거부하는 화면이 나온다.
 */
export function allowsNullValue(key: SetupKey): boolean {
  return validateValue(key, null).length === 0
}

/**
 * `reviewModel`의 **추천 목록**(enum이 아니다 — 스키마는 자유 문자열 그대로다).
 *
 * 🔴 여기 없는 모델도 **직접 입력으로 쓸 수 있어야 한다.** enum으로 잠그면 다른 모델을 핀한
 *    기존 소비자의 `req.config.json`이 스키마 위반으로 거부되어 모든 명령이 막힌다.
 */
export const MODEL_SUGGESTIONS: readonly string[] = ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']

/** 스키마의 enum에서 표시용 선택지를 뽑는다(`null` 제외 — 그건 `NULL_SENTINEL`로 표현된다). */
export function choicesFor(key: SetupKey): readonly string[] | undefined {
  const sub = subSchemaFor(key)
  const en = sub.enum
  if (!Array.isArray(en)) return undefined
  return en.filter((v): v is string => typeof v === 'string')
}

/** 현재 설정(파일 raw + DEFAULTS)에서 질문 목록을 만든다. */
export function buildQuestions(raw: Record<string, unknown>): Question[] {
  const PROMPTS: Record<SetupKey, string> = {
    reviewModel: '리뷰 모델(codex `-c model=`)',
    reviewReasoningEffort: '리뷰 추론강도(codex `-c model_reasoning_effort=`)',
    stopGate: '사람이 멈추는 지점',
  }
  return SETUP_KEYS.map((key) => {
    // 🔴 `reviewModel`은 스키마상 자유 문자열이다 — 추천 목록일 뿐 enum이 아니다(위 `freeTextAllowed`).
    const suggested = key === 'reviewModel' ? MODEL_SUGGESTIONS : choicesFor(key)
    // 🔴 `stopGate`는 legacy `phaseCommit`에서 **역파생**될 수 있다(REQ-2026-063 DEC-3). 그 경우를 무시하고
    //    DEFAULTS를 보여 주면, 파일이 `low-only`인데 화면은 `phase [기본값]`이라고 말하는 거짓 표시가 된다.
    const derived = key === 'stopGate' ? derivedStopGate(raw) : null
    const present = Object.prototype.hasOwnProperty.call(raw, key) || derived !== null
    const v = Object.prototype.hasOwnProperty.call(raw, key)
      ? raw[key]
      : (derived ?? (DEFAULTS as Record<string, unknown>)[key])
    return {
      key,
      prompt: PROMPTS[key],
      current: typeof v === 'string' ? v : null,
      currentIsDefault: !present,
      choices: suggested,
      freeTextAllowed: key === 'reviewModel',
    }
  })
}

/** legacy `phaseCommit`에서 역파생한 `stopGate`. 그 키가 없으면 `null`. */
function derivedStopGate(raw: Record<string, unknown>): string | null {
  const pc = raw.phaseCommit
  if (!pc || typeof pc !== 'object') return null
  const a = (pc as { autoApprove?: unknown }).autoApprove
  return typeof a === 'string' && a in STOP_GATE_OF ? STOP_GATE_OF[a as PhaseCommitPolicy] : null
}

/**
 * 🔴 `stopGate` 질문에만 붙는 고지(REQ-2026-063 DEC-6).
 *
 * 이 문장이 하는 일은 **이 값이 무엇을 정하는지** 그 자리에서 알려주는 것이다. 사용자는 지금
 * 정지 지점을 고르고 있고, 값마다 멈추는 자리가 다르다(`userConfirmGate`). 그리고 어떤 값을 골라도
 * 통합 승인은 남는다는 사실이 함께 있어야 "전부 자동이 됐다"는 오해가 생기지 않는다.
 *
 * 🔴 **보장을 약속하지 않는다.** 예전 문구는 위험도에 따라 매 phase 확인이 남는다고 적었는데,
 *    REQ-2026-071이 그 백스톱을 걷어내고 정지 지점을 이 값 하나로 모은 뒤에도 그대로 남아 있었다.
 *    설정 화면이 실제 동작보다 강한 약속을 하면, 사용자는 보호받는다고 믿는 자리에서 보호받지 못한다.
 */
export const STOP_GATE_HIGH_NOTICE =
  '정지 지점은 이 값이 정합니다 — phase: 매 phase 커밋 전 · req: REQ를 끝내는 커밋 전 · merge: 커밋에서는 멈추지 않음 · 통합(main 병합) 승인은 어느 값에서도 필요합니다'

/** 질문 하나에 붙일 안내 문구(순수 — 프롬프트 렌더링의 SSOT). */
/**
 * 안내 문구. **질문 형태별로 다르다**(phase-4 DEC-11).
 *
 * 🔴 메뉴 질문에 자유 입력용 문구를 재사용하면 **거짓 안내**가 된다. 0.10.0 실측 화면이 그랬다:
 *    `선택지: …`(메뉴가 이미 보여 준다) · `'-'=비움`(메뉴에는 그런 입력이 없다) ·
 *    `Enter=유지`(첫 항목이 그 역할이다). 둘은 중복이고 하나는 사용자가 따라 할 수 없는 지시다.
 */
export function hintFor(q: Question): string {
  const cur = q.current === null ? '(비움 — codex 전역 설정 상속)' : q.current
  const src = q.currentIsDefault ? ' [기본값]' : ''
  // 🔴 근거는 스키마 하나다(`allowsNullValue`) — 하드코딩을 두 곳에 두면 화면과 검증이 갈라진다.
  const notice = !allowsNullValue(q.key) ? `\n  ⚠️ ${STOP_GATE_HIGH_NOTICE}` : ''
  // 메뉴 질문: 현재 값 + (해당되면) 고지만. 조작 안내는 위젯이 낸다.
  if (q.choices) return `현재: ${cur}${src}${notice}`
  return freeInputHint(q)
}

/**
 * 자유 입력 안내(순수).
 *
 * 🔴 위젯을 못 쓰는 환경(raw mode 미지원)에서는 메뉴 질문도 **자유 입력으로 degrade**한다(DEC-9).
 *    그때 메뉴용 안내를 그대로 내면 사용자가 `Enter=유지`·`'-'=비움`을 알 길이 없다 —
 *    **조작법이 사라진 화면**이 된다. 그래서 degrade 경로는 이 안내를 쓴다.
 */
export function freeInputHint(q: Question): string {
  const cur = q.current === null ? '(비움 — codex 전역 설정 상속)' : q.current
  const src = q.currentIsDefault ? ' [기본값]' : ''
  const notice = !allowsNullValue(q.key) ? `\n  ⚠️ ${STOP_GATE_HIGH_NOTICE}` : ''
  const list = q.choices?.length ? `\n  ${q.freeTextAllowed ? '추천' : '선택지'}: ${q.choices.join(' / ')}` : ''
  const keep = allowsNullValue(q.key) ? `\n  Enter=유지 · '${NULL_SENTINEL}'=비움(전역 상속)` : `\n  Enter=유지`
  return `현재: ${cur}${src}${notice}${list}${keep}`
}

/** 선택 목록의 한 항목: 화면에 보이는 라벨과, 고르면 `ask`가 돌려줄 **원시 답 문자열**. */
export interface SelectItem {
  label: string
  /** `interpretAnswer`가 해석할 값 — `''`=유지 · `NULL_SENTINEL`=비움 · 그 외=그 값. */
  answer: string
  /** 값의 의미 한 줄. 없으면 라벨만 보인다(DEC-12 — 설명은 장식이다). */
  note?: string
}

/**
 * 값별 한 줄 설명(DEC-12). **부분 사전**이다 — 없는 값은 그냥 라벨만 나온다.
 *
 * 🔴 필수 대응이 아니어야 한다. enum이 늘었을 때 여기 빠졌다고 선택지가 사라지면
 *    스키마가 SSOT라는 계약이 깨진다(REQ-2026-063 DEC-4).
 */
const VALUE_NOTES: Partial<Record<SetupKey, Record<string, string>>> = {
  reviewModel: {
    'gpt-5.6-terra': '기본값',
  },
  stopGate: {
    phase: '매 phase 커밋 전에 확인',
    req: 'REQ 하나가 끝날 때 한 번 확인',
    merge: '여러 REQ를 묶어 묶음이 끝날 때까지 미룸',
  },
  reviewReasoningEffort: {
    none: '추론 없음 · 가장 빠르고 얕다',
    minimal: '최소',
    low: '낮음',
    medium: '보통 · 기본값',
    high: '높음',
    xhigh: '매우 높음 · 느리고 비싸다',
  },
}

/**
 * enum 질문의 선택 목록(순수, DEC-6).
 *
 * 🔴 목록은 `[유지] + [비움?] + enum 값들`이다. 특수 답을 빼면 자유 입력에서 되던 일이
 *    선택에서는 안 되는 **기능 후퇴**가 된다 — "유지"는 미기록이고 "비움"은 `null` 기록이라
 *    어느 것도 enum 값으로 대체할 수 없다.
 *
 * 🔴 첫 항목이 **유지**다. 커서가 여기서 시작하므로 "Enter만 누르면 아무것도 안 바뀐다"는
 *    기존 계약이 그대로 성립한다. 현재 값에 커서를 두면 Enter가 **명시 선택**이 되어
 *    파일에 없던 키가 조용히 기록된다(DEC-5).
 */
export function buildSelectItems(q: Question): SelectItem[] {
  const notes = VALUE_NOTES[q.key] ?? {}
  const items: SelectItem[] = [
    {
      label: '현재 값 유지',
      answer: '',
      note: `${q.current === null ? '비움' : q.current}${q.currentIsDefault ? ' · 기본값' : ''} · 파일에 쓰지 않음`,
    },
  ]
  // 비움 항목은 **스키마가 null을 허용할 때만**(`hintFor`와 같은 근거).
  if (allowsNullValue(q.key)) items.push({ label: '비움', answer: NULL_SENTINEL, note: 'codex 전역 설정을 상속' })
  for (const c of q.choices ?? []) {
    const base = notes[c]
    items.push({ label: c, answer: c, note: c === q.current ? (base ? `${base} · 현재 값` : '현재 값') : base })
  }
  // 🔴 추천 목록은 enum이 아니다 — 목록에 없는 값을 쓸 길을 반드시 남긴다(`freeTextAllowed`).
  //    남기지 않으면 다른 모델을 쓰는 소비자가 setup으로는 설정을 못 한다.
  if (q.freeTextAllowed) items.push({ label: '직접 입력…', answer: FREE_TEXT_SENTINEL, note: '목록에 없는 값을 타이핑' })
  return items
}

/**
 * 원시 입력 → 패치 값. `undefined` = **패치하지 않음**(현재값 유지).
 *
 * 🔴 유지일 때 키를 쓰지 않는 것이 의도다(DEC-6: 건드린 키만 바꾼다). 파일에 없던 키를 Enter만으로
 *    박아 넣으면 사용자가 고르지 않은 값을 고른 것처럼 고정된다.
 */
export function interpretAnswer(rawInput: string): string | null | undefined {
  const t = rawInput.trim()
  if (t === '') return undefined
  if (t === NULL_SENTINEL) return null
  return t
}

/** 유효하지 않은 답변을 다시 묻는 횟수 상한(무한 루프 방지 — fail-closed). */
export const MAX_ANSWER_ATTEMPTS = 3

/** 질문을 순회하며 패치를 모은다. 잘못된 답은 상한까지 재질문하고, 넘으면 throw. */
export async function askAll(
  questions: readonly Question[],
  prompter: Prompter,
  onInvalid: (msg: string) => void = () => {},
): Promise<Partial<Record<SetupKey, string | null>>> {
  const patch: Partial<Record<SetupKey, string | null>> = {}
  for (const q of questions) {
    let accepted = false
    for (let attempt = 1; attempt <= MAX_ANSWER_ATTEMPTS && !accepted; attempt++) {
      const value = interpretAnswer(await prompter.ask(q, hintFor(q)))
      if (value === undefined) {
        accepted = true // 유지 — 패치 없음
        break
      }
      const problems = validateValue(q.key, value)
      if (problems.length === 0) {
        patch[q.key] = value
        accepted = true
      } else {
        onInvalid(`'${q.key}' 값이 올바르지 않습니다: ${problems.join('; ')}`)
      }
    }
    if (!accepted) throw new Error(`'${q.key}' 값을 ${MAX_ANSWER_ATTEMPTS}회 안에 확정하지 못했습니다 — 중단합니다.`)
  }
  return patch
}

/** 기존 `req.config.json` 본문 → 평범한 객체. 없으면 `{}`. 배열·null·비객체는 fail-closed. */
export function parseConfigText(text: string | null): Record<string, unknown> {
  if (text === null) return {}
  const t = stripBom(text).trim()
  if (t === '') return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(t)
  } catch (err) {
    throw new Error(`req.config.json 파싱 실패 — 손상된 설정을 덮어쓰지 않습니다: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    throw new Error('req.config.json 이 JSON 객체가 아닙니다 — 덮어쓰지 않습니다(fail-closed).')
  return parsed as Record<string, unknown>
}

/**
 * read-merge-write의 **merge + 직렬화**(DEC-6·DEC-7).
 *
 * - 건드린 키만 교체하고 **나머지 키의 값과 순서를 보존**한다(기존 키는 제자리, 신규 키는 뒤에 추가).
 * - 병합 결과를 `CONFIG_SCHEMA`로 **다시 검증**하고 실패하면 **throw**(쓰기 없음 — fail-closed).
 * - 줄바꿈은 **LF 고정**(`JSON.stringify`는 `\n`만 낸다). autocrlf 환경에서 도구마다 CRLF/LF가 갈리면
 *   무의미한 diff가 생긴다.
 */
export function mergeConfigText(
  existingText: string | null,
  patch: Partial<Record<SetupKey, string | null>>,
  marker?: SetupMarker,
  deleteKeys: readonly string[] = [],
): string {
  const base = parseConfigText(existingText)
  const merged: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(patch)) merged[k] = v
  if (marker) merged.setup = marker
  // 🔴 삭제는 **같은 원자적 쓰기 안에서** 처리한다(REQ-2026-063 DEC-6b). 별도 쓰기로 나누면
  //    중간 상태(두 축이 모순인 파일)가 디스크에 존재하고, 그 상태는 스스로 만든 게이트에 걸린다.
  for (const k of deleteKeys) delete merged[k]

  const validate = ajv.compile(CONFIG_SCHEMA)
  if (!validate(merged)) {
    const msg = (validate.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message ?? ''}`).join('; ')
    throw new Error(`병합된 req.config.json 이 스키마를 위반합니다 — 쓰지 않습니다: ${msg}`)
  }
  return JSON.stringify(merged, null, 2) + '\n'
}

export interface Opts {
  /** 대상 repo 루트(기본: 현재 디렉터리). phase-3의 설정 쓰기가 이 값을 쓴다. */
  dir: string
}

/** 설정 파일 IO 경계(주입 seam — 테스트에서 실제 파일 없이 구동). */
export interface ConfigIo {
  /** 기존 본문. 파일이 없으면 `null`. */
  read(): string | null
  /** 🔴 **유일한 쓰기 지점**(DEC-5·DEC-10 ⑦). 원자적으로 교체한다. */
  write(text: string): void
}

/** 부작용 주입 seam(테스트). 출력·TTY 상태·IO·probe·prompter를 밖에서 준다. */
export interface SetupDeps {
  streams: TtyStreams
  log: (msg: string) => void
  io: ConfigIo
  probes: ReviewerProbes
  createPrompter: () => Prompter
  /**
   * 🔴 **실제 시계**(REQ-2026-062 DEC-1). 주입 seam인 이유는 테스트를 위해서지 값을 지어내기 위해서가 아니다 —
   * 지어낸 타임스탬프는 REQ-2026-019 폐기 사유다. 기본 구현은 `new Date().toISOString()`.
   */
  now: () => string
  /** setup을 실행한 commitgate 버전(마커에 기록). */
  version: string
}

/** 인자 파싱(fail-closed): 값 누락·알 수 없는 옵션은 즉시 throw. */
export function parseArgs(argv: string[]): Opts {
  let dir = process.cwd()
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dir') {
      const v = argv[++i]
      if (!v) throw new Error('--dir 에 경로가 필요합니다')
      dir = v
    } else if (a === '-h' || a === '--help') {
      throw new HelpRequested()
    } else {
      throw new Error(`알 수 없는 옵션: ${a}`)
    }
  }
  return { dir: resolve(dir) }
}

/** `-h/--help` 신호(오류가 아니다 — runCli가 exit 0으로 처리). */
export class HelpRequested extends Error {
  constructor() {
    super('help')
    this.name = 'HelpRequested'
  }
}

/** 설정 파일 이름(대상 repo 루트 기준). */
export const CONFIG_BASENAME = 'req.config.json'

/**
 * 이 패키지의 버전(마커의 `completedVersion`). **패키지 자신의** `package.json`을 읽는다 —
 * 대상 repo의 것이 아니다(대상은 소비자 프로젝트 버전이라 의미가 다르다).
 */
export function packageVersion(): string {
  try {
    const pkgPath = join(resolve(fileURLToPath(import.meta.url), '..', '..'), 'package.json')
    const parsed = JSON.parse(stripBom(readFileSync(pkgPath, 'utf8'))) as { version?: unknown }
    return typeof parsed.version === 'string' && parsed.version ? parsed.version : '0.0.0-unknown'
  } catch {
    return '0.0.0-unknown'
  }
}

/**
 * 원자적 교체(DEC-5). 같은 디렉터리에 temp를 쓰고 `rename`한다 — 같은 볼륨이라 rename이 원자적이고,
 * 중간에 죽어도 **원본이 온전**하다. 실패 시 temp를 치운다(찌꺼기 금지).
 */
export function writeFileAtomic(path: string, content: string): void {
  const tmp = `${path}.tmp-${process.pid}`
  try {
    writeFileSync(tmp, content, 'utf8')
    renameSync(tmp, path)
  } catch (err) {
    try {
      if (existsSync(tmp)) unlinkSync(tmp)
    } catch {
      // 정리 실패는 원래 오류를 가리지 않는다.
    }
    throw err
  }
}

/** 실제 파일 IO. */
export function createConfigIo(dir: string): ConfigIo {
  const path = join(dir, CONFIG_BASENAME)
  return {
    read: () => (existsSync(path) ? readFileSync(path, 'utf8') : null),
    write: (text) => writeFileAtomic(path, text),
  }
}

/** 실제 대화형 Prompter(`node:readline/promises`). IO는 이 한 겹에만 있다(DEC-3). */
/** `createReadlinePrompter`가 만지는 프로세스 표면(테스트 주입 seam). */
export interface PrompterIo {
  stdin: NodeJS.ReadStream
  stdout: NodeJS.WriteStream
  log: (msg: string) => void
}

/**
 * 실제 대화형 Prompter. IO는 이 한 겹에만 있다(REQ-2026-060 DEC-3).
 *
 * 🔴 **readline 인터페이스는 자유 입력 질문마다 만들고 즉시 닫는다**(REQ-2026-067 phase-2 r01 P1).
 *    오래 살려 두고 `pause()`만 하면 readline의 stdin 리스너가 **그대로 남아** raw 선택 위젯과
 *    방향키를 함께 먹는다 — 위젯 출력 위에 readline이 프롬프트를 다시 그려 화면이 깨진다.
 *    `pause()`는 흐름만 멈출 뿐 리스너를 떼지 않는다.
 */
export function createReadlinePrompter(io: PrompterIo = { stdin: process.stdin, stdout: process.stdout, log: (m) => console.log(m) }): Prompter {
  let live: ReturnType<typeof createInterface> | null = null
  const freeInput = async (text: string): Promise<string> => {
    const rl = createInterface({ input: io.stdin, output: io.stdout })
    live = rl
    try {
      return await rl.question(text)
    } finally {
      live = null
      // 🔴 반드시 닫는다. 열린 채 남으면 stdin 핸들이 살아 **CLI 프로세스가 종료되지 않고**,
      //    다음 선택 위젯과 입력을 나눠 갖는다.
      rl.close()
    }
  }
  return {
    ask: async (q, hint) => {
      const header = `\n${q.prompt}\n  ${hint}`
      // 🔴 enum 질문만 방향키로 고른다(DEC-2). 자유 입력(리뷰 모델)은 그대로다.
      //    확정값은 **문자열로** 반환되어 기존 해석·검증·저장 경로를 그대로 탄다.
      if (q.choices && canUseRawMode(io.stdin)) {
        const items = buildSelectItems(q)
        const color = colorEnabled(process.env, io.stdout.isTTY)
        io.log(`${header}\n  ${colorize(color, [2], '↑↓ 이동   Enter 선택   Ctrl+C 취소')}\n`)
        const idx = await runSelect(items, 0, { stdin: io.stdin, stdout: io.stdout }, { color })
        const chosen = items[idx]
        if (!chosen) throw new Error('선택 결과가 목록 범위를 벗어났습니다(내부 오류).')
        // 🔴 "직접 입력"은 값이 아니라 **경로 전환**이다 — 그 자리에서 자유 입력으로 넘긴다.
        //    sentinel이 검증·저장 경로로 새면 안 되므로 여기서 소비한다.
        // 🔴 여기서도 조작법을 낸다(DEC-17). 없으면 `-`로 비우려는 사용자가 방법을 알 수 없다.
        if (chosen.answer === FREE_TEXT_SENTINEL)
          return freeInput(`  ${q.prompt} · 직접 입력\n  ${freeInputHint(q)}\n> `)
        // 🔴 목록은 지우되 **질문과 답을 함께** 남긴다(DEC-14) — 스크롤백에서 무엇을 물었는지 알 수 있어야 한다.
        io.log(`  ${q.prompt} → ${colorize(color, [36, 1], chosen.label)}`)
        return chosen.answer
      }
      // 🔴 raw mode를 못 쓰는 환경은 **자유 입력으로 되돌린다**(DEC-9) — 실패시키지 않는다.
      return freeInput(`${header}\n> `)
    },
    // 🔴 안전망: 예외로 빠져나간 질문이 있어도 남은 인터페이스를 닫는다(멱등).
    close: () => {
      live?.close()
      live = null
    },
  }
}

/** 로그인 실패 시 메시지(수용기준 3·4 — 이 경로에서는 설정이 저장되지 않는다). */
export function loginFailureMessage(detail: string): string {
  return [
    `codex 로그인을 확인하지 못했습니다: ${detail}`,
    '설정을 저장하지 않았습니다 — req.config.json 은 변경되지 않았습니다.',
    '터미널에서 `codex login` 을 마친 뒤 `npx commitgate setup` 을 다시 실행하세요.',
  ].join('\n')
}

/**
 * setup 본체(설계 DEC-10의 ①~⑦).
 *
 * 🔴 **TTY 가드가 가장 먼저**이고 그 앞에는 아무 부작용도 없다 — `deps.log`조차 호출되지 않는다.
 * 🔴 **쓰기는 ⑦ 한 곳뿐**이다. 그 앞의 어떤 실패(설정 파싱·codex 미설치·질문 중단·로그인 실패·스키마 위반)도
 *    `req.config.json`을 건드리지 않는다.
 */
export async function runSetup(opts: Opts, deps: SetupDeps): Promise<void> {
  // ① TTY 판정 — 질문을 만들기 전에.
  if (!isInteractiveTty(deps.streams)) throw new Error(NON_TTY_MESSAGE)

  // 🔴 배너는 TTY 판정 **이후**다(DEC-7). 거부 경로에 장식이 붙으면 에이전트가 읽는 오류 출력이 흐려진다.
  deps.log(setupBanner(deps.version))

  // ② 기존 설정 로드(손상이면 여기서 중단 — 덮어쓰지 않는다).
  const existingText = deps.io.read()
  const raw = parseConfigText(existingText)

  // ③ codex 설치 확인 — 미설치면 로그인·설정 모두 의미가 없다.
  const ver = deps.probes.version()
  // 🔴 메시지는 공유 빌더가 만든다 — 설치 명령을 표면마다 따로 쓰면 새 표면에서 또 빠진다(REQ-2026-083 DEC-2).
  if (!ver.ok) throw new Error(codexMissingSetupMessage(ver.detail))
  deps.log(`codex 확인: ${ver.version ?? '(버전 미상)'}`)

  // ④ 질문(모델·effort). 현재 값이 기본 답변이다(DEC-11).
  //    🔴 prompter 는 반드시 닫는다 — readline 이 열린 채면 프로세스가 끝나지 않는다.
  const prompter = deps.createPrompter()
  let patch: Partial<Record<SetupKey, string | null>>
  try {
    patch = await askAll(buildQuestions(raw), prompter, (m) => deps.log(`  ⚠️  ${m}`))
  } finally {
    prompter.close?.()
  }

  // ⑤ 로그인 — 이미 되어 있으면 건너뛴다. 아니면 실행하고 **재검증**한다(DEC-8·DEC-9).
  const before = deps.probes.auth()
  if (before.state === 'logged-in') {
    deps.log(`codex 로그인 확인됨${before.detail ? `: ${before.detail}` : ''}`)
  } else {
    deps.log('codex 로그인이 필요합니다 — 브라우저 인증을 마치면 이어집니다.')
    deps.probes.login()
    const after = deps.probes.auth()
    // 🔴 setup 에서는 `unknown`도 실패다 — 완료로 넘어가려면 "로그인 성공"이 확정이어야 한다(DEC-9).
    if (after.state !== 'logged-in') throw new Error(loginFailureMessage(`${after.state}(${after.reason}) ${after.detail}`.trim()))
    deps.log('codex 로그인 완료.')
  }

  // ⑥ 병합 + 스키마 재검증(실패면 throw — 쓰기 없음).
  //
  // 🔴 **setup 완료 마커도 여기서 함께 쓴다**(REQ-2026-062 DEC-9). 값을 하나도 바꾸지 않았어도(모두 Enter)
  //    마커는 남긴다 — 마커의 의미는 "값을 바꿨다"가 아니라 **"설정을 확인했다"**이고, 값을 유지한 것도
  //    확인의 결과다. 다만 **마커가 이미 있고 값 변경도 없으면** 아무것도 쓰지 않는다(무의미한 diff 방지).
  const marker: SetupMarker = { completedVersion: deps.version, completedAt: deps.now() }
  const hadMarker = Object.prototype.hasOwnProperty.call(raw, 'setup')
  if (Object.keys(patch).length === 0 && hadMarker) {
    deps.log('변경된 설정이 없습니다 — req.config.json 을 건드리지 않았습니다.')
    return
  }
  // 🔴 `stopGate`를 기록하면 legacy `phaseCommit`을 **같은 쓰기에서 지운다**(REQ-2026-063 DEC-6b).
  //    지우지 않으면 기존 `low-only` 프로젝트에서 `phase`를 고른 **정상 경로**가
  //    두 축이 모순인 파일을 만들고, 그 파일이 config 충돌 검사에 걸려 **이후 모든 명령이 죽는다.**
  //    값이 마침 일치해도 지운다 — alias를 남기면 다음에 한쪽만 손으로 고쳤을 때 같은 덫이 재발한다.
  const deleteKeys = patch.stopGate !== undefined ? ['phaseCommit'] : []
  const merged = mergeConfigText(existingText, patch, marker, deleteKeys)

  // ⑦ 유일한 쓰기.
  deps.io.write(merged)
  const changed = Object.keys(patch)
  deps.log(savedMessage(opts.dir, changed, process.cwd()))
}

/**
 * 시작 배너(순수). **테두리는 ASCII만** 쓴다 — 박스 드로잉 문자는 Windows 콘솔 기본 폰트에서 깨진다.
 * (본문 한글은 그대로 쓰되, 폭 계산에서 2칸으로 센다.)
 * 🔴 비-TTY 거부 경로에서는 출력하지 않는다(DEC-7): 에이전트가 읽는 오류 출력 위에 장식이 붙으면
 *    무엇이 문제인지 흐려진다.
 */
export function setupBanner(version: string): string {
  // 테두리는 박스 드로잉 대신 ASCII(`+`·`-`·`|`)만 쓴다(DEC-7).
  const inner = 52
  const line = '+' + '-'.repeat(inner) + '+'
  const row = (text: string): string => `|  ${text}${' '.repeat(Math.max(0, inner - 3 - displayWidth(text)))} |`
  return [
    '',
    line,
    row(''),
    row('C O M M I T G A T E   ·   setup'),
    row(`v${version}`),
    row(''),
    row('리뷰 모델 · 추론강도 · 멈춤 지점을 정하고'),
    row('codex 로그인까지 함께 마칩니다.'),
    row(''),
    line,
  ].join('\n')
}

/**
 * 저장 후 안내(순수).
 *
 * 🔴 **커밋 안내가 핵심이다**(DEC-8). 진행 중 티켓이 있는 저장소에서 setup을 돌리면
 *    `req.config.json`이 uncommitted 상태가 되어 `req:doctor`가 D10(unstaged 존재)·
 *    D13(설계 승인 없는 비-티켓 변경)으로 **FAIL**한다(matjib-nuxt 실측). 커밋하면 즉시 PASS다.
 *    안내가 없으면 사용자는 방금 실행한 setup이 워크플로를 망가뜨렸다고 읽는다.
 */
export function savedMessage(dir: string, changedKeys: readonly string[], cwd: string): string {
  const what = changedKeys.length ? changedKeys.join(', ') + ' · ' : ''
  const path = join(dir, CONFIG_BASENAME)
  // 🔴 **경로를 셸 명령 안에 넣지 않는다**(phase-3 r02 P1). 어떤 인용을 써도 이식성 있게 안전하지 않다 —
  //    POSIX 셸은 큰따옴표 안에서도 `$()`·백틱을 평가하고, Windows는 인용 규칙이 또 다르다.
  //    디렉터리 이름은 사용자가 정하는 **데이터**이므로, 그것이 붙여넣기 한 번으로 코드가 되면 안 된다.
  //    그래서 경로는 **표시만** 하고, 명령은 경로가 들어가지 않는 고정 문자열로 준다.
  const same = resolve(dir) === resolve(cwd)
  const where = same ? [] : ['', `  위 파일이 있는 저장소에서 실행하세요(현재 디렉터리가 아닙니다): ${dir}`]
  return [
    `저장했습니다: ${path} (${what}setup 완료 기록)`,
    '',
    '  다음: 이 파일을 커밋하세요 —',
    `    git add ${CONFIG_BASENAME} && git commit -m "chore: commitgate setup"`,
    ...where,
    '  (커밋하지 않으면 진행 중인 티켓에서 req:doctor가 D10·D13으로 막습니다)',
  ].join('\n')
}

export function printHelp(): void {
  console.log(`commitgate setup — 리뷰어 설정 대화형 마법사

⚠️ **대화형 전용**입니다. 사람이 터미널에서 직접 실행해야 하며,
   에이전트(Claude/Codex)는 이 명령을 실행하지 않고 사용자에게 실행을 요청합니다.
   터미널이 아니면 질문을 하나도 던지지 않고 즉시 종료합니다.

사용법:
  npx commitgate setup [--dir <대상repo>]

옵션:
  --dir <path>   대상 repo 루트(기본: 현재 디렉터리)
  -h, --help     도움말

하지 않는 일:
  비대화형(--set 등) 설정 경로 · 설치(init 소관) · 게이트 강제 · 자격증명 보관.
`)
}

/**
 * 🔴 이 `runCli`는 `lib/cli-boundary`의 `makeRunCli`를 **일부러 쓰지 않는다**(REQ-2026-105 DEC-4).
 *    두 가지가 다르다: **async**이고(`deps?` 주입 seam까지 받는다), help를 오류가 아닌 정상 종료로
 *    처리한다. 동기 경계 헬퍼로 덮을 수 없고, 덮으려고 일반화하면 공용 계약이 약해진다.
 *    (`isEntrypoint`는 별개 관심사라 아래에서 공유한다.)
 */
export async function runCli(argv: string[], deps?: SetupDeps): Promise<void> {
  try {
    const opts = parseArgs(argv)
    const d: SetupDeps =
      deps ?? {
        streams: { stdin: process.stdin.isTTY, stdout: process.stdout.isTTY },
        log: (m) => console.log(m),
        io: createConfigIo(opts.dir),
        probes: createReviewerProbes(),
        createPrompter: createReadlinePrompter,
        now: () => new Date().toISOString(),
        version: packageVersion(),
      }
    await runSetup(opts, d)
  } catch (err) {
    if (err instanceof HelpRequested) {
      printHelp()
      return
    }
    console.error(`commitgate setup: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  }
}

const isMain = isEntrypoint(import.meta.url)
if (isMain) runCli(process.argv.slice(2))
