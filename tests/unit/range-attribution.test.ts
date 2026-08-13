import { describe, it, expect } from 'vitest'
import { attributeRange, deliveryOfPath, ticketOfPath, type AttributionInput } from '../../scripts/req/lib/range-attribution'
import { scopeRangeProblem } from '../../scripts/req/lib/delegation'
import type { DeepCategory, DeepCommitMeta, ManifestFile } from '../../scripts/req/lib/verify-range'

/**
 * REQ-2026-140 phase-4a — 병합 범위의 티켓 귀속(설계 DEC-4a).
 *
 * 🔴 이 계산이 없으면 티켓 A 로 받은 위임이 같은 브랜치에 쌓인 B 까지 통합한다.
 *    **이 저장소의 체인(134~140)이 정확히 그 모양**이라 픽스처가 인위적이지 않다.
 */

const sha = (n: number): string => String(n).padStart(40, '0')

const commit = (n: number, over: Partial<DeepCommitMeta> = {}): DeepCommitMeta =>
  ({
    sha: sha(n),
    subject: `c${n}`,
    message: `c${n}`,
    parentCount: 1,
    changedPaths: [],
    ccPaths: [],
    ...over,
  }) as DeepCommitMeta

const manifest = (ticket: string, shas: string[]): ManifestFile => ({
  path: `workflow/${ticket}/responses/approvals.jsonl`,
  content: shas.map((s) => JSON.stringify({ consumed_by_commit_sha: s })).join('\n') + '\n',
})

const INPUT = (over: Partial<AttributionInput> = {}): AttributionInput => ({
  commits: [],
  entries: [],
  manifests: [],
  ticketRoot: 'workflow',
  ...over,
})

const entry = (n: number, category: DeepCategory): { sha: string; category: DeepCategory } => ({ sha: sha(n), category })

describe('[REQ-2026-140] ticketOfPath', () => {
  it('티켓 디렉터리만 티켓으로 읽는다', () => {
    expect(ticketOfPath('workflow/REQ-2026-140/state.json', 'workflow')).toBe('REQ-2026-140')
    expect(ticketOfPath('workflow/delegations.jsonl', 'workflow')).toBeNull()
    expect(ticketOfPath('src/index.ts', 'workflow')).toBeNull()
    expect(ticketOfPath('workflow/notes/x.md', 'workflow')).toBeNull()
  })
})

describe('[REQ-2026-140] attributeRange — 범주별 귀속', () => {
  it('승인 커밋은 매니페스트의 티켓으로 귀속된다', () => {
    const r = attributeRange(
      INPUT({
        commits: [commit(1)],
        entries: [entry(1, 'approved')],
        manifests: [manifest('REQ-2026-140', [sha(1)])],
      }),
    )
    expect(r.tickets).toEqual(['REQ-2026-140'])
    expect(r.unattributable).toBe(0)
  })

  it('🔴 두 티켓이 한 범위에 있으면 둘 다 나온다(이것이 scope 검사의 입력이다)', () => {
    const r = attributeRange(
      INPUT({
        commits: [commit(1), commit(2)],
        entries: [entry(1, 'approved'), entry(2, 'approved')],
        manifests: [manifest('REQ-2026-140', [sha(1)]), manifest('REQ-2026-139', [sha(2)])],
      }),
    )
    expect(r.tickets).toEqual(['REQ-2026-139', 'REQ-2026-140'])
    // 🔴 실제 결속: 140 위임으로는 이 범위를 통합할 수 없다.
    expect(scopeRangeProblem({ kind: 'ticket', req_id: 'REQ-2026-140' }, r, null)).toContain('REQ-2026-139')
  })

  it('merge 커밋은 귀속이 없다(부모로 흡수)', () => {
    const r = attributeRange(
      INPUT({ commits: [commit(1, { parentCount: 2 })], entries: [entry(1, 'merge')] }),
    )
    expect(r.tickets).toEqual([])
    expect(r.unattributable).toBe(0)
  })

  it('티켓 디렉터리를 바꾼 부기는 그 티켓으로 귀속된다', () => {
    const r = attributeRange(
      INPUT({
        commits: [commit(1, { changedPaths: ['workflow/REQ-2026-140/state.json'] })],
        entries: [entry(1, 'bookkeeping')],
      }),
    )
    expect(r.tickets).toEqual(['REQ-2026-140'])
  })

  /**
   * 🔴 **phase-3 이 드러낸 자리**: 위임 발급 부기 커밋은 `workflow/delegations.jsonl` 만 바꾼다.
   *    티켓 디렉터리가 아니므로 귀속이 없지만 **판정 불가가 아니다** — 그렇게 읽으면 위임이
   *    자기 자신 때문에 `scope-out-of-range` 로 막힌다.
   */
  it('🔴 위임 원장 부기는 repo 수준이라 판정 불가가 아니다(자기 자신을 막지 않는다)', () => {
    const r = attributeRange(
      INPUT({
        commits: [commit(1, { changedPaths: ['workflow/delegations.jsonl'] })],
        entries: [entry(1, 'bookkeeping')],
      }),
    )
    expect(r.unattributable).toBe(0)
    expect(r.repoLevelBookkeeping).toBe(1)
    expect(r.tickets).toEqual([])
    // 티켓 위임으로도 통과한다 — 범위 밖 티켓이 없기 때문이다.
    expect(scopeRangeProblem({ kind: 'ticket', req_id: 'REQ-2026-140' }, r, null)).toBeNull()
  })

  /**
   * 🔴 phase-4a 리뷰 r01 P1 — **repo 수준 허용은 접두가 아니라 정확한 경로 집합**이다.
   *    `<ticketRoot>/` 아래면 무조건 통과시키면 `workflow/delivery/*.json` 같은 다른 도구 상태가
   *    티켓 위임에 편승해 통합된다.
   */
  it('🔴 위임 원장도 delivery 레코드도 아닌 ticketRoot 하위 부기는 판정 불가다', () => {
    const r = attributeRange(
      INPUT({
        commits: [commit(1, { changedPaths: ['workflow/notes/scratch.md'], subject: 'chore: 메모' })],
        entries: [entry(1, 'bookkeeping')],
      }),
    )
    expect(r.unattributable).toBe(1)
    expect(scopeRangeProblem({ kind: 'ticket', req_id: 'REQ-2026-140' }, r, null)).not.toBeNull()
  })

  it('제목의 chore(REQ-…) 로 귀속된다(DEC-4a)', () => {
    const r = attributeRange(
      INPUT({
        commits: [commit(1, { changedPaths: ['workflow/notes/x.md'], subject: 'chore(REQ-2026-139): 메모 갱신' })],
        entries: [entry(1, 'bookkeeping')],
      }),
    )
    expect(r.tickets).toEqual(['REQ-2026-139'])
    expect(r.unattributable).toBe(0)
  })

  /**
   * 🔴 phase-4a 리뷰 r03 P1 — **delivery 정상 경로를 막으면 안 된다.**
   *    `commitgate delivery create/begin` 은 `workflow/delivery/<slug>.json` 만 바꾸고 제목이
   *    `chore(delivery): …` 라 REQ 를 담지 않는다. 판정 불가로 두면 지원되는 delivery scope 의
   *    자율 통합이 통째로 막힌다. 슬러그로 귀속시켜 **그 묶음의 위임에서만** 정상이 되게 한다.
   */
  it('🔴 delivery 레코드는 슬러그로 귀속되고, 그 묶음 위임에서만 통과한다', () => {
    const r = attributeRange(
      INPUT({
        commits: [commit(1, { changedPaths: ['workflow/delivery/S.json'], subject: 'chore(delivery): create S' })],
        entries: [entry(1, 'bookkeeping')],
      }),
    )
    expect(r.unattributable).toBe(0)
    expect(r.deliveries).toEqual(['S'])
    // 그 묶음의 위임 → 통과
    expect(scopeRangeProblem({ kind: 'delivery', slug: 'S' }, r, [])).toBeNull()
    // 🔴 티켓 위임으로 묶음 상태를 옮길 수 없다
    expect(scopeRangeProblem({ kind: 'ticket', req_id: 'REQ-2026-140' }, r, null)).toContain('S')
    // 🔴 다른 묶음의 위임으로도 안 된다
    expect(scopeRangeProblem({ kind: 'delivery', slug: 'OTHER' }, r, [])).toContain('S')
  })

  it('deliveryOfPath 는 delivery 레코드만 읽는다', () => {
    expect(deliveryOfPath('workflow/delivery/0.23.0.json', 'workflow')).toBe('0.23.0')
    expect(deliveryOfPath('workflow/delivery/a/b.json', 'workflow')).toBeNull()
    expect(deliveryOfPath('workflow/delivery/x.txt', 'workflow')).toBeNull()
    expect(deliveryOfPath('workflow/REQ-2026-140/state.json', 'workflow')).toBeNull()
  })

  /**
   * 🔴 phase-4a 리뷰 r02 P1 — **티켓 경로가 하나 있다고 나머지를 안 보면 안 된다.**
   *    `workflow/REQ-2026-140/…` + `workflow/delivery/S.json` 부기가 140 위임만으로 통합됐다.
   */
  it('🔴 티켓 경로와 미분류 경로가 섞이면 판정 불가다(티켓만 보고 넘어가지 않는다)', () => {
    const r = attributeRange(
      INPUT({
        commits: [
          commit(1, {
            changedPaths: ['workflow/REQ-2026-140/responses/approvals.jsonl', 'workflow/notes/x.md'],
            subject: 'chore: 둘 다 바꿈',
          }),
        ],
        entries: [entry(1, 'bookkeeping')],
      }),
    )
    expect(r.unattributable).toBe(1)
    expect(scopeRangeProblem({ kind: 'ticket', req_id: 'REQ-2026-140' }, r, null)).not.toBeNull()
  })

  it('혼합이어도 제목이 티켓을 밝히면 두 티켓 모두 귀속된다', () => {
    const r = attributeRange(
      INPUT({
        commits: [
          commit(1, {
            changedPaths: ['workflow/REQ-2026-140/state.json', 'workflow/notes/x.md'],
            subject: 'chore(REQ-2026-139): delivery 갱신',
          }),
        ],
        entries: [entry(1, 'bookkeeping')],
      }),
    )
    expect(r.tickets).toEqual(['REQ-2026-139', 'REQ-2026-140'])
    expect(scopeRangeProblem({ kind: 'ticket', req_id: 'REQ-2026-140' }, r, null)).toContain('REQ-2026-139')
  })

  it('🔴 변경 경로가 없는 부기는 판정 불가다', () => {
    const r = attributeRange(INPUT({ commits: [commit(1, { changedPaths: [] })], entries: [entry(1, 'bookkeeping')] }))
    expect(r.unattributable).toBe(1)
  })

  it('🔴 위임 원장에 다른 경로가 섞이면 repo 수준이 아니다', () => {
    const r = attributeRange(
      INPUT({
        commits: [
          commit(1, { changedPaths: ['workflow/delegations.jsonl', 'workflow/notes/x.md'], subject: 'chore: 둘 다' }),
        ],
        entries: [entry(1, 'bookkeeping')],
      }),
    )
    expect(r.unattributable).toBe(1)
  })

  /** 🔴 리뷰 없이 예외 승인된 커밋을 자율 통합에 태우지 않는다. */
  it('🔴 attested 는 판정 불가다', () => {
    const r = attributeRange(INPUT({ commits: [commit(1)], entries: [entry(1, 'attested')] }))
    expect(r.unattributable).toBe(1)
    expect(r.unattributableCommits[0]?.why).toContain('attested')
    expect(scopeRangeProblem({ kind: 'ticket', req_id: 'REQ-2026-140' }, r, null)).not.toBeNull()
  })

  it('🔴 unproven·invalid-evidence 도 판정 불가다(strict 가 먼저 막지만 여기서도 통과 안 함)', () => {
    for (const c of ['unproven', 'invalid-evidence'] as const) {
      const r = attributeRange(INPUT({ commits: [commit(1)], entries: [entry(1, c)] }))
      expect(r.unattributable, c).toBe(1)
    }
  })

  it('🔴 분류 결과에 없는 커밋은 판정 불가다(조용히 건너뛰지 않는다)', () => {
    const r = attributeRange(INPUT({ commits: [commit(1)], entries: [] }))
    expect(r.unattributable).toBe(1)
    expect(r.unattributableCommits[0]?.why).toContain('분류 결과에 없는')
  })

  it('🔴 승인 커밋인데 소비 행이 없으면 판정 불가다', () => {
    const r = attributeRange(INPUT({ commits: [commit(1)], entries: [entry(1, 'approved')], manifests: [] }))
    expect(r.unattributable).toBe(1)
  })

  it('한 커밋을 여러 티켓이 소비했으면 전부 귀속으로 본다(좁게 읽지 않는다)', () => {
    const r = attributeRange(
      INPUT({
        commits: [commit(1)],
        entries: [entry(1, 'approved')],
        manifests: [manifest('REQ-2026-140', [sha(1)]), manifest('REQ-2026-139', [sha(1)])],
      }),
    )
    expect(r.tickets).toEqual(['REQ-2026-139', 'REQ-2026-140'])
  })
})

/** 이 저장소의 실제 체인 모양 — 승인 커밋 여럿 + 티켓 부기 + 위임 원장 부기 + merge. */
describe('[REQ-2026-140] 현실 조합', () => {
  const input = INPUT({
    commits: [
      commit(1),
      commit(2, { changedPaths: ['workflow/REQ-2026-140/responses/approvals.jsonl'] }),
      commit(3, { changedPaths: ['workflow/delegations.jsonl'] }),
      commit(4, { parentCount: 2 }),
      commit(5),
    ],
    entries: [
      entry(1, 'approved'),
      entry(2, 'bookkeeping'),
      entry(3, 'bookkeeping'),
      entry(4, 'merge'),
      entry(5, 'approved'),
    ],
    manifests: [manifest('REQ-2026-140', [sha(1)]), manifest('REQ-2026-139', [sha(5)])],
  })

  it('귀속은 두 티켓 · 판정 불가 0 · repo 부기 1', () => {
    const r = attributeRange(input)
    expect(r.tickets).toEqual(['REQ-2026-139', 'REQ-2026-140'])
    expect(r.unattributable).toBe(0)
    expect(r.repoLevelBookkeeping).toBe(1)
  })

  it('🔴 140 단독 위임으로는 막히고, 두 티켓을 묶은 delivery 위임이면 통과한다', () => {
    const r = attributeRange(input)
    expect(scopeRangeProblem({ kind: 'ticket', req_id: 'REQ-2026-140' }, r, null)).toContain('REQ-2026-139')
    expect(
      scopeRangeProblem({ kind: 'delivery', slug: 'S' }, r, ['REQ-2026-139', 'REQ-2026-140']),
    ).toBeNull()
  })
})
