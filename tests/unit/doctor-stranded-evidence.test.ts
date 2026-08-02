/**
 * REQ-2026-114 phase-1 — D30: **리뷰를 받았는데 증거가 trunk에 없는 티켓**.
 *
 * 🔴 **왜 close proof(D25 계열)가 아닌가**: 실측된 유실 티켓(`REQ-2026-025`·`009`·`062`)은
 *    **종결된 적이 없어** close proof가 어느 브랜치에도 없다. 찾을 것이 없으므로 그 신호로는
 *    원리적으로 잡히지 않는다. 리뷰 호출 로그는 gitignored·워킹디렉터리 상주라 살아남는다.
 *
 * 🔴 **AC-4는 실제 진입점을 돌린다**: D30은 `main()`이 **로그 파일을 읽어** 입력을 만든다.
 *    순수 함수만 테스트하면 그 배선이 끊겨도 통과한다(REQ-2026-083·097·099 실증).
 */
import { describe, it, expect, vi } from 'vitest'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  main as doctorMain,
  strandedReviewedTickets,
  readReviewCallCounts,
  runChecks,
  type DoctorInputs,
} from '../../scripts/req/req-doctor'
import { REVIEW_CALL_LOG_REL, type WorkflowState } from '../../scripts/req/review-codex'
import { mkRepo, git } from './fixtures/stale-devcomplete'

const SELF = 'REQ-2026-114'
const SHORT = '2026-114'
const ROOT = 'workflow'

describe('[REQ-2026-114] strandedReviewedTickets (순수)', () => {
  const trunk = (ids: string[]): Set<string> =>
    new Set(ids.map((id) => `${ROOT}/${id}/responses/design-r01-approved.json`))

  /** AC-1 */
  it('🔴 trunk에 증거가 없는 티켓만, 리뷰 횟수와 함께 낸다', () => {
    const counts = new Map([
      ['REQ-2026-025', 8],
      ['REQ-2026-100', 3], // trunk에 있음 → 제외
    ])
    expect(strandedReviewedTickets(counts, trunk(['REQ-2026-100']), ROOT, SELF)).toEqual([
      { id: 'REQ-2026-025', reviews: 8 },
    ])
  })

  /** AC-2 — 작업 중 티켓이 매번 걸리면 안내가 죽는다(D25 선례). */
  it('🔴 자기 티켓은 제외한다', () => {
    const counts = new Map([[SELF, 5]])
    expect(strandedReviewedTickets(counts, trunk([]), ROOT, SELF)).toEqual([])
  })

  /** 방치와 진행 중을 사람이 구별할 수 있게 — 횟수 내림차순. */
  it('리뷰 횟수 내림차순으로 정렬한다(방치가 먼저 보이게)', () => {
    const counts = new Map([
      ['REQ-2026-140', 1],
      ['REQ-2026-025', 8],
    ])
    expect(strandedReviewedTickets(counts, trunk([]), ROOT, SELF).map((s) => s.id)).toEqual([
      'REQ-2026-025',
      'REQ-2026-140',
    ])
  })

  it('trunk 경로가 다른 티켓의 것이면 매칭하지 않는다(접두 오매칭 방지)', () => {
    // `REQ-2026-02` 가 `REQ-2026-025` 를 가리는 일이 없어야 한다.
    const counts = new Map([['REQ-2026-025', 2]])
    const paths = new Set([`${ROOT}/REQ-2026-02/responses/x.json`])
    expect(strandedReviewedTickets(counts, paths, ROOT, SELF)).toEqual([{ id: 'REQ-2026-025', reviews: 2 }])
  })
})

describe('[REQ-2026-114] readReviewCallCounts (fail-open)', () => {
  it('파일이 없으면 null(판정 불가) — 진단이 사람을 막지 않는다', () => {
    expect(readReviewCallCounts(join(mkRepo('req114-nolog-'), 'nope.jsonl'))).toBeNull()
  })

  /**
   * 🔴 설계 리뷰 r01 의견 반영: **손상된 줄 하나가 나머지 관측을 버리게 하지 않는다.**
   *    append-only 로그의 마지막 줄이 잘리는 것은 흔한 사고다.
   */
  it('🔴 손상된 줄은 건너뛰고 나머지는 센다', () => {
    const repo = mkRepo('req114-badlog-')
    const p = join(repo, 'log.jsonl')
    writeFileSync(p, ['{"ticket_id":"A"}', '{"ticket_id":"A"}', '{ 잘린 줄', '{"ticket_id":"B"}', ''].join('\n'))
    const counts = readReviewCallCounts(p)
    expect(counts?.get('A')).toBe(2)
    expect(counts?.get('B')).toBe(1)
  })

  /**
   * 🔴 phase-1 리뷰 r01 의견: **"아무것도 못 읽음"과 "읽었는데 비어 있음"을 구별한다.**
   *    전부 손상됐는데 빈 Map을 내면 D30이 "모두 trunk에 반영됨"이라고 **모르는 것을 단언**한다.
   */
  it('🔴 비어 있지 않은 줄이 전부 손상되면 null(판정 불가)', () => {
    const repo = mkRepo('req114-allbad-')
    const p = join(repo, 'log.jsonl')
    writeFileSync(p, ['{ 잘린 줄', 'not json at all', ''].join('\n'))
    expect(readReviewCallCounts(p)).toBeNull()
  })

  /** 대조: **빈 파일**은 "아직 리뷰 없음"이라는 정상 상태이므로 빈 Map이 맞다. */
  it('빈 파일은 빈 Map(판정 가능 — 리뷰가 없을 뿐)', () => {
    const repo = mkRepo('req114-empty-')
    const p = join(repo, 'log.jsonl')
    writeFileSync(p, '\n\n')
    expect(readReviewCallCounts(p)?.size).toBe(0)
  })

  it('ticket_id가 없거나 빈 문자열인 행은 세지 않는다', () => {
    const repo = mkRepo('req114-noid-')
    const p = join(repo, 'log.jsonl')
    writeFileSync(p, ['{"outcome":"approved"}', '{"ticket_id":""}', '{"ticket_id":"A"}'].join('\n'))
    expect([...(readReviewCallCounts(p) as Map<string, number>).entries()]).toEqual([['A', 1]])
  })
})

describe('[REQ-2026-114] D30 판정 (순수)', () => {
  const base: DoctorInputs = {
    state: { id: SELF, branch: 'feat/req-2026-114-x', commit_allowed: false } as WorkflowState,
    currentBranch: 'feat/req-2026-114-x',
    branchExists: true,
    branchPrefix: 'feat/req-',
    stagedTree: 'T',
    statusEntries: [],
    scratch: [],
    responseVerdict: null,
    responseStructureOk: false,
    designApproved: false,
    designApprovedHash: null,
    currentDesignHash: null,
    ticketDocs: [],
    ticketRel: `${ROOT}/${SELF}`,
  }
  const d30 = (inp: DoctorInputs): { level: string; msg: string } => {
    const c = runChecks(inp).find((x) => x.id === 'D30')
    if (!c) throw new Error('D30이 push되지 않았다')
    return { level: c.level, msg: c.msg }
  }

  /** AC-3 — 판정 불가는 조용히 통과(D25와 같은 근거). */
  it('🔴 판정 불가(undefined)는 OK', () => {
    expect(d30(base).level).toBe('OK')
    expect(d30(base).msg).toContain('점검 불요')
  })

  it('빈 배열이면 OK', () => {
    expect(d30({ ...base, strandedEvidence: [] }).level).toBe('OK')
  })

  it('🔴 있으면 WARN이고 티켓 id와 리뷰 횟수를 함께 낸다', () => {
    const r = d30({ ...base, strandedEvidence: [{ id: 'REQ-2026-025', reviews: 8 }], trunkBranch: 'main' })
    expect(r.level).toBe('WARN')
    expect(r.msg).toContain('REQ-2026-025')
    expect(r.msg).toContain('8회')
    // "유실됐다"고 단정하지 않는다 — 진행 중일 수 있다는 사실을 함께 말한다.
    expect(r.msg).toContain('진행 중이면 정상')
  })
})

describe('[REQ-2026-114] main() 배선 (실 git)', () => {
  /** 최소 티켓 + 리뷰 로그를 가진 hermetic repo. `trunkBranch`는 mkRepo가 만든 `main`. */
  const repoWith = (logLines: string[] | null): string => {
    const repo = mkRepo('req114-wiring-')
    const ticketRel = `${ROOT}/${SELF}`
    mkdirSync(join(repo, ticketRel), { recursive: true })
    writeFileSync(
      join(repo, ticketRel, 'state.json'),
      JSON.stringify({ id: SELF, branch: 'main', risk_level: 'LOW', commit_allowed: false, phases: [] }),
    )
    git(repo, ['add', '-A'])
    git(repo, ['commit', '-qm', 'ticket'])
    if (logLines !== null) {
      mkdirSync(join(repo, ROOT), { recursive: true })
      writeFileSync(join(repo, ...REVIEW_CALL_LOG_REL.split('/')), logLines.join('\n') + '\n')
    }
    return repo
  }

  const d30Line = (repo: string): string => {
    const lines: string[] = []
    const log = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void lines.push(a.join(' ')))
    const exit = vi.spyOn(process, 'exit').mockImplementation(((): never => undefined as never) as never)
    try {
      doctorMain([SHORT, '--root', repo])
    } finally {
      log.mockRestore()
      exit.mockRestore()
    }
    return lines.find((l) => l.includes('] WARN D30:') || l.includes('] OK D30:')) ?? ''
  }

  /** AC-4 — 배선. 순수 테스트로는 잡히지 않는 결함이다. */
  it('🔴 로그에 있고 trunk에 증거가 없는 티켓을 main()이 WARN한다', () => {
    const line = d30Line(repoWith(['{"ticket_id":"REQ-2026-025"}', '{"ticket_id":"REQ-2026-025"}']))
    expect(line).toContain('WARN D30')
    expect(line).toContain('REQ-2026-025')
    expect(line).toContain('2회')
  })

  it('로그가 없으면 조용히 통과한다', () => {
    const line = d30Line(repoWith(null))
    expect(line).toContain('OK D30')
    expect(line).toContain('점검 불요')
  })

  /** 🔴 설계 리뷰 r01 의견: 손상된 로그에서도 fail-open이 진입점까지 이어지는가. */
  it('🔴 로그가 손상돼도 doctor가 죽지 않는다(fail-open이 진입점까지)', () => {
    const line = d30Line(repoWith(['{ 잘린 줄', '{"ticket_id":"REQ-2026-009"}']))
    expect(line).toContain('WARN D30')
    expect(line).toContain('REQ-2026-009')
  })
})
