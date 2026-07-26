import { describe, it, expect } from 'vitest'
import {
  parseKeys,
  applySelectKey,
  renderSelect,
  eraseLines,
  runSelect,
  canUseRawMode,
  SelectCancelled,
  type Key,
  type SelectState,
} from '../../bin/select-prompt'

/**
 * REQ-2026-067 phase-1 — 단일 선택 프롬프트의 순수 코어.
 *
 * 🔴 이 파일의 존재 이유: setup은 대화형 전용이라 CI가 **실제 키 입력을 검증할 수 없다.**
 *    키 시퀀스 → 결과를 여기서 고정해야 회귀 검증이 사람 눈에만 의존하지 않는다.
 *
 * 헤드라인 단언 둘:
 *   1. **분할 도착한 escape sequence가 정상 경로다** — `['\x1b','[A']`가 이동 1회여야 한다.
 *      청크마다 독립 해석하면 ↑를 눌렀는데 프롬프트가 끝난다(design r01 P1).
 *   2. **단독 Esc는 취소가 아니다** — 시퀀스 시작과 구별할 수 없다. 취소는 Ctrl+C 하나.
 */

const ESC = String.fromCharCode(27)
const CR = String.fromCharCode(13)
const LF = String.fromCharCode(10)
const ETX = String.fromCharCode(3)
const UP = ESC + '[A'
const DOWN = ESC + '[B'

/** 청크들을 실제 어댑터처럼 **버퍼를 이어 붙이며** 먹인다. */
function feed(chunks: readonly string[]): { keys: Key[]; rest: string } {
  let rest = ''
  const keys: Key[] = []
  for (const c of chunks) {
    const r = parseKeys(rest + c)
    keys.push(...r.keys)
    rest = r.rest
  }
  return { keys, rest }
}

describe('[select] parseKeys — 스트림 단위 증분 파싱(DEC-1b)', () => {
  it('한 청크에 담긴 완전한 시퀀스를 해석한다', () => {
    expect(parseKeys(UP).keys).toEqual(['up'])
    expect(parseKeys(DOWN).keys).toEqual(['down'])
    expect(parseKeys(CR).keys).toEqual(['enter'])
    expect(parseKeys(LF).keys).toEqual(['enter'])
    expect(parseKeys(ETX).keys).toEqual(['cancel'])
  })

  it('application cursor mode(\\x1bOA/\\x1bOB)도 방향키다', () => {
    expect(parseKeys(ESC + 'OA').keys).toEqual(['up'])
    expect(parseKeys(ESC + 'OB').keys).toEqual(['down'])
  })

  /**
   * 🔴 헤드라인 1. raw stdin은 바이트 스트림이라 ↑ 한 번이 두 청크로 나뉘어 온다.
   * 청크 독립 해석이면 첫 청크의 `\x1b`가 Esc로 읽혀 사용자가 이동하려다 프롬프트를 잃는다.
   */
  it('🔴 분할 도착한 \\x1b + [A 는 이동 1회다(청크 독립 해석 금지)', () => {
    expect(feed([ESC, '[A'])).toEqual({ keys: ['up'], rest: '' })
    expect(feed([ESC, 'O', 'B'])).toEqual({ keys: ['down'], rest: '' })
    // 세 조각으로 쪼개져도 같다.
    expect(feed([ESC, '[', 'B'])).toEqual({ keys: ['down'], rest: '' })
  })

  it('🔴 미완성 접두사는 소비하지 않고 rest 로 되돌린다', () => {
    expect(parseKeys(ESC)).toEqual({ keys: [], rest: ESC })
    expect(parseKeys(ESC + '[')).toEqual({ keys: [], rest: ESC + '[' })
    expect(parseKeys(ESC + 'O')).toEqual({ keys: [], rest: ESC + 'O' })
  })

  it('한 청크에 붙어 온 여러 키를 순서대로 해석한다(빠른 입력·붙여넣기)', () => {
    expect(parseKeys(UP + DOWN + CR).keys).toEqual(['up', 'down', 'enter'])
  })

  /**
   * 🔴 접두사가 될 수 없는 바이트를 rest 에 남기면 인식 못 하는 입력이 쌓여 버퍼가 무한히 자란다.
   * `other` 로 소비해야 한다 — 상태를 바꾸지 않으므로 무해하다.
   */
  it('🔴 인식 못 하는 바이트는 other 로 소비해 버퍼가 자라지 않는다', () => {
    const r = parseKeys('xyz')
    expect(r.keys).toEqual(['other', 'other', 'other'])
    expect(r.rest).toBe('')
  })

  it('인식 불가로 끝난 Esc 조합도 소비된다(무한 대기 없음)', () => {
    // \x1b + 'Z' 는 어떤 시퀀스의 접두사도 아니다 → 둘 다 소비.
    const r = parseKeys(ESC + 'Z')
    expect(r.rest).toBe('')
    expect(r.keys.every((k) => k === 'other')).toBe(true)
  })

  it('빈 입력은 아무것도 내지 않는다', () => {
    expect(parseKeys('')).toEqual({ keys: [], rest: '' })
  })
})

describe('[select] applySelectKey — 순수 상태 전이', () => {
  const s = (index: number): SelectState => ({ options: ['a', 'b', 'c'], index })

  it('↓ 는 다음, ↑ 는 이전으로 옮긴다', () => {
    expect(applySelectKey(s(0), 'down')).toEqual({ kind: 'move', state: s(1) })
    expect(applySelectKey(s(2), 'up')).toEqual({ kind: 'move', state: s(1) })
  })

  /** 순환하지 않으면 끝에서 멈춰 사용자가 반대 키를 찾아야 한다 — 항목이 적을수록 성가시다. */
  it('🔴 양 끝에서 순환한다', () => {
    expect(applySelectKey(s(0), 'up')).toEqual({ kind: 'move', state: s(2) })
    expect(applySelectKey(s(2), 'down')).toEqual({ kind: 'move', state: s(0) })
  })

  it('Enter 는 현재 항목을 확정한다', () => {
    expect(applySelectKey(s(1), 'enter')).toEqual({ kind: 'accept', index: 1, value: 'b' })
  })

  it('Ctrl+C 는 취소다', () => {
    expect(applySelectKey(s(1), 'cancel')).toEqual({ kind: 'cancel' })
  })

  /** 🔴 헤드라인 2 — Esc 는 파서에서 `other` 로 접히고, `other` 는 상태를 바꾸지 않는다. */
  it('🔴 알 수 없는 키는 상태를 바꾸지 않는다(단독 Esc 포함)', () => {
    const before = s(1)
    expect(applySelectKey(before, 'other')).toEqual({ kind: 'ignore' })
    expect(before.index).toBe(1) // 입력 상태 불변(순수)
    // 파서가 Esc 를 취소로 만들지 않는다는 것까지 함께 고정한다.
    expect(parseKeys(ESC).keys).not.toContain('cancel')
  })

  it('빈 목록에서도 터지지 않는다', () => {
    const empty: SelectState = { options: [], index: 0 }
    expect(applySelectKey(empty, 'enter')).toEqual({ kind: 'ignore' })
    expect(applySelectKey(empty, 'down')).toEqual({ kind: 'ignore' })
    expect(applySelectKey(empty, 'cancel')).toEqual({ kind: 'cancel' })
  })

  it('키 시퀀스를 이어 적용하면 최종 확정값이 결정된다(통합)', () => {
    let state: SelectState = { options: ['keep', 'phase', 'req', 'merge'], index: 0 }
    let accepted: string | null = null
    for (const key of feed([ESC, '[B', DOWN + DOWN, CR]).keys) {
      const out = applySelectKey(state, key)
      if (out.kind === 'move') state = out.state
      else if (out.kind === 'accept') accepted = out.value
    }
    expect(accepted).toBe('merge')
  })
})

describe('[select] renderSelect · eraseLines — 순수 출력 생성', () => {
  it('커서가 현재 항목에만 붙는다', () => {
    const lines = renderSelect({ options: ['a', 'b'], index: 1 })
    expect(lines).toEqual(['    a', '  > b'])
  })

  it('줄 수가 항목 수와 같다 — 지우기와 그리기가 같은 근거를 쓴다', () => {
    const state: SelectState = { options: ['a', 'b', 'c'], index: 0 }
    expect(renderSelect(state)).toHaveLength(state.options.length)
  })

  it('eraseLines 는 올린 만큼만 지운다 · 0 이하는 no-op', () => {
    expect(eraseLines(3)).toBe(`${ESC}[3A${ESC}[0J`)
    expect(eraseLines(0)).toBe('')
    expect(eraseLines(-1)).toBe('')
  })
})

/**
 * REQ-2026-067 phase-2 — raw mode 어댑터.
 *
 * 🔴 헤드라인: **모든 종료 경로에서 raw mode 를 되돌린다.** 되돌리지 못하면 사용자 터미널이
 *    에코 없는 상태로 남는다 — 확정·취소 어느 쪽으로 끝나든 마찬가지다.
 */
describe('[select] runSelect — raw mode 어댑터', () => {
  /** 최소 stdin/stdout 대역. 실제 TTY 없이 어댑터 계약만 본다. */
  function fakeIo() {
    const listeners: Array<(c: string) => void> = []
    const rawCalls: boolean[] = []
    let out = ''
    const stdin = {
      isTTY: true,
      isRaw: false,
      setRawMode(v: boolean) {
        rawCalls.push(v)
        this.isRaw = v
        return this
      },
      resume() {
        return this
      },
      pause() {
        return this
      },
      setEncoding() {
        return this
      },
      on(_e: string, fn: (c: string) => void) {
        listeners.push(fn)
        return this
      },
      removeListener(_e: string, fn: (c: string) => void) {
        const i = listeners.indexOf(fn)
        if (i >= 0) listeners.splice(i, 1)
        return this
      },
    }
    const stdout = {
      write(s: string) {
        out += s
        return true
      },
    }
    return {
      io: { stdin, stdout } as never,
      send: (chunk: string) => listeners.forEach((l) => l(chunk)),
      rawCalls,
      listeners,
      get output() {
        return out
      },
    }
  }

  it('↓ 두 번 + Enter 로 세 번째 항목이 확정된다', async () => {
    const f = fakeIo()
    const p = runSelect(['a', 'b', 'c'], 0, f.io)
    f.send(DOWN)
    f.send(DOWN)
    f.send(CR)
    expect(await p).toBe(2)
  })

  it('🔴 분할 도착한 방향키도 어댑터를 통과한다(버퍼 이어붙이기)', async () => {
    const f = fakeIo()
    const p = runSelect(['a', 'b'], 0, f.io)
    f.send(ESC) // 아직 확정 못 함 — 여기서 취소되면 안 된다
    f.send('[B')
    f.send(CR)
    expect(await p).toBe(1)
  })

  it('🔴 확정하면 raw mode 를 되돌리고 리스너를 뗀다', async () => {
    const f = fakeIo()
    const p = runSelect(['a'], 0, f.io)
    f.send(CR)
    await p
    expect(f.rawCalls).toEqual([true, false])
    expect(f.listeners).toHaveLength(0)
  })

  it('🔴 Ctrl+C 로 취소해도 raw mode 를 되돌린다(터미널이 먹통이 되면 안 된다)', async () => {
    const f = fakeIo()
    const p = runSelect(['a', 'b'], 0, f.io)
    f.send(ETX)
    await expect(p).rejects.toThrow(SelectCancelled)
    expect(f.rawCalls).toEqual([true, false])
    expect(f.listeners).toHaveLength(0)
  })

  it('초기 인덱스가 범위를 벗어나도 안전하게 잘린다', async () => {
    const f = fakeIo()
    const p = runSelect(['a', 'b'], 99, f.io)
    f.send(CR)
    expect(await p).toBe(1)
  })

  it('canUseRawMode 는 TTY 이면서 setRawMode 가 있을 때만 true', () => {
    expect(canUseRawMode({ isTTY: true, setRawMode: () => {} } as never)).toBe(true)
    expect(canUseRawMode({ isTTY: false, setRawMode: () => {} } as never)).toBe(false)
    expect(canUseRawMode({ isTTY: true } as never)).toBe(false)
  })
})
