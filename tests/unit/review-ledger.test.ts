import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  serializeLedgerRow,
  parseLedger,
  appendLedgerRow,
  ledgerRowProblems,
  ledgerRowKey,
  ledgerPath,
  unclosedAttempts,
  LEDGER_KEYS,
  LEDGER_BASENAME,
  type LedgerRow,
} from '../../scripts/req/lib/review-ledger'

/**
 * 원장 코어(REQ-2026-051 phase-1) — 순수 함수만. fs·git 무의존.
 *
 * ⚠️ 기대값은 **이 파일 안의 리터럴**이다. SUT 상수로 기대값을 만들면 tautology가 된다
 *    (키가 통째로 사라져도 그린) — REQ-2026-031 B-1의 교훈.
 */

const opened = (over: Partial<LedgerRow> = {}): LedgerRow => ({
  ticket_id: 'REQ-2026-051',
  series_id: 'design:-#1',
  review_kind: 'design',
  phase_id: null,
  attempt: 1,
  event: 'attempt-opened',
  lifecycle: null,
  outcome: null,
  exception_consumed: false,
  prompt_sha256: 'a'.repeat(64),
  at: '2026-07-24T04:00:00.000Z',
  reconstructed: false,
  ...over,
})

const closed = (over: Partial<LedgerRow> = {}): LedgerRow =>
  opened({
    event: 'attempt-closed',
    lifecycle: 'completed',
    outcome: 'approved',
    ...over,
  })

describe('[ledger] 경로', () => {
  it('approvals.jsonl과 같은 디렉터리에 둔다', () => {
    expect(ledgerPath('workflow/REQ-2026-051')).toBe('workflow/REQ-2026-051/responses/review-ledger.jsonl')
  })
  it('후행 슬래시·백슬래시를 정규화한다', () => {
    expect(ledgerPath('workflow\\REQ-2026-051\\')).toBe('workflow/REQ-2026-051/responses/review-ledger.jsonl')
  })
  it('파일명이 review-ledger.jsonl 이다', () => {
    expect(LEDGER_BASENAME).toBe('review-ledger.jsonl')
  })
})

describe('[ledger] ① 직렬화 — 고정 키 순서 + 끝 개행', () => {
  it('키 순서가 고정이다(리터럴 대조)', () => {
    const line = serializeLedgerRow(opened())
    expect(line.endsWith('\n')).toBe(true)
    expect(Object.keys(JSON.parse(line))).toEqual([
      'ticket_id',
      'series_id',
      'review_kind',
      'phase_id',
      'attempt',
      'event',
      'lifecycle',
      'outcome',
      'exception_consumed',
      'prompt_sha256',
      'at',
      'reconstructed',
    ])
  })

  it('입력 객체의 키 순서가 달라도 출력은 같다(deterministic)', () => {
    const a = opened()
    const shuffled = Object.fromEntries(Object.entries(a).reverse()) as unknown as LedgerRow
    expect(serializeLedgerRow(shuffled)).toBe(serializeLedgerRow(a))
  })

  it('⑩ 프롬프트·응답 본문이 들어갈 키가 없다', () => {
    const keys = new Set<string>(LEDGER_KEYS)
    for (const forbidden of ['prompt', 'response', 'body', 'text', 'findings', 'detail'])
      expect(keys.has(forbidden)).toBe(false)
  })

  it('archive path·sha 키가 없다 — approvals.jsonl의 archive_inventory가 단일 출처(중복 금지)', () => {
    const keys = new Set<string>(LEDGER_KEYS)
    expect(keys.has('archive_path')).toBe(false)
    expect(keys.has('archive_sha256')).toBe(false)
  })
})

describe('[ledger] ② round-trip', () => {
  it('serialize → parse 가 동일 객체를 낸다', () => {
    const row = closed()
    const { rows, problems } = parseLedger(serializeLedgerRow(row))
    expect(problems).toEqual([])
    expect(rows).toEqual([row])
  })

  it('빈 줄은 무시한다', () => {
    const content = `\n${serializeLedgerRow(opened())}\n\n`
    const { rows, problems } = parseLedger(content)
    expect(problems).toEqual([])
    expect(rows.length).toBe(1)
  })
})

describe('[ledger] ③④ 멱등 append', () => {
  it('③ 같은 자연키 + 동일 내용 → duplicate · 행 수 불변', () => {
    const row = closed()
    const first = appendLedgerRow('', row)
    expect(first.outcome).toBe('appended')
    const again = appendLedgerRow(first.content, row)
    expect(again.outcome).toBe('duplicate')
    expect(again.content).toBe(first.content)
    expect(parseLedger(again.content).rows.length).toBe(1)
  })

  it('④ 같은 자연키 + 다른 내용 → conflict · append도 덮어쓰기도 없다', () => {
    const first = appendLedgerRow('', closed({ outcome: 'approved' }))
    const conflicting = appendLedgerRow(first.content, closed({ outcome: 'needs-fix' }))
    expect(conflicting.outcome).toBe('conflict')
    expect(conflicting.content).toBe(first.content)
    expect(conflicting.problems.join(' ')).toContain('덮어쓰지 않는다')
  })

  it('다른 자연키는 정상 append 된다', () => {
    const a = appendLedgerRow('', opened({ attempt: 1 }))
    const b = appendLedgerRow(a.content, closed({ attempt: 1 }))
    const c = appendLedgerRow(b.content, opened({ attempt: 2 }))
    expect(c.outcome).toBe('appended')
    expect(parseLedger(c.content).rows.length).toBe(3)
  })

  it('개행으로 끝나지 않는 기존 본문에도 안전하게 잇는다', () => {
    const broken = serializeLedgerRow(opened()).replace(/\n$/, '')
    const r = appendLedgerRow(broken, closed())
    expect(r.outcome).toBe('appended')
    expect(parseLedger(r.content).problems).toEqual([])
    expect(parseLedger(r.content).rows.length).toBe(2)
  })

  it('⑤ 손상된 기존 본문 위에는 append 하지 않는다', () => {
    const r = appendLedgerRow('{not json\n', closed())
    expect(r.outcome).toBe('conflict')
    expect(r.content).toBe('{not json\n')
    expect(r.problems.join(' ')).toContain('JSON 파싱 실패')
  })

  it('자기 자신이 형식 위반이면 append 하지 않는다', () => {
    const r = appendLedgerRow('', opened({ attempt: 0 }))
    expect(r.outcome).toBe('conflict')
    expect(r.content).toBe('')
  })
})

describe('[ledger] ⑤ 손상은 조용히 넘어가지 않는다', () => {
  it('파싱 불가 행을 problems로 드러낸다', () => {
    const { problems } = parseLedger(`${serializeLedgerRow(opened())}{broken\n`)
    expect(problems.some((p) => p.includes('line 2') && p.includes('JSON 파싱 실패'))).toBe(true)
  })

  it('같은 자연키가 두 번 실려 있으면 중복으로 보고한다', () => {
    const line = serializeLedgerRow(closed())
    const { problems } = parseLedger(line + line)
    expect(problems.some((p) => p.includes('자연키 중복'))).toBe(true)
  })
})

describe('[ledger] ⑥⑦ 키는 닫고 값은 연다(D3 비대칭)', () => {
  it('⑥ 모르는 top-level 키는 거부한다', () => {
    expect(ledgerRowProblems({ ...closed(), prompt: '전문이 들어오면 안 된다' }).join(' ')).toContain('알 수 없는 키: prompt')
  })

  it('필수 키가 없으면 거부한다', () => {
    const { at: _at, ...rest } = closed()
    expect(ledgerRowProblems(rest).join(' ')).toContain('필수 키 누락: at')
  })

  it('⑦ 모르는 lifecycle 값은 거부하지 않는다(forward-compatible)', () => {
    expect(ledgerRowProblems(closed({ lifecycle: 'dispatched_unknown' }))).toEqual([])
    expect(ledgerRowProblems(closed({ lifecycle: 'pre_dispatch_failed' }))).toEqual([])
  })

  it('반면 outcome 은 닫힌 집합이다', () => {
    expect(ledgerRowProblems(closed({ outcome: 'maybe' as never })).join(' ')).toContain('outcome 부적합')
  })

  it('event 도 닫힌 집합이다', () => {
    expect(ledgerRowProblems(closed({ event: 'attempt-half' as never })).join(' ')).toContain('event 부적합')
  })
})

describe('[ledger] ⑧ attempt-opened 는 결과 필드가 비어야 한다', () => {
  it('outcome 이 채워져 있으면 거부', () => {
    expect(ledgerRowProblems(opened({ outcome: 'approved' })).join(' ')).toContain('attempt-opened인데 outcome')
  })
  it('lifecycle 이 채워져 있으면 거부', () => {
    expect(ledgerRowProblems(opened({ lifecycle: 'completed' })).join(' ')).toContain('attempt-opened인데 lifecycle')
  })
  it('정상 attempt-opened 는 통과', () => {
    expect(ledgerRowProblems(opened())).toEqual([])
  })
})

describe('[ledger] ⑰ attempt-closed 는 판정이 있어야 한다(design 리뷰 observation)', () => {
  it('outcome 이 null 인 closed 는 거부(완료됐지만 판정 불명 = 자기모순)', () => {
    expect(ledgerRowProblems(closed({ outcome: null })).join(' ')).toContain('attempt-closed인데 outcome이 null')
  })
  it('lifecycle 이 null 인 closed 는 거부', () => {
    expect(ledgerRowProblems(closed({ lifecycle: null })).join(' ')).toContain('attempt-closed인데 lifecycle이 null')
  })
  it('정상 attempt-closed 는 통과', () => {
    expect(ledgerRowProblems(closed())).toEqual([])
  })
})

describe('[ledger] ⑨ 미완 attempt 관측 — 이 REQ의 존재 이유', () => {
  it('opened 만 있고 closed 가 없는 attempt를 찾아낸다', () => {
    const rows = [opened({ attempt: 1 }), closed({ attempt: 1 }), opened({ attempt: 2 })]
    const unclosed = unclosedAttempts(rows)
    expect(unclosed.length).toBe(1)
    expect(unclosed[0]?.attempt).toBe(2)
  })

  it('전부 닫혔으면 빈 배열', () => {
    expect(unclosedAttempts([opened({ attempt: 1 }), closed({ attempt: 1 })])).toEqual([])
  })

  it('series 가 다르면 같은 attempt 번호라도 서로 닫아주지 않는다', () => {
    const rows = [
      opened({ series_id: 'design:-#1', attempt: 1 }),
      closed({ series_id: 'phase:p1#1', attempt: 1, review_kind: 'phase', phase_id: 'p1' }),
    ]
    expect(unclosedAttempts(rows).length).toBe(1)
    expect(unclosedAttempts(rows)[0]?.series_id).toBe('design:-#1')
  })
})

describe('[ledger] ⑪ 타임스탬프·식별자 검증', () => {
  it('at 이 ISO instant 가 아니면 거부', () => {
    expect(ledgerRowProblems(closed({ at: '2026-07-24 04:00:00' })).join(' ')).toContain('ISO instant')
  })
  it('attempt 가 정수가 아니면 거부', () => {
    expect(ledgerRowProblems(closed({ attempt: 1.5 })).join(' ')).toContain('attempt는 1 이상 정수')
  })
  it('review_kind 는 design|phase 만', () => {
    expect(ledgerRowProblems(closed({ review_kind: 'other' as never })).join(' ')).toContain('review_kind 부적합')
  })
  it('phase_id 는 null 이거나 비지 않은 문자열', () => {
    expect(ledgerRowProblems(closed({ phase_id: '' })).join(' ')).toContain('phase_id')
  })
  it('exception_consumed 는 boolean 이어야 한다(예외 소비는 원장에만 남는 사실)', () => {
    expect(ledgerRowProblems(closed({ exception_consumed: 'yes' as never })).join(' ')).toContain('exception_consumed는 boolean')
  })
})

describe('[ledger] 자연키', () => {
  it('ticket·series·attempt·event 로 구성된다', () => {
    const key = ledgerRowKey(closed({ attempt: 7 }))
    expect(key.split(String.fromCharCode(31))).toEqual(['REQ-2026-051', 'design:-#1', '7', 'attempt-closed'])
  })

  it('구분자는 식별자에 나타날 수 없는 제어문자다(가시 문자면 series id의 `:`·`#`와 충돌 위험)', () => {
    const key = ledgerRowKey(closed())
    expect(key).toContain(String.fromCharCode(31))
    expect(key).not.toContain(' ')
  })

  it('event 가 다르면 다른 키다(opened/closed 공존)', () => {
    expect(ledgerRowKey(opened())).not.toBe(ledgerRowKey(closed()))
  })

  it('구분자 충돌로 서로 다른 attempt가 같은 키로 접히지 않는다', () => {
    const a = ledgerRowKey(closed({ series_id: 'x', attempt: 1 }))
    const b = ledgerRowKey(closed({ series_id: 'x' + String.fromCharCode(31) + '1', attempt: 1 }))
    expect(a).not.toBe(b)
  })
})

describe('[ledger] 소스 위생 — 제어문자 리터럴 없음', () => {
  it('원장 모듈 소스에 원시 제어문자가 없다', () => {
    // 이 phase에서 실제로 원시 NUL이 소스에 박혀 git이 파일을 binary로 취급했다(grep·diff 붕괴).
    // 구분자는 String.fromCharCode 로 만들고 소스에는 리터럴을 두지 않는다.
    const src = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts/req/lib/review-ledger.ts'),
      'utf8',
    )
    const bad = [...src].filter((c) => {
      const n = c.charCodeAt(0)
      return n < 9 || (n >= 11 && n <= 12) || (n >= 14 && n <= 31)
    })
    expect(bad).toEqual([])
  })
})
