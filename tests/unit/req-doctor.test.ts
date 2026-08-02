import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  runChecks,
  phaseGranularityWarnings,
  parseArgs,
  classifyInstallMode,
  safeSha256,
  unprotectedRepoRootScratch,
  unmergedClosedTickets,
  type DoctorInputs,
  type Check,
} from '../../scripts/req/req-doctor'
import { packageRoot, DEFAULTS } from '../../scripts/req/lib/config'
import type { StatusEntry } from '../../scripts/req/lib/porcelain'
import type { WorkflowState, Verdict } from '../../scripts/req/review-codex'

/**
 * 테스트 편의: `--porcelain` 표기 문자열(`'R  old -> new'`)을 `StatusEntry`로 변환.
 * `-z` 시맨틱(path=NEW, origPath=OLD)으로 맞춘다 — runChecks가 이제 StatusEntry[]를 받기 때문.
 */
const E = (...lines: string[]): StatusEntry[] =>
  lines.map((l) => {
    const index = l[0] as string
    const worktree = l[1] as string
    const rest = l.slice(3)
    const arrow = rest.indexOf(' -> ')
    if (arrow >= 0) return { index, worktree, path: rest.slice(arrow + 4), origPath: rest.slice(0, arrow) }
    return { index, worktree, path: rest }
  })

const base: DoctorInputs = {
  state: {
    id: 'REQ-2026-001',
    branch: 'feat/req-2026-001-x',
    phase: 'IMPLEMENT',
    commit_allowed: false,
  } as WorkflowState,
  currentBranch: 'feat/req-2026-001-x',
  branchExists: true,
  branchPrefix: 'feat/req-', // Phase 2: config 기본값(현재 동작 보존)
  stagedTree: 'TREE',
  statusEntries: E(),
  scratch: [
    'workflow/REQ-2026-001/codex-response.json',
    'workflow/REQ-2026-001/.review-preview.txt',
    'workflow/REQ-2026-001/state.json',
  ],
  responseVerdict: null,
  responseStructureOk: false,
  designApproved: false,
  designApprovedHash: null,
  currentDesignHash: null,
  ticketDocs: [
    'workflow/REQ-2026-001/00-requirement.md',
    'workflow/REQ-2026-001/01-design.md',
    'workflow/REQ-2026-001/02-plan.md',
    'workflow/REQ-2026-001/codex-request.md',
  ],
  ticketRel: 'workflow/REQ-2026-001',
}

function mk(over: Partial<Omit<DoctorInputs, 'state'>> & { state?: Partial<WorkflowState> }): DoctorInputs {
  const { state: stateOver, ...rest } = over
  return { ...base, ...rest, state: { ...base.state, ...stateOver } as WorkflowState }
}
const lvl = (checks: Check[], id: string) => checks.find((c) => c.id === id)?.level

const validVerdict = {
  machine_schema_version: '1.1',
  review_base_sha: 'BASE',
  status: 'STEP_COMPLETE',
  commit_approved: 'yes',
  merge_ready: 'no',
  risk_level: 'LOW',
  review_kind: 'phase',
  findings: [],
  next_action: '',
}

describe('req:doctor — runChecks(1차 최소셋)', () => {
  it('정상 입력(commit_allowed=false)이면 FAIL 없음', () => {
    const fails = runChecks(mk({})).filter((c) => c.level === 'FAIL')
    expect(fails).toEqual([])
  })

  it('D21(REQ-2026-040): Quick Start 백필 필요는 WARN — dev/dogfood·미계산·최신은 OK, 절대 FAIL 아님', () => {
    const ins = [{ rel: 'CLAUDE.md', action: 'insert' as const }]
    // dev/dogfood(packageRootDiffers=false) → OK skip
    expect(lvl(runChecks(mk({ packageRootDiffers: false, quickstartBackfill: ins })), 'D21')).toBe('OK')
    // 🔴 미계산·판정 불가(undefined) → OK (REQ-2026-101 DEC-7: 판정할 근거가 없으면 알리지 않는다)
    expect(lvl(runChecks(mk({ packageRootDiffers: true })), 'D21')).toBe('OK')
    // 전부 최신([]) → OK
    expect(lvl(runChecks(mk({ packageRootDiffers: true, quickstartBackfill: [] })), 'D21')).toBe('OK')
    // 소비 repo + 백필 필요 → WARN
    const warned = runChecks(mk({ packageRootDiffers: true, quickstartBackfill: [...ins, { rel: 'AGENTS.md', action: 'insert' as const }] }))
    expect(lvl(warned, 'D21')).toBe('WARN')
    expect(warned.filter((c) => c.level === 'FAIL')).toEqual([]) // 게이트를 벽돌로 만들지 않는다
  })

  /**
   * REQ-2026-101 — 부재와 드리프트는 사용자에게 **다른 사건**이다. 한 줄에 뭉치면 무엇을 해야 하는지도,
   * 무엇을 잃는지도 알 수 없다. 특히 드리프트 갱신은 마커 안쪽 수정을 덮어쓴다.
   */
  it('[REQ-2026-101] D21이 부재와 드리프트를 구분하고, 드리프트엔 덮어쓰기 경고가 붙는다', () => {
    const msg = (inp: Parameters<typeof mk>[0]): string => runChecks(mk(inp)).find((c) => c.id === 'D21')?.msg ?? ''

    const onlyMissing = msg({ packageRootDiffers: true, quickstartBackfill: [{ rel: 'CLAUDE.md', action: 'insert' }] })
    expect(onlyMissing).toContain('Quick Start 블록이 없습니다')
    expect(onlyMissing).not.toContain('덮어써집니다')       // 부재엔 덮어쓸 것이 없다

    const onlyStale = msg({ packageRootDiffers: true, quickstartBackfill: [{ rel: 'AGENTS.md', action: 'replace' }] })
    expect(onlyStale).toContain('드리프트')
    expect(onlyStale).toContain('덮어써집니다')             // 무엇을 잃는지 말한다
    expect(onlyStale).not.toContain('블록이 없습니다')       // 사유를 섞지 않는다

    // 둘 다면 둘 다 말하고, 해소 명령은 한 번만 붙는다.
    const both = msg({
      packageRootDiffers: true,
      quickstartBackfill: [{ rel: 'CLAUDE.md', action: 'insert' }, { rel: 'AGENTS.md', action: 'replace' }],
    })
    expect(both).toContain('CLAUDE.md 에 Quick Start 블록이 없습니다')
    expect(both).toContain('AGENTS.md 의 Quick Start 블록이 설치된 commitgate와 다릅니다')
    expect(both.match(/quickstart --apply/g)?.length).toBe(1)
  })

  it('[REQ-2026-101] D21은 어떤 입력에서도 WARN 상한이다(커밋 게이트를 벽돌로 만들지 않는다)', () => {
    for (const backfill of [
      [{ rel: 'CLAUDE.md', action: 'insert' as const }],
      [{ rel: 'AGENTS.md', action: 'replace' as const }],
      [{ rel: 'CLAUDE.md', action: 'replace' as const }, { rel: 'AGENTS.md', action: 'insert' as const }],
    ]) {
      const checks = runChecks(mk({ packageRootDiffers: true, quickstartBackfill: backfill }))
      expect(checks.find((c) => c.id === 'D21')?.level).not.toBe('FAIL')
    }
  })

  it('D22(REQ-2026-047): repo-root 스크래치 미보호는 WARN — dev/dogfood·미계산·보호됨은 OK, 절대 FAIL 아님', () => {
    // dev/dogfood(packageRootDiffers=false) → OK skip
    expect(
      lvl(runChecks(mk({ packageRootDiffers: false, repoRootScratchUnprotected: ['workflow/.review-calls.jsonl'] })), 'D22'),
    ).toBe('OK')
    // 미계산(undefined) → OK
    expect(lvl(runChecks(mk({ packageRootDiffers: true })), 'D22')).toBe('OK')
    // 전부 보호됨([]) → OK
    expect(lvl(runChecks(mk({ packageRootDiffers: true, repoRootScratchUnprotected: [] })), 'D22')).toBe('OK')
    // 소비 repo + 미보호 → WARN
    const warned = runChecks(mk({ packageRootDiffers: true, repoRootScratchUnprotected: ['workflow/.review-calls.jsonl'] }))
    expect(lvl(warned, 'D22')).toBe('WARN')
    // 🔴 이 검사가 FAIL로 승격되면 소비자의 모든 커밋이 벽돌이 된다 — 레벨 상한을 테스트로 고정한다.
    expect(warned.filter((c) => c.level === 'FAIL')).toEqual([])
    // 안내가 실행 가능한 명령을 담아야 한다(불투명한 D10 메시지의 번역이 존재 이유).
    expect(warned.find((c) => c.id === 'D22')?.msg).toContain('commitgate sync --gitignore --apply')
  })

  it('D23(REQ-2026-056): frozen-lockfile 위생 — missing/untracked는 WARN, ok/no-package-json/미계산은 OK, 절대 FAIL 아님', () => {
    // ⑩ ok → OK
    expect(lvl(runChecks(mk({ lockfileStatus: 'ok' })), 'D23')).toBe('OK')
    // ⑬ no-package-json·미계산(undefined) → OK
    expect(lvl(runChecks(mk({ lockfileStatus: 'no-package-json' })), 'D23')).toBe('OK')
    expect(lvl(runChecks(mk({})), 'D23')).toBe('OK')
    // ⑪ missing → WARN. ⑫ untracked → WARN.
    const missing = runChecks(mk({ lockfileStatus: 'missing' }))
    expect(lvl(missing, 'D23')).toBe('WARN')
    expect(lvl(runChecks(mk({ lockfileStatus: 'untracked' })), 'D23')).toBe('WARN')
    // ⑭ 🔴 WARN 상한 — FAIL 승격 시 lockfile 없는 프로젝트의 모든 커밋이 벽돌이 된다.
    expect(missing.filter((c) => c.level === 'FAIL')).toEqual([])
    expect(missing.find((c) => c.id === 'D23')?.msg).toContain('lockfile')
  })

  it('D24(REQ-2026-062): setup 완료 게이트 — 마커=OK · grandfather/차단=WARN · 절대 FAIL 아님', () => {
    // 미계산(2-arg) → OK
    expect(lvl(runChecks(mk({})), 'D24')).toBe('OK')
    // 마커 있음 → OK
    expect(
      lvl(runChecks(mk({ setupGate: { kind: 'pass', reason: 'marker', evidence: ['마커=있음'] } })), 'D24'),
    ).toBe('OK')
    // grandfather 통과 → WARN(언젠가 setup을 하라는 안내)
    const gf = runChecks(mk({ setupGate: { kind: 'pass', reason: 'grandfathered', evidence: ['마커=없음'] } }))
    expect(lvl(gf, 'D24')).toBe('WARN')
    expect(gf.find((c) => c.id === 'D24')?.msg).toContain('commitgate setup')
    // 차단 판정 → WARN (차단 자체는 verb preflight의 몫)
    const blocked = runChecks(mk({ setupGate: { kind: 'block', message: 'x', evidence: ['마커=없음'] } }))
    expect(lvl(blocked, 'D24')).toBe('WARN')

    // 🔴 **WARN 상한**. FAIL로 승격되면 `req:commit`이 doctor를 하드 게이트로 spawn하므로
    //    마커 없는 기존 설치본의 **모든 커밋이 벽돌**이 된다(D19~D23과 같은 근거).
    for (const r of [gf, blocked]) expect(r.filter((c) => c.level === 'FAIL')).toEqual([])

    // 에이전트가 직접 실행하지 않도록 "요청"을 지시한다(setup은 대화형 전용).
    expect(blocked.find((c) => c.id === 'D24')?.msg).toContain('요청')
  })

  it('unprotectedRepoRootScratch: ignore되면 제외 · tracked면 제외 · 둘 다 아니면 보고', () => {
    const p = 'workflow/.review-calls.jsonl'
    const ok = (args: string[]): string => {
      if (args[0] === 'check-ignore') return '' // 종료 0 = ignore됨
      return ''
    }
    expect(unprotectedRepoRootScratch([p], ok)).toEqual([]) // ignore됨 → 제외

    const trackedOnly = (args: string[]): string => {
      if (args[0] === 'check-ignore') throw new Error('exit 1') // ignore 아님
      return `${p}\n` // ls-files 출력 있음 = tracked
    }
    expect(unprotectedRepoRootScratch([p], trackedOnly)).toEqual([]) // tracked → 제외(경고 대상 아님)

    const neither = (args: string[]): string => {
      if (args[0] === 'check-ignore') throw new Error('exit 1')
      return '' // ls-files 비어있음 = untracked
    }
    expect(unprotectedRepoRootScratch([p], neither)).toEqual([p]) // 둘 다 아님 → 보고

    // ls-files 조회 자체가 실패하면 보호됨으로 간주(fail-safe — 게이트를 막지 않는다).
    const lsFails = (args: string[]): string => {
      throw new Error(`fail: ${args[0]}`)
    }
    expect(unprotectedRepoRootScratch([p], lsFails)).toEqual([])
  })

  it('D2: state.branch != 현재 브랜치 → FAIL', () => {
    expect(lvl(runChecks(mk({ currentBranch: 'other' })), 'D2')).toBe('FAIL')
  })

  it('D3: state.branch 로컬에 없음 → FAIL', () => {
    expect(lvl(runChecks(mk({ branchExists: false })), 'D3')).toBe('FAIL')
  })

  /**
   * 🔴 REQ-2026-108: D5는 **WARN 상한**이다. 이 필드를 읽는 코드는 D5 자신뿐이고
   *    (REQ-2026-103이 마지막 소비 경로를 제거), `req:commit`이 doctor를 하드 게이트로 spawn하므로
   *    FAIL이면 codex가 thread id 형식을 바꾸는 날 전 소비자의 커밋이 동시에 막힌다.
   */
  it('D5: codex_thread_id 형식 오류 → WARN, 정상 UUID → OK', () => {
    expect(lvl(runChecks(mk({ state: { codex_thread_id: 'not-uuid' } })), 'D5')).toBe('WARN')
    expect(lvl(runChecks(mk({ state: { codex_thread_id: '019eeca1-2356-76c3-aa38-9af48842caea' } })), 'D5')).toBe('OK')
  })

  it('D5: 미설정(undefined) → OK (무회귀)', () =>
    expect(lvl(runChecks(mk({ state: {} })), 'D5')).toBe('OK'))

  /**
   * 🔴 이 REQ의 요구는 "WARN이다"가 아니라 **"커밋을 막지 않는다"**이다.
   *    `main()`의 exit 규칙이 `FAIL ≥ 1 → exit 1`이므로 FAIL 0건 = exit 0 = `req:commit` 통과다.
   */
  it('🔴 D5 형식 오류만으로는 FAIL이 0건이다 — 커밋이 막히지 않는다', () => {
    const checks = runChecks(mk({ state: { codex_thread_id: 'not-uuid' } }))
    expect(checks.filter((c) => c.level === 'FAIL')).toEqual([])
    expect(lvl(checks, 'D5')).toBe('WARN') // 보고는 계속한다(감사 기록에 남는 값이다)
  })

  it('D6: commit_allowed=true인데 응답 없음 → FAIL', () => {
    expect(lvl(runChecks(mk({ state: { commit_allowed: true } })), 'D6')).toBe('FAIL')
  })

  it('D6: commit_allowed=true + 승인 응답·base 일치·바인딩 정합 → OK', () => {
    const r = runChecks(
      mk({
        state: { commit_allowed: true, review_base_sha: 'BASE', review_diff_hash: 'TREE', approved_diff_hash: 'TREE' },
        stagedTree: 'TREE',
        responseVerdict: validVerdict,
        responseStructureOk: true,
      }),
    )
    expect(lvl(r, 'D6')).toBe('OK')
  })

  it('[Codex P1] D6: commit_allowed=true인데 응답이 비승인(NEEDS_FIX/no) → FAIL(승인 우회 차단)', () => {
    const r = runChecks(
      mk({
        state: { commit_allowed: true, review_base_sha: 'BASE', review_diff_hash: 'TREE', approved_diff_hash: 'TREE' },
        stagedTree: 'TREE',
        responseVerdict: {
          machine_schema_version: '1.1',
          review_base_sha: 'BASE',
          status: 'NEEDS_FIX',
          commit_approved: 'no',
          merge_ready: 'no',
          risk_level: 'HIGH',
          review_kind: 'phase',
          findings: [{ severity: 'P1', detail: '미승인', file: null }],
          next_action: '지적 반영 후 재리뷰',
        },
        responseStructureOk: true,
      }),
    )
    expect(lvl(r, 'D6')).toBe('FAIL')
  })

  it('[Codex P1] D6: commit_allowed=true인데 바인딩 필드(review_diff_hash) 누락 → FAIL', () => {
    const r = runChecks(
      mk({
        state: { commit_allowed: true, review_base_sha: 'BASE', approved_diff_hash: 'TREE' },
        stagedTree: 'TREE',
        responseVerdict: validVerdict,
        responseStructureOk: true,
      }),
    )
    expect(lvl(r, 'D6')).toBe('FAIL')
  })

  it('D9: commit_allowed=true인데 staged tree != approved → FAIL(stale)', () => {
    const r = runChecks(
      mk({
        state: { commit_allowed: true, review_base_sha: 'BASE', review_diff_hash: 'OTHER', approved_diff_hash: 'OTHER' },
        stagedTree: 'TREE',
        responseVerdict: validVerdict,
        responseStructureOk: true,
      }),
    )
    expect(lvl(r, 'D9')).toBe('FAIL')
  })

  it('D10: unstaged/untracked(비-스크래치) → FAIL, 스크래치만 → OK', () => {
    expect(lvl(runChecks(mk({ statusEntries: E(' M src/x.ts') })), 'D10')).toBe('FAIL')
    expect(lvl(runChecks(mk({ statusEntries: E('?? workflow/REQ-2026-001/codex-response.json') })), 'D10')).toBe('OK')
  })

  it('[4C e2e] D10: review-codex 후 unstaged state.json은 scratch라 OK', () => {
    expect(lvl(runChecks(mk({ statusEntries: E(' M workflow/REQ-2026-001/state.json') })), 'D10')).toBe('OK')
  })

  it('D11: phase≠DONE인데 main 브랜치 → FAIL', () => {
    expect(lvl(runChecks(mk({ currentBranch: 'main', state: { branch: 'main' } })), 'D11')).toBe('FAIL')
  })

  // 🔴 REQ-2026-085 DEC-5b: **정답이 뒤집힌 테스트다.** 예전에는 `phase: 'DONE'`이면 브랜치 무관 OK였다.
  //    그런데 런타임은 `state.phase`에 `'DONE'`을 어디서도 쓰지 않는다 — 즉 그 통과는 도달 가능한 기능이 아니라
  //    **워킹 state.json을 손으로 고치면 열리는 우회로**였다(runChecks는 워킹 state를 읽는다).
  //    이제 조건이 없어져 위조해도 막힌다. 정상 경로 판정은 바뀌지 않았다(늘 참이던 조건을 뺐을 뿐).
  it('[REQ-085 DEC-5b] D11: state.phase를 "DONE"으로 위조해도 main이면 FAIL — 죽은 필드로 게이트가 열리지 않는다', () => {
    expect(lvl(runChecks(mk({ currentBranch: 'main', state: { branch: 'main', phase: 'DONE' } })), 'D11')).toBe('FAIL')
    // feature 브랜치 밖(prefix 불일치)도 마찬가지.
    expect(lvl(runChecks(mk({ currentBranch: 'wip/x', state: { branch: 'wip/x', phase: 'DONE' } })), 'D11')).toBe('FAIL')
  })

  it('[REQ-085 DEC-5.4] D11: state.phase가 아예 없어도 정상 feature 브랜치는 OK(신규 스캐폴드 형태)', () => {
    const { phase: _omit, ...noPhase } = { phase: 'INTAKE', branch: 'feat/req-2026-001-x' }
    expect(lvl(runChecks(mk({ currentBranch: 'feat/req-2026-001-x', state: noPhase })), 'D11')).toBe('OK')
  })

  it('[P2] D11: config branchPrefix override(feature/REQ-) → 일치 브랜치 OK', () => {
    expect(
      lvl(
        runChecks(mk({ branchPrefix: 'feature/REQ-', currentBranch: 'feature/REQ-2026-001-x', state: { branch: 'feature/REQ-2026-001-x' } })),
        'D11',
      ),
    ).toBe('OK')
  })
  it('[P2] D11: custom branchPrefix면 기존 feat/req- 브랜치는 FAIL(prefix 실제 적용)', () => {
    expect(
      lvl(
        runChecks(mk({ branchPrefix: 'feature/REQ-', currentBranch: 'feat/req-2026-001-x', state: { branch: 'feat/req-2026-001-x' } })),
        'D11',
      ),
    ).toBe('FAIL')
  })
})

describe('req:doctor — D13 (design 선행 + freshness, exact path 분류)', () => {
  it('유효 design 승인 없음 + src 코드 변경(staged) → FAIL', () => {
    expect(lvl(runChecks(mk({ statusEntries: E('M  src/foo.ts') })), 'D13')).toBe('FAIL')
  })
  it('유효 design 승인 없음 + src 코드 변경(unstaged) → FAIL', () => {
    expect(lvl(runChecks(mk({ statusEntries: E(' M src/foo.ts') })), 'D13')).toBe('FAIL')
  })
  it('유효 design 승인 없음 + src 코드(untracked) → FAIL', () => {
    expect(lvl(runChecks(mk({ statusEntries: E('?? src/new.ts') })), 'D13')).toBe('FAIL')
  })
  it('유효 design 승인 없음 + 현재 티켓 문서만(01-design.md) → OK', () => {
    expect(lvl(runChecks(mk({ statusEntries: E(' M workflow/REQ-2026-001/01-design.md') })), 'D13')).toBe('OK')
  })
  it('유효 design 승인 없음 + scratch만(codex-response/state) → OK', () => {
    expect(
      lvl(
        runChecks(
          mk({
            statusEntries: E(
              '?? workflow/REQ-2026-001/codex-response.json',
              ' M workflow/REQ-2026-001/state.json',
            ),
          }),
        ),
        'D13',
      ),
    ).toBe('OK')
  })
  it('변경 없음(statusLines []) → OK', () => {
    expect(lvl(runChecks(mk({})), 'D13')).toBe('OK')
  })
  it('유효 design 승인(hash 일치) + src 코드 변경 → OK(코드 허용)', () => {
    expect(
      lvl(
        runChecks(mk({ statusEntries: E('M  src/foo.ts'), designApproved: true, designApprovedHash: 'H', currentDesignHash: 'H' })),
        'D13',
      ),
    ).toBe('OK')
  })
  it('design_approved=true지만 hash 불일치(승인 후 설계 변경=stale) + 코드 → FAIL', () => {
    expect(
      lvl(
        runChecks(mk({ statusEntries: E('M  src/foo.ts'), designApproved: true, designApprovedHash: 'OLD', currentDesignHash: 'NEW' })),
        'D13',
      ),
    ).toBe('FAIL')
  })
  it('design_approved=true지만 currentDesignHash=null(문서 미추적) + 코드 → FAIL(승인 무효)', () => {
    expect(
      lvl(
        runChecks(mk({ statusEntries: E('M  src/foo.ts'), designApproved: true, designApprovedHash: 'H', currentDesignHash: null })),
        'D13',
      ),
    ).toBe('FAIL')
  })
  it('[exact match] 다른 REQ 문서는 현재 티켓 docs 아님 → 코드 취급 FAIL', () => {
    expect(lvl(runChecks(mk({ statusEntries: E(' M workflow/REQ-2026-002/01-design.md') })), 'D13')).toBe('FAIL')
  })
  it('[exact match] .bak 변형은 티켓 doc 아님 → FAIL(substring 오인 방지)', () => {
    expect(lvl(runChecks(mk({ statusEntries: E(' M workflow/REQ-2026-001/01-design.md.bak') })), 'D13')).toBe('FAIL')
  })
  it('[exact match] .tmp 변형은 티켓 doc 아님 → FAIL', () => {
    expect(lvl(runChecks(mk({ statusEntries: E('?? workflow/REQ-2026-001/01-design.md.tmp') })), 'D13')).toBe('FAIL')
  })
  it('[exact match] 확장자 변형(.mdx)은 티켓 doc 아님 → FAIL', () => {
    expect(lvl(runChecks(mk({ statusEntries: E(' M workflow/REQ-2026-001/01-design.mdx') })), 'D13')).toBe('FAIL')
  })
  it('[exact match] 티켓 doc 경로를 prefix로 갖는 유사 파일(.orig) → FAIL', () => {
    expect(lvl(runChecks(mk({ statusEntries: E(' M workflow/REQ-2026-001/codex-request.md.orig') })), 'D13')).toBe('FAIL')
  })
  it('[Codex P2] rename 우회 차단: src 코드 → 허용 티켓 doc로 rename → FAIL(원본도 검사)', () => {
    expect(
      lvl(runChecks(mk({ statusEntries: E('R  src/foo.ts -> workflow/REQ-2026-001/01-design.md') })), 'D13'),
    ).toBe('FAIL')
  })
  it('[Codex P2] rename 우회 차단: 티켓 doc → src 코드로 rename → FAIL(목적지도 검사)', () => {
    expect(
      lvl(runChecks(mk({ statusEntries: E('R  workflow/REQ-2026-001/01-design.md -> src/foo.ts') })), 'D13'),
    ).toBe('FAIL')
  })
})

describe('req:doctor — D15 (NEEDS_FIX actionable)', () => {
  const needsFix = (over: Partial<Verdict>): Verdict => ({
    machine_schema_version: '1.1',
    review_base_sha: 'BASE',
    status: 'NEEDS_FIX',
    commit_approved: 'no',
    merge_ready: 'no',
    risk_level: 'HIGH',
    review_kind: 'phase',
    findings: [{ severity: 'P1', detail: 'x', file: null }],
    next_action: '고쳐라',
    ...over,
  })
  it('NEEDS_FIX + findings 있음 + next_action 있음 → OK', () => {
    expect(lvl(runChecks(mk({ responseVerdict: needsFix({}) })), 'D15')).toBe('OK')
  })
  it('NEEDS_FIX + findings=[] → FAIL', () => {
    expect(lvl(runChecks(mk({ responseVerdict: needsFix({ findings: [] }) })), 'D15')).toBe('FAIL')
  })
  it('NEEDS_FIX + next_action 공백 → FAIL', () => {
    expect(lvl(runChecks(mk({ responseVerdict: needsFix({ next_action: '   ' }) })), 'D15')).toBe('FAIL')
  })
  it('NEEDS_FIX + next_action 비-문자열(파손) → throw 없이 FAIL', () => {
    expect(lvl(runChecks(mk({ responseVerdict: needsFix({ next_action: 1 as unknown as string }) })), 'D15')).toBe('FAIL')
  })
  it('STEP_COMPLETE 응답 → D15 점검 불요 OK', () => {
    expect(lvl(runChecks(mk({ responseVerdict: needsFix({ status: 'STEP_COMPLETE' }) })), 'D15')).toBe('OK')
  })
  it('응답 없음(null) → OK', () => {
    expect(lvl(runChecks(mk({ responseVerdict: null })), 'D15')).toBe('OK')
  })
})

// statusPaths 테스트는 삭제(REQ-2026-012 — 함수가 lib/porcelain의 entryPaths로 대체됨).
// entryPaths·parseStatusZ의 경로 추출·rename src/dest·백슬래시 보존은 porcelain.test.ts가 검증한다.
// (옛 '백슬래시 정규화' 테스트는 버그였다 — `-z`는 역슬래시를 파일명의 일부로 보존한다.)

// ─────────────────────────────── [A2] D16/D17 승인 증거 아카이브 정본 검증 ──
type MkArg = Parameters<typeof mk>[0]
describe('[A2] D16 — phase 승인 증거 아카이브 정본 검증', () => {
  const phaseEv = {
    response_path: 'workflow/REQ-2026-001/responses/phase-A1-evidence-mechanism-r02-approved.json',
    response_sha256: 'SHA', review_kind: 'phase', phase_id: 'phase-A1-evidence-mechanism',
    review_base_sha: 'BASE', approved_tree: 'TREE', codex_thread_id: 'TID',
    machine_schema_version: '1.1', status: 'COMPLETE', commit_approved: 'yes', approved_at: 'AT',
  }
  const phaseArchiveOk = {
    exists: true, sha256: 'SHA', structureOk: true,
    verdict: { ...validVerdict, status: 'COMPLETE', commit_approved: 'yes', review_kind: 'phase', review_base_sha: 'BASE' },
  }
  const pState = { commit_allowed: true, approved_diff_hash: 'TREE', review_base_sha: 'BASE', review_diff_hash: 'TREE' }

  it('신규 REQ + 유효 evidence/archive → D16 OK', () => {
    const c = runChecks(mk({ state: { ...pState, approval_evidence_required: true }, approvalEvidenceRequired: true, approvalEvidence: phaseEv, approvalArchive: phaseArchiveOk } as MkArg))
    expect(lvl(c, 'D16')).toBe('OK')
  })
  it('신규 REQ + commit_allowed인데 evidence 없음 → D16 FAIL', () => {
    const c = runChecks(mk({ state: { ...pState, approval_evidence_required: true }, approvalEvidenceRequired: true, approvalEvidence: null, approvalArchive: null } as MkArg))
    expect(lvl(c, 'D16')).toBe('FAIL')
  })
  it('아카이브 SHA 불일치 → D16 FAIL', () => {
    const c = runChecks(mk({ state: { ...pState, approval_evidence_required: true }, approvalEvidenceRequired: true, approvalEvidence: phaseEv, approvalArchive: { ...phaseArchiveOk, sha256: 'OTHER' } } as MkArg))
    expect(lvl(c, 'D16')).toBe('FAIL')
  })
  it('아카이브 review_kind=design(잘못된 kind) → D16 FAIL', () => {
    const c = runChecks(mk({ state: { ...pState, approval_evidence_required: true }, approvalEvidenceRequired: true, approvalEvidence: phaseEv, approvalArchive: { ...phaseArchiveOk, verdict: { ...phaseArchiveOk.verdict, review_kind: 'design' } } } as MkArg))
    expect(lvl(c, 'D16')).toBe('FAIL')
  })
  it('approved_tree != state.approved_diff_hash → D16 FAIL', () => {
    const c = runChecks(mk({ state: { ...pState, approval_evidence_required: true, approved_diff_hash: 'DIFFERENT' }, approvalEvidenceRequired: true, approvalEvidence: phaseEv, approvalArchive: phaseArchiveOk } as MkArg))
    expect(lvl(c, 'D16')).toBe('FAIL')
  })
  it('legacy(미요구) + evidence 없음 → D16 OK(FAIL 아님)', () => {
    const c = runChecks(mk({ state: { ...pState }, approvalEvidenceRequired: false, approvalEvidence: null, approvalArchive: null } as MkArg))
    expect(lvl(c, 'D16')).toBe('OK')
  })
  it('legacy + evidence 있는데 SHA 불일치 → D16 WARN(FAIL 아님)', () => {
    const c = runChecks(mk({ state: { ...pState }, approvalEvidenceRequired: false, approvalEvidence: phaseEv, approvalArchive: { ...phaseArchiveOk, sha256: 'OTHER' } } as MkArg))
    expect(lvl(c, 'D16')).toBe('WARN')
  })
  it('commit_allowed=false → D16 OK(점검 불요)', () => {
    const c = runChecks(mk({ state: { commit_allowed: false, approval_evidence_required: true }, approvalEvidenceRequired: true, approvalEvidence: null } as MkArg))
    expect(lvl(c, 'D16')).toBe('OK')
  })
})

describe('[A2] D17 — design 승인 증거 아카이브 정본 검증', () => {
  const designEv = {
    response_path: 'workflow/REQ-2026-001/responses/design-r02-approved.json',
    response_sha256: 'DSHA', review_kind: 'design', phase_id: null, review_base_sha: 'BASE',
    design_hash: 'DHASH', codex_thread_id: 'TID', machine_schema_version: '1.1',
    status: 'COMPLETE', commit_approved: 'yes', approved_at: 'AT',
  }
  const designArchiveOk = {
    exists: true, sha256: 'DSHA', structureOk: true,
    verdict: { ...validVerdict, status: 'COMPLETE', commit_approved: 'yes', review_kind: 'design', review_base_sha: 'BASE' },
  }
  it('신규 REQ + design 승인 + 유효 design evidence → D17 OK', () => {
    const c = runChecks(mk({ state: { design_approved: true, design_approved_hash: 'DHASH', approval_evidence_required: true }, approvalEvidenceRequired: true, designApprovalEvidence: designEv, designArchive: designArchiveOk, designApproved: true, designApprovedHash: 'DHASH', currentDesignHash: 'DHASH' } as MkArg))
    expect(lvl(c, 'D17')).toBe('OK')
  })
  it('신규 REQ + design 승인인데 design evidence 없음 → D17 FAIL', () => {
    const c = runChecks(mk({ state: { design_approved: true, design_approved_hash: 'DHASH', approval_evidence_required: true }, approvalEvidenceRequired: true, designApprovalEvidence: null, designArchive: null, designApproved: true, designApprovedHash: 'DHASH', currentDesignHash: 'DHASH' } as MkArg))
    expect(lvl(c, 'D17')).toBe('FAIL')
  })
  it('design_hash != state.design_approved_hash → D17 FAIL', () => {
    const c = runChecks(mk({ state: { design_approved: true, design_approved_hash: 'OTHER', approval_evidence_required: true }, approvalEvidenceRequired: true, designApprovalEvidence: designEv, designArchive: designArchiveOk, designApproved: true, designApprovedHash: 'OTHER', currentDesignHash: 'OTHER' } as MkArg))
    expect(lvl(c, 'D17')).toBe('FAIL')
  })
  it('legacy(미요구) + design evidence 없음 → D17 OK', () => {
    const c = runChecks(mk({ state: { design_approved: true, design_approved_hash: 'DHASH' }, approvalEvidenceRequired: false, designApprovalEvidence: null, designApproved: true, designApprovedHash: 'DHASH', currentDesignHash: 'DHASH' } as MkArg))
    expect(lvl(c, 'D17')).toBe('OK')
  })
})

describe('[A2] D10 — responses/ 스크래치 live(ticketRel)', () => {
  it('현재 티켓 untracked 아카이브 → D10 OK', () => {
    const c = runChecks(mk({ statusEntries: E('?? workflow/REQ-2026-001/responses/phase-A1-evidence-mechanism-r01-approved.json'), ticketRel: 'workflow/REQ-2026-001' } as MkArg))
    expect(lvl(c, 'D10')).toBe('OK')
  })
  it('커밋된 evidence 수정(tracked) → D10 FAIL', () => {
    const c = runChecks(mk({ statusEntries: E(' M workflow/REQ-2026-001/responses/design-r01-approved.json'), ticketRel: 'workflow/REQ-2026-001' } as MkArg))
    expect(lvl(c, 'D10')).toBe('FAIL')
  })
  it('approvals.jsonl untracked → D10 FAIL(스크래치 아님)', () => {
    const c = runChecks(mk({ statusEntries: E('?? workflow/REQ-2026-001/responses/approvals.jsonl'), ticketRel: 'workflow/REQ-2026-001' } as MkArg))
    expect(lvl(c, 'D10')).toBe('FAIL')
  })
})

describe('[A2-fix] D16/D17 — base-sha 정합 + 경로 confinement', () => {
  const T = 'workflow/REQ-2026-001'
  const pEv = { response_path: `${T}/responses/phase-A1-evidence-mechanism-r02-approved.json`, response_sha256: 'SHA', review_kind: 'phase', phase_id: 'phase-A1-evidence-mechanism', review_base_sha: 'BASE', approved_tree: 'TREE', codex_thread_id: 'TID', machine_schema_version: '1.1', status: 'COMPLETE', commit_approved: 'yes', approved_at: 'AT' }
  const pArch = { exists: true, sha256: 'SHA', structureOk: true, verdict: { ...validVerdict, status: 'COMPLETE', commit_approved: 'yes', review_kind: 'phase', review_base_sha: 'BASE' } }
  const pState = { commit_allowed: true, approved_diff_hash: 'TREE', review_base_sha: 'BASE', review_diff_hash: 'TREE', approval_evidence_required: true }
  const dEv = { response_path: `${T}/responses/design-r02-approved.json`, response_sha256: 'DSHA', review_kind: 'design', phase_id: null, review_base_sha: 'DESIGN_BASE', design_hash: 'DHASH', codex_thread_id: 'TID', machine_schema_version: '1.1', status: 'COMPLETE', commit_approved: 'yes', approved_at: 'AT' }
  const dArch = { exists: true, sha256: 'DSHA', structureOk: true, verdict: { ...validVerdict, status: 'COMPLETE', commit_approved: 'yes', review_kind: 'design', review_base_sha: 'DESIGN_BASE' } }

  it('[fix1] phase로 state.review_base_sha가 바뀌어도 design evidence는 자기 base로 검증 → D17 OK', () => {
    const c = runChecks(mk({ state: { design_approved: true, design_approved_hash: 'DHASH', approval_evidence_required: true, review_base_sha: 'PHASE_BASE_NEW' }, ticketRel: T, approvalEvidenceRequired: true, designApprovalEvidence: dEv, designArchive: dArch, designApproved: true, designApprovedHash: 'DHASH', currentDesignHash: 'DHASH' } as MkArg))
    expect(lvl(c, 'D17')).toBe('OK')
  })
  it('[fix2] phase evidence response_path 다른 티켓 → D16 FAIL', () => {
    const c = runChecks(mk({ state: pState, ticketRel: T, approvalEvidenceRequired: true, approvalEvidence: { ...pEv, response_path: 'workflow/REQ-2026-999/responses/phase-A1-evidence-mechanism-r02-approved.json' }, approvalArchive: pArch } as MkArg))
    expect(lvl(c, 'D16')).toBe('FAIL')
  })
  it('[fix2] nested path → D16 FAIL', () => {
    const c = runChecks(mk({ state: pState, ticketRel: T, approvalEvidenceRequired: true, approvalEvidence: { ...pEv, response_path: `${T}/responses/sub/phase-A1-evidence-mechanism-r02-approved.json` }, approvalArchive: pArch } as MkArg))
    expect(lvl(c, 'D16')).toBe('FAIL')
  })
  it('[fix2] design evidence response_path 다른 티켓 → D17 FAIL', () => {
    const c = runChecks(mk({ state: { design_approved: true, design_approved_hash: 'DHASH', approval_evidence_required: true }, ticketRel: T, approvalEvidenceRequired: true, designApprovalEvidence: { ...dEv, response_path: 'workflow/REQ-2026-999/responses/design-r02-approved.json' }, designArchive: dArch, designApproved: true, designApprovedHash: 'DHASH', currentDesignHash: 'DHASH' } as MkArg))
    expect(lvl(c, 'D17')).toBe('FAIL')
  })
  it('[fix2] 정상 current ticket 직계 → D16 OK', () => {
    const c = runChecks(mk({ state: pState, ticketRel: T, approvalEvidenceRequired: true, approvalEvidence: pEv, approvalArchive: pArch } as MkArg))
    expect(lvl(c, 'D16')).toBe('OK')
  })
})

describe('[A2-R2-fix] D13 — untracked 응답 아카이브 코드변경 오분류 차단', () => {
  const T = 'workflow/REQ-2026-001'
  const noDesign = { state: { design_approved: false }, designApproved: false, designApprovedHash: null, currentDesignHash: null, ticketRel: T }
  it('design 미승인 + untracked needs-fix 아카이브만 → D13 FAIL 아님(아카이브는 코드변경 아님)', () => {
    const c = runChecks(mk({ ...noDesign, statusEntries: E(`?? ${T}/responses/design-r01-needs-fix.json`) } as MkArg))
    expect(lvl(c, 'D13')).not.toBe('FAIL')
  })
  it('회귀: approvals.jsonl untracked는 D13에서 숨기지 않음(미승인→FAIL)', () => {
    const c = runChecks(mk({ ...noDesign, statusEntries: E(`?? ${T}/responses/approvals.jsonl`) } as MkArg))
    expect(lvl(c, 'D13')).toBe('FAIL')
  })
  it('회귀: tracked evidence 수정은 D13에서 숨기지 않음(미승인→FAIL)', () => {
    const c = runChecks(mk({ ...noDesign, statusEntries: E(` M ${T}/responses/design-r01-approved.json`) } as MkArg))
    expect(lvl(c, 'D13')).toBe('FAIL')
  })
  it('회귀: 타 티켓 아카이브는 D13에서 숨기지 않음(미승인→FAIL)', () => {
    const c = runChecks(mk({ ...noDesign, statusEntries: E('?? workflow/REQ-2026-999/responses/design-r01-needs-fix.json') } as MkArg))
    expect(lvl(c, 'D13')).toBe('FAIL')
  })
  it('회귀: collapsed responses/ 디렉터리는 D13에서 숨기지 않음(미승인→FAIL)', () => {
    const c = runChecks(mk({ ...noDesign, statusEntries: E(`?? ${T}/responses/`) } as MkArg))
    expect(lvl(c, 'D13')).toBe('FAIL')
  })
})

describe('[A2-R3-fix] D16 — live codex-response.json SHA 일치(phase 전용)', () => {
  const T = 'workflow/REQ-2026-001'
  const pEv = { response_path: `${T}/responses/phase-A1-evidence-mechanism-r02-approved.json`, response_sha256: 'SHA', review_kind: 'phase', phase_id: 'phase-A1-evidence-mechanism', review_base_sha: 'BASE', approved_tree: 'TREE', codex_thread_id: 'TID', machine_schema_version: '1.1', status: 'COMPLETE', commit_approved: 'yes', approved_at: 'AT' }
  const pArch = { exists: true, sha256: 'SHA', structureOk: true, verdict: { ...validVerdict, status: 'COMPLETE', commit_approved: 'yes', review_kind: 'phase', review_base_sha: 'BASE' } }
  const pState = { commit_allowed: true, approved_diff_hash: 'TREE', review_base_sha: 'BASE', review_diff_hash: 'TREE', approval_evidence_required: true }
  const reqd = { state: pState, ticketRel: T, approvalEvidenceRequired: true, approvalEvidence: pEv, approvalArchive: pArch }

  it('live SHA == evidence SHA → D16 OK', () => {
    expect(lvl(runChecks(mk({ ...reqd, liveResponseSha256: 'SHA' } as MkArg)), 'D16')).toBe('OK')
  })
  it('live SHA != evidence SHA (신규) → D16 FAIL', () => {
    expect(lvl(runChecks(mk({ ...reqd, liveResponseSha256: 'OTHER' } as MkArg)), 'D16')).toBe('FAIL')
  })
  it('live SHA != evidence SHA (legacy) → D16 WARN', () => {
    const c = runChecks(mk({ state: { ...pState, approval_evidence_required: false }, ticketRel: T, approvalEvidenceRequired: false, approvalEvidence: pEv, approvalArchive: pArch, liveResponseSha256: 'OTHER' } as MkArg))
    expect(lvl(c, 'D16')).toBe('WARN')
  })
  it('live response 없음(null) → live 검사 skip(나머지 정상 → OK)', () => {
    expect(lvl(runChecks(mk({ ...reqd, liveResponseSha256: null } as MkArg)), 'D16')).toBe('OK')
  })
})

describe('[A2-R3-fix] D17 — design은 live SHA 비교 안 함', () => {
  const T = 'workflow/REQ-2026-001'
  const dEv = { response_path: `${T}/responses/design-r02-approved.json`, response_sha256: 'DSHA', review_kind: 'design', phase_id: null, review_base_sha: 'DESIGN_BASE', design_hash: 'DHASH', codex_thread_id: 'TID', machine_schema_version: '1.1', status: 'COMPLETE', commit_approved: 'yes', approved_at: 'AT' }
  const dArch = { exists: true, sha256: 'DSHA', structureOk: true, verdict: { ...validVerdict, status: 'COMPLETE', commit_approved: 'yes', review_kind: 'design', review_base_sha: 'DESIGN_BASE' } }
  it('live SHA가 design evidence SHA와 달라도 archive/design_hash 정상이면 D17 OK', () => {
    const c = runChecks(mk({ state: { design_approved: true, design_approved_hash: 'DHASH', approval_evidence_required: true }, ticketRel: T, approvalEvidenceRequired: true, designApprovalEvidence: dEv, designArchive: dArch, designApproved: true, designApprovedHash: 'DHASH', currentDesignHash: 'DHASH', liveResponseSha256: 'PHASE_RESPONSE_SHA' } as MkArg))
    expect(lvl(c, 'D17')).toBe('OK')
  })
})

// ─────────────────────────────── [C] D18 granularity 정책(advisory WARN) ──
describe('[C] phaseGranularityWarnings — phase 분할 권고(순수)', () => {
  it('임계 이하 → []', () => expect(phaseGranularityWarnings(['a.ts', 'b.ts'], 8)).toEqual([]))
  it('정확히 임계 → []', () => expect(phaseGranularityWarnings(Array.from({ length: 8 }, (_, i) => `f${i}.ts`), 8)).toEqual([]))
  it('임계 초과 → WARN 메시지', () =>
    expect(phaseGranularityWarnings(Array.from({ length: 9 }, (_, i) => `f${i}.ts`), 8).length).toBeGreaterThan(0))

  /**
   * 🔴 REQ-2026-107: 선언(`phases[].max_files`)이 있으면 그것이 임계다 — 리뷰 preflight와 같은 판정.
   *    이전에는 이 함수가 선언을 **인자로 받지도 않아**, 선언으로 리뷰를 정당하게 통과한 phase에도
   *    "8파일 초과"를 냈다(소비자 5개 티켓에서 실발화).
   */
  const files = (n: number): string[] => Array.from({ length: n }, (_, i) => `f${i}.ts`)
  it('🔴 선언 상한 20 + 10파일 → [] (오탐 없음)', () =>
    expect(phaseGranularityWarnings(files(10), 8, 'warn', 20)).toEqual([]))
  it('선언 없음 + 10파일 → WARN (기존 동작 보존)', () =>
    expect(phaseGranularityWarnings(files(10), 8, 'warn', null).length).toBe(1))
  it('선언 상한 5 + 10파일 → WARN이고 문구가 **선언한 상한 5**를 가리킨다(DEC-4)', () => {
    const [msg] = phaseGranularityWarnings(files(10), 8, 'warn', 5)
    expect(msg).toContain('선언한 상한 5')
    expect(msg).not.toContain('권고 8') // config 임계를 잘못 인용하지 않는다
  })
  it('선언 없을 때 문구는 **권고**로 표기한다', () =>
    expect(phaseGranularityWarnings(files(10), 8, 'warn', null)[0]).toContain('권고 8'))
})

describe('[C] D18 — granularity advisory(절대 FAIL 아님)', () => {
  // validDesign(D13 OK) 상태에서 코드 변경 파일이 임계 초과면 D18=WARN, FAIL 아님.
  const manyStaged = Array.from({ length: 12 }, (_, i) => `M  src/file${i}.ts`)
  const validDesignOver = { designApproved: true, designApprovedHash: 'H', currentDesignHash: 'H', statusEntries: E(...manyStaged) }
  it('코드 변경 많음 → D18 WARN', () => expect(lvl(runChecks(mk(validDesignOver)), 'D18')).toBe('WARN'))
  it('D18은 FAIL을 만들지 않음', () =>
    expect(runChecks(mk(validDesignOver)).filter((c) => c.id === 'D18' && c.level === 'FAIL')).toEqual([]))
  it('코드 변경 적음 → D18 OK', () =>
    expect(lvl(runChecks(mk({ designApproved: true, designApprovedHash: 'H', currentDesignHash: 'H', statusEntries: E('M  src/a.ts') })), 'D18')).toBe('OK'))

  /** 🔴 REQ-2026-107: runChecks 배선 — 선언이 D18까지 실제로 전달되는지(순수 함수 단위만으로는 배선을 못 잡는다). */
  it('🔴 declaredMaxFiles=20 + 12파일 staged → D18 OK (리뷰 게이트가 통과시킨 phase를 경고하지 않는다)', () =>
    expect(lvl(runChecks(mk({ ...validDesignOver, declaredMaxFiles: 20 })), 'D18')).toBe('OK'))
  it('declaredMaxFiles 미지정(undefined) → 기존대로 WARN (무회귀)', () =>
    expect(lvl(runChecks(mk(validDesignOver)), 'D18')).toBe('WARN'))
  it('🔴 D18이 세는 것은 stagedCodeFiles다 — 주어지면 codeChanges 대신 그것을 쓴다', () =>
    expect(lvl(runChecks(mk({ ...validDesignOver, stagedCodeFiles: ['src/only.ts'] })), 'D18')).toBe('OK'))

  it('[P2] config granularityMaxFiles=2 → 3파일이면 WARN(임계 주입)', () => {
    const three = ['M  src/a.ts', 'M  src/b.ts', 'M  src/c.ts']
    expect(
      lvl(runChecks(mk({ designApproved: true, designApprovedHash: 'H', currentDesignHash: 'H', statusEntries: E(...three), granularityMaxFiles: 2 })), 'D18'),
    ).toBe('WARN')
  })
  it('[P2] config granularityMaxFiles=50 → 12파일이어도 OK(임계 상향)', () => {
    expect(lvl(runChecks(mk({ ...validDesignOver, granularityMaxFiles: 50 })), 'D18')).toBe('OK')
  })
})

// ─────────────────────── D19: 설치 모드 진단(REQ-2026-014, 형태 기준·WARN 상한) ──

const STAGE_A: Record<string, string> = {
  'req:new': 'tsx scripts/req/req-new.ts',
  'req:next': 'tsx scripts/req/req-next.ts',
  'req:review-codex': 'tsx scripts/req/review-codex.ts',
  'req:doctor': 'tsx scripts/req/req-doctor.ts',
  'req:commit': 'tsx scripts/req/req-commit.ts',
}
const STAGE_B: Record<string, string> = {
  'req:new': 'commitgate req:new',
  'req:next': 'commitgate req:next',
  'req:review-codex': 'commitgate req:review-codex',
  'req:doctor': 'commitgate req:doctor',
  'req:commit': 'commitgate req:commit',
}

describe('[REQ-2026-014] classifyInstallMode — req:* 값의 형태만으로 판정(순수)', () => {
  it('전부 Stage A 형태 → stage-a', () => expect(classifyInstallMode(STAGE_A)).toBe('stage-a'))
  it('전부 Stage B 형태 → stage-b', () => expect(classifyInstallMode(STAGE_B)).toBe('stage-b'))
  it('섞이면 mixed', () => expect(classifyInstallMode({ ...STAGE_A, 'req:next': 'commitgate req:next' })).toBe('mixed'))
  it('req:* 키가 없으면 none', () => expect(classifyInstallMode({})).toBe('none'))
  it('무관한 스크립트만 있어도 none', () => expect(classifyInstallMode({ build: 'tsc', test: 'vitest' })).toBe('none'))
  it('전부 사용자 정의 값이면 custom', () =>
    expect(classifyInstallMode({ 'req:new': 'node mine.mjs', 'req:doctor': 'echo hi' })).toBe('custom'))
  it('일부만 kit 형태이고 나머지가 사용자 값이면 custom(Stage A/B가 공존해야 mixed)', () =>
    expect(classifyInstallMode({ 'req:new': 'tsx scripts/req/req-new.ts', 'req:doctor': 'echo hi' })).toBe('custom'))
  it('부분 집합이어도 전부 같은 형태면 그 형태로 판정', () => {
    expect(classifyInstallMode({ 'req:new': 'tsx scripts/req/req-new.ts' })).toBe('stage-a')
    expect(classifyInstallMode({ 'req:commit': 'commitgate req:commit' })).toBe('stage-b')
  })
  it('형태만 본다 — 파일명이 달라도 Stage A 형태(바이트 정확 일치 요구는 migrate 쪽 계약)', () =>
    expect(classifyInstallMode({ 'req:new': 'tsx scripts/req/whatever.ts' })).toBe('stage-a'))
})

describe('[REQ-2026-014] D19 — 설치 모드 진단(절대 FAIL 아님)', () => {
  /**
   * 🔴 이 검사가 FAIL을 내면 **이 저장소 자신의 req:commit이 영구 차단**된다.
   * CommitGate의 package.json 은 Stage A 형태이고(개발 repo가 자기 스크립트를 직접 실행), req:commit 이
   * req:doctor 를 exit≠0에 throw 하는 하드 게이트로 spawn 하기 때문이다. Stage A 는 지원되는 설치 형태다.
   */
  it('Stage A → OK (결함이 아니라 지원되는 설치 형태)', () =>
    expect(lvl(runChecks(mk({ reqScripts: STAGE_A })), 'D19')).toBe('OK'))
  it('Stage B → OK', () => expect(lvl(runChecks(mk({ reqScripts: STAGE_B })), 'D19')).toBe('OK'))
  it('mixed → WARN + migrate 안내', () => {
    const checks = runChecks(mk({ reqScripts: { ...STAGE_A, 'req:next': 'commitgate req:next' } }))
    expect(lvl(checks, 'D19')).toBe('WARN')
    expect(checks.find((c) => c.id === 'D19')?.msg).toContain('commitgate migrate')
  })
  it('none/custom → OK', () => {
    expect(lvl(runChecks(mk({ reqScripts: {} })), 'D19')).toBe('OK')
    expect(lvl(runChecks(mk({ reqScripts: { 'req:new': 'node mine.mjs' } })), 'D19')).toBe('OK')
  })

  it('어떤 입력에도 FAIL을 만들지 않는다(WARN 상한)', () => {
    const inputs: Array<Record<string, string> | null | undefined> = [
      STAGE_A,
      STAGE_B,
      { ...STAGE_A, 'req:next': 'commitgate req:next' },
      {},
      null,
      undefined,
    ]
    for (const reqScripts of inputs)
      expect(runChecks(mk({ reqScripts })).filter((c) => c.id === 'D19' && c.level === 'FAIL')).toEqual([])
  })

  it('reqScripts 미지정(legacy 2-arg 호출) → OK 점검 불요 — 기존 호출부를 깨지 않는다', () => {
    expect(lvl(runChecks(base), 'D19')).toBe('OK')
    expect(runChecks(base).find((c) => c.id === 'D19')?.msg).toContain('점검 불요')
  })

  it('package.json 없음/파손(null) → OK 점검 불요(무관한 이유로 커밋 게이트를 죽이지 않는다)', () =>
    expect(lvl(runChecks(mk({ reqScripts: null })), 'D19')).toBe('OK'))

  it('모든 경로에서 정확히 1개 Check를 push한다(비해당도 OK를 낸다)', () => {
    const inputs: Array<Record<string, string> | null | undefined> = [STAGE_A, STAGE_B, {}, null, undefined]
    for (const reqScripts of inputs) expect(runChecks(mk({ reqScripts })).filter((c) => c.id === 'D19')).toHaveLength(1)
  })
})

// ─────────────────────────────── [P2] CLI 파싱(parseArgs) — --root 계약 ──
describe('req:doctor — parseArgs(--root·--ticket·--finalize)', () => {
  it('[P2] --root 수용(config 탐색 루트 주입)', () => {
    expect(parseArgs(['2026-001', '--root', '/x']).root).toBe('/x')
    expect(parseArgs(['2026-001']).root).toBe(null)
  })
  it('[P2] --root 값 누락은 throw', () => {
    expect(() => parseArgs(['2026-001', '--root'])).toThrow(/--root/)
  })
  it('--ticket·--finalize·reqId 파싱(behavior-preserving)', () => {
    const o = parseArgs(['--ticket', '/t', '--finalize'])
    expect(o.ticket).toBe('/t')
    expect(o.finalize).toBe(true)
    expect(parseArgs(['2026-003']).reqId).toBe('2026-003')
  })
  it('알 수 없는 옵션은 throw(fail-closed)', () => {
    expect(() => parseArgs(['--nope'])).toThrow(/알 수 없는/)
  })
})

describe('req:doctor — D20 (자산 skew content-hash, REQ-2026-038)', () => {
  const D20 = (over: Parameters<typeof mk>[0]) => lvl(runChecks(mk(over)), 'D20')

  it('필드 미지정(legacy/2-arg) → OK(점검 불요)', () => {
    expect(D20({})).toBe('OK')
  })
  it('dev repo/dogfood(packageRootDiffers=false) → OK', () => {
    expect(D20({ packageRootDiffers: false, schemaPathIsDefault: true, packagedSchemaSha: 'a', vendoredSchemaSha: 'b' })).toBe('OK')
  })
  it('custom schemaPath(schemaPathIsDefault=false) → OK(unmanaged)', () => {
    expect(D20({ packageRootDiffers: true, schemaPathIsDefault: false, packagedSchemaSha: 'a', vendoredSchemaSha: 'b' })).toBe('OK')
  })
  it('shipped/vendored 조회 불가(sha null) → OK', () => {
    expect(D20({ packageRootDiffers: true, schemaPathIsDefault: true, packagedSchemaSha: null, vendoredSchemaSha: 'b' })).toBe('OK')
    expect(D20({ packageRootDiffers: true, schemaPathIsDefault: true, packagedSchemaSha: 'a', vendoredSchemaSha: null })).toBe('OK')
  })
  it('shipped === vendored → OK(동기화됨)', () => {
    expect(D20({ packageRootDiffers: true, schemaPathIsDefault: true, packagedSchemaSha: 'same', vendoredSchemaSha: 'same' })).toBe('OK')
  })
  it('shipped !== vendored(skew) → WARN', () => {
    expect(
      D20({ packageRootDiffers: true, schemaPathIsDefault: true, packagedSchemaSha: 'shipped', vendoredSchemaSha: 'stale', installedVersion: '0.8.1' }),
    ).toBe('WARN')
  })
  it('skew여도 D20은 절대 FAIL이 아니다(커밋 게이트 무영향)', () => {
    const checks = runChecks(mk({ packageRootDiffers: true, schemaPathIsDefault: true, packagedSchemaSha: 'x', vendoredSchemaSha: 'y' }))
    expect(checks.filter((c) => c.id === 'D20' && c.level === 'FAIL').length).toBe(0)
  })

  // main() 경로 증명(REQ-2026-038 phase-2 리뷰 대응): 합성 sha 문자열이 아니라 req-doctor의 **실제 createHash 경로**
  // (safeSha256)를 구동한다. createHash import가 결함이면 safeSha256이 null을 반환해 아래 hex 단언이 실패한다.
  it('safeSha256 — 실제 createHash 경로 동작(파일 sha 64hex)', () => {
    const sha = safeSha256(join(packageRoot(), 'workflow', 'machine.schema.json'))
    expect(sha).toMatch(/^[0-9a-f]{64}$/)
  })
  it('실제 shipped-vs-stale sha로 D20 WARN(main() sha 계산 end-to-end)', () => {
    const shipped = safeSha256(join(packageRoot(), 'workflow', 'machine.schema.json'))
    const dir = mkdtempSync(join(tmpdir(), 'cg-d20-'))
    try {
      const stalePath = join(dir, 'stale.json')
      writeFileSync(stalePath, '{"machine_schema_version":["1.1"],"_stale":"0.7.0"}')
      const stale = safeSha256(stalePath)
      expect(shipped).toMatch(/^[0-9a-f]{64}$/)
      expect(stale).toMatch(/^[0-9a-f]{64}$/)
      expect(shipped).not.toBe(stale)
      expect(
        D20({ packageRootDiffers: true, schemaPathIsDefault: true, packagedSchemaSha: shipped, vendoredSchemaSha: stale, installedVersion: '0.8.1' }),
      ).toBe('WARN')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  it('safeSha256 — 부재 파일은 null(fail-safe → D20 OK 처리)', () => {
    expect(safeSha256(join(tmpdir(), 'cg-nonexistent-xyz-123.json'))).toBeNull()
  })
})

// ───────────────────────────── D25: 미병합 누적 경고 (REQ-2026-085) ──
describe('[REQ-2026-085] D25 — 종결됐지만 trunk에 없는 티켓', () => {
  const paths = (...ids: string[]) =>
    new Set(ids.map((id) => `workflow/${id}/responses/ticket-close.jsonl`))

  it('DEC-1: 판정 근거는 trunk 트리의 close proof다 — 브랜치 존재가 아니다', () => {
    // 070·071은 종결됐고 trunk에는 070만 있다 → 071만 미병합.
    expect(
      unmergedClosedTickets(['REQ-2026-070', 'REQ-2026-071'], paths('REQ-2026-070'), 'workflow', 'REQ-2026-099'),
    ).toEqual(['REQ-2026-071'])
  })

  it('DEC-3: 대상 티켓(자기 자신)은 세지 않는다 — 방금 종결된 것이 trunk에 없는 건 정상이다', () => {
    expect(unmergedClosedTickets(['REQ-2026-085'], new Set(), 'workflow', 'REQ-2026-085')).toEqual([])
  })

  it('전부 반영됐으면 빈 배열 · 정렬된 목록을 준다', () => {
    expect(unmergedClosedTickets(['REQ-2026-070'], paths('REQ-2026-070'), 'workflow', 'X')).toEqual([])
    expect(
      unmergedClosedTickets(['REQ-2026-072', 'REQ-2026-070', 'REQ-2026-071'], new Set(), 'workflow', 'X'),
    ).toEqual(['REQ-2026-070', 'REQ-2026-071', 'REQ-2026-072'])
  })

  it('ticketRoot가 config로 바뀌어도 경로를 맞춘다', () => {
    const p = new Set(['tickets/REQ-2026-070/responses/ticket-close.jsonl'])
    expect(unmergedClosedTickets(['REQ-2026-070'], p, 'tickets', 'X')).toEqual([])
    expect(unmergedClosedTickets(['REQ-2026-070'], p, 'workflow', 'X')).toEqual(['REQ-2026-070'])
  })

  it('🔴 DEC-4: 어떤 입력에서도 FAIL이 아니다 — 알림이지 게이트가 아니다', () => {
    for (const u of [undefined, [], ['REQ-2026-070'], ['A', 'B', 'C', 'D', 'E', 'F']]) {
      const level = lvl(runChecks(mk({ unmergedClosedTickets: u, trunkBranch: 'main' })), 'D25')
      expect(level, `unmerged=${JSON.stringify(u)}`).not.toBe('FAIL')
    }
  })

  it('DEC-2: 판정 불가(undefined)는 조용히 통과 — 오탐으로 doctor 출력을 죽이지 않는다', () => {
    expect(lvl(runChecks(mk({ unmergedClosedTickets: undefined })), 'D25')).toBe('OK')
  })

  it('미병합이 있으면 WARN + 목록에 REQ id가 실린다', () => {
    const checks = runChecks(mk({ unmergedClosedTickets: ['REQ-2026-070', 'REQ-2026-071'], trunkBranch: 'main' }))
    expect(lvl(checks, 'D25')).toBe('WARN')
    const msg = checks.find((c) => c.id === 'D25')?.msg ?? ''
    expect(msg).toContain('REQ-2026-070')
    expect(msg).toContain('REQ-2026-071')
    expect(msg).toContain('main')
  })

  it('전부 반영됐으면 OK', () => {
    expect(lvl(runChecks(mk({ unmergedClosedTickets: [], trunkBranch: 'main' })), 'D25')).toBe('OK')
  })
})

// ─────────────── D18 레벨 상한 (REQ-2026-086 DEC-5) ──
describe('[REQ-2026-086] D18은 WARN 상한을 유지한다', () => {
  it('🔴 초과해도 FAIL이 아니다 — FAIL이면 승인받은 phase가 커밋되지 못하고 승인도 소비되지 않는 교착이 된다', () => {
    const over = E(...Array.from({ length: 20 }, (_, i) => `M  src/f${i}.ts`))
    const checks = runChecks(mk({ statusEntries: over, granularityMaxFiles: 8 }))
    expect(lvl(checks, 'D18')).toBe('WARN')
    expect(checks.filter((c) => c.id === 'D18' && c.level === 'FAIL')).toEqual([])
  })

  it('block 명시 시 문구가 차단 절차와 두 탈출구를 가리킨다', () => {
    const msgs = phaseGranularityWarnings(['a', 'b', 'c'], 2, 'block')
    expect(msgs).toHaveLength(1)
    expect(msgs[0]).toContain('실행 전에 막힙니다')
    expect(msgs[0]).toContain('staging')
    expect(msgs[0]).toContain('max_files')
  })

  // 🔴 phase-2 r01 P1: 문구가 실제 설정과 어긋나면 안 된다. warn 사용자에게 "막힙니다"는 거짓이다.
  it('🔴 granularityGate="warn"이면 "막힌다"고 말하지 않는다(안내가 실제 동작과 일치)', () => {
    const msgs = phaseGranularityWarnings(['a', 'b', 'c'], 2, 'warn')
    expect(msgs).toHaveLength(1)
    expect(msgs[0]).not.toContain('막힙니다')
    expect(msgs[0]).toContain('그대로 진행됩니다')
  })

  // 🔴 REQ-2026-087: 기본 인자는 DEFAULTS를 따른다. 기본값과 문구가 갈라지면 REQ-2026-086 phase-2 r01 P1
  //    (안내가 실제 동작과 어긋남)이 재발한다 — 그 정합이 우연이 아님을 여기서 고정한다.
  it('🔴 [REQ-087 R4] 기본 인자(=DEFAULTS)일 때 "막힌다"고 말하지 않는다', () => {
    expect(DEFAULTS.granularityGate).toBe('warn') // 기본값 자체를 고정
    const msgs = phaseGranularityWarnings(['a', 'b', 'c'], 2) // gate 미지정 = DEFAULTS
    expect(msgs).toHaveLength(1)
    expect(msgs[0]).not.toContain('막힙니다')
    expect(msgs[0]).toContain('그대로 진행됩니다')
  })

  it('runChecks도 설정을 그대로 반영한다(배선)', () => {
    const over = E(...Array.from({ length: 20 }, (_, i) => `M  src/f${i}.ts`))
    const block = runChecks(mk({ statusEntries: over, granularityMaxFiles: 8, granularityGate: 'block' }))
    const warn = runChecks(mk({ statusEntries: over, granularityMaxFiles: 8, granularityGate: 'warn' }))
    expect(block.find((c) => c.id === 'D18')?.msg).toContain('막힙니다')
    expect(warn.find((c) => c.id === 'D18')?.msg).not.toContain('막힙니다')
    // 레벨은 둘 다 WARN(상한 불변).
    expect(lvl(block, 'D18')).toBe('WARN')
    expect(lvl(warn, 'D18')).toBe('WARN')
  })
})

// ───────────── D26: 낡은 design_ref 결속 사전 안내 (REQ-2026-088) ──
describe('[REQ-2026-088] D26 — 결속이 끊긴 phase 사전 경고', () => {
  it('🔴 DEC-4: 어떤 입력에서도 FAIL이 아니다 — FAIL이면 재결속에 필요한 phase를 커밋조차 못 하는 교착이 된다', () => {
    for (const v of [undefined, [], ['a'], ['a', 'b', 'c', 'd', 'e']]) {
      const checks = runChecks(mk({ staleBindingLines: v }))
      expect(lvl(checks, 'D26'), `staleBindingLines=${JSON.stringify(v)}`).not.toBe('FAIL')
      expect(checks.filter((c) => c.id === 'D26' && c.level === 'FAIL')).toEqual([])
    }
  })

  it('미계산(undefined)·결속 온전([])은 OK', () => {
    expect(lvl(runChecks(mk({})), 'D26')).toBe('OK')
    expect(lvl(runChecks(mk({ staleBindingLines: [] })), 'D26')).toBe('OK')
  })

  it('안내 줄이 있으면 WARN이고 그 내용이 그대로 실린다', () => {
    const lines = [
      '설계 재승인으로 앞선 phase의 결속이 끊겼습니다(2개) — 재결속하면 종결됩니다.',
      'npx commitgate req:rebind REQ-2026-001 --phase p1 --confirm "rebind REQ-2026-001 p1" --run',
    ]
    const checks = runChecks(mk({ staleBindingLines: lines }))
    expect(lvl(checks, 'D26')).toBe('WARN')
    const msg = checks.find((c) => c.id === 'D26')?.msg ?? ''
    expect(msg).toContain('req:rebind REQ-2026-001 --phase p1')
    expect(msg).toContain('--confirm "rebind REQ-2026-001 p1"') // 실행 가능한 명령 그대로
  })
})

// ───────────── D27: 소비된 승인의 행 유실 (REQ-2026-094) ──
//
// 🔴 이 검사가 **말하지 않는 것**이 설계의 절반이다: 미소비 승인 핀(`approval_evidence`)은
//    `req:confirm` 체크포인트가 만드는 정상 상태와 구별할 수 없어 신호로 쓰지 않는다.
describe('[REQ-2026-094] D27 — 소비된 승인인데 매니페스트 행이 없다', () => {
  it('🔴 DEC-2: 어떤 입력에서도 FAIL이 아니다 — 진단이 스스로 새 교착을 만들면 안 된다', () => {
    for (const v of [undefined, [], ['p1'], ['p1', 'p2', 'p3']]) {
      const checks = runChecks(mk({ consumedWithoutRow: v }))
      expect(lvl(checks, 'D27'), `consumedWithoutRow=${JSON.stringify(v)}`).not.toBe('FAIL')
      expect(checks.filter((c) => c.id === 'D27' && c.level === 'FAIL')).toEqual([])
    }
  })

  it('🔴 오탐 0: 미계산(undefined)·빈 배열은 OK — 진행 중 정상 티켓이 경고를 받지 않는다', () => {
    expect(lvl(runChecks(mk({})), 'D27')).toBe('OK')
    expect(lvl(runChecks(mk({ consumedWithoutRow: [] })), 'D27')).toBe('OK')
  })

  it('소비 기록만 있고 행이 없으면 WARN + 해당 phase를 지목한다', () => {
    const checks = runChecks(mk({ consumedWithoutRow: ['phase-1b'] }))
    expect(lvl(checks, 'D27')).toBe('WARN')
    expect(checks.find((c) => c.id === 'D27')?.msg ?? '').toContain('phase-1b')
  })

  it('🔴 안내가 정직하다 — 복구 불가를 말하고, 존재하지 않는 복원 명령을 안내하지 않는다', () => {
    const msg = runChecks(mk({ consumedWithoutRow: ['p1'], state: { id: 'REQ-2026-004' } })).find((c) => c.id === 'D27')?.msg ?? ''
    expect(msg).toContain('복구할 수 없습니다')
    expect(msg).toContain('다시 수행')                    // 경로 1
    expect(msg).toContain('req:close 2026-004 --abandon') // 경로 2 — 그대로 실행 가능한 형태
    // 🔴 없는 명령을 안내하면 사용자를 막다른 길로 보낸다(설계 r03 P1로 복원은 폐기됐다).
    expect(msg).not.toContain('req:reconstruct')
    expect(msg).not.toContain('--approvals')
  })
})

/**
 * REQ-2026-097 — 종결된 티켓에서 **브랜치 동일성 축**(D2·D3·D11)을 면제한다.
 *
 * 🔴 소비자 리포트: 병합 후 브랜치를 지우는 **권장 운영**을 하면 종결 티켓 전부에서 셋이 영구히
 *    FAIL이 되어 `req:doctor`를 건강 점검으로 쓸 수 없었다. 더 나쁜 것은 에이전트가 그 FAIL을 보고
 *    종결 티켓의 feature 브랜치를 되살리려 한다는 점이다.
 *
 * 워킹트리 축(D10)과 커밋 게이트(commit_allowed 축)는 **면제 대상이 아니다** — 아래가 그것을 고정한다.
 */
describe('[REQ-2026-097] D2·D3·D11 — 종결 티켓은 브랜치 축 면제', () => {
  /** 병합 후 main으로 돌아와 브랜치를 지운 상태(리포트의 재현 조건 그대로). */
  const merged = (over: Partial<DoctorInputs> = {}): DoctorInputs => ({
    ...base,
    currentBranch: 'main',
    branchExists: false,
    ...over,
  })
  const AXIS = ['D2', 'D3', 'D11'] as const
  const lv = (checks: Check[], id: string): string | undefined => checks.find((c) => c.id === id)?.level
  const ms = (checks: Check[], id: string): string => checks.find((c) => c.id === id)?.msg ?? ''

  it('종결(dev-complete)이면 세 검사가 OK이고 사유를 남긴다', () => {
    const checks = runChecks(merged({ ticketTerminalEvent: 'dev-complete' }))
    for (const id of AXIS) {
      expect(lv(checks, id), id).toBe('OK')
      expect(ms(checks, id), id).toContain('종결 티켓')
      expect(ms(checks, id), id).toContain('dev-complete')
    }
  })

  /**
   * 🔴 설계 r01 P1의 회귀 가드. 입력이 boolean이면 `abandoned`와 `dev-complete`를 구분할 수 없어
   *    이 문구를 만들 수 없다 — 그래서 입력 계약이 `CloseProofEvent | null`이다.
   */
  it('사유 문구는 실제 종결 이벤트를 그대로 쓴다(boolean으로는 만들 수 없는 문구)', () => {
    const checks = runChecks(merged({ ticketTerminalEvent: 'abandoned' }))
    for (const id of AXIS) {
      expect(ms(checks, id), id).toContain('abandoned')
      expect(ms(checks, id), id).not.toContain('dev-complete')
    }
  })

  it('진행 중(null)이면 세 검사가 그대로 FAIL — 완화가 새지 않는다', () => {
    const checks = runChecks(merged({ ticketTerminalEvent: null }))
    for (const id of AXIS) expect(lv(checks, id), id).toBe('FAIL')
  })

  it('미계산(undefined)이면 현행 동작 — fail-closed·하위호환', () => {
    const checks = runChecks(merged({}))
    for (const id of AXIS) expect(lv(checks, id), id).toBe('FAIL')
  })

  it('워킹트리 축(D10)은 면제하지 않는다 — 종결과 독립인 사실이다', () => {
    const checks = runChecks(
      merged({ ticketTerminalEvent: 'dev-complete', statusEntries: E(' M src/app.ts') }),
    )
    expect(lv(checks, 'D2')).toBe('OK')
    expect(lv(checks, 'D10')).toBe('FAIL')
  })

  /**
   * 🔴 R4 — 브랜치 축 면제가 **커밋 경로를 열면 안 된다**. 실제 커밋 게이트는 `commit_allowed`
   *    축(D6·D9·D16)이며 dev-complete 발행 시점에 소비된다. 그 논증을 주장으로 두지 않고 여기서 고정한다.
   */
  it('면제돼도 승인 축은 그대로 막는다 — 종결 티켓이 main에서 커밋 가능해지지 않는다', () => {
    const checks = runChecks(
      merged({
        ticketTerminalEvent: 'dev-complete',
        state: { ...base.state, commit_allowed: true, approved_diff_hash: 'OTHER' } as WorkflowState,
        stagedTree: 'TREE',
      }),
    )
    for (const id of AXIS) expect(lv(checks, id), id).toBe('OK')
    expect(checks.some((c) => c.level === 'FAIL')).toBe(true)
    expect(lv(checks, 'D9')).toBe('FAIL')
  })
})

/**
 * REQ-2026-102 — legacy 티켓에서 **왜 면제되지 않는지**를 말한다.
 *
 * 🔴 소비자가 "legacy는 조치가 없는데 doctor만 FAIL한다"며 면제를 요청했으나, 실측 결과
 *    `legacy` 축이 둘이고 겹치지 않는다: intake legacy(`evidence_durability_required`, HEAD)와
 *    review legacy(`review_series_model_version`, 워킹). 리포터가 든 4건은 **전부 review-OK** —
 *    즉 리뷰·커밋으로 진행 가능하고 브랜치 축이 그것을 지킨다. `req:commit`이 doctor를 하드
 *    게이트로 spawn하므로 면제하면 **main 커밋이 열린다.**
 *
 * → **동작은 그대로 두고 사유만 말한다.** 아래 ①·⑤가 "게이트가 약해지지 않았음"을 고정한다.
 */
describe('[REQ-2026-102] legacy 티켓 — 면제하지 않되 사유를 말한다', () => {
  const merged = (over: Partial<DoctorInputs> = {}): DoctorInputs => ({
    ...base,
    currentBranch: 'main',
    branchExists: false,
    ...over,
  })
  const AXIS = ['D2', 'D3', 'D11'] as const
  const lv = (checks: Check[], id: string): string | undefined => checks.find((c) => c.id === id)?.level
  const ms = (checks: Check[], id: string): string => checks.find((c) => c.id === id)?.msg ?? ''

  it('① legacy는 여전히 FAIL이다 — 면제 집합이 넓어지지 않았다', () => {
    const checks = runChecks(merged({ ticketTerminalEvent: 'legacy' }))
    for (const id of AXIS) expect(lv(checks, id), id).toBe('FAIL')
  })

  it('② 그 FAIL이 사유를 말하고, 없는 해결책을 암시하지 않는다', () => {
    const checks = runChecks(merged({ ticketTerminalEvent: 'legacy' }))
    for (const id of AXIS) {
      expect(ms(checks, id), id).toContain('legacy 티켓')
      expect(ms(checks, id), id).toContain('해소할 수단이 없습니다') // 🔴 없는 조치를 찾게 만들지 않는다
    }
  })

  it('③ 면제 값에는 legacy 문구가 붙지 않는다(오염 없음)', () => {
    const checks = runChecks(merged({ ticketTerminalEvent: 'dev-complete' }))
    for (const id of AXIS) {
      expect(lv(checks, id), id).toBe('OK')
      expect(ms(checks, id), id).not.toContain('legacy')
    }
  })

  it('④ null(진행 중)은 무회귀 — FAIL이되 legacy 문구가 없다', () => {
    const checks = runChecks(merged({ ticketTerminalEvent: null }))
    for (const id of AXIS) {
      expect(lv(checks, id), id).toBe('FAIL')
      expect(ms(checks, id), id).not.toContain('legacy 티켓')
    }
  })

  it('⑤ legacy를 WARN으로 강등하지 않았다 — 리포터 제안 (b)를 채택하지 않았음을 고정', () => {
    const checks = runChecks(merged({ ticketTerminalEvent: 'legacy' }))
    for (const id of AXIS) expect(lv(checks, id), id).not.toBe('WARN')
  })
})
