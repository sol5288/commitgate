import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { planStaleClose, type StaleCloseInput } from '../../scripts/req/lib/stale-attempt'
import type { LedgerRow } from '../../scripts/req/lib/review-ledger'
import { main, parseArgs } from '../../scripts/req/req-review-exception'

/**
 * REQ-2026-141 phase-2 — 열린 attempt 해소의 순수 판정.
 *
 * 🔴 **핵심 오라클은 "재실행이 수렴하는가" 다**(DEC-3a). 이 명령은 durable 원장과 scratch state 두 곳을
 *    바꾸므로 그 사이에서 끊길 수 있다. 재실행이 막히면 **고치려는 교착을 스스로 만든다** —
 *    실제로 REQ-2026-140 phase-6 에서 그 교착을 밟았기 때문에 이 REQ 가 있다.
 */

const SERIES = 'phase:phase-1-x#1'

const row = (attempt: number, event: LedgerRow['event'], over: Partial<LedgerRow> = {}): LedgerRow =>
  ({
    ticket_id: 'REQ-2026-141',
    series_id: SERIES,
    review_kind: 'phase',
    phase_id: 'phase-1-x',
    attempt,
    event,
    lifecycle: event === 'attempt-closed' ? 'completed' : null,
    outcome: event === 'attempt-closed' ? 'approved' : null,
    exception_consumed: false,
    prompt_sha256: null,
    at: '2026-08-14T00:00:00.000Z',
    reconstructed: false,
    ...over,
  }) as LedgerRow

const INPUT = (over: Partial<StaleCloseInput> = {}): StaleCloseInput => ({
  rows: [],
  seriesId: SERIES,
  seriesAttempts: 1,
  seriesOpen: true,
  reason: '실행이 중단됨',
  ...over,
})

describe('[REQ-2026-141] planStaleClose — 거부 조건', () => {
  it('🔴 사유가 비면 거부한다(공백 포함)', () => {
    for (const reason of ['', '   ']) {
      const v = planStaleClose(INPUT({ reason, rows: [row(2, 'attempt-opened')], seriesAttempts: 2 }))
      expect(v.ok, JSON.stringify(reason)).toBe(false)
      if (!v.ok) expect(v.reason).toContain('사유')
    }
  })

  it('🔴 state 에 없는 series 는 거부한다', () => {
    const v = planStaleClose(INPUT({ seriesAttempts: null }))
    expect(v.ok).toBe(false)
  })

  it('🔴 이미 닫힌 series 는 거부한다', () => {
    const v = planStaleClose(INPUT({ seriesOpen: false, rows: [row(1, 'attempt-opened')] }))
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toContain('닫힌')
  })

  /** 🔴 탈출구가 **기본을 열지 않는다** — 할 일이 없으면 아무것도 하지 않는다. */
  it('🔴 정합한 상태에서는 할 일이 없다고 말한다', () => {
    const rows = [row(1, 'attempt-opened'), row(1, 'attempt-closed')]
    const v = planStaleClose(INPUT({ rows, seriesAttempts: 1 }))
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toContain('열린 attempt 가 없다')
  })
})

describe('[REQ-2026-141] planStaleClose — 정상 해소', () => {
  it('열린 attempt 를 버리고, state 가 뒤처졌으면 함께 올린다', () => {
    // 재현 상태: 원장에 attempt-opened #2, state.attempts=1
    const rows = [row(1, 'attempt-opened'), row(1, 'attempt-closed'), row(2, 'attempt-opened')]
    const v = planStaleClose(INPUT({ rows, seriesAttempts: 1 }))
    expect(v.ok).toBe(true)
    if (v.ok)
      expect(v.plan).toMatchObject({ appendRow: true, attempt: 2, raiseAttemptsTo: 2, voidAttemptsAtLeast: 1 })
  })

  it('state 가 이미 그 번호면 올리지 않는다(정합화 불필요)', () => {
    const rows = [row(2, 'attempt-opened')]
    const v = planStaleClose(INPUT({ rows, seriesAttempts: 2 }))
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.plan).toMatchObject({ appendRow: true, attempt: 2, raiseAttemptsTo: null, voidAttemptsAtLeast: 1 })
  })

  /** 🔴 재실행이 순서대로 해소하려면 선택이 결정적이어야 한다. */
  it('🔴 열린 attempt 가 둘 이상이면 가장 이른 것을 고른다', () => {
    const rows = [row(2, 'attempt-opened'), row(4, 'attempt-opened'), row(3, 'attempt-opened')]
    const v = planStaleClose(INPUT({ rows, seriesAttempts: 4 }))
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.plan.attempt).toBe(2)
  })

  it('다른 series 의 행은 섞이지 않는다', () => {
    const other = row(9, 'attempt-opened', { series_id: 'design:-#1' })
    const v = planStaleClose(INPUT({ rows: [other], seriesAttempts: 1 }))
    expect(v.ok).toBe(false) // 내 series 에는 열린 것이 없다
  })
})

/**
 * 🔴 **DEC-3a — 부분 실패 재실행 수렴.** 이 describe 가 이 REQ 의 존재 이유를 지킨다.
 */
describe('[REQ-2026-141 DEC-3a] 부분 실패 뒤 재실행이 수렴한다', () => {
  const rows = [
    row(1, 'attempt-opened'),
    row(1, 'attempt-closed'),
    row(2, 'attempt-opened'),
    // 원장에는 abandoned 가 이미 들어갔다(커밋됨) — 그 직후 중단돼 state 는 그대로다.
    row(2, 'attempt-closed', { outcome: 'abandoned', lifecycle: 'abandoned', stale_close_reason: '중단' }),
  ]

  it('🔴 행은 이미 있고 state 만 뒤처진 상태 → 행을 다시 만들지 않고 state 만 맞춘다', () => {
    const v = planStaleClose(INPUT({ rows, seriesAttempts: 1 }))
    expect(v.ok).toBe(true)
    if (v.ok) {
      // 🔴 새 행을 만들면 같은 자연키에 다른 타임스탬프라 무결성 가드가 던진다.
      expect(v.plan.appendRow).toBe(false)
      expect(v.plan.raiseAttemptsTo).toBe(2)
      /**
       * 🔴 **증분이 아니라 원장에서 센 값이다**(r01 P1). 증분이면 두 방향으로 틀린다: 원장 커밋 뒤
       *    state 쓰기 전에 끊기면 한 번도 반영되지 않고, 재실행에서 또 올리면 두 번 센다.
       */
      expect(v.plan.voidAttemptsAtLeast).toBe(1)
    }
  })

  it('🔴 완전히 정합해지면 그다음 재실행은 no-op 이다(수렴)', () => {
    const v = planStaleClose(INPUT({ rows, seriesAttempts: 2 }))
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toContain('열린 attempt 가 없다')
  })
})

/**
 * 🔴 예산 회계(DEC-3). `void_attempts` 를 쓰는 이유는 **호출은 나갔고 판정은 없었기** 때문이다 —
 *    `autoBudget` 에서만 빠지고 `hardCap`(dispatched)에는 남는다.
 */
describe('[REQ-2026-141] 예산 회계 — productive 계산', () => {
  const productive = (attempts: number, refunded: number, voided: number): number =>
    Math.max(0, attempts - refunded - voided)

  it('🔴 정합화가 필요한 경우: productive 불변', () => {
    // before: attempts=1, void=0 → 1
    expect(productive(1, 0, 0)).toBe(1)
    // after: attempts=2(정합화), void=1 → 1
    expect(productive(2, 0, 1)).toBe(1)
  })

  it('🔴 정합화가 불필요한 경우: productive 1 감소(버린 회차가 예산을 놓아준다)', () => {
    expect(productive(2, 0, 0)).toBe(2)
    expect(productive(2, 0, 1)).toBe(1)
  })
})

/**
 * 🔴 **CLI 배선** — 순수 판정만 있으면 "판정은 맞는데 아무도 그것을 쓰지 않는" 상태를 못 잡는다.
 *    이 저장소가 세 번 실증한 실패다(REQ-2026-083·097·099).
 */
describe('[REQ-2026-141] --close-stale CLI 파싱', () => {
  it('series_id 와 사유를 읽는다', () => {
    const o = parseArgs(['2026-141', '--close-stale', 'phase:p1#1', '--reason', '중단됨', '--run'])
    expect(o).toMatchObject({ reqId: '2026-141', closeStale: 'phase:p1#1', reason: '중단됨', run: true })
  })

  it('🔴 --close-stale 값 자리에 옵션이 오면 거부한다(값 누락)', () => {
    expect(() => parseArgs(['2026-141', '--close-stale', '--run'])).toThrow('--close-stale')
  })

  it('--reason 값은 대시로 시작해도 받는다(사유는 자유 텍스트)', () => {
    expect(parseArgs(['2026-141', '--close-stale', 's', '--reason', '-중단']).reason).toBe('-중단')
  })

  it('🔴 해소 모드는 --kind 를 요구하지 않는다(예외 부여와 다른 경로)', () => {
    const o = parseArgs(['2026-141', '--close-stale', 's', '--reason', 'r'])
    expect(o.kind).toBeNull()
    expect(o.closeStale).not.toBeNull()
  })
})

/**
 * 🔴 **실 git 실행 경로** — 순수 판정과 CLI 파싱이 맞아도 "원장에 실제로 무엇이 쓰였는가"는
 *    돌려 봐야 안다. 특히 `outcome: 'abandoned'` 가 원장 **검증기**를 통과하는지는 여기서만 드러난다
 *    (리뷰 r01 이 정확히 그 지점을 잡았다: 타입만 넓히고 `OUTCOMES` 를 빼먹었다).
 */
describe('[REQ-2026-141] --close-stale 실행 경로 (실 git)', () => {
  const roots: string[] = []
  afterEach(() => {
    for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true })
  })

  const TICKET = 'REQ-2026-999'
  const SID = 'phase:phase-1-x#1'

  function setup(seriesAttempts: number, ledgerRows: LedgerRow[]): string {
    const root = mkdtempSync(join(tmpdir(), 'cg-stale-'))
    roots.push(root)
    const g = (...a: string[]): string => execFileSync('git', a, { cwd: root, encoding: 'utf8' })
    g('init', '-b', 'main')
    g('config', 'user.email', 's@example.com')
    g('config', 'user.name', 'Stale')
    writeFileSync(
      join(root, 'req.config.json'),
      JSON.stringify({ setup: { completedVersion: '0.22.0', completedAt: '2026-08-14T00:00:00.000Z' } }),
    )
    const ticketDir = join(root, 'workflow', TICKET, 'responses')
    mkdirSync(ticketDir, { recursive: true })
    writeFileSync(
      join(root, 'workflow', TICKET, 'state.json'),
      JSON.stringify({
        id: TICKET,
        branch: 'feat/req-2026-999-x',
        risk_level: 'LOW',
        commit_allowed: false,
        phases: [],
        review_series: [
          { series_id: SID, review_kind: 'phase', phase_id: 'phase-1-x', attempts: seriesAttempts, closed_reason: null },
        ],
      }),
    )
    writeFileSync(join(ticketDir, 'review-ledger.jsonl'), ledgerRows.map((r) => JSON.stringify(r)).join('\n') + '\n')
    g('add', '-A')
    g('commit', '-qm', 'fixture')
    return root
  }

  const readLedgerRows = (root: string): LedgerRow[] =>
    readFileSync(join(root, 'workflow', TICKET, 'responses', 'review-ledger.jsonl'), 'utf8')
      .split('\n')
      .filter((l) => l.trim() !== '')
      .map((l) => JSON.parse(l) as LedgerRow)

  const readAttempts = (root: string): { attempts: number; void_attempts?: number } =>
    (JSON.parse(readFileSync(join(root, 'workflow', TICKET, 'state.json'), 'utf8')) as {
      review_series: { attempts: number; void_attempts?: number }[]
    }).review_series[0] as { attempts: number; void_attempts?: number }

  const open2 = row(2, 'attempt-opened', { ticket_id: TICKET })

  it('🔴 abandoned 행이 원장 검증을 통과해 실제로 기록된다', () => {
    const root = setup(1, [row(1, 'attempt-opened', { ticket_id: TICKET }), row(1, 'attempt-closed', { ticket_id: TICKET }), open2])
    main(['2026-999', '--close-stale', SID, '--reason', '실행이 중단됨', '--root', root, '--run'])
    const rows = readLedgerRows(root)
    const closed = rows.find((r) => r.attempt === 2 && r.event === 'attempt-closed')
    expect(closed).toBeDefined()
    expect(closed?.outcome).toBe('abandoned')
    expect(closed?.stale_close_reason).toBe('실행이 중단됨')
    // 🔴 state 도 함께 맞춰진다 — 다음 리뷰가 #3 을 연다.
    expect(readAttempts(root).attempts).toBe(2)
    expect(readAttempts(root).void_attempts).toBe(1)
  })

  it('🔴 재실행이 수렴한다(행을 다시 만들지 않고, 정합해지면 할 일 없음)', () => {
    const root = setup(1, [open2])
    main(['2026-999', '--close-stale', SID, '--reason', 'r', '--root', root, '--run'])
    const after = readLedgerRows(root).length
    // 완전히 정합해졌으므로 그다음 실행은 "할 일 없음"으로 거부된다(수렴).
    expect(() => main(['2026-999', '--close-stale', SID, '--reason', 'r', '--root', root, '--run'])).toThrow('열린 attempt 가 없다')
    expect(readLedgerRows(root).length).toBe(after)
  })

  it('🔴 사유가 없으면 아무것도 쓰지 않는다', () => {
    const root = setup(1, [open2])
    const before = readFileSync(join(root, 'workflow', TICKET, 'responses', 'review-ledger.jsonl'), 'utf8')
    expect(() => main(['2026-999', '--close-stale', SID, '--reason', '  ', '--root', root, '--run'])).toThrow('사유')
    expect(readFileSync(join(root, 'workflow', TICKET, 'responses', 'review-ledger.jsonl'), 'utf8')).toBe(before)
  })
})

/**
 * 🔴 phase-2 리뷰 r01 P1 — **원장 커밋 뒤 state 쓰기 전에 끊긴 경우**에도 `void_attempts` 가
 *    정확히 한 번 반영돼야 한다. 증분이었다면 이 경로에서 **영영 0** 이라 버린 회차가 autoBudget 을 먹는다.
 */
describe('[REQ-2026-141] 부분 실패 복구에서도 void_attempts 가 정확하다', () => {
  const rows = [row(2, 'attempt-opened'), row(2, 'attempt-closed', { outcome: 'abandoned', lifecycle: 'abandoned' })]

  it('🔴 state 가 attempts=1·void=0 인 채로 남아 있어도 복구가 void 를 1 로 만든다', () => {
    const v = planStaleClose(INPUT({ rows, seriesAttempts: 1 }))
    expect(v.ok).toBe(true)
    if (v.ok) {
      expect(v.plan.appendRow).toBe(false)
      expect(v.plan.voidAttemptsAtLeast).toBe(1)
      // productive = attempts(2) - refunded(0) - void(1) = 1 — 버린 회차가 예산을 먹지 않는다.
      expect(2 - 0 - v.plan.voidAttemptsAtLeast).toBe(1)
    }
  })

  it('abandoned 가 둘이면 void 도 2 다(원장에서 센다)', () => {
    const more = [
      ...rows,
      row(3, 'attempt-opened'),
      row(3, 'attempt-closed', { outcome: 'abandoned', lifecycle: 'abandoned' }),
    ]
    const v = planStaleClose(INPUT({ rows: more, seriesAttempts: 1 }))
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.plan.voidAttemptsAtLeast).toBe(2)
  })
})

/**
 * 🔴 phase-2 리뷰 r03 P1 — 행을 **파일에 쓰고 커밋 전에** 끊긴 경우. 재실행은 그 행을 "이미 있다"고
 *    보므로, 커밋을 append 분기에 묶어 두면 행이 워킹트리에만 영영 남아 이후 리뷰가 막힌다.
 */
describe('[REQ-2026-141] append 후 커밋 전 중단도 재실행이 확정한다 (실 git)', () => {
  const roots2: string[] = []
  afterEach(() => {
    for (const r of roots2.splice(0)) rmSync(r, { recursive: true, force: true })
  })

  it('🔴 미커밋 abandoned 행이 있으면 재실행이 그것을 커밋한다', () => {
    const root = mkdtempSync(join(tmpdir(), 'cg-stale2-'))
    roots2.push(root)
    const g = (...a: string[]): string => execFileSync('git', a, { cwd: root, encoding: 'utf8' })
    g('init', '-b', 'main')
    g('config', 'user.email', 's@example.com')
    g('config', 'user.name', 'Stale')
    writeFileSync(
      join(root, 'req.config.json'),
      JSON.stringify({ setup: { completedVersion: '0.22.0', completedAt: '2026-08-14T00:00:00.000Z' } }),
    )
    const T = 'REQ-2026-998'
    const SID2 = 'phase:p#1'
    const dir = join(root, 'workflow', T, 'responses')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(root, 'workflow', T, 'state.json'),
      JSON.stringify({
        id: T,
        branch: 'feat/req-2026-998-x',
        risk_level: 'LOW',
        commit_allowed: false,
        phases: [],
        review_series: [{ series_id: SID2, review_kind: 'phase', phase_id: 'p', attempts: 1, closed_reason: null }],
      }),
    )
    const opened = { ...row(2, 'attempt-opened'), ticket_id: T, series_id: SID2, phase_id: 'p' }
    writeFileSync(join(dir, 'review-ledger.jsonl'), JSON.stringify(opened) + '\n')
    g('add', '-A')
    g('commit', '-qm', 'fixture')

    // 앞선 실행이 행을 쓰다 말았다 — 파일에는 있고 커밋에는 없다.
    const abandoned = { ...opened, event: 'attempt-closed', outcome: 'abandoned', lifecycle: 'abandoned', stale_close_reason: '중단' }
    writeFileSync(join(dir, 'review-ledger.jsonl'), JSON.stringify(opened) + '\n' + JSON.stringify(abandoned) + '\n')
    expect(g('status', '--porcelain').trim()).not.toBe('')

    main(['2026-998', '--close-stale', SID2, '--reason', '중단', '--root', root, '--run'])

    /**
     * 🔴 재실행이 그 행을 **durable 하게 확정**했다 — 원장 파일이 clean 이다.
     *    (`state.json` 은 scratch 라 커밋되지 않는 것이 정상이므로 원장 경로만 본다.)
     */
    expect(g('status', '--porcelain', '--', `workflow/${T}/responses/review-ledger.jsonl`).trim()).toBe('')
    expect(g('log', '-1', '--pretty=%s')).toContain('close stale attempt')
  })
})

/**
 * 🔴 phase-2 리뷰 r04 P1 — `void_attempts` 는 **판정이 없던 회차 전부**(`invalid` + `abandoned`)다.
 *    abandoned 만 세면 호출부의 `max` 와 겹쳐 기존 invalid 하나가 사라진다.
 */
describe('[REQ-2026-141] void_attempts 는 invalid 와 abandoned 를 합산한다', () => {
  it('🔴 #1 invalid + #2 abandoned → void 는 2 다(1 이 아니다)', () => {
    const rows = [
      row(1, 'attempt-opened'),
      row(1, 'attempt-closed', { outcome: 'invalid', lifecycle: 'completed' }),
      row(2, 'attempt-opened'),
    ]
    const v = planStaleClose(INPUT({ rows, seriesAttempts: 2 }))
    expect(v.ok).toBe(true)
    if (v.ok) {
      expect(v.plan.voidAttemptsAtLeast).toBe(2)
      // productive = attempts(2) - refunded(0) - void(2) = 0 — 둘 다 판정이 없었다.
      expect(2 - 0 - v.plan.voidAttemptsAtLeast).toBe(0)
    }
  })

  it('판정이 있는 회차는 세지 않는다', () => {
    const rows = [
      row(1, 'attempt-opened'),
      row(1, 'attempt-closed', { outcome: 'needs-fix' }),
      row(2, 'attempt-opened'),
    ]
    const v = planStaleClose(INPUT({ rows, seriesAttempts: 2 }))
    if (v.ok) expect(v.plan.voidAttemptsAtLeast).toBe(1)
  })
})

/**
 * 🔴 phase-2 리뷰 r05 P1 — **환불된 회차를 void 로 또 세면 예산 게이트가 느슨해진다.**
 *    `pre_dispatch_failed` 는 호출이 나가지 않아 `refunded_attempts` 로 이미 빠져 있다.
 */
describe('[REQ-2026-141] 환불된 invalid 는 void 로 세지 않는다', () => {
  it('🔴 pre_dispatch_failed invalid + abandoned → void 는 1 이다(2 가 아니다)', () => {
    const rows = [
      row(1, 'attempt-opened'),
      row(1, 'attempt-closed', { outcome: 'invalid', lifecycle: 'pre_dispatch_failed' }),
      row(2, 'attempt-opened'),
    ]
    const v = planStaleClose(INPUT({ rows, seriesAttempts: 2 }))
    expect(v.ok).toBe(true)
    if (v.ok) {
      expect(v.plan.voidAttemptsAtLeast).toBe(1)
      // attempts=2 · refunded=1(기존 경로) · void=1 → productive 0. 두 번 빼지 않는다.
      expect(2 - 1 - v.plan.voidAttemptsAtLeast).toBe(0)
    }
  })

  it('세 종류가 섞여도 정확하다(환불 1 · 정상 invalid 1 · abandoned 1)', () => {
    const rows = [
      row(1, 'attempt-opened'),
      row(1, 'attempt-closed', { outcome: 'invalid', lifecycle: 'pre_dispatch_failed' }),
      row(2, 'attempt-opened'),
      row(2, 'attempt-closed', { outcome: 'invalid', lifecycle: 'completed' }),
      row(3, 'attempt-opened'),
    ]
    const v = planStaleClose(INPUT({ rows, seriesAttempts: 3 }))
    expect(v.ok).toBe(true)
    // 정상 invalid(#2) + 이번 abandoned(#3) = 2. 환불된 #1 은 제외.
    if (v.ok) expect(v.plan.voidAttemptsAtLeast).toBe(2)
  })
})
