#!/usr/bin/env tsx
/**
 * req:repolicy — 티켓에 고정된 **정지 정책 스냅샷**을 현재 `req.config.json` 값으로 채택한다
 * (REQ-2026-129 DEC-4).
 *
 * **왜 필요한가**: 스냅샷은 "티켓 하나가 여러 정책으로 진행되는 것"을 막지만, 그것만 두면 정책을 바꾼
 * 사용자의 **진행 중 티켓이 영구히 옛 정책에 갇힌다**. 이 저장소는 탈출구 없는 게이트가 교착을 만든다는
 * 것을 이미 두 번 겪었다(REQ-2026-072 낡은 종결 술어 · REQ-2026-093 `--abandon`). 그래서 스냅샷과
 * 채택 경로는 **같은 릴리스**에 있어야 한다.
 *
 * 🔴 **게이트 우회가 아니다.** 바꾸는 것은 "어디서 멈추는가"뿐이고 이미 기록된 확인은 지우지 않는다.
 *    좁은 정책으로 바꾸면 남은 지점에서 더 자주 멈추고, 넓은 정책으로 바꾸면 그 범위의 확인을
 *    새로 요구받는다(scope 정확일치 규칙이 그대로 적용된다).
 *
 * 🔴 채택 이력은 **append-only**이고 `at`은 **실제 시계**에서 읽는다 — 시각을 사람이 적어 넣는 표면을
 *    만들지 않는다(REQ-2026-019 폐기 사유).
 *
 * 사용: req:repolicy <REQ> [--reason "<왜 바꾸는가>"] [--run]
 */
import { join, relative } from 'node:path'
import { loadConfig, effectiveStopGate, isStopGate, type PolicyAdoption, type PolicySnapshot, type StopGate } from './lib/config'
import { createGitAdapter } from './lib/adapters'
import { assertSetupComplete } from './lib/setup-gate'
import { commitStateCheckpoint } from './lib/state-checkpoint'
import { inRecoveryWindow, recoveryWindowProblem } from './lib/recovery-window'
import { loadState, writeState, type WorkflowState } from './review-codex'
import { makeRunCli, isEntrypoint, readFreeTextValue } from './lib/cli-boundary'

export interface Opts {
  reqId: string | null
  reason: string | null
  root: string | null
  run: boolean
}

/** 이 CLI가 해석하는 옵션 이름 — 자유 텍스트 값 자리에서 이 중 하나가 오면 값 누락으로 본다. */
export const KNOWN_OPTIONS = ['--run', '--reason', '--root'] as const

/** 인자 파싱(fail-closed). 값 자리에 온 **알려진 옵션**을 값으로 삼키지 않는다. */
export function parseArgs(argv: string[]): Opts {
  const o: Opts = { reqId: null, reason: null, root: null, run: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === undefined || a === '--') continue
    if (a === '--run') o.run = true
    else if (a === '--reason') {
      // 사유는 `-`로 시작할 수 있으므로 접두 검사를 하지 않되, 알려진 옵션은 거부한다.
      o.reason = readFreeTextValue(argv, ++i, '--reason', KNOWN_OPTIONS)
    } else if (a === '--root') {
      const v = argv[++i]
      if (v === undefined || v.startsWith('-')) throw new Error(`--root 에 경로가 필요합니다 (받음: ${v ?? '(없음)'})`)
      o.root = v
    } else if (a.startsWith('-')) throw new Error(`알 수 없는 옵션: ${a}`)
    else o.reqId = a
  }
  return o
}

/** 스냅샷이 **유효하게** 존재하는가(손상값은 부재와 같게 취급 — `effectiveStopGate`와 같은 기준). */
export function hasValidSnapshot(state: { policy_snapshot?: unknown }): boolean {
  const snap = state.policy_snapshot
  if (!snap || typeof snap !== 'object') return false
  return isStopGate((snap as { stop_gate?: unknown }).stop_gate)
}

/** 기존 채택 이력(형태가 아니면 빈 배열 — 이력을 잃지 않되 손상값을 이어붙이지 않는다). */
export function existingAdoptions(state: { policy_snapshot?: unknown }): PolicyAdoption[] {
  const snap = state.policy_snapshot
  if (!snap || typeof snap !== 'object') return []
  const a = (snap as { adopted?: unknown }).adopted
  return Array.isArray(a) ? (a as PolicyAdoption[]) : []
}

export type Plan =
  | { kind: 'noop'; current: StopGate }
  | { kind: 'pin'; current: StopGate; target: StopGate }
  | { kind: 'adopt'; current: StopGate; target: StopGate }

/**
 * 무엇을 할지 정한다(순수).
 * - `noop` : 스냅샷이 있고 config 와 같다 — 채택할 것이 없다.
 * - `pin`  : 스냅샷이 없다(legacy·손상) — 현재 config 를 고정한다.
 * - `adopt`: 스냅샷이 config 와 다르다 — 새 값으로 바꾼다.
 */
export function planRepolicy(state: WorkflowState, cfgStopGate: StopGate): Plan {
  const current = effectiveStopGate(state, { stopGate: cfgStopGate })
  if (!hasValidSnapshot(state)) return { kind: 'pin', current, target: cfgStopGate }
  if (current === cfgStopGate) return { kind: 'noop', current }
  return { kind: 'adopt', current, target: cfgStopGate }
}

/** 채택 후 스냅샷(순수 — 시각은 주입). append-only. */
export function nextSnapshot(state: WorkflowState, plan: Plan, nowIso: string, reason: string | null): PolicySnapshot {
  if (plan.kind === 'noop') throw new Error('noop 은 기록하지 않습니다(내부 오류)')
  const entry: PolicyAdoption = {
    from: plan.current,
    to: plan.target,
    at: nowIso,
    ...(reason ? { reason } : {}),
  }
  return { stop_gate: plan.target, adopted: [...existingAdoptions(state), entry] }
}

export interface Deps {
  now: () => string
  log: (m: string) => void
}

const defaultDeps: Deps = { now: () => new Date().toISOString(), log: (m) => console.log(m) }

export function main(argv: string[] = process.argv.slice(2), deps: Deps = defaultDeps): void {
  const o = parseArgs(argv)
  // setup 완료 게이트 — 다른 state 변경 verb 와 동일하게 가장 앞이다.
  assertSetupComplete({ root: o.root })
  if (!o.reqId) throw new Error('REQ 필요 (예: req:repolicy 2026-129 --reason "정책 변경" --run)')

  const cfg = loadConfig({ root: o.root })
  const reqId = o.reqId.startsWith('REQ-') ? o.reqId : `REQ-${o.reqId}`
  const ticketDir = join(cfg.workflowDirAbs, reqId)
  const ticketRel = relative(cfg.root, ticketDir).replace(/\\/g, '/')
  const state = loadState(ticketDir)
  /**
   * 🔴 REQ-2026-154 DEC-2 / REQ-2026-155: **복구 창에서는 쓰지 않는다.**
   *
   * evidence 커밋 뒤·소비 checkpoint 전에 state 를 바꿔 checkpoint 커밋하면, 커밋된 증거의
   * `consumed_state_sha256` 결속이 깨지고 이후 `--finalize` 가 영구 차단된다(실측 재현).
   *
   * 🔴 **`loadState` 직후**여야 한다(phase-1 r03 P1). 아래 `noop` 조기 반환이 가드보다 앞에 있으면,
   *    정책이 이미 같은 티켓은 복구 창에서도 **성공으로 끝나고 `--finalize` 안내를 받지 못한다**.
   * 🔴 dry-run 은 막지 않는다 — `o.run` 을 함께 본다.
   */
  if (o.run && inRecoveryWindow(state)) throw new Error(recoveryWindowProblem(reqId, 'req:repolicy'))

  const plan = planRepolicy(state, cfg.stopGate)
  deps.log(`[req:repolicy] ${reqId} · 티켓 정책="${plan.current}" · req.config.json="${cfg.stopGate}"`)

  if (plan.kind === 'noop') {
    deps.log('  이미 일치합니다 — 채택할 것이 없습니다(state 를 쓰지 않습니다).')
    return
  }
  deps.log(
    plan.kind === 'pin'
      ? `  스냅샷이 없는 티켓입니다(legacy 또는 손상) — 현재 정책 "${plan.target}" 을 이 티켓에 고정합니다.`
      : `  정지 정책을 "${plan.current}" → "${plan.target}" 으로 채택합니다.`,
  )
  /**
   * 🔴 무엇이 바뀌고 무엇이 안 바뀌는지 말한다. 사용자가 "확인이 없어졌다"고 오해하면 안 된다.
   */
  deps.log('  🔴 이미 기록된 사람 확인은 지워지지 않습니다 — 새 정책이 요구하는 scope 와 다르면 그 지점에서 다시 요구됩니다.')

  if (!o.run) {
    deps.log('[req:repolicy] DRY-RUN — write 없음(--run 시 기록).')
    return
  }
  // 🔴 시각은 **실제 시계**. 채택 이력은 append-only 다.
  const snapshot = nextSnapshot(state, plan, deps.now(), o.reason)
  const next: WorkflowState = { ...state, policy_snapshot: snapshot }
  writeState(ticketDir, next)
  const git = createGitAdapter(cfg.root)
  commitStateCheckpoint({
    root: cfg.root,
    ticketRel,
    ticketId: reqId,
    state: next,
    reason: `정지 정책 채택(${plan.current}→${plan.target})`,
    gitFn: (args) => git.exec(args),
  })
  deps.log(`[req:repolicy] ✅ 채택 — stop_gate="${snapshot.stop_gate}" · ${snapshot.adopted?.at(-1)?.at}`)
}

/** bin dispatch 진입점(친절한 1줄 오류 + exit 1 경계). */
export const runCli = makeRunCli(main)

const isMain = isEntrypoint(import.meta.url)
if (isMain) runCli(process.argv.slice(2))
