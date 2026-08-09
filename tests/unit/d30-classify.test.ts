/**
 * D30 상태 분류(REQ-2026-117) — 분류 순수 함수·수집부(fetch 금지)·메시지 계약.
 */
import { describe, it, expect } from 'vitest'
import {
  classifyStranded,
  ticketIdInBranchNames,
  renderStrandedTicket,
  collectStrandedContext,
  readReviewCallStats,
  runChecks,
  type DoctorInputs,
  type ClassifiedStranded,
} from '../../scripts/req/req-doctor'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const NOW = '2026-08-09T12:00:00.000Z'

function stranded(id: string, reviews = 3): { id: string; reviews: number } {
  return { id, reviews }
}

describe('ticketIdInBranchNames — 전체 id·경계 일치(설계 r01 P1)', () => {
  it('feat/req-2026-009-slug 형태(소문자화·비영숫자 경계)와 일치한다', () => {
    expect(ticketIdInBranchNames('REQ-2026-009', ['feat/req-2026-009-p15-authz'])).toBe(true)
    expect(ticketIdInBranchNames('REQ-2026-009', ['REQ-2026-009'])).toBe(true)
  })
  it('숫자부만 일치하는 무관한 브랜치는 불일치 — false-positive가 조치 대상을 가리면 안 된다', () => {
    expect(ticketIdInBranchNames('REQ-2026-009', ['fix/2026-009-logging'])).toBe(false)
  })
  it('접두 관계(id 뒤에 숫자가 이어짐)는 불일치', () => {
    expect(ticketIdInBranchNames('REQ-2026-009', ['feat/req-2026-0091-other'])).toBe(false)
  })
  it('앞이 영숫자면 불일치(경계 위반)', () => {
    expect(ticketIdInBranchNames('REQ-2026-009', ['xreq-2026-009-a'])).toBe(false)
  })
})

describe('classifyStranded — 우선순위와 연령(설계 DEC-1)', () => {
  it('세 범주 각 1케이스: remote-trunk / branch-alive / stranded', () => {
    const out = classifyStranded({
      stranded: [stranded('REQ-2026-001'), stranded('REQ-2026-002'), stranded('REQ-2026-003')],
      remoteTrunkTickets: new Set(['REQ-2026-001']),
      localBranches: ['feat/req-2026-002-x'],
      lastReviewAt: new Map([['REQ-2026-001', '2026-08-07T12:00:00.000Z']]),
      nowIso: NOW,
    })
    expect(out.map((t) => t.category)).toEqual(['remote-trunk', 'branch-alive', 'stranded'])
    expect(out[0]!.ageDays).toBe(2)
    expect(out[1]!.ageDays).toBeNull() // 시각 미기록 — null로 전달되고 렌더링이 표기한다
  })

  it('우선순위: remote-trunk가 branch-alive를 이긴다(원격 증거 실재는 결정적 사실)', () => {
    const out = classifyStranded({
      stranded: [stranded('REQ-2026-009')],
      remoteTrunkTickets: new Set(['REQ-2026-009']),
      localBranches: ['feat/req-2026-009-x'],
      lastReviewAt: new Map(),
      nowIso: NOW,
    })
    expect(out[0]!.category).toBe('remote-trunk')
  })

  it('원격 축 판정 불가(null)면 branch-alive/stranded 분류는 계속된다', () => {
    const out = classifyStranded({
      stranded: [stranded('REQ-2026-009'), stranded('REQ-2026-010')],
      remoteTrunkTickets: null,
      localBranches: ['feat/req-2026-009-x'],
      lastReviewAt: new Map(),
      nowIso: NOW,
    })
    expect(out.map((t) => t.category)).toEqual(['branch-alive', 'stranded'])
  })
})

describe('renderStrandedTicket — 티켓별 표기 계약(설계 r01·r02 P1)', () => {
  it('연령이 있으면 N일 전, 없으면 "마지막 리뷰 시각 미기록"을 표기한다(생략 금지)', () => {
    const withAge: ClassifiedStranded = { id: 'REQ-2026-009', reviews: 7, category: 'stranded', ageDays: 12 }
    const noAge: ClassifiedStranded = { id: 'REQ-2026-010', reviews: 1, category: 'branch-alive', ageDays: null }
    expect(renderStrandedTicket(withAge)).toBe('REQ-2026-009(리뷰 7회·마지막 리뷰 12일 전)')
    expect(renderStrandedTicket(noAge)).toBe('REQ-2026-010(리뷰 1회·마지막 리뷰 시각 미기록)')
  })
})

describe('D30 메시지(runChecks) — 조치 대상 우선·범주별 티켓 상세·level 불변', () => {
  /** D30 축만 채운 최소 입력 — 다른 검사는 이 테스트의 관심사가 아니다(req-doctor.test.ts의 base 형태). */
  const base: DoctorInputs = {
    state: {
      id: 'REQ-2026-999',
      branch: 'feat/req-2026-999-x',
      phase: 'IMPLEMENT',
      commit_allowed: false,
    } as never,
    currentBranch: 'feat/req-2026-999-x',
    branchExists: true,
    branchPrefix: 'feat/req-',
    stagedTree: 'TREE',
    statusEntries: [],
    scratch: ['workflow/REQ-2026-999/codex-response.json'],
    responseVerdict: null,
    responseStructureOk: false,
    designApproved: false,
    designApprovedHash: null,
    currentDesignHash: null,
    ticketDocs: [],
    ticketRel: 'workflow/REQ-2026-999',
  }
  function d30Of(inp: Partial<DoctorInputs>): { level: string; msg: string } {
    const d30 = runChecks({ ...base, ...inp }).find((c) => c.id === 'D30')
    if (!d30) throw new Error('D30 미발화')
    return d30
  }

  const classified: ClassifiedStranded[] = [
    { id: 'REQ-2026-005', reviews: 5, category: 'stranded', ageDays: 30 },
    { id: 'REQ-2026-009', reviews: 7, category: 'branch-alive', ageDays: null },
    { id: 'REQ-2026-011', reviews: 2, category: 'remote-trunk', ageDays: 1 },
  ]
  const strandedList = classified.map(({ id, reviews }) => ({ id, reviews }))

  it('조치 대상이 앞서고, 세 범주 모두 티켓별 연령/미기록 표기가 있다', () => {
    const d30 = d30Of({
      strandedEvidence: strandedList,
      strandedClassified: classified,
      remoteTrunkFreshness: '2026-08-09T10:00:00+09:00',
      trunkBranch: 'main',
    })
    expect(d30.level).toBe('WARN')
    expect(d30.msg).toContain('조치 대상 1건: REQ-2026-005(리뷰 5회·마지막 리뷰 30일 전)')
    expect(d30.msg).toContain('미병합 브랜치에 있음')
    expect(d30.msg).toContain('REQ-2026-009(리뷰 7회·마지막 리뷰 시각 미기록)')
    expect(d30.msg).toContain('pull로 해소')
    expect(d30.msg).toContain('REQ-2026-011(리뷰 2회·마지막 리뷰 1일 전)')
    expect(d30.msg.indexOf('조치 대상')).toBeLessThan(d30.msg.indexOf('미병합 브랜치'))
  })

  it('원격 축 판정 불가면 그 사실을 표기한다 — 모르는 것을 단언하지 않는다', () => {
    const d30 = d30Of({
      strandedEvidence: strandedList.slice(0, 1),
      strandedClassified: classified.slice(0, 1),
      remoteTrunkFreshness: null,
      trunkBranch: 'main',
    })
    expect(d30.msg).toContain('원격 추적 ref 없음 — 원격 존재 여부는 판정하지 않음')
  })

  it('전부 branch-alive여도 WARN이다(침묵 강등 금지 — 실측 유실 2건이 branch-alive였다)', () => {
    const all: ClassifiedStranded[] = [{ id: 'REQ-2026-009', reviews: 7, category: 'branch-alive', ageDays: 20 }]
    const d30 = d30Of({
      strandedEvidence: [{ id: 'REQ-2026-009', reviews: 7 }],
      strandedClassified: all,
      remoteTrunkFreshness: '2026-08-09T10:00:00+09:00',
      trunkBranch: 'main',
    })
    expect(d30.level).toBe('WARN')
  })

  it('분류 미제공(undefined)이면 기존 단순 나열로 렌더링된다(판정 동일)', () => {
    const d30 = d30Of({ strandedEvidence: strandedList, trunkBranch: 'main' })
    expect(d30.level).toBe('WARN')
    expect(d30.msg).toContain('REQ-2026-005(리뷰 5회)')
  })
})

describe('collectStrandedContext — fetch 금지(설계 DEC-2)', () => {
  it('git 호출에 fetch가 없고, upstream ref에서 responses/ 티켓 집합·신선도를 얻는다', () => {
    const calls: string[][] = []
    const fake = (args: string[]): string => {
      calls.push(args)
      if (args[0] === 'rev-parse') return 'origin/main\n'
      if (args[0] === 'ls-tree')
        return 'workflow/REQ-2026-011/responses/approvals.jsonl\nworkflow/REQ-2026-012/00-requirement.md\n'
      if (args[0] === 'log') return '2026-08-09T10:00:00+09:00\n'
      if (args[0] === 'branch') return 'main\nfeat/req-2026-009-x\n'
      throw new Error(`예상 밖 호출: ${args.join(' ')}`)
    }
    const ctx = collectStrandedContext(fake, 'main', 'workflow')
    expect(calls.some((a) => a.includes('fetch'))).toBe(false)
    expect(ctx.remoteTrunkTickets).toEqual(new Set(['REQ-2026-011'])) // responses/ 보유만
    expect(ctx.remoteFreshness).toBe('2026-08-09T10:00:00+09:00')
    expect(ctx.localBranches).toContain('feat/req-2026-009-x')
  })

  it('upstream 미설정(rev-parse throw)이면 원격 축만 null이고 브랜치 목록은 계속 수집한다', () => {
    const fake = (args: string[]): string => {
      if (args[0] === 'rev-parse') throw new Error('no upstream')
      if (args[0] === 'branch') return 'main\n'
      throw new Error(`예상 밖 호출: ${args.join(' ')}`)
    }
    const ctx = collectStrandedContext(fake, 'main', 'workflow')
    expect(ctx.remoteTrunkTickets).toBeNull()
    expect(ctx.remoteFreshness).toBeNull()
    expect(ctx.localBranches).toEqual(['main'])
  })
})

describe('readReviewCallStats — counts 계약 유지 + lastAt(설계 DEC-3)', () => {
  it('티켓별 count와 최대 timestamp(로그 실제 키)를 집계하고, 시각 없는 행은 count만 기여한다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cg-d30-'))
    const p = join(dir, 'review-calls.jsonl')
    writeFileSync(
      p,
      [
        JSON.stringify({ ticket_id: 'REQ-2026-001', timestamp: '2026-08-01T00:00:00.000Z' }),
        JSON.stringify({ ticket_id: 'REQ-2026-001', timestamp: '2026-08-05T00:00:00.000Z' }),
        JSON.stringify({ ticket_id: 'REQ-2026-002' }), // timestamp 없음
        'broken-json-line',
        '',
      ].join('\n'),
      'utf8',
    )
    const stats = readReviewCallStats(p)
    expect(stats).not.toBeNull()
    expect(stats!.get('REQ-2026-001')).toEqual({ count: 2, lastAt: '2026-08-05T00:00:00.000Z' })
    expect(stats!.get('REQ-2026-002')).toEqual({ count: 1, lastAt: null })
  })

  it('전부 손상이면 null(모르는 것을 단언하지 않는다)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cg-d30-'))
    const p = join(dir, 'review-calls.jsonl')
    writeFileSync(p, 'x\ny\n', 'utf8')
    expect(readReviewCallStats(p)).toBeNull()
  })
})
