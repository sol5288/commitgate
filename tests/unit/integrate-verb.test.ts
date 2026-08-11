import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parseArgs,
  HelpRequested,
  runIntegrate,
  makeAppendLog,
  makeCoordinatorDeps,
  isYes,
  CI_RUN_PROMPT,
  finalMergePrompt,
  INTEGRATE_RUN_LOG_REL,
  type IntegrateRunRow,
} from '../../bin/integrate'
import { resolveDispatch } from '../../bin/dispatch.mjs'
import { createFakeCiRunPort } from '../../scripts/req/lib/github-ci-run'
// 🔴 fake 배선은 `tests/support/integrate-fakes.ts` **한 곳**에만 둔다(ci-workflow-policy 테스트와 공유).
import {
  BASE,
  HEAD,
  SRC,
  TREE,
  MERGE_SHA,
  FEATURE,
  MANIFEST_PATH,
  fakeGit,
  fakeReadBlobs,
  makeDeps,
  runInfo as run,
  integrateOpts as opts,
} from '../support/integrate-fakes'

/**
 * REQ-2026-126 phase-3 + 0.22.0 RC 보완 — integrate verb의 **오케스트레이션**.
 *
 * 🔴 실제 gh·네트워크 호출 없음(CI는 fake 포트, git은 fake).
 * 🔴 CAS 병합·ref 표류의 **실 git 증명**은 `tests/unit/integration-coordinator.test.ts`가 소유한다.
 * 🔴 CI 기본 미실행 **정책**의 전수 행렬은 `tests/unit/ci-workflow-policy.test.ts`가 소유한다.
 */


describe('parseArgs·dispatch 배선', () => {
  it('fail-closed 파싱 + alias 충돌', () => {
    expect(parseArgs(['--run'])).toMatchObject({ run: true, runGithubCi: null })
    expect(parseArgs(['--run-github-ci'])).toMatchObject({ runGithubCi: true })
    expect(parseArgs(['--no-github-ci'])).toMatchObject({ runGithubCi: false })
    expect(() => parseArgs(['--run-github-ci', '--no-github-ci'])).toThrow()
    expect(() => parseArgs(['--nope'])).toThrow('알 수 없는 옵션')
    expect(() => parseArgs(['-h'])).toThrow(HelpRequested)
  })
  it('dispatch가 integrate를 bin 모듈로 해석한다', () => {
    expect(resolveDispatch(['integrate', '--run'])).toMatchObject({ entry: 'integrate.ts', rest: ['--run'] })
  })
})

describe('dry-run(기본) — 병합하지 않는다', () => {
  it('전제 통과 → 계획·결속 SHA 렌더·merge 미호출·exit 0·감사 로그 1행(ci: null)', async () => {
    const deps = makeDeps()
    const r = await runIntegrate(opts(), deps)
    expect(r.exit).toBe(0)
    expect(r.merged).toBe(false)
    expect(deps.logs.some((l) => l.includes('DRY-RUN'))).toBe(true)
    expect(deps.logs.some((l) => l.includes('결속: feature') && l.includes(HEAD.slice(0, 8)))).toBe(true)
    expect(deps.git.calls.some((c) => c[0] === 'merge' || c[0] === 'update-ref')).toBe(false)
    // phase-3 r01 P1: 기본(dry-run) 실행도 1실행 1행이다 — ci는 null(실행 안 함).
    expect(deps.rows).toHaveLength(1)
    expect(deps.rows[0]).toMatchObject({ ci: null, merged: false, exit: 0, feature_head_sha: HEAD, trunk_head_sha: BASE })
  })

  it('감사 로그 append가 throw해도 결과·exit가 보존된다(phase-3 r01 P1)', async () => {
    const deps = makeDeps()
    deps.appendLog = () => {
      throw new Error('EACCES: read-only')
    }
    const r = await runIntegrate(opts({ run: true }), deps)
    expect(r.merged).toBe(true) // 병합은 이미 완료 — 로그 실패가 성공을 실패로 바꾸면 안 된다
    expect(r.exit).toBe(0)
    expect(deps.logs.some((l) => l.includes('감사 로그 기록 실패'))).toBe(true)
  })

  it('미입증 존재 → 차단(목록 렌더)·exit 1·로그 1행·결속 SHA 없음', async () => {
    const deps = makeDeps({
      git: fakeGit({ logOut: `${SRC}\x1f${TREE}\x1f${BASE}\x1fwip: unproven\x00\n`, nameOnlyOut: `\x01${SRC}\nsrc/app.ts\n` }),
      readBlobs: fakeReadBlobs({ [MANIFEST_PATH]: '' }),
    })
    const r = await runIntegrate(opts({ run: true }), deps)
    expect(r.exit).toBe(1)
    expect(r.merged).toBe(false)
    expect(deps.logs.some((l) => l.includes('strict'))).toBe(true)
    expect(deps.logs.some((l) => l.includes(SRC.slice(0, 8)))).toBe(true)
    expect(deps.rows).toHaveLength(1)
    expect(deps.rows[0]).toMatchObject({ merged: false, exit: 1, ci: null, feature_head_sha: null, trunk_head_sha: null })
  })
})

describe('CI 실행 opt-in(설계 DEC-2·DEC-3) — 기본은 실행하지 않는다', () => {
  it('config 없음·비대화형 → 질문 없이 생략(정상)·병합 진행', async () => {
    const deps = makeDeps()
    const r = await runIntegrate(opts({ run: true }), deps)
    expect(deps.asked).toHaveLength(0)
    expect(deps.logs.some((l) => l.includes('실행 생략(정상'))).toBe(true)
    expect(r.merged).toBe(true)
    expect(deps.rows[0]).toMatchObject({ ci: 'skipped', merged: true, exit: 0 })
  })

  it('--run-github-ci + config 없음 → 명확 실패·병합 없음', async () => {
    const deps = makeDeps()
    const r = await runIntegrate(opts({ run: true, runGithubCi: true }), deps)
    expect(r.exit).toBe(1)
    expect(r.merged).toBe(false)
    expect(deps.logs.some((l) => l.includes('githubCi 설정이 없습니다'))).toBe(true)
    expect(deps.git.calls.some((c) => c[0] === 'merge')).toBe(false)
  })

  it('--run-github-ci + config + fake green → run id·conclusion 로그·병합', async () => {
    const deps = makeDeps({ githubCi: { workflow: 'ci.yml', timeoutMinutes: 30 } })
    const r = await runIntegrate(opts({ run: true, runGithubCi: true }), deps)
    expect(r.merged).toBe(true)
    expect(deps.rows[0]).toMatchObject({ ci: 'run-ok', ci_run_id: 1, ci_conclusion: 'success', merged: true })
  })

  it('CI가 결속한 feature SHA를 대상으로 실행된다(브랜치 tip이 아니라)', async () => {
    const port = createFakeCiRunPort({ remoteSha: HEAD, runStates: [run({})] })
    const deps = makeDeps({ githubCi: { workflow: 'ci.yml', timeoutMinutes: 30 }, ciPort: port })
    await runIntegrate(opts({ run: true, runGithubCi: true }), deps)
    // remoteBranchSha는 브랜치 이름으로 조회하고, HEAD 대조는 결속 SHA로 한다(포트 계약).
    expect(port.calls[0]).toMatchObject({ method: 'remoteBranchSha', args: [FEATURE] })
    expect(port.calls[1]).toMatchObject({ method: 'dispatch', args: ['ci.yml', FEATURE] })
  })

  it('CI red → 통합 중단(병합 없음)·감사 로그에 결과 보존', async () => {
    const deps = makeDeps({
      githubCi: { workflow: 'ci.yml', timeoutMinutes: 30 },
      ciPort: createFakeCiRunPort({ remoteSha: HEAD, dispatchResult: { runId: 4 }, runStates: [run({ id: 4, conclusion: 'failure' })] }),
    })
    const r = await runIntegrate(opts({ run: true, runGithubCi: true }), deps)
    expect(r.exit).toBe(1)
    expect(r.merged).toBe(false)
    expect(deps.git.calls.some((c) => c[0] === 'merge')).toBe(false)
    expect(deps.rows[0]).toMatchObject({ ci: 'run-fail', ci_run_id: 4, ci_conclusion: 'failure', exit: 1 })
  })

  it('CI가 skipped → 병합하지 않는다(명시 요청한 검사가 실행되지 않은 것이다)', async () => {
    const deps = makeDeps({
      githubCi: { workflow: 'ci.yml', timeoutMinutes: 30 },
      ciPort: createFakeCiRunPort({ remoteSha: HEAD, dispatchResult: { runId: 6 }, runStates: [run({ id: 6, conclusion: 'skipped' })] }),
    })
    const r = await runIntegrate(opts({ run: true, runGithubCi: true }), deps)
    expect(r.exit).toBe(1)
    expect(r.merged).toBe(false)
    expect(deps.rows[0]).toMatchObject({ ci: 'run-fail', ci_conclusion: 'skipped' })
  })

  it('대화형 + config → CI 질문(고정 문구)·n이면 생략, 최종 확인 y면 병합', async () => {
    const answers = ['n', 'y'] // CI 질문 → n, 최종 확인 → y
    const asked: string[] = []
    const port = createFakeCiRunPort({ remoteSha: HEAD, runStates: [run({})] })
    const deps = makeDeps({
      interactive: true,
      githubCi: { workflow: 'ci.yml', timeoutMinutes: 30 },
      ciPort: port,
      ask: async (q) => {
        asked.push(q)
        return answers.shift() ?? ''
      },
    })
    const r = await runIntegrate(opts({ run: true }), deps)
    expect(asked[0]).toBe(CI_RUN_PROMPT)
    expect(CI_RUN_PROMPT).toContain('실행하시겠습니까')
    expect(CI_RUN_PROMPT).toContain('사용량 또는 비용')
    expect(CI_RUN_PROMPT).toContain('[y/N]')
    expect(asked[1]).toBe(finalMergePrompt(FEATURE, 'main'))
    expect(port.calls).toHaveLength(0) // 🔴 n → 포트를 건드리지도 않는다
    expect(r.merged).toBe(true)
    expect(deps.rows[0]).toMatchObject({ ci: 'skipped', merged: true })
  })

  it('대화형 최종 확인 기본 No(Enter) → 병합하지 않는다', async () => {
    const deps = makeDeps({ interactive: true, ask: async () => '' })
    const r = await runIntegrate(opts({ run: true }), deps)
    expect(r.merged).toBe(false)
    expect(r.exit).toBe(0) // 사용자 취소는 실패가 아니다
    expect(deps.git.calls.some((c) => c[0] === 'merge')).toBe(false)
  })
})

/**
 * 🔴 결속 회귀 가드(0.22.0 RC 보완). coordinator가 실제 CAS를 소유하지만,
 *    verb 층에서도 "표류하면 병합 명령이 나가지 않는다"를 확인한다 — 배선이 끊기면 순수 테스트가 못 잡는다.
 */
describe('검증 이후 ref가 움직이면 verb 경로에서도 병합 명령이 나가지 않는다', () => {
  it('사람 확인 중 feature ref 이동 → merge/update-ref 미호출·exit 1', async () => {
    let moved = false
    const git = fakeGit()
    const inner = git.exec.bind(git)
    git.exec = (args: string[]): string => {
      // 최종 확인(ask) 이후에야 이동한 것으로 만든다 — 재검증 시점의 ref 조회부터 새 값을 준다.
      if (moved && args[0] === 'rev-parse' && args[2] === `refs/heads/${FEATURE}`) return `${'7'.repeat(40)}\n`
      return inner(args)
    }
    const deps = makeDeps({
      git,
      interactive: true,
      ask: async () => {
        moved = true
        return 'y'
      },
    })
    const r = await runIntegrate(opts({ run: true }), deps)
    expect(r.exit).toBe(1)
    expect(r.merged).toBe(false)
    expect(deps.logs.some((l) => l.includes('다시 실행하세요'))).toBe(true)
    expect(git.calls.some((c) => c[0] === 'merge' || c[0] === 'update-ref')).toBe(false)
  })

  it('CI 대기 중 trunk ref 이동 → merge/update-ref 미호출·exit 1', async () => {
    let moved = false
    const git = fakeGit()
    const inner = git.exec.bind(git)
    git.exec = (args: string[]): string => {
      if (moved && args[0] === 'rev-parse' && args[2] === 'refs/heads/main') return `${'8'.repeat(40)}\n`
      return inner(args)
    }
    const port = createFakeCiRunPort({ remoteSha: HEAD, runStates: [run({})] })
    const origDispatch = port.dispatch.bind(port)
    port.dispatch = async (w, ref) => {
      moved = true // CI 대기 창에서 trunk가 움직였다
      return origDispatch(w, ref)
    }
    const deps = makeDeps({ git, githubCi: { workflow: 'ci.yml', timeoutMinutes: 30 }, ciPort: port })
    const r = await runIntegrate(opts({ run: true, runGithubCi: true }), deps)
    expect(r.exit).toBe(1)
    expect(r.merged).toBe(false)
    expect(deps.logs.some((l) => l.includes('trunk 브랜치가 이동했습니다'))).toBe(true)
    expect(git.calls.some((c) => c[0] === 'merge' || c[0] === 'update-ref')).toBe(false)
  })
})

describe('감사 로그(설계 DEC-6)', () => {
  it('gitignore 미대상이면 기록 생략 + sync --apply --gitignore 안내', () => {
    const warns: string[] = []
    const git = fakeGit({ checkIgnoreOk: false })
    const dir = mkdtempSync(join(tmpdir(), 'cg-int-'))
    const append = makeAppendLog(dir, git, (l) => warns.push(l))
    append({} as IntegrateRunRow)
    expect(warns[0]).toContain('sync --apply --gitignore')
  })

  it('행에 CI 출력 본문·커밋 메시지가 없다(필드 화이트리스트) + 결속 SHA 3필드', async () => {
    const deps = makeDeps()
    await runIntegrate(opts({ run: true }), deps)
    const row = deps.rows[0] as IntegrateRunRow
    expect(Object.keys(row).sort()).toEqual(
      [
        'at',
        'base',
        'ci',
        'ci_conclusion',
        'ci_run_id',
        'counts',
        'exit',
        'feature',
        'feature_head_sha',
        'head',
        'manifest_problems',
        'merge_parents',
        'merge_sha',
        'merged',
        'trunk',
        'trunk_head_sha',
      ].sort(),
    )
  })

  it('병합 성공 행에 feature/trunk 두 SHA와 실제 merge 부모가 모두 남는다', async () => {
    const deps = makeDeps()
    await runIntegrate(opts({ run: true }), deps)
    expect(deps.rows[0]).toMatchObject({
      merged: true,
      merge_sha: MERGE_SHA,
      feature_head_sha: HEAD,
      trunk_head_sha: BASE,
      merge_parents: [BASE, HEAD],
    })
  })
})

describe('makeCoordinatorDeps — verify-range와 같은 수집을 주입한다', () => {
  it('verify가 심층 6범주 counts를 돌려준다(수집 분기 없음)', () => {
    const deps = makeDeps()
    const summary = makeCoordinatorDeps(deps).verify(BASE, HEAD)
    expect(summary).not.toBeNull()
    expect(Object.keys(summary?.counts ?? {}).sort()).toEqual(
      ['approved', 'attested', 'bookkeeping', 'invalid-evidence', 'merge', 'unproven'].sort(),
    )
  })
})

describe('isYes — 기본 No', () => {
  it('y/Y만 긍정 — Enter·빈 문자열·n은 전부 부정', () => {
    expect(isYes('y')).toBe(true)
    expect(isYes(' Y ')).toBe(true)
    expect(isYes('')).toBe(false)
    expect(isYes('   ')).toBe(false)
    expect(isYes('\n')).toBe(false)
    expect(isYes('yes')).toBe(false)
    expect(isYes('n')).toBe(false)
    expect(isYes('N')).toBe(false)
  })
})

describe('로그 경로 상수', () => {
  it('workflow/.integrate-runs.jsonl — 템플릿 앵커·smoke 단언과 짝', () => {
    expect(INTEGRATE_RUN_LOG_REL).toBe('workflow/.integrate-runs.jsonl')
  })
})
