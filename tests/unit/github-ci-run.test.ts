import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  awaitCiRun,
  createFakeCiRunPort,
  createGhCiRunAdapter,
  isExplicitRunSuccess,
  parseDispatchResponse,
  checkRunIdentity,
  normalizeWorkflowPath,
  expectedWorkflowPath,
  WORKFLOWS_DIR,
  toRunInfo,
  GITHUB_API_VERSION,
  GITHUB_ACCEPT,
  type RunInfo,
} from '../../scripts/req/lib/github-ci-run'
import { loadConfig, GITHUB_CI_TIMEOUT_MINUTES_DEFAULT } from '../../scripts/req/lib/config'

/**
 * REQ-2026-126 phase-1 + 0.22.0 RC 보완 — CI 실행 포트.
 * 🔴 실제 gh·git·네트워크를 절대 호출하지 않는다 — fake 포트와 주입 spawn만 쓴다(완료 기준 7).
 */

const HEAD = 'a'.repeat(40)
const OTHER = 'b'.repeat(40)
const REF = 'feat/x'

/** 가상 시계: now는 sleep 누적으로 흐른다. */
function clock(startIso = '2026-08-10T00:00:00.000Z') {
  let t = Date.parse(startIso)
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms
    },
    advance: (ms: number) => {
      t += ms
    },
  }
}

const run = (over: Partial<RunInfo>): RunInfo => ({
  id: 1,
  status: 'completed',
  conclusion: 'success',
  created_at: '2026-08-10T00:00:01.000Z',
  head_sha: HEAD,
  head_branch: REF,
  event: 'workflow_dispatch',
  // 🔴 공식 응답과 같은 `path@ref` 형태 — 정상 경로 테스트가 이 계약을 항상 지난다.
  path: `.github/workflows/ci.yml@refs/heads/${REF}`,
  ...over,
})

const baseOpts = (c: ReturnType<typeof clock>) => ({
  workflow: 'ci.yml',
  ref: REF,
  expectedHeadSha: HEAD,
  timeoutMinutes: 30,
  now: c.now,
  sleep: c.sleep,
  pollIntervalMs: 1000,
})

describe('awaitCiRun — HEAD 결속(설계 r01 P1)', () => {
  it('원격 브랜치 부재 → 실패 + 자동 push 없음 안내', async () => {
    const c = clock()
    const port = createFakeCiRunPort({ remoteSha: null })
    const r = await awaitCiRun(port, baseOpts(c))
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('자동 push 하지 않습니다')
    expect(port.calls.some((x) => x.method === 'dispatch')).toBe(false) // dispatch 자체를 안 한다
  })

  it('원격 SHA ≠ 로컬 HEAD → dispatch 없이 실패(미push 커밋 우회 방지)', async () => {
    const c = clock()
    const port = createFakeCiRunPort({ remoteSha: OTHER })
    const r = await awaitCiRun(port, baseOpts(c))
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('push')
    expect(port.calls.some((x) => x.method === 'dispatch')).toBe(false)
  })
})

/**
 * 🔴 0.22.0 RC 보완의 핵심. dispatch 응답이 준 id **하나만** 쓴다 —
 *    목록 조회로 이번 run을 추측하던 경로는 삭제됐다(포트에 listRuns가 없다).
 */
describe('awaitCiRun — dispatch가 반환한 run id에만 결속', () => {
  it('반환된 id를 그대로 getRun에 넘긴다(추정 없음)', async () => {
    const c = clock()
    const port = createFakeCiRunPort({
      remoteSha: HEAD,
      dispatchResult: { runId: 4242, htmlUrl: 'https://github.com/o/r/actions/runs/4242' },
      runStates: [run({ id: 4242 })],
    })
    const r = await awaitCiRun(port, baseOpts(c))
    expect(r).toEqual({
      ok: true,
      reason: null,
      runId: 4242,
      conclusion: 'success',
      runHtmlUrl: 'https://github.com/o/r/actions/runs/4242',
    })
    const getRuns = port.calls.filter((x) => x.method === 'getRun')
    expect(getRuns.length).toBeGreaterThan(0)
    for (const call of getRuns) expect(call.args[0]).toBe(4242)
    // 호출 순서: remoteBranchSha → dispatch → getRun. 목록 조회 메서드는 존재하지 않는다.
    const seq = port.calls.map((x) => x.method)
    expect(seq[0]).toBe('remoteBranchSha')
    expect(seq[1]).toBe('dispatch')
    expect(seq).not.toContain('listRuns')
  })

  it('포트에 listRuns가 없다 — 목록 추정 fallback을 둘 자리 자체가 없다', () => {
    const port = createFakeCiRunPort({ remoteSha: HEAD })
    expect((port as unknown as Record<string, unknown>).listRuns).toBeUndefined()
  })

  it('dispatch 실패(구형 API·권한·422 등) → 실패이며 다른 방법으로 넘어가지 않는다', async () => {
    const c = clock()
    const port = createFakeCiRunPort({ remoteSha: HEAD, dispatchError: 'HTTP 422' })
    const r = await awaitCiRun(port, baseOpts(c))
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('workflow_dispatch')
    expect(r.runId).toBeNull()
    expect(port.calls.some((x) => x.method === 'getRun')).toBe(false)
  })

  it('dispatch가 유효하지 않은 id를 반환 → fail-closed', async () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      const c = clock()
      const port = createFakeCiRunPort({ remoteSha: HEAD, dispatchResult: { runId: bad }, runStates: [run({})] })
      const r = await awaitCiRun(port, baseOpts(c))
      expect(r.ok).toBe(false)
      expect(r.reason).toContain('유효한 run id')
      expect(port.calls.some((x) => x.method === 'getRun')).toBe(false)
    }
  })

  it('getRun API 오류 → 실패(runId 보존)', async () => {
    const c = clock()
    const port = createFakeCiRunPort({ remoteSha: HEAD, dispatchResult: { runId: 77 }, getRunError: 'HTTP 503' })
    const r = await awaitCiRun(port, baseOpts(c))
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('run 상태 조회 실패')
    expect(r.runId).toBe(77)
  })
})

describe('parseDispatchResponse — return_run_details 응답 파싱(fail-closed)', () => {
  it('200 본문에서 workflow_run_id·run_url·html_url을 읽는다', () => {
    const body = JSON.stringify({
      workflow_run_id: 987654,
      run_url: 'https://api.github.com/repos/o/r/actions/runs/987654',
      html_url: 'https://github.com/o/r/actions/runs/987654',
    })
    expect(parseDispatchResponse(body)).toEqual({
      runId: 987654,
      runUrl: 'https://api.github.com/repos/o/r/actions/runs/987654',
      htmlUrl: 'https://github.com/o/r/actions/runs/987654',
    })
  })

  it('빈 본문(204 — 구형 API/gh) → 목록 추정으로 되돌아가지 않고 명확히 실패', () => {
    expect(() => parseDispatchResponse('')).toThrow('204')
    expect(() => parseDispatchResponse('   \n')).toThrow('return_run_details')
  })

  it('malformed·비객체·잘못된 id → 실패', () => {
    expect(() => parseDispatchResponse('{nope')).toThrow('JSON')
    expect(() => parseDispatchResponse('[]')).toThrow('객체')
    expect(() => parseDispatchResponse('null')).toThrow('객체')
    expect(() => parseDispatchResponse('{}')).toThrow('workflow_run_id')
    expect(() => parseDispatchResponse('{"workflow_run_id":"123"}')).toThrow('workflow_run_id') // 문자열은 거부
    expect(() => parseDispatchResponse('{"workflow_run_id":0}')).toThrow('workflow_run_id')
    expect(() => parseDispatchResponse('{"workflow_run_id":-3}')).toThrow('workflow_run_id')
    expect(() => parseDispatchResponse('{"workflow_run_id":1.5}')).toThrow('workflow_run_id')
  })

  it('URL이 없어도 id만 있으면 통과(선택 필드)', () => {
    expect(parseDispatchResponse('{"workflow_run_id":5}')).toEqual({ runId: 5 })
  })
})

describe('checkRunIdentity — 조회한 run이 우리가 요청한 그 실행인가', () => {
  const want = { headSha: HEAD, ref: REF, workflow: 'ci.yml' }

  it('전부 일치 → 문제 없음', () => {
    expect(checkRunIdentity(run({}), want)).toBeNull()
  })

  it('head_sha 불일치 → 실패', () => {
    expect(checkRunIdentity(run({ head_sha: OTHER }), want)).toContain('head_sha')
  })

  it('event가 workflow_dispatch가 아니면 실패(push/PR run을 우리 실행으로 읽지 않는다)', () => {
    expect(checkRunIdentity(run({ event: 'push' }), want)).toContain('workflow_dispatch')
    expect(checkRunIdentity(run({ event: '' }), want)).toContain('workflow_dispatch')
  })

  it('브랜치 불일치 → 실패(빈 값도 실패)', () => {
    expect(checkRunIdentity(run({ head_branch: 'other' }), want)).toContain('브랜치')
    expect(checkRunIdentity(run({ head_branch: '' }), want)).toContain('브랜치')
  })

  it('workflow path 불일치 → 실패', () => {
    expect(checkRunIdentity(run({ path: '.github/workflows/release.yml' }), want)).toContain('workflow 경로')
  })
})

/**
 * 🔴 `path` 대조는 **전체 경로**로 한다. 예전 구현은 basename만 비교해서
 *    `other/ci.yml` 같은 값이 전부 통과했다 — 이름만 같은 다른 파일을 우리 실행으로 읽는 결함이다.
 *    동시에 GitHub 응답은 `path@ref` 형태로 올 수 있으므로 그 접미는 떼고 비교한다.
 */
describe('checkRunIdentity — workflow path@ref 형식 호환과 전체 경로 대조', () => {
  const want = { headSha: HEAD, ref: REF, workflow: 'ci.yml' }
  const verdict = (path: string): string | null => checkRunIdentity(run({ path }), want)

  it('정규 경로 상수', () => {
    expect(WORKFLOWS_DIR).toBe('.github/workflows')
    expect(expectedWorkflowPath('ci.yml')).toBe('.github/workflows/ci.yml')
  })

  it('normalizeWorkflowPath — @ 뒤 ref 표현만 제거한다', () => {
    expect(normalizeWorkflowPath('.github/workflows/ci.yml')).toBe('.github/workflows/ci.yml')
    expect(normalizeWorkflowPath('.github/workflows/ci.yml@main')).toBe('.github/workflows/ci.yml')
    expect(normalizeWorkflowPath('.github/workflows/ci.yml@feat/x')).toBe('.github/workflows/ci.yml')
    expect(normalizeWorkflowPath('.github/workflows/ci.yml@refs/heads/feat/x')).toBe('.github/workflows/ci.yml')
  })

  for (const path of [
    '.github/workflows/ci.yml',
    '.github/workflows/ci.yml@main',
    '.github/workflows/ci.yml@feat/x',
    '.github/workflows/ci.yml@refs/heads/feat/x',
  ]) {
    it(`허용: ${path}`, () => {
      expect(verdict(path)).toBeNull()
    })
  }

  for (const path of [
    '.github/workflows/other.yml@main', // 같은 디렉터리·다른 파일
    '.github/other/ci.yml@main', // 같은 basename·다른 디렉터리
    'other/ci.yml', // 같은 basename·완전히 다른 경로
    'other/ci.yml@main',
    '.github/workflows/subdir/ci.yml', // 같은 basename·하위 디렉터리
    '.github/workflows/subdir/ci.yml@refs/heads/feat/x',
    'ci.yml', // basename만 — 경로가 아니다
    'workflows/ci.yml',
  ]) {
    it(`거부: ${path}`, () => {
      const r = verdict(path)
      expect(r, `${path} 가 통과해버렸습니다(basename 비교 회귀?)`).not.toBeNull()
      expect(r).toContain('workflow 경로')
      expect(r).toContain('.github/workflows/ci.yml') // 기대 경로를 사람이 볼 수 있게 담는다
    })
  }

  it('path 빈 값 → 대조할 입력이 없으므로 이 축만 생략(명시 정책)', () => {
    // 🔴 관대함이 아니라 "판정 입력 부재"의 반영이다. 나머지 세 축(head_sha·event·branch)은 그대로 강제된다.
    expect(verdict('')).toBeNull()
    expect(checkRunIdentity(run({ path: '', head_sha: OTHER }), want)).toContain('head_sha')
    expect(checkRunIdentity(run({ path: '', event: 'push' }), want)).toContain('workflow_dispatch')
    expect(checkRunIdentity(run({ path: '', head_branch: 'nope' }), want)).toContain('브랜치')
  })

  it('path 대조가 통과해도 나머지 축은 독립적으로 강제된다', () => {
    const good = '.github/workflows/ci.yml@refs/heads/feat/x'
    expect(checkRunIdentity(run({ path: good, head_sha: OTHER }), want)).toContain('head_sha')
    expect(checkRunIdentity(run({ path: good, event: 'schedule' }), want)).toContain('workflow_dispatch')
    expect(checkRunIdentity(run({ path: good, head_branch: 'main' }), want)).toContain('브랜치')
  })
})

describe('awaitCiRun — 정체 대조가 실제로 병합을 막는다', () => {
  const cases: { label: string; over: Partial<RunInfo>; needle: string }[] = [
    { label: 'head_sha 불일치', over: { head_sha: OTHER }, needle: 'head_sha' },
    { label: 'event 불일치', over: { event: 'push' }, needle: 'workflow_dispatch' },
    { label: 'branch 불일치', over: { head_branch: 'main' }, needle: '브랜치' },
    { label: 'workflow 불일치', over: { path: '.github/workflows/other.yml@main' }, needle: 'workflow 경로' },
    { label: 'workflow basename만 같은 다른 경로', over: { path: '.github/other/ci.yml@main' }, needle: 'workflow 경로' },
  ]
  for (const { label, over, needle } of cases) {
    it(`${label} → 실패`, async () => {
      const c = clock()
      const port = createFakeCiRunPort({ remoteSha: HEAD, dispatchResult: { runId: 9 }, runStates: [run({ id: 9, ...over })] })
      const r = await awaitCiRun(port, baseOpts(c))
      expect(r.ok).toBe(false)
      expect(r.reason).toContain(needle)
      expect(r.runId).toBe(9)
    })
  }
})

describe('awaitCiRun — 단일 시계(설계 r02 P1)', () => {
  it('오래 queued 여도 마감 안에 완료되면 성공 — 별도 출현 상한이 없다', async () => {
    const c = clock()
    const queued = Array.from({ length: 200 }, () => run({ id: 5, status: 'queued', conclusion: null }))
    const port = createFakeCiRunPort({ remoteSha: HEAD, dispatchResult: { runId: 5 }, runStates: [...queued, run({ id: 5 })] })
    const r = await awaitCiRun(port, baseOpts(c))
    expect(r).toMatchObject({ ok: true, runId: 5, conclusion: 'success' })
  })

  it('run 미완료인 채 마감 → timeout 실패(runId 보존)', async () => {
    const c = clock()
    const port = createFakeCiRunPort({
      remoteSha: HEAD,
      dispatchResult: { runId: 8 },
      runStates: [run({ id: 8, status: 'in_progress', conclusion: null })],
    })
    const r = await awaitCiRun(port, { ...baseOpts(c), timeoutMinutes: 1 })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('timeout')
    expect(r.runId).toBe(8)
  })
})

/**
 * 🔴 0.22.0 RC 보완: 명시 요청한 실행에서 성공은 `success` 뿐이다.
 *    `skipped`는 "요청했는데 실행되지 않음", `neutral`은 "판정 없음"이다.
 */
describe('conclusion 판정 — success만 통과', () => {
  it('isExplicitRunSuccess', () => {
    expect(isExplicitRunSuccess('success')).toBe(true)
    expect(isExplicitRunSuccess('skipped')).toBe(false)
    expect(isExplicitRunSuccess('neutral')).toBe(false)
    expect(isExplicitRunSuccess('failure')).toBe(false)
    expect(isExplicitRunSuccess('cancelled')).toBe(false)
    expect(isExplicitRunSuccess(null)).toBe(false)
  })

  for (const [conclusion, ok] of [
    ['success', true],
    ['skipped', false],
    ['neutral', false],
    ['failure', false],
    ['cancelled', false],
    ['timed_out', false],
  ] as const) {
    it(`awaitCiRun: ${conclusion} → ${ok ? '성공' : '실패(conclusion 보존)'}`, async () => {
      const c = clock()
      const port = createFakeCiRunPort({ remoteSha: HEAD, dispatchResult: { runId: 4 }, runStates: [run({ id: 4, conclusion })] })
      const r = await awaitCiRun(port, baseOpts(c))
      expect(r.ok).toBe(ok)
      expect(r.conclusion).toBe(conclusion)
      expect(r.runId).toBe(4)
      if (!ok) expect(r.reason).toContain('success 이외는 통과로 보지 않습니다')
    })
  }
})

describe('gh 어댑터 인자 — 실제 스폰 없이 주입 spawn으로 관측', () => {
  function capture() {
    const calls: { cmd: string; args: string[] }[] = []
    let dispatchOut = JSON.stringify({ workflow_run_id: 11 })
    const spawn = ((cmd: string, args: string[]) => {
      calls.push({ cmd, args })
      if (args.includes('POST')) return dispatchOut
      return JSON.stringify({ id: 11, status: 'completed', conclusion: 'success', head_sha: HEAD })
    }) as never
    return { calls, spawn, setDispatchOut: (s: string) => (dispatchOut = s) }
  }

  it('return_run_details를 문자열(-f)이 아니라 타입 있는 값(-F)으로 보낸다', async () => {
    const { calls, spawn } = capture()
    await createGhCiRunAdapter('/tmp/x', spawn).dispatch('ci.yml', REF)
    const args = calls[0]?.args ?? []
    const i = args.indexOf('return_run_details=true')
    expect(i).toBeGreaterThan(0)
    expect(args[i - 1]).toBe('-F') // 🔴 -f 였다면 문자열 "true"라 GitHub이 무시한다
    expect(args).toContain(`ref=${REF}`)
    expect(args[args.indexOf(`ref=${REF}`) - 1]).toBe('-f')
  })

  it('Accept·X-GitHub-Api-Version 헤더를 명시한다(기본값에 맡기지 않는다)', async () => {
    const { calls, spawn } = capture()
    const adapter = createGhCiRunAdapter('/tmp/x', spawn)
    await adapter.dispatch('ci.yml', REF)
    await adapter.getRun(11)
    for (const call of calls) {
      expect(call.args).toContain(`Accept: ${GITHUB_ACCEPT}`)
      expect(call.args).toContain(`X-GitHub-Api-Version: ${GITHUB_API_VERSION}`)
    }
    expect(GITHUB_API_VERSION).toBe('2022-11-28')
  })

  it('dispatch 응답이 비면(204) 어댑터가 throw — 목록 추정으로 대체하지 않는다', async () => {
    const { spawn, setDispatchOut } = capture()
    setDispatchOut('')
    await expect(createGhCiRunAdapter('/tmp/x', spawn).dispatch('ci.yml', REF)).rejects.toThrow('204')
  })
})

describe('toRunInfo — 응답 필드 하강', () => {
  it('누락 필드는 빈 문자열로(정체 대조가 fail-closed 하게 읽는다)', () => {
    expect(toRunInfo({ id: 3 })).toEqual({
      id: 3,
      status: '',
      conclusion: null,
      created_at: '',
      head_sha: '',
      head_branch: '',
      event: '',
      path: '',
    })
  })
})

describe('ci.yml 계약과 어댑터가 같은 workflow 이름을 본다', () => {
  it('이 저장소 req.config.json의 githubCi.workflow 파일이 실재한다', () => {
    const root = join(__dirname, '..', '..')
    const cfg = JSON.parse(readFileSync(join(root, 'req.config.json'), 'utf8')) as { githubCi?: { workflow?: string } }
    expect(cfg.githubCi?.workflow).toBe('ci.yml')
    expect(readFileSync(join(root, '.github', 'workflows', 'ci.yml'), 'utf8')).toContain('workflow_dispatch')
  })
})

describe('config githubCi 축(설계 DEC-4)', () => {
  function repoWith(config: unknown): string {
    const dir = mkdtempSync(join(tmpdir(), 'cg-cfg-'))
    writeFileSync(join(dir, 'req.config.json'), JSON.stringify(config))
    return dir
  }

  it('미지정 → null(미구성)', () => {
    expect(loadConfig({ root: repoWith({}) }).githubCi).toBeNull()
  })

  it('workflow만 지정 → timeoutMinutes 기본 30', () => {
    const cfg = loadConfig({ root: repoWith({ githubCi: { workflow: 'ci.yml' } }) })
    expect(cfg.githubCi).toEqual({ workflow: 'ci.yml', timeoutMinutes: GITHUB_CI_TIMEOUT_MINUTES_DEFAULT })
  })

  it('timeoutMinutes 지정 보존·범위 밖은 스키마 거부', () => {
    expect(loadConfig({ root: repoWith({ githubCi: { workflow: 'ci.yml', timeoutMinutes: 5 } }) }).githubCi).toEqual({
      workflow: 'ci.yml',
      timeoutMinutes: 5,
    })
    expect(() => loadConfig({ root: repoWith({ githubCi: { workflow: 'ci.yml', timeoutMinutes: 0 } }) })).toThrow('스키마')
    expect(() => loadConfig({ root: repoWith({ githubCi: { workflow: 'ci.yml', timeoutMinutes: 999 } }) })).toThrow('스키마')
  })

  it('workflow 부재·경로 문자·미지 키는 스키마 거부(fail-closed)', () => {
    expect(() => loadConfig({ root: repoWith({ githubCi: {} }) })).toThrow('스키마')
    expect(() => loadConfig({ root: repoWith({ githubCi: { workflow: '../evil.yml' } }) })).toThrow('스키마')
    expect(() => loadConfig({ root: repoWith({ githubCi: { workflow: 'a/b.yml' } }) })).toThrow('스키마')
    expect(() => loadConfig({ root: repoWith({ githubCi: { workflow: 'ci.yml', nope: 1 } }) })).toThrow('스키마')
  })
})
