/**
 * 단일 선택 프롬프트의 **순수 코어** (REQ-2026-067 phase-1).
 *
 * 🔴 왜 순수 함수로 빼는가(DEC-1): `commitgate setup`은 대화형 전용이라 **CI에서 실제 키 입력을
 *    검증할 수 없다.** 로직이 raw-mode 어댑터 안에 있으면 회귀 검증이 사람 눈에만 의존하게 된다.
 *    키 시퀀스 → 결과를 순수 함수로 고정해 두면 전 OS CI가 그것을 지킨다.
 *
 * 🔴 파싱은 **스트림 단위**다(DEC-1b). raw stdin은 바이트 스트림이라 정상 입력인 ↑(`\x1b[A`)가
 *    `\x1b` + `[A` 두 청크로 쪼개져 도착할 수 있고, 반대로 여러 키가 한 청크에 붙어 오기도 한다.
 *    청크마다 독립 해석하면 첫 청크의 `\x1b`를 Esc로 읽어 **↑를 눌렀는데 프롬프트가 끝난다.**
 *
 * 이 파일에는 IO가 없다 — raw mode·stdin·화면 출력은 phase-2의 어댑터가 담당한다.
 */

/** 제어 문자는 **코드로 만든다** — 소스에 원시 제어문자를 박으면 git이 binary로 취급해 diff·리뷰가 깨진다. */
const ESC = String.fromCharCode(27)
const CR = String.fromCharCode(13)
const LF = String.fromCharCode(10)
const ETX = String.fromCharCode(3) // Ctrl+C

/** 위젯이 이해하는 키. 그 외 입력은 전부 `other`(무시)로 접힌다. */
export type Key = 'up' | 'down' | 'enter' | 'cancel' | 'other'

/**
 * 완전한 키 시퀀스 → `Key`. 긴 것부터 봐야 `\x1b[A`가 `\x1b`로 잘못 잘리지 않는다.
 *
 * `\x1bOA`/`\x1bOB`는 application cursor mode — 일부 터미널이 방향키를 이 형태로 보낸다.
 * 둘 다 받지 않으면 그런 터미널에서 방향키가 통째로 죽는다.
 */
const SEQUENCES: ReadonlyArray<{ seq: string; key: Key }> = [
  { seq: ESC + '[A', key: 'up' },
  { seq: ESC + '[B', key: 'down' },
  { seq: ESC + 'OA', key: 'up' },
  { seq: ESC + 'OB', key: 'down' },
  { seq: CR, key: 'enter' },
  { seq: LF, key: 'enter' },
  { seq: ETX, key: 'cancel' },
]

/**
 * 더 긴 시퀀스의 **접두사가 될 수 있는** 조각들. 여기 걸리면 잘라내지 않고 다음 청크를 기다린다.
 *
 * 🔴 이 목록이 곧 "단독 Esc를 취소로 쓰지 않는" 이유다: `\x1b` 하나만 보고는 그것이 Esc 키인지
 *    방향키 시퀀스의 시작인지 알 수 없고, 구별하려면 타이머(비결정적·테스트 불가)가 필요하다.
 *    취소는 Ctrl+C 하나로 정했으므로 Esc는 그냥 기다렸다가 인식 불가면 `other`가 된다.
 */
const PREFIXES: readonly string[] = [ESC, ESC + '[', ESC + 'O']

/**
 * 버퍼 앞에서부터 **완전한 키만** 잘라낸다(순수).
 *
 * @returns `keys` = 확정된 키들(도착 순서) · `rest` = 아직 확정할 수 없는 꼬리(다음 청크와 이어 붙인다).
 *
 * 접두사가 될 수 **없는** 바이트는 `other`로 소비한다 — 그러지 않으면 인식 못 하는 입력이 쌓여
 * 버퍼가 무한히 자란다.
 */
export function parseKeys(buffer: string): { keys: Key[]; rest: string } {
  const keys: Key[] = []
  let rest = buffer
  outer: while (rest.length > 0) {
    for (const { seq, key } of SEQUENCES) {
      if (rest.startsWith(seq)) {
        keys.push(key)
        rest = rest.slice(seq.length)
        continue outer
      }
    }
    // 완전한 시퀀스는 아니다 — 더 올 것이 있는 조각이면 여기서 멈춘다.
    if (PREFIXES.includes(rest)) break
    // 접두사도 아니다 → 한 글자 소비하고 계속(버퍼가 자라지 않게).
    keys.push('other')
    rest = rest.slice(1)
  }
  return { keys, rest }
}

export interface SelectState {
  readonly options: readonly string[]
  readonly index: number
}

export type SelectOutcome =
  | { kind: 'move'; state: SelectState }
  | { kind: 'accept'; index: number; value: string }
  | { kind: 'cancel' }
  | { kind: 'ignore' }

/**
 * 키 하나를 적용한다(순수). 상태를 **바꾸지 않고** 새 상태 또는 결과를 낸다.
 *
 * 커서는 양 끝에서 **순환**한다 — 항목이 몇 개든 한 방향키만으로 전부 돌 수 있다.
 */
export function applySelectKey(state: SelectState, key: Key): SelectOutcome {
  const n = state.options.length
  if (n === 0) return key === 'cancel' ? { kind: 'cancel' } : { kind: 'ignore' }
  switch (key) {
    case 'up':
      return { kind: 'move', state: { ...state, index: (state.index - 1 + n) % n } }
    case 'down':
      return { kind: 'move', state: { ...state, index: (state.index + 1) % n } }
    case 'enter': {
      const value = state.options[state.index]
      // 인덱스가 범위를 벗어난 상태는 만들어지지 않지만, 확정은 조용히 틀리면 안 되는 지점이라 확인한다.
      if (value === undefined) return { kind: 'ignore' }
      return { kind: 'accept', index: state.index, value }
    }
    case 'cancel':
      return { kind: 'cancel' }
    default:
      return { kind: 'ignore' }
  }
}

export interface SelectRenderOptions {
  /** 커서 표시(기본 `>`). ASCII만 — Windows 콘솔 폰트 안전. */
  cursor?: string
  /** 각 줄 앞 들여쓰기(기본 두 칸). */
  indent?: string
}

/**
 * 그릴 줄들(순수). 실제 출력은 어댑터가 한다 — 여기서는 문자열만 만든다.
 * 반환 길이가 곧 `eraseLines`에 넘길 줄 수라, 지우기와 그리기가 같은 근거를 쓴다.
 */
export function renderSelect(state: SelectState, opts: SelectRenderOptions = {}): string[] {
  const cursor = opts.cursor ?? '>'
  const indent = opts.indent ?? '  '
  const pad = ' '.repeat(cursor.length)
  return state.options.map((o, i) => `${indent}${i === state.index ? cursor : pad} ${o}`)
}

/**
 * 커서를 `n`줄 위로 올리고 그 아래를 지우는 시퀀스(순수).
 *
 * 🔴 전체 화면 제어(alternate screen buffer·커서 저장/복원)를 쓰지 않는다(DEC-10) —
 *    스크롤백을 먹거나 터미널마다 다르게 동작한다. 우리가 방금 그린 줄만 지운다.
 */
export function eraseLines(n: number): string {
  if (n <= 0) return ''
  return `${ESC}[${n}A${ESC}[0J`
}

// ─────────────────────────────────────── raw mode 어댑터 (phase-2) ──

/** 어댑터가 만지는 IO 표면. 테스트가 대체할 수 있도록 좁게 잡는다. */
export interface SelectIo {
  stdin: NodeJS.ReadStream
  stdout: NodeJS.WriteStream
}

export class SelectCancelled extends Error {
  constructor() {
    super('선택이 취소되었습니다(Ctrl+C).')
    this.name = 'SelectCancelled'
  }
}

/**
 * raw mode를 쓸 수 있는 stdin인가. 드문 플랫폼·환경에서는 `setRawMode`가 없다.
 * 🔴 못 쓴다고 setup을 실패시키지 않는다(DEC-9) — 호출부가 자유 입력으로 되돌린다.
 */
export function canUseRawMode(stdin: NodeJS.ReadStream): boolean {
  return typeof stdin.setRawMode === 'function' && stdin.isTTY === true
}

/**
 * 방향키 단일 선택. 확정된 항목의 인덱스를 낸다.
 *
 * 🔴 **모든 종료 경로에서 raw mode를 되돌린다**(DEC-3). 되돌리지 못하면 사용자 터미널이
 *    **에코 없는 상태로 남는다** — 정상 종료·예외·취소 전부 `finally`를 지난다.
 *
 * 🔴 raw mode에서는 Ctrl+C가 SIGINT를 만들지 않고 그냥 `\x03` 데이터로 온다. 그래서 기본 핸들러에
 *    기댈 수 없고, 우리가 `cancel`로 받아 **정리한 뒤** 던진다.
 */
export function runSelect(
  rows: readonly SelectRow[],
  initialIndex: number,
  io: SelectIo,
  view: SelectViewOptions = {},
): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const items = rows.map((r) => r.label)
    let state: SelectState = { options: items, index: Math.min(Math.max(initialIndex, 0), Math.max(items.length - 1, 0)) }
    let buffer = ''
    let drawn = 0
    const wasRaw = io.stdin.isRaw === true

    const draw = (): void => {
      // 지우기와 그리기가 **같은 줄 수**를 쓴다 — 어긋나면 화면이 겹치거나 지워진다.
      if (drawn > 0) io.stdout.write(eraseLines(drawn))
      const lines = renderRows(rows, state.index, view)
      io.stdout.write(lines.join('\n') + '\n')
      drawn = lines.length
    }

    const cleanup = (): void => {
      io.stdin.removeListener('data', onData)
      io.stdin.pause()
      // 멱등: 이미 되돌렸어도 안전하다.
      if (!wasRaw && typeof io.stdin.setRawMode === 'function') io.stdin.setRawMode(false)
    }

    function onData(chunk: Buffer | string): void {
      buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
      const parsed = parseKeys(buffer)
      buffer = parsed.rest
      for (const key of parsed.keys) {
        const out = applySelectKey(state, key)
        if (out.kind === 'move') {
          state = out.state
          draw()
        } else if (out.kind === 'accept') {
          if (drawn > 0) io.stdout.write(eraseLines(drawn))
          cleanup()
          resolve(out.index)
          return
        } else if (out.kind === 'cancel') {
          if (drawn > 0) io.stdout.write(eraseLines(drawn))
          cleanup()
          reject(new SelectCancelled())
          return
        }
      }
    }

    try {
      if (typeof io.stdin.setRawMode === 'function') io.stdin.setRawMode(true)
      io.stdin.resume()
      io.stdin.setEncoding('utf8')
      io.stdin.on('data', onData)
      draw()
    } catch (err) {
      cleanup()
      reject(err instanceof Error ? err : new Error(String(err)))
    }
  })
}

// ────────────────────────────────────────────── 색 · 표시 (phase-4) ──

const CSI = ESC + '['
const RESET = CSI + '0m'

/**
 * 색을 켤지 결정한다(순수).
 *
 * 🔴 `NO_COLOR`가 있거나 stdout이 TTY가 아니면 **끈다**(DEC-13). escape sequence가 파이프·로그로
 *    새면 읽을 수 없는 출력이 된다 — "대화형이니까 TTY다"라고 가정하지 않는다.
 *    (https://no-color.org — 값이 무엇이든 **존재**하면 끈다.)
 */
export function colorEnabled(env: Record<string, string | undefined>, isTty: boolean | undefined): boolean {
  if (env.NO_COLOR !== undefined) return false
  return isTty === true
}

/** 색 입히기(순수). `enabled=false`면 원문 그대로 — 호출부에 분기를 두지 않는다. */
export function colorize(enabled: boolean, codes: readonly number[], text: string): string {
  if (!enabled || codes.length === 0) return text
  return CSI + codes.join(';') + 'm' + text + RESET
}

/** 선택 목록 한 항목: 값 라벨과(있으면) 한 줄 설명. */
export interface SelectRow {
  label: string
  /** 값의 의미를 한 줄로. 없으면 라벨만 나온다(DEC-12 — 설명은 장식이다). */
  note?: string
}

export interface SelectViewOptions {
  color?: boolean
  /** 커서 표시(기본 `>`). ASCII 기본 — 터미널 폰트에 의존하지 않는다. */
  cursor?: string
}

/**
 * 설명까지 포함해 그릴 줄들(순수, DEC-12·DEC-13).
 *
 * 선택 줄은 굵게(1) + 청록(36), 나머지 설명은 흐리게(2). 색이 꺼지면 커서 문자만으로 구별된다 —
 * 그래서 **색 없이도 읽을 수 있어야** 한다.
 */
export function renderRows(rows: readonly SelectRow[], index: number, opts: SelectViewOptions = {}): string[] {
  const on = opts.color === true
  const cursor = opts.cursor ?? '>'
  const pad = ' '.repeat(cursor.length)
  // 🔴 라벨을 같은 너비로 맞춰 설명이 **한 열에서 시작**하게 한다 — 들쭉날쭉하면 목록이 아니라 잡음이 된다.
  //    한글은 두 칸을 차지하므로 코드포인트 수가 아니라 표시 폭으로 센다.
  const w = Math.max(...rows.map((r) => displayWidth(r.label)), 0)
  return rows.map((r, i) => {
    const selected = i === index
    const label = r.label + ' '.repeat(Math.max(0, w - displayWidth(r.label)))
    const head = `  ${selected ? colorize(on, [36, 1], cursor) : pad} ${selected ? colorize(on, [36, 1], label) : label}`
    return r.note ? `${head}   ${colorize(on, [2], r.note)}` : head.trimEnd()
  })
}

/** 터미널 표시 폭(순수). CJK·전각은 두 칸이다 — 코드포인트 수로 맞추면 열이 어긋난다. */
export function displayWidth(text: string): number {
  return [...text].reduce((n, ch) => n + (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]/.test(ch) ? 2 : 1), 0)
}
