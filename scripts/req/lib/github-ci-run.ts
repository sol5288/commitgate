/**
 * GitHub CI **실행**(workflow_dispatch) 포트 — REQ-2026-126 phase-1 · 0.22.0 RC 보완.
 *
 * 확정 정책: GitHub CI는 기본 실행하지 않는다. 이 모듈은 사용자가 **명시적으로** 실행을 요청했을 때만
 * 쓰이며(integrate `--run-github-ci` 또는 대화형 y), 다음 계약을 지킨다:
 *
 *  - **HEAD 결속**(설계 r01 P1): dispatch 전에 원격 브랜치 SHA == 병합할 로컬 HEAD를 대조하고,
 *    조회한 run의 `head_sha`도 같은 SHA여야 한다 — CI가 검사하지 않은 커밋을 green으로 오인하지 않는다.
 *    불일치는 push 안내와 함께 실패한다(자동 push 금지).
 *  - 🔴 **run은 추정하지 않는다**(0.22.0 RC 보완). dispatch 요청에 `return_run_details=true`를 실어
 *    **응답이 준 `workflow_run_id`만** 쓴다. 예전 구현은 dispatch 뒤 `created_at`·`head_sha`로 실행
 *    목록을 뒤져 이번 run을 **추측**했다 — 같은 SHA에서 동시 실행이 있으면 원리적으로 갈라진다.
 *    목록 추정 경로는 **삭제**했다(포트에 `listRuns` 자체가 없다 — fallback을 둘 자리가 없다).
 *    ID를 얻지 못하면 조용히 다른 방법으로 넘어가지 않고 **실패**한다.
 *  - **정체 대조**(`checkRunIdentity`): head_sha·event·head_branch, 그리고 응답에 있으면 workflow
 *    path까지 요청한 것과 같아야 한다. 폴링마다 확인한다(re-run 등으로 바뀌면 결속이 깨진 것).
 *  - **단일 시계**(설계 r02 P1): 출현 대기·완료 대기를 나누지 않는다 — 시작부터 `timeoutMinutes` 하나.
 *  - 🔴 **성공은 `success`뿐**(0.22.0 RC 보완). 명시 요청한 검사에서 `skipped`는 "요청했는데 실행되지
 *    않음"이고 `neutral`은 "판정 없음"이다 — 둘 다 green이 아니다. 이 축은 조회 축
 *    (`verify-range`의 `judgeCheckRunsPayload`)보다 **의도적으로 엄격하다**: 저쪽은 남이 만든 기존
 *    체크 묶음을 읽는 것이고, 이쪽은 우리가 방금 하나를 돌려 그 결과로 병합을 결정한다.
 *  - 감사 로그를 위해 run id·실제 conclusion을 결과에 보존한다(설계 r02 P1).
 *
 * 🔴 테스트는 fake 포트만 쓴다 — 실제 gh·git 스폰은 어댑터 팩토리에만 존재한다.
 *
 * 참고: `return_run_details`는 2026-02-19 GitHub 변경사항으로 추가된 **boolean** 파라미터다.
 * 주면 `200 OK` + `{workflow_run_id, run_url, html_url}`, 주지 않으면 종전대로 `204 No Content`다.
 * 그래서 gh 인자에서 문자열(`-f`)이 아니라 **타입 있는 값(`-F`)**으로 보내야 한다.
 * https://docs.github.com/en/rest/actions/workflows?apiVersion=2022-11-28
 */
import { safeSpawnSync, assertNotTestEnv } from './adapters'

/** dispatch 요청에 명시하는 API 버전 — 헤더를 생략하면 GitHub이 임의의 기본값을 고른다. */
export const GITHUB_API_VERSION = '2022-11-28'
export const GITHUB_ACCEPT = 'application/vnd.github+json'

/** workflow 파일이 사는 디렉터리. config의 `githubCi.workflow`는 스키마상 **파일명 하나**다. */
export const WORKFLOWS_DIR = '.github/workflows'

/** 요청한 workflow 파일명 → 대조할 정규 경로. `ci.yml` → `.github/workflows/ci.yml`. */
export function expectedWorkflowPath(workflow: string): string {
  return `${WORKFLOWS_DIR}/${workflow}`
}

/**
 * run 응답의 `path`를 대조 가능한 경로로 정규화한다.
 *
 * GitHub의 workflow-run 응답은 `path`에 **`@<ref>` 접미**를 붙여 오는 경우가 있다:
 *   `.github/workflows/ci.yml` · `.github/workflows/ci.yml@main` ·
 *   `.github/workflows/ci.yml@refs/heads/feat/x`
 *
 * 🔴 ref 부분은 여기서 **떼어낸다.** 어느 브랜치에서 돌았는지는 `head_branch` 축이 이미 따로
 *    검증하므로, 같은 사실을 두 곳에서 다르게 판정하지 않는다(경로 비교는 경로만 본다).
 * 🔴 `@`가 없으면 값 전체가 경로다 — 두 형태를 모두 받는다.
 */
export function normalizeWorkflowPath(path: string): string {
  const at = path.indexOf('@')
  return at === -1 ? path : path.slice(0, at)
}

export interface RunInfo {
  id: number
  status: string // 'queued' | 'in_progress' | 'completed' | ...
  conclusion: string | null // completed일 때 'success' | 'failure' | 'cancelled' | ...
  created_at: string // ISO
  head_sha: string
  /** 이 run이 돈 브랜치. dispatch는 브랜치 ref로만 하므로 비어 있으면 대조 실패다. */
  head_branch: string
  /** 'workflow_dispatch' 이어야 한다 — push/PR로 생긴 run을 우리 실행으로 읽지 않는다. */
  event: string
  /** '.github/workflows/ci.yml'. 빈 문자열 = 응답에 없었음(그때만 workflow 대조를 생략한다). */
  path: string
}

/** dispatch 응답(`return_run_details=true`) — 이번 실행의 **정확한** 식별자. */
export interface DispatchResult {
  runId: number
  runUrl?: string
  htmlUrl?: string
}

export interface GithubCiRunPort {
  /**
   * POST repos/{owner}/{repo}/actions/workflows/{workflow}/dispatches (return_run_details=true).
   * 🔴 run id를 반환하지 못하면 **throw** 한다 — 목록 추정으로 대체하지 않는다.
   */
  dispatch(workflow: string, ref: string): Promise<DispatchResult>
  getRun(id: number): Promise<RunInfo>
  /** `git ls-remote origin refs/heads/<ref>` — 원격 부재면 null. gh 아님(인증 축 분리). */
  remoteBranchSha(ref: string): Promise<string | null>
}

/** 감사 로그가 소비하는 결과(설계 r02 P1 — id·실제 conclusion 보존). */
export interface CiRunResult {
  ok: boolean
  /** 실패 사유(사람용 한 줄). ok=true면 null. */
  reason: string | null
  /** dispatch가 반환한 run id — dispatch 전/실패면 null. */
  runId: number | null
  /** 선택 run의 실제 conclusion — 미완료·미식별이면 null. */
  conclusion: string | null
  /** 사람이 열어볼 run URL(있으면). */
  runHtmlUrl: string | null
}

export interface AwaitCiRunOpts {
  workflow: string
  ref: string
  /** 병합할 로컬 HEAD — 원격 SHA·run head_sha와 대조한다. */
  expectedHeadSha: string
  timeoutMinutes: number
  now: () => number // epoch ms
  sleep: (ms: number) => Promise<void>
  /** 폴링 간격(ms). 기본 10초 — 테스트가 줄인다. */
  pollIntervalMs?: number
}

const fail = (
  reason: string,
  runId: number | null = null,
  conclusion: string | null = null,
  runHtmlUrl: string | null = null,
): CiRunResult => ({ ok: false, reason, runId, conclusion, runHtmlUrl })

/**
 * 명시 요청한 CI 실행의 성공 판정. **`success`만 성공이다.**
 *
 * 🔴 `skipped`·`neutral`을 넣지 않는다. 사람이 "이 커밋을 CI로 검사해 달라"고 지시했는데 잡이
 *    건너뛰어졌거나 판정을 내지 않았다면, 얻은 것은 "green"이 아니라 "검사가 없었다"이다.
 *    넓히려면 문서·설정·테스트에 왜 그것이 검사로 셈해지는지 함께 적을 것.
 */
export function isExplicitRunSuccess(conclusion: string | null): boolean {
  return conclusion === 'success'
}

/**
 * dispatch 응답 본문 → `DispatchResult`(순수). 유효한 양의 정수 id가 없으면 throw 한다.
 *
 * 🔴 본문이 비어 있는 경우(`204 No Content`)가 가장 흔한 실패다 — `return_run_details`를 지원하지
 *    않는 구형 API/gh다. 그때 목록 추정으로 **되돌아가지 않는다**: 정확한 결속을 포기하는 순간
 *    "검사한 커밋"과 "병합할 커밋"이 갈라질 수 있고, 그것이 이 모듈의 존재 이유다.
 */
export function parseDispatchResponse(raw: string): DispatchResult {
  const body = raw.trim()
  if (body === '')
    throw new Error(
      'dispatch 응답이 비어 있습니다(204: run 정보 없음) — 이 엔드포인트가 return_run_details 를 지원하지 않는 ' +
        'GitHub API 버전/서버(GitHub Enterprise Server 등)일 수 있습니다. ' +
        `확인할 것: 대상 서버가 이 기능을 지원하는지 · 요청한 API 버전(X-GitHub-Api-Version: ${GITHUB_API_VERSION})이 맞는지 · gh 버전. ` +
        'CommitGate는 여기서 run 을 목록으로 추정하지 않고 중단합니다(fail-closed)',
    )
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    throw new Error('dispatch 응답을 JSON으로 파싱할 수 없습니다')
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('dispatch 응답이 객체가 아닙니다')
  const r = parsed as Record<string, unknown>
  const id = r.workflow_run_id
  if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0)
    throw new Error(`dispatch 응답의 workflow_run_id 가 유효한 양의 정수가 아닙니다: ${JSON.stringify(id)}`)
  const out: DispatchResult = { runId: id }
  if (typeof r.run_url === 'string' && r.run_url !== '') out.runUrl = r.run_url
  if (typeof r.html_url === 'string' && r.html_url !== '') out.htmlUrl = r.html_url
  return out
}

/**
 * 조회한 run이 **우리가 요청한 그 실행**인지 대조한다(순수). 문제가 없으면 null.
 *
 * workflow 대조는 응답의 `path`가 있을 때만 한다 — 없을 때 통과시키는 것은 관대함이 아니라
 * "대조할 입력이 없다"는 사실의 반영이다(head_sha·event·branch 세 축은 그대로 강제된다).
 */
export function checkRunIdentity(run: RunInfo, want: { headSha: string; ref: string; workflow: string }): string | null {
  if (run.head_sha !== want.headSha)
    return `run #${run.id} head_sha(${run.head_sha.slice(0, 8) || '(없음)'})가 검증한 HEAD(${want.headSha.slice(0, 8)})와 다릅니다`
  if (run.event !== 'workflow_dispatch') return `run #${run.id} event가 workflow_dispatch가 아닙니다: ${run.event || '(없음)'}`
  if (run.head_branch !== want.ref) return `run #${run.id} 브랜치(${run.head_branch || '(없음)'})가 요청한 ${want.ref}와 다릅니다`
  if (run.path !== '') {
    // 🔴 **basename만 비교하지 않는다.** 그러면 `other/ci.yml`·`.github/other/ci.yml`·
    //    `.github/workflows/subdir/ci.yml` 처럼 이름만 같은 다른 파일이 전부 통과한다.
    //    전체 경로를 정규 형태로 맞춰 비교한다(`@<ref>` 접미만 제거).
    const actual = normalizeWorkflowPath(run.path)
    const expected = expectedWorkflowPath(want.workflow)
    if (actual !== expected) return `run #${run.id} workflow 경로(${run.path})가 요청한 ${expected}와 다릅니다`
  }
  return null
}

/**
 * dispatch → 반환된 id로 완료 대기(단일 시계). 폴링 중 포트 오류는 실패로 표시한다(명시 요청한
 * 확인이므로 조용히 넘어가지 않는다).
 */
export async function awaitCiRun(port: GithubCiRunPort, opts: AwaitCiRunOpts): Promise<CiRunResult> {
  const { workflow, ref, expectedHeadSha } = opts
  const pollMs = opts.pollIntervalMs ?? 10_000

  // 1. HEAD 결속 — 원격 브랜치 SHA == 로컬 HEAD (자동 push 금지 — 안내만).
  let remoteSha: string | null
  try {
    remoteSha = await port.remoteBranchSha(ref)
  } catch (err) {
    return fail(`원격 브랜치 조회 실패: ${msg(err)}`)
  }
  if (remoteSha === null)
    return fail(`원격에 브랜치가 없습니다: ${ref} — CommitGate는 자동 push 하지 않습니다. 직접 push 후 다시 시도하세요`)
  if (remoteSha !== expectedHeadSha)
    return fail(
      `원격 ${ref} (${remoteSha.slice(0, 8)}) 이 병합할 로컬 HEAD(${expectedHeadSha.slice(0, 8)})와 다릅니다 — ` +
        'CI가 검사할 커밋과 병합할 커밋이 달라집니다. push 후 다시 시도하세요(자동 push 없음)',
    )

  // 2. 단일 시계의 기점(설계 r02 P1) — dispatch 이전에 잡는다.
  const deadline = opts.now() + opts.timeoutMinutes * 60_000

  // 3. dispatch — 이번 run의 id를 **응답에서** 받는다. 실패는 곧 실행 실패다(추정 없음).
  let dispatched: DispatchResult
  try {
    dispatched = await port.dispatch(workflow, ref)
  } catch (err) {
    return fail(`workflow_dispatch 실패(workflow_dispatch 미지원·권한·인증·구형 API 포함): ${msg(err)}`)
  }
  const runId = dispatched.runId
  if (!Number.isInteger(runId) || runId <= 0) return fail(`dispatch가 유효한 run id를 반환하지 않았습니다: ${JSON.stringify(dispatched.runId)}`)
  const htmlUrl = dispatched.htmlUrl ?? null

  // 4. 완료 대기 — 매 폴링마다 정체를 대조한다.
  for (;;) {
    let run: RunInfo
    try {
      run = await port.getRun(runId)
    } catch (err) {
      return fail(`run 상태 조회 실패: ${msg(err)}`, runId, null, htmlUrl)
    }
    const mismatch = checkRunIdentity(run, { headSha: expectedHeadSha, ref, workflow })
    if (mismatch !== null) return fail(mismatch, runId, run.conclusion, htmlUrl)
    if (run.status === 'completed') {
      if (isExplicitRunSuccess(run.conclusion)) return { ok: true, reason: null, runId, conclusion: run.conclusion, runHtmlUrl: htmlUrl }
      return fail(
        `run #${runId} 결과: ${run.conclusion ?? '(없음)'} — 명시 요청한 CI에서 success 이외는 통과로 보지 않습니다`,
        runId,
        run.conclusion,
        htmlUrl,
      )
    }
    if (opts.now() >= deadline) return fail(`timeout(${opts.timeoutMinutes}분) — run #${runId} 미완료(${run.status})`, runId, run.conclusion, htmlUrl)
    await opts.sleep(pollMs)
  }
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// ───────────────────────────────── 실제 어댑터(테스트 금지 — fake 주입) ──

/**
 * gh CLI + git ls-remote 어댑터. 🔴 테스트에서 이 팩토리를 쓰지 않는다 — 실호출이다.
 * gh api 응답의 민감 본문은 다루지 않는다(run 메타데이터만).
 */
export function createGhCiRunAdapter(cwd: string, spawn: typeof safeSpawnSync = safeSpawnSync): GithubCiRunPort {
  // kill switch는 기본(실제) spawn일 때만 — 주입 spawn은 테스트 seam이다(REQ-2026-130).
  const isRealSpawn = spawn === safeSpawnSync
  const apiHeaders = ['-H', `Accept: ${GITHUB_ACCEPT}`, '-H', `X-GitHub-Api-Version: ${GITHUB_API_VERSION}`]
  return {
    async dispatch(workflow: string, ref: string): Promise<DispatchResult> {
      if (isRealSpawn) assertNotTestEnv('gh(workflow_dispatch)')
      const out = spawn(
        'gh',
        [
          'api',
          '-X',
          'POST',
          ...apiHeaders,
          `repos/{owner}/{repo}/actions/workflows/${workflow}/dispatches`,
          '-f',
          `ref=${ref}`,
          // 🔴 `-F` = 타입 있는 값(boolean true). `-f` 였다면 문자열 "true"라 무시된다.
          '-F',
          'return_run_details=true',
        ],
        { cwd },
      )
      return parseDispatchResponse(out)
    },
    async getRun(id: number): Promise<RunInfo> {
      if (isRealSpawn) assertNotTestEnv('gh(run 상태 조회)')
      return toRunInfo(JSON.parse(spawn('gh', ['api', ...apiHeaders, `repos/{owner}/{repo}/actions/runs/${id}`], { cwd })))
    },
    async remoteBranchSha(ref: string): Promise<string | null> {
      if (isRealSpawn) assertNotTestEnv('git ls-remote(원격 조회)')
      const out = spawn('git', ['ls-remote', 'origin', `refs/heads/${ref}`], { cwd }).trim()
      if (out === '') return null
      const sha = out.split(/\s+/)[0]
      return sha && /^[0-9a-f]{40}$/.test(sha) ? sha : null
    },
  }
}

export function toRunInfo(raw: unknown): RunInfo {
  const r = (raw ?? {}) as Record<string, unknown>
  return {
    id: Number(r.id),
    status: String(r.status ?? ''),
    conclusion: r.conclusion === null || r.conclusion === undefined ? null : String(r.conclusion),
    created_at: String(r.created_at ?? ''),
    head_sha: String(r.head_sha ?? ''),
    head_branch: String(r.head_branch ?? ''),
    event: String(r.event ?? ''),
    path: String(r.path ?? ''),
  }
}

// ───────────────────────────────── fake(테스트 전용) ──

export interface FakeCiRunScript {
  remoteSha: string | null
  dispatchError?: string
  /** dispatch 응답. 미지정이면 runId 1. */
  dispatchResult?: DispatchResult
  /** getRun이 호출될 때마다 순서대로 반환(마지막 요소 반복). */
  runStates?: RunInfo[]
  /** 지정하면 getRun이 이 메시지로 throw 한다. */
  getRunError?: string
}

export function createFakeCiRunPort(script: FakeCiRunScript): GithubCiRunPort & {
  calls: { method: string; args: unknown[] }[]
} {
  const calls: { method: string; args: unknown[] }[] = []
  let getI = 0
  return {
    calls,
    async dispatch(workflow, ref) {
      calls.push({ method: 'dispatch', args: [workflow, ref] })
      if (script.dispatchError !== undefined) throw new Error(script.dispatchError)
      return script.dispatchResult ?? { runId: 1 }
    },
    async getRun(id) {
      calls.push({ method: 'getRun', args: [id] })
      if (script.getRunError !== undefined) throw new Error(script.getRunError)
      const states = script.runStates ?? []
      const st = states[Math.min(getI, states.length - 1)]
      getI++
      if (st === undefined) throw new Error('fake: runStates 미지정')
      return st
    },
    async remoteBranchSha(ref) {
      calls.push({ method: 'remoteBranchSha', args: [ref] })
      return script.remoteSha
    },
  }
}
