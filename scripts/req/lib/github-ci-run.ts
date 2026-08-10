/**
 * GitHub CI **실행**(workflow_dispatch) 포트 — REQ-2026-126 phase-1.
 *
 * 확정 정책: GitHub CI는 기본 실행하지 않는다. 이 모듈은 사용자가 **명시적으로** 실행을 요청했을 때만
 * 쓰이며(integrate `--run-github-ci` 또는 대화형 y), 다음 계약을 지킨다:
 *
 *  - **HEAD 결속**(설계 r01 P1): dispatch 전에 원격 브랜치 SHA == 병합할 로컬 HEAD를 대조하고,
 *    후보 run의 `head_sha`도 같은 SHA여야 한다 — CI가 검사하지 않은 커밋을 green으로 오인하지 않는다.
 *    불일치는 push 안내와 함께 실패한다(자동 push 금지).
 *  - **오연결 금지**: 후보는 같은 workflow·ref·`event=workflow_dispatch`·`created_at >= T`·
 *    `head_sha` 일치로만 좁히고, 그래도 2개 이상이면 식별 불가로 **실패**한다(가장 이른 것을 고르지 않는다).
 *  - **T는 dispatch 이전에 기록**(설계 r03 P1): dispatch가 즉시 run을 만들어도 `created_at >= T`.
 *  - **단일 시계**(설계 r02 P1): 출현 대기·완료 대기를 나누지 않는다 — T부터 `timeoutMinutes` 하나.
 *  - 감사 로그를 위해 선택 run의 id·실제 conclusion을 결과에 보존한다(설계 r02 P1).
 *
 * 🔴 테스트는 fake 포트만 쓴다 — 실제 gh·git 스폰은 어댑터 팩토리에만 존재한다.
 */
import { safeSpawnSync, assertNotTestEnv } from './adapters'

export interface RunInfo {
  id: number
  status: string // 'queued' | 'in_progress' | 'completed' | ...
  conclusion: string | null // completed일 때 'success' | 'failure' | 'cancelled' | ...
  created_at: string // ISO
  head_sha: string
}

export interface GithubCiRunPort {
  /** POST repos/{owner}/{repo}/actions/workflows/{workflow}/dispatches — 실패는 throw. */
  dispatch(workflow: string, ref: string): Promise<void>
  /** event=workflow_dispatch · branch=ref · created>=createdSince 필터 조회. */
  listRuns(workflow: string, ref: string, createdSince: string): Promise<RunInfo[]>
  getRun(id: number): Promise<RunInfo>
  /** `git ls-remote origin refs/heads/<ref>` — 원격 부재면 null. gh 아님(인증 축 분리). */
  remoteBranchSha(ref: string): Promise<string | null>
}

/** 감사 로그가 소비하는 결과(설계 r02 P1 — id·실제 conclusion 보존). */
export interface CiRunResult {
  ok: boolean
  /** 실패 사유(사람용 한 줄). ok=true면 null. */
  reason: string | null
  /** 식별된 run id — 식별 전 실패면 null. */
  runId: number | null
  /** 선택 run의 실제 conclusion — 미완료·미식별이면 null. */
  conclusion: string | null
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

const fail = (reason: string, runId: number | null = null, conclusion: string | null = null): CiRunResult => ({
  ok: false,
  reason,
  runId,
  conclusion,
})

/** 성공 conclusion 판정 — verify-range 조회 축(judgeCheckRunsPayload)과 같은 허용값. */
export function isGreenConclusion(conclusion: string | null): boolean {
  return conclusion === 'success' || conclusion === 'neutral' || conclusion === 'skipped'
}

/**
 * dispatch → 식별 → 완료 대기(단일 시계). 폴링 중 포트 오류는 실패로 표시한다(명시 요청한 확인이므로
 * 조용히 넘어가지 않는다).
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
  if (remoteSha === null) return fail(`원격에 브랜치가 없습니다: ${ref} — CommitGate는 자동 push 하지 않습니다. 직접 push 후 다시 시도하세요`)
  if (remoteSha !== expectedHeadSha)
    return fail(
      `원격 ${ref} (${remoteSha.slice(0, 8)}) 이 병합할 로컬 HEAD(${expectedHeadSha.slice(0, 8)})와 다릅니다 — ` +
        'CI가 검사할 커밋과 병합할 커밋이 달라집니다. push 후 다시 시도하세요(자동 push 없음)',
    )

  // 2. T를 dispatch **이전에** 기록(설계 r03 P1) — 단일 시계의 기점이기도 하다.
  const startMs = opts.now()
  const createdSince = new Date(startMs).toISOString()
  const deadline = startMs + opts.timeoutMinutes * 60_000

  try {
    await port.dispatch(workflow, ref)
  } catch (err) {
    return fail(`workflow_dispatch 실패(workflow_dispatch 미지원·권한·인증 포함): ${msg(err)}`)
  }

  // 3. 식별 — 같은 T로만 조회한다. 후보 2개 이상은 오연결 대신 식별 불가 실패.
  let runId: number | null = null
  while (runId === null) {
    if (opts.now() >= deadline) return fail(`timeout(${opts.timeoutMinutes}분) — dispatch한 run이 나타나지 않았습니다`)
    let candidates: RunInfo[]
    try {
      candidates = await port.listRuns(workflow, ref, createdSince)
    } catch (err) {
      return fail(`run 조회 실패: ${msg(err)}`)
    }
    const mine = candidates.filter((r) => r.head_sha === expectedHeadSha && r.created_at >= createdSince)
    if (mine.length > 1) return fail(`dispatch 이후 같은 조건의 run이 ${mine.length}개 — 어느 것이 이번 실행인지 식별할 수 없습니다(오연결 방지)`)
    const first = mine[0]
    if (first !== undefined) {
      runId = first.id
      break
    }
    await opts.sleep(pollMs)
  }

  // 4. 완료 대기 — 같은 마감(단일 시계).
  for (;;) {
    let run: RunInfo
    try {
      run = await port.getRun(runId)
    } catch (err) {
      return fail(`run 상태 조회 실패: ${msg(err)}`, runId)
    }
    // 완료 판정 직전 head_sha 재확인(설계 — re-run 등으로 바뀌었으면 결속이 깨진 것).
    if (run.head_sha !== expectedHeadSha) return fail(`run #${runId} head_sha(${run.head_sha.slice(0, 8)})가 로컬 HEAD와 다릅니다`, runId, run.conclusion)
    if (run.status === 'completed') {
      if (isGreenConclusion(run.conclusion)) return { ok: true, reason: null, runId, conclusion: run.conclusion }
      return fail(`run #${runId} 결과: ${run.conclusion ?? '(없음)'}`, runId, run.conclusion)
    }
    if (opts.now() >= deadline) return fail(`timeout(${opts.timeoutMinutes}분) — run #${runId} 미완료(${run.status})`, runId, run.conclusion)
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
  return {
    async dispatch(workflow: string, ref: string): Promise<void> {
      if (isRealSpawn) assertNotTestEnv('gh(workflow_dispatch)')
      spawn('gh', ['api', '-X', 'POST', `repos/{owner}/{repo}/actions/workflows/${workflow}/dispatches`, '-f', `ref=${ref}`], { cwd })
    },
    async listRuns(workflow: string, ref: string, createdSince: string): Promise<RunInfo[]> {
      if (isRealSpawn) assertNotTestEnv('gh(run 조회)')
      const out = spawn(
        'gh',
        [
          'api',
          `repos/{owner}/{repo}/actions/workflows/${workflow}/runs?event=workflow_dispatch&branch=${encodeURIComponent(ref)}&created=%3E%3D${encodeURIComponent(createdSince)}&per_page=50`,
        ],
        { cwd },
      )
      const parsed = JSON.parse(out) as { workflow_runs?: unknown[] }
      return (parsed.workflow_runs ?? []).map(toRunInfo)
    },
    async getRun(id: number): Promise<RunInfo> {
      if (isRealSpawn) assertNotTestEnv('gh(run 상태 조회)')
      return toRunInfo(JSON.parse(spawn('gh', ['api', `repos/{owner}/{repo}/actions/runs/${id}`], { cwd })))
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

function toRunInfo(raw: unknown): RunInfo {
  const r = raw as Record<string, unknown>
  return {
    id: Number(r.id),
    status: String(r.status ?? ''),
    conclusion: r.conclusion === null || r.conclusion === undefined ? null : String(r.conclusion),
    created_at: String(r.created_at ?? ''),
    head_sha: String(r.head_sha ?? ''),
  }
}

// ───────────────────────────────── fake(테스트 전용) ──

export interface FakeCiRunScript {
  remoteSha: string | null
  dispatchError?: string
  /** listRuns가 호출될 때마다 순서대로 반환(마지막 요소 반복). */
  listBatches: RunInfo[][]
  /** getRun이 호출될 때마다 순서대로 반환(마지막 요소 반복). */
  runStates?: RunInfo[]
}

export function createFakeCiRunPort(script: FakeCiRunScript): GithubCiRunPort & {
  calls: { method: string; args: unknown[] }[]
} {
  const calls: { method: string; args: unknown[] }[] = []
  let listI = 0
  let getI = 0
  return {
    calls,
    async dispatch(workflow, ref) {
      calls.push({ method: 'dispatch', args: [workflow, ref] })
      if (script.dispatchError !== undefined) throw new Error(script.dispatchError)
    },
    async listRuns(workflow, ref, createdSince) {
      calls.push({ method: 'listRuns', args: [workflow, ref, createdSince] })
      const batch = script.listBatches[Math.min(listI, script.listBatches.length - 1)] ?? []
      listI++
      return batch
    },
    async getRun(id) {
      calls.push({ method: 'getRun', args: [id] })
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
