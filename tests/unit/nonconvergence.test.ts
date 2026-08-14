/**
 * REQ-2026-147 phase-1 — 비수렴 분석기.
 *
 * 🔴 이 스위트가 지키는 두 가지: ① **결정론**(같은 상태면 같은 보고) ② **지금 이 상태에서 성공하는
 *    명령만** 낸다. 두 번째가 REQ-2026-144 가 6라운드를 쓴 이유다 — 자리표시자·접두 누락·존재하지
 *    않는 선행 조건·실행에 필요한 줄 누락이 매 라운드 나왔다.
 */
import { describe, it, expect } from 'vitest'
import {
  repeatedAxes,
  decompositionAdvice,
  roundSummary,
  nextChoices,
  nonConvergenceReport,
  commandLines,
  MAX_AXES,
  MAX_COMMAND_LINES,
  type NonConvergenceInput,
  type RoundObservation,
} from '../../scripts/req/lib/nonconvergence'

const TICKET = 'workflow/REQ-2026-147'
const round = (n: number, findings: RoundObservation['findings'], outcome = 'needs-fix'): RoundObservation => ({
  round: n,
  outcome,
  findings,
})

const input = (over: Partial<NonConvergenceInput> = {}): NonConvergenceInput => ({
  reqId: 'REQ-2026-147',
  seriesId: 'design:-#1',
  hasOpenAttempt: false,
  ticketDirty: false,
  outsideDirty: [],
  ticketRel: TICKET,
  successorSlug: 'hardcap-report-successor',
  rounds: [],
  hardCap: 8,
  attempt: 9,
  ...over,
})

describe('[REQ-2026-147] repeatedAxes', () => {
  const rounds = [
    round(1, [{ file: 'a.ts', detail: 'x' }, { file: 'b.ts', detail: 'y' }]),
    round(2, [{ file: 'a.ts', detail: 'z' }]),
    round(3, [{ file: 'a.ts', detail: 'w' }, { detail: '경계 조건 확인이 없다' }]),
    round(4, [{ detail: '경계  조건 확인이 없다  ' }]),
  ]

  it('🔴 2라운드 이상 등장한 축만 담는다 — 1회는 반복이 아니다', () => {
    const axes = repeatedAxes(rounds)
    expect(axes.map((a) => a.key)).toContain('a.ts')
    expect(axes.map((a) => a.key)).not.toContain('b.ts')
  })

  it('🔴 파일 없는 지적은 본문으로 묶이고 공백 차이는 흡수된다', () => {
    const axes = repeatedAxes(rounds)
    const topic = axes.find((a) => a.kind === 'topic')
    expect(topic).toBeDefined()
    expect(topic!.rounds).toEqual([3, 4])
  })

  it('🔴 결정론 — 입력 순서를 뒤집어도 같은 결과', () => {
    expect(repeatedAxes([...rounds].reverse())).toEqual(repeatedAxes(rounds))
  })

  it('등장 라운드 수 내림차순 → 키 오름차순', () => {
    const axes = repeatedAxes(rounds)
    for (let i = 1; i < axes.length; i++) {
      const prev = axes[i - 1]!
      const cur = axes[i]!
      expect(prev.rounds.length >= cur.rounds.length).toBe(true)
    }
  })

  it('rounds 는 오름차순·중복 없음', () => {
    const a = repeatedAxes(rounds).find((x) => x.key === 'a.ts')!
    expect(a.rounds).toEqual([1, 2, 3])
  })

  it('빈 입력이면 빈 배열', () => {
    expect(repeatedAxes([])).toEqual([])
  })
})

describe('[REQ-2026-147] decompositionAdvice — 네 갈래가 각각 다르다', () => {
  const two = [round(1, [{ file: 'a.ts' }, { file: 'b.ts' }]), round(2, [{ file: 'a.ts' }, { file: 'b.ts' }])]
  const one = [round(1, [{ file: 'a.ts' }]), round(2, [{ file: 'a.ts' }])]
  const none = [round(1, [{ file: 'a.ts' }]), round(2, [{ file: 'b.ts' }])]

  it('🔴 자료가 0개면 "분석할 자료가 없다" — 분해안을 내지 않는다(REQ-144 r06 P1)', () => {
    const msg = decompositionAdvice([], [])
    expect(msg).toContain('분석할 자료가 없다')
    expect(msg).not.toContain('범위가 넓다')
    expect(msg).not.toContain('나누면')
  })

  it('🔴 자료는 있는데 반복 축이 0개면 "범위가 넓다" — 앞 갈래와 다른 문구', () => {
    const msg = decompositionAdvice(none, repeatedAxes(none))
    expect(msg).toContain('범위가 넓다')
    expect(msg).not.toContain('분석할 자료가 없다')
  })

  it('🔴 축이 1개면 분할을 권하지 않는다', () => {
    const msg = decompositionAdvice(one, repeatedAxes(one))
    expect(msg).toContain('나눌 것이 없다')
    expect(msg).not.toContain('축별로 나누면')
  })

  it('🔴 축이 2개 이상이면 축별 분할을 권한다', () => {
    const msg = decompositionAdvice(two, repeatedAxes(two))
    expect(msg).toContain('축별로 나누면')
  })

  it('🔴 네 갈래의 문구가 서로 모두 다르다', () => {
    const msgs = [
      decompositionAdvice([], []),
      decompositionAdvice(none, repeatedAxes(none)),
      decompositionAdvice(one, repeatedAxes(one)),
      decompositionAdvice(two, repeatedAxes(two)),
    ]
    expect(new Set(msgs).size).toBe(4)
  })
})

describe('[REQ-2026-147] 선택지는 상태에서 계산된다', () => {
  it('🔴 열린 attempt 가 없으면 --close-stale 을 내지 않는다', () => {
    expect(nextChoices(input()).pre).toHaveLength(0)
  })

  it('열린 attempt 가 있으면 실제 series_id 를 박아 낸다', () => {
    const pre = nextChoices(input({ hasOpenAttempt: true })).pre
    expect(pre).toHaveLength(1)
    expect(pre[0]!.text).toContain('--close-stale "design:-#1"')
  })

  it('🔴 티켓이 깨끗하면 갈래 B 는 두 줄', () => {
    expect(nextChoices(input()).replace).toHaveLength(2)
  })

  it('🔴 티켓이 더러우면 파킹 줄이 들어가 세 줄 — git commit 만으로는 untracked 가 남는다', () => {
    const replace = nextChoices(input({ ticketDirty: true })).replace
    // 🔴 파킹은 **두 줄**이다 — 한 줄로 잇는 구분자가 모든 셸에 없다(PowerShell 5.1 은 && 미지원,
    //    cmd.exe 는 ; 미지원). 그래서 갈래 B 는 네 줄이 된다.
    expect(replace).toHaveLength(4)
    expect(replace[1]!.kind).toBe('shell')
    expect(replace[2]!.kind).toBe('shell')
    expect(replace[1]!.text).toBe(`git add -- "${TICKET}"`)
    expect(replace[2]!.text).toContain('git commit -m')
    for (const c of replace) {
      expect(c.text).not.toContain('git add -A')
      expect(c.text).not.toContain('&&')
    }
  })

  it('abandon 은 필수 인자를 전부 담는다', () => {
    const t = nextChoices(input()).abandon[0]!.text
    expect(t).toContain('--abandon')
    expect(t).toContain('--reason')
    expect(t).toContain('--confirm')
    expect(t).toContain('--run')
  })
})

describe('[REQ-2026-147] 명령 형식 계약', () => {
  const all = (over: Partial<NonConvergenceInput> = {}) => commandLines(input({ hasOpenAttempt: true, ticketDirty: true, ...over }))

  it('🔴 CommitGate 명령은 npx commitgate 로 시작하고 --run 으로 끝난다', () => {
    for (const c of all().filter((x) => x.kind === 'commitgate')) {
      expect(c.text.startsWith('npx commitgate ')).toBe(true)
      expect(c.text.endsWith('--run')).toBe(true)
    }
  })

  it('🔴 정리용 shell 명령은 그 검사에서 제외된다 — 한 규칙으로 묶으면 파킹 안내를 낼 수 없다', () => {
    const shell = all().filter((x) => x.kind === 'shell')
    expect(shell.length).toBeGreaterThan(0)
    for (const c of shell) expect(c.text.startsWith('npx commitgate ')).toBe(false)
  })

  it('🔴 꺾쇠 자리표시자가 없다 — PowerShell 에서 `<` 는 리디렉션이라 명령이 죽는다', () => {
    for (const c of all()) expect(c.text).not.toContain('<')
  })

  it('🔴 사람이 채울 자리는 따옴표 안에만 있다', () => {
    for (const c of all().filter((x) => x.kind === 'commitgate')) {
      // 따옴표 밖에 한글 안내어가 노출되면 인자로 깨진다.
      const outside = c.text.replace(/"[^"]*"/g, '')
      expect(outside).not.toMatch(/[가-힣]/)
    }
  })

  it('🔴 hardCap 을 올리라는 선택지가 없다', () => {
    const blob = nonConvergenceReport(input({ hasOpenAttempt: true, ticketDirty: true }))
    // 🔴 `hardCap=8` 자체는 **상한을 알리는** 정당한 문구다 — 금지 대상은 "올려라"는 권유다.
    //    목록에 그 선택지가 있으면 그게 기본 답이 된다.
    expect(blob).toContain('hardCap=8')
    for (const verb of ['늘리', '높이', '증액', '올리', '완화', 'reviewBudget']) expect(blob).not.toContain(verb)
    // 설정 파일을 고치라는 안내도 없다.
    expect(blob).not.toContain('req.config.json')
  })

  it('🔴 명령 줄이 상한 이하다', () => {
    expect(all().length).toBeLessThanOrEqual(MAX_COMMAND_LINES)
  })
})

describe('[REQ-2026-147] 보고 조립', () => {
  const rounds = [round(1, [{ file: 'a.ts' }]), round(2, [{ file: 'a.ts' }]), round(3, [{ file: 'b.ts' }, { file: 'c.ts' }])]

  it('🔴 결정론 — 같은 입력이면 같은 문자열', () => {
    const i = input({ rounds })
    expect(nonConvergenceReport(i)).toBe(nonConvergenceReport(input({ rounds })))
  })

  it('🔴 조언이지 증거가 아님을 밝힌다', () => {
    expect(nonConvergenceReport(input({ rounds }))).toContain('감사 증거 아님')
  })

  it('원래 차단 사실을 여전히 담는다', () => {
    const r = nonConvergenceReport(input({ rounds }))
    expect(r).toContain('review 예산 소진')
    expect(r).toContain('hardCap=8')
  })

  it('🔴 라운드 요약은 한 줄이다', () => {
    expect(roundSummary(rounds).split('\n')).toHaveLength(1)
  })

  it(`🔴 반복 축은 최대 ${MAX_AXES}개만 나열한다`, () => {
    const many = [1, 2].map((n) => round(n, ['a', 'b', 'c', 'd', 'e'].map((f) => ({ file: `${f}.ts` }))))
    const msg = decompositionAdvice(many, repeatedAxes(many))
    expect(msg.match(/\.ts/g)?.length).toBe(MAX_AXES)
  })

  it('🔴 티켓 밖 더러운 경로는 데이터로 열거하고 명령으로 만들지 않는다', () => {
    const r = nonConvergenceReport(input({ rounds, outsideDirty: ['scripts/req/x.ts', 'src/y.ts'] }))
    expect(r).toContain('scripts/req/x.ts')
    expect(r).toContain('src/y.ts')
    // 그 경로들이 실행 가능한 명령 줄로 둔갑하지 않는다.
    for (const line of r.split('\n').filter((l) => l.includes('src/y.ts'))) {
      expect(line.trim().startsWith('npx ')).toBe(false)
      expect(line.trim().startsWith('git ')).toBe(false)
    }
  })

  it('자료가 없어도 보고가 만들어진다(차단 사실 + 선택지)', () => {
    const r = nonConvergenceReport(input())
    expect(r).toContain('분석할 자료가 없다')
    expect(r).toContain('req:close')
  })
})

describe('[REQ-2026-147] 🔴 결정론은 보고 **전체**에서 성립한다 (phase-1 r01 P1)', () => {
  const withAxes = [round(1, [{ file: 'a.ts' }]), round(2, [{ file: 'a.ts' }]), round(3, [{ file: 'b.ts' }])]
  const noAxes = [round(1, [{ file: 'a.ts' }]), round(2, [{ file: 'b.ts' }]), round(3, [{ file: 'c.ts' }, { file: 'd.ts' }])]

  it('반복 축이 있는 경우 — 역순 입력이 같은 보고를 낸다', () => {
    expect(nonConvergenceReport(input({ rounds: [...withAxes].reverse() }))).toBe(
      nonConvergenceReport(input({ rounds: withAxes })),
    )
  })

  it('🔴 반복 축이 **없는** 경우도 같다 — "라운드별 지적 수" 나열이 순서에 민감했다', () => {
    expect(nonConvergenceReport(input({ rounds: [...noAxes].reverse() }))).toBe(
      nonConvergenceReport(input({ rounds: noAxes })),
    )
  })

  it('라운드 요약이 항상 번호 오름차순이다', () => {
    expect(roundSummary([...withAxes].reverse())).toBe('r01 needs-fix · r02 needs-fix · r03 needs-fix')
  })

  it('분해안의 라운드별 지적 수도 번호 오름차순이다', () => {
    const msg = decompositionAdvice([...noAxes].reverse(), repeatedAxes(noAxes))
    expect(msg).toContain('1·1·2')
  })
})
