import { describe, it, expect } from 'vitest'
import { policyTargetIds, resolveIntegrationPolicy, runIntegrate, type AutoFacts } from '../../bin/integrate'
import {
  makeDeps,
  integrateOpts,
  fakeGit,
  fakeReadBlobs,
  BASE,
  SRC,
  TREE,
  FEATURE,
  TRUNK,
  MANIFEST_PATH,
  ARCHIVE_PATH,
} from '../support/integrate-fakes'
import {
  attestedOnlyAndAcked,
  scopeRangeProblem,
  parseDelegationLedger,
  type DelegationScope,
  type RangeAttribution,
} from '../../scripts/req/lib/delegation'
import { parseArgs } from '../../scripts/req/req-delegate'
import type { UnattributableCommit } from '../../scripts/req/lib/range-attribution'

/**
 * REQ-2026-168 DEC-3 — `req:delegate --allow-attested`.
 *
 * 🔴 **왜 이 축이 있는가**: `attested` 커밋이 범위에 하나라도 들어오면 자율 통합이 막히고, 비대화형
 *    (에이전트·CI)에는 통과 경로가 **아예 없었다**(소비자 리포트). 대화형 `y` 만 남는데 그 자리는
 *    fail-closed 판정을 사람이 덮는 자리라, 매번 누르면 게이트가 형식이 된다.
 *
 * 🔴 **무엇을 열지 않는가가 이 축의 핵심이다.** `attested` 외의 귀속 불가(`unproven`·
 *    `invalid-evidence`·분류 미상)는 **증거가 깨진 상태**이지 사람이 승인한 상태가 아니다.
 */

const commit = (over: Partial<UnattributableCommit> = {}): UnattributableCommit => ({
  sha: 'aaaa1111bbbb',
  subject: 'chore(commitgate): 런타임 올림',
  why: 'attested — 자율 통합 대상이 아니다',
  category: 'attested',
  ...over,
})

/** `attested` 가 아닌 귀속 불가 범주 — **전수**로 돌린다(하나를 대표로 삼으면 나머지가 열려도 green). */
const NON_ATTESTED: (string | null)[] = ['unproven', 'invalid-evidence', 'approved', 'bookkeeping', null]

const FACTS: AutoFacts = {
  riskLevel: 'LOW',
  budgetHardCapReached: false,
  reviewInconclusive: false,
  deliveryMembers: null,
  compositionChanged: false,
  memberPolicies: [{ id: 'REQ-2026-266', snapshotStopGate: 'auto', stateUnreadable: false }],
  policyUnknown: null,
}
const SCOPE: DelegationScope = { kind: 'ticket', req_id: 'REQ-2026-266' }
/** 브랜치 이름이 티켓과 맞아야 `scopeOfBranch` 가 scope 를 확정한다(위임 조회의 전제). */
const FEATURE_001 = 'feat/req-2026-001-x'
const OK_STATE = JSON.stringify({
  id: 'REQ-2026-001',
  risk_level: 'LOW',
  review_series: [{ series_id: 'phase:p1#1', attempts: 1, closed_reason: 'approved' }],
})
const noDelivery = (): string[] | null => null

const attribution = (commits: UnattributableCommit[]): RangeAttribution => ({
  tickets: ['REQ-2026-266'],
  unattributable: commits.length,
  unattributableAttested: commits.filter((c) => c.category === 'attested').length,
})

describe('[allow-attested] 🔴 G4 — 위임에 명시하지 않으면 여전히 막는다', () => {
  it('정책 판정: attested 만 있어도 ack 없이는 판정 불가다', () => {
    const r = policyTargetIds({ tickets: ['REQ-2026-266'], unattributableCommits: [commit()] }, SCOPE, noDelivery)
    expect(r.ok).toBe(false)
  })

  it('위임 권한 판정: ack 없이는 scope 거부다', () => {
    expect(scopeRangeProblem(SCOPE, attribution([commit()]), null, false)).not.toBeNull()
  })

  it('🔴 기본값이 불허다 — 인자를 생략해도 열리지 않는다', () => {
    expect(scopeRangeProblem(SCOPE, attribution([commit()]), null)).not.toBeNull()
  })
})

describe('[allow-attested] 명시하면 attested 만 통과한다', () => {
  it('정책 판정이 확정된다', () => {
    const r = policyTargetIds({ tickets: ['REQ-2026-266'], unattributableCommits: [commit()] }, SCOPE, noDelivery, true)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.ids).toContain('REQ-2026-266')
  })

  it('위임 권한 판정이 통과한다', () => {
    expect(scopeRangeProblem(SCOPE, attribution([commit()]), null, true)).toBeNull()
  })

  it('🔴 그래도 정책 판정 자체는 사라지지 않는다 — 확정된 대상으로 정상 판정한다', () => {
    expect(resolveIntegrationPolicy(FACTS, 'auto').kind).toBe('resolved')
  })
})

describe('[allow-attested] 🔴 G5 — attested 외에는 무엇도 열지 않는다', () => {
  for (const category of NON_ATTESTED) {
    const label = category ?? '분류 미상(null)'

    it(`${label} 단독 — ack 가 있어도 정책 판정 불가다`, () => {
      const r = policyTargetIds(
        { tickets: [], unattributableCommits: [commit({ category })] },
        SCOPE,
        noDelivery,
        true,
      )
      expect(r.ok).toBe(false)
      if (!r.ok && r.unknown.reason === 'unattributable')
        expect(r.unknown.commits.map((c) => c.category)).toEqual([category])
    })

    it(`${label} 이 attested 와 **섞이면** ack 가 있어도 막는다`, () => {
      const mixed = [commit(), commit({ sha: 'cccc3333', category })]
      const r = policyTargetIds({ tickets: [], unattributableCommits: mixed }, SCOPE, noDelivery, true)
      expect(r.ok).toBe(false)
      // 🔴 막은 이유로 **그 커밋만** 남는다 — attested 를 사유로 말하면 거짓이다.
      if (!r.ok && r.unknown.reason === 'unattributable') expect(r.unknown.commits).toHaveLength(1)
      expect(scopeRangeProblem(SCOPE, attribution(mixed), null, true)).not.toBeNull()
    })
  }
})

describe('[allow-attested] 🔴 G6 — 두 차단 지점이 같은 입력에 같은 답을 낸다', () => {
  const cases: { name: string; commits: UnattributableCommit[]; ack: boolean }[] = [
    { name: 'attested 만 · ack', commits: [commit()], ack: true },
    { name: 'attested 만 · ack 없음', commits: [commit()], ack: false },
    { name: '섞임 · ack', commits: [commit(), commit({ category: 'unproven' })], ack: true },
    { name: '없음 · ack 없음', commits: [], ack: false },
  ]

  for (const c of cases) {
    it(`${c.name} — 정책과 위임 판정이 일치한다`, () => {
      const policyOk = policyTargetIds({ tickets: [], unattributableCommits: c.commits }, SCOPE, noDelivery, c.ack).ok
      const scopeOk = scopeRangeProblem(SCOPE, attribution(c.commits), null, c.ack) === null
      expect(policyOk, c.name).toBe(scopeOk)
    })
  }
})

describe('[allow-attested] attestedOnlyAndAcked — 술어 자체', () => {
  it('🔴 수집되지 않은 개수(undefined)는 0 이 아니라 "모름"이다 → 적용하지 않는다', () => {
    expect(attestedOnlyAndAcked({ tickets: [], unattributable: 1 }, true)).toBe(false)
  })

  it('귀속 불가가 없으면 이 술어는 참이 아니다(그때는 애초에 막지 않는다)', () => {
    expect(attestedOnlyAndAcked({ tickets: [], unattributable: 0, unattributableAttested: 0 }, true)).toBe(false)
  })

  it('일부만 attested 면 거짓이다', () => {
    expect(attestedOnlyAndAcked({ tickets: [], unattributable: 2, unattributableAttested: 1 }, true)).toBe(false)
  })
})

/**
 * 🔴 **원장 하위호환**(설계 리뷰 관찰). 새 키를 필수로 두면 업그레이드 순간 기존 원장이 통째로
 *    손상 판정되어 **무관한 자율 통합이 전부 막힌다**. 부재 = `false`(불허)로 읽는다.
 */
describe('[allow-attested] 🔴 옛 원장 행을 계속 읽는다', () => {
  const row = (extra: string): string =>
    JSON.stringify({
      kind: 'issued',
      id: 'id-1',
      at: '2026-08-17T00:00:00.000Z',
      scope: { kind: 'ticket', req_id: 'REQ-2026-266' },
      trunk_branch: 'main',
      trunk_sha: 'a'.repeat(40),
      source_branch: 'feat/x',
      base_sha: 'b'.repeat(40),
      expires_at: '2026-08-18T00:00:00.000Z',
      permissions: { local_merge: true, origin_push: false, bypass_protection: false },
      high_risk_ack: false,
      approval_sentence: '통합을 사전 위임합니다',
      ...(extra === '' ? {} : JSON.parse(extra)),
    })

  it('`attested_ack` 가 없는 행은 유효하고 값은 false 다', () => {
    const { rows } = parseDelegationLedger(row(''))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.kind === 'issued' && rows[0].attested_ack).toBe(false)
  })

  it('값이 있으면 그대로 읽는다', () => {
    const { rows } = parseDelegationLedger(row('{"attested_ack":true}'))
    expect(rows[0]?.kind === 'issued' && rows[0].attested_ack).toBe(true)
  })

  it('🔴 형태가 틀리면 그때는 손상이 맞다 — 조용히 false 로 읽지 않는다', () => {
    const { rows } = parseDelegationLedger(row('{"attested_ack":"yes"}'))
    expect(rows).toHaveLength(0)
  })
})

describe('[allow-attested] 🔴 G8 — 명령 표면', () => {
  it('--allow-attested 가 파싱되고 기본은 불허다', () => {
    expect(parseArgs([]).allowAttested).toBe(false)
    expect(parseArgs(['--allow-attested']).allowAttested).toBe(true)
  })

  it('🔴 자유 텍스트 값 자리에서 옵션으로 인식된다 — 문장으로 삼키지 않는다', () => {
    expect(() => parseArgs(['--sentence', '--allow-attested'])).toThrow(/값이 누락/)
  })
})

/**
 * 🔴 **phase-2 r01 P1 — 무효 위임이 면제를 열면 안 된다.**
 *
 * 앞선 판의 구멍: `activeDelegationAck` 가 원장의 **미소비 행**만 보고 정책을 풀었는데, `stopGate` 가
 * `merge` 면 `delegationRequired` 가 `false` 라 `delegationGate` 가 **아예 돌지 않았다**. 그래서
 * 만료·trunk 이동·source 불일치 위임으로도 **비대화형 통합이 열렸다**.
 *
 * 고침: 면제를 쓰는 것 자체가 **위임된 행위**이므로 게이트를 강제한다(`policy.delegationRequired ||
 * attestedWaiverUsed`). 아래는 그 배선을 **실행해서** 본다 — 순수 테스트로는 잡히지 않는 자리다.
 */
describe('[allow-attested] 🔴 무효 위임 + stopGate merge — 비대화형에서 열리지 않는다', () => {
  const ATTESTED_SHA = 'd'.repeat(40)

  /**
   * `ls-tree` 결과에 attestations 경로를 더한다 — `collectDeepInput` 은 그 목록에 **보일 때만**
   * attestations 를 읽는다. 나머지 호출은 원래 fake 가 처리하고 `calls` 도 그대로 쌓인다.
   */
  const withAttestationsInTree = (g: ReturnType<typeof fakeGit>): ReturnType<typeof fakeGit> => ({
    ...g,
    exec(args: string[]): string {
      if (args[0] === 'ls-tree') {
        g.calls.push(args)
        return `${MANIFEST_PATH}\n${ARCHIVE_PATH}\nworkflow/attestations.jsonl\n`
      }
      return g.exec(args)
    },
  })

  /** 범위에 attested 커밋 1건을 넣는다(승인 증거 없음 + attestations.jsonl 에 등재 + tree 일치). */
  const withAttestedCommit = (ledger: string | null, over: Record<string, unknown> = {}) => {
    const attRow = JSON.stringify({
      schema_version: 1,
      sha: ATTESTED_SHA,
      tree: TREE,
      reason: '런타임 업그레이드 커밋',
      attested_at: '2026-08-17T00:00:00.000Z',
      attested_by: 'tester <t@e.st>',
    })
    return makeDeps({
      stopGate: 'merge',
      interactive: false,
      readDelegationLedger: () => ledger,
      git: withAttestationsInTree(
        fakeGit({
          branch: FEATURE_001,
          logOut: [
            `${SRC}\x1f${TREE}\x1f${BASE}\x1ffeat: approved work\x00\n`,
            `${ATTESTED_SHA}\x1f${TREE}\x1f${SRC}\x1fchore(commitgate): 런타임을 올림\x00\n`,
          ].join(''),
          nameOnlyOut: [`\x01${SRC}\nsrc/app.ts\n`, `\x01${ATTESTED_SHA}\npackage.json\n`].join(''),
        }),
      ),
      readBlobs: fakeReadBlobs({ 'workflow/attestations.jsonl': `${attRow}\n` }),
      ...over,
    })
  }

  const issuedRow = (over: Record<string, unknown>): string =>
    JSON.stringify({
      kind: 'issued',
      id: 'id-1',
      at: '2026-08-17T00:00:00.000Z',
      scope: { kind: 'ticket', req_id: 'REQ-2026-001' },
      trunk_branch: TRUNK,
      trunk_sha: BASE,
      source_branch: FEATURE_001,
      base_sha: BASE,
      expires_at: '2026-08-18T00:00:00.000Z',
      permissions: { local_merge: true, origin_push: false, bypass_protection: false },
      high_risk_ack: false,
      attested_ack: true,
      approval_sentence: '통합을 사전 위임합니다',
      ...over,
    })

  it('🔴 오라클이 공허하지 않다 — 위임이 아예 없으면 attested 로 막힌다', async () => {
    const deps = withAttestedCommit(null)
    const r = await runIntegrate(integrateOpts({ run: true }), deps)
    expect(r.merged).toBe(false)
    expect(r.exit).toBe(1)
    expect(deps.logs.join('\n')).toContain('attested')
  })

  /**
   * 🔴 **대조군이 없으면 아래 셋은 공허하다.** 실제로 첫 판이 그랬다 — 원장 scope 가 브랜치와 달라
   *    면제가 **애초에 적용되지 않았고**, 그래서 배선을 되돌리는 변이에도 전부 green 이었다.
   *
   *    병합 **완료**까지 보지 않는 이유: 그 뒤는 fake 가 소비 커밋을 만들어야 하는 자리이고,
   *    이 테스트가 보려는 성질(무효 위임이 면제를 열지 못한다)은 **게이트 통과 여부**에서 갈린다.
   */
  const gateAllowed = (logs: string[]): boolean => logs.join('\n').includes('사람 확인 없이 진행합니다')

  it('🔴 대조군: **유효한** --allow-attested 위임은 게이트를 통과한다', async () => {
    const deps = withAttestedCommit(`${issuedRow({})}\n`)
    await runIntegrate(integrateOpts({ run: true }), deps)
    expect(gateAllowed(deps.logs), deps.logs.join('\n')).toBe(true)
    // 면제로 실린 커밋을 이름으로 남긴다(설계 DEC-3).
    expect(deps.logs.join('\n')).toContain('attested 위임: 1건')
  })

  it('🔴 **만료된** --allow-attested 위임으로는 열리지 않는다', async () => {
    // fake 의 시계는 2026-08-10 이다 — 그보다 이른 만료를 쓴다(`now` 를 덮으면 makeDeps 가 무시한다).
    const deps = withAttestedCommit(
      `${issuedRow({ at: '2026-08-08T00:00:00.000Z', expires_at: '2026-08-09T00:00:00.000Z' })}\n`,
    )
    const r = await runIntegrate(integrateOpts({ run: true }), deps)
    expect(r.merged, deps.logs.join('\n')).toBe(false)
    expect(gateAllowed(deps.logs), deps.logs.join('\n')).toBe(false)
    expect(deps.git.calls.some((c) => c[0] === 'merge')).toBe(false)
  })

  it('🔴 **source 가 다른** 위임으로도 열리지 않는다', async () => {
    const deps = withAttestedCommit(`${issuedRow({ source_branch: 'feat/other' })}\n`)
    const r = await runIntegrate(integrateOpts({ run: true }), deps)
    expect(r.merged, deps.logs.join('\n')).toBe(false)
    expect(gateAllowed(deps.logs), deps.logs.join('\n')).toBe(false)
    expect(deps.git.calls.some((c) => c[0] === 'merge')).toBe(false)
  })

  it('🔴 **trunk 가 움직인** 위임으로도 열리지 않는다', async () => {
    const deps = withAttestedCommit(`${issuedRow({ trunk_sha: 'f'.repeat(40) })}\n`)
    const r = await runIntegrate(integrateOpts({ run: true }), deps)
    expect(r.merged, deps.logs.join('\n')).toBe(false)
    expect(gateAllowed(deps.logs), deps.logs.join('\n')).toBe(false)
    expect(deps.git.calls.some((c) => c[0] === 'merge')).toBe(false)
  })
})
