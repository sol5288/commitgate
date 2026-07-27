#!/usr/bin/env tsx
/**
 * req:confirm — HIGH 위험 티켓의 **사람 확인을 기록**한다 (REQ-2026-071 DEC-3).
 *
 * **왜 필요한가**: 지금까지 `user_commit_confirmed`를 넣는 방법은 **`state.json` 손편집**뿐이었다.
 * 🔴 그것이 REQ-2026-019가 폐기된 표면과 같다 — 시각을 사람이 적어 넣으면 **지어낼 수 있다.**
 *    이 명령은 시각을 **실제 시계에서 읽어** 그 표면을 없앤다.
 *
 * 🔴 **범위(`scope`)는 크기 순서가 아니라 진술이다.** `stopGate`가 요구하는 것과 **정확히 일치**해야
 *    게이트를 통과한다 — "넓으면 통과"로 두면 `phase`가 보장하려던 "매 phase 신선한 확인"이 사라진다.
 *
 * 🔴 **넓은 범위는 아직 없는 변경까지 미리 승인한다.** 그 사실을 출력이 명시한다 — 사용자가 모른 채
 *    승인하면 안 된다.
 *
 * 사용: req:confirm <REQ> --scope phase|req|delivery --method "<승인 문장>" [--note "<메모>"] [--run]
 */
import { pathToFileURL } from 'node:url'
import { join, relative } from 'node:path'
import { loadConfig } from './lib/config'
import { createGitAdapter } from './lib/adapters'
import { assertSetupComplete } from './lib/setup-gate'
import { commitStateCheckpoint } from './lib/state-checkpoint'
import { REQUIRED_CONFIRM_SCOPE, userConfirmProblem, type ConfirmScope, type UserCommitConfirmed } from './lib/evidence'
import { loadState, writeState, type WorkflowState } from './review-codex'

export const CONFIRM_SCOPES: readonly ConfirmScope[] = ['phase', 'req', 'delivery']

export interface Opts {
  reqId: string | null
  scope: ConfirmScope | null
  method: string | null
  note: string | null
  root: string | null
  run: boolean
}

/** 인자 파싱(fail-closed). 값 자리에 온 옵션을 값으로 삼키지 않는다(REQ-2026-061 r01 P1과 같은 함정). */
export function parseArgs(argv: string[]): Opts {
  const o: Opts = { reqId: null, scope: null, method: null, note: null, root: null, run: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === undefined || a === '--') continue
    if (a === '--run') o.run = true
    else if (a === '--scope') {
      const v = argv[++i]
      if (v === undefined || !(CONFIRM_SCOPES as readonly string[]).includes(v))
        throw new Error(`--scope 는 ${CONFIRM_SCOPES.join('|')} 중 하나여야 합니다 (받음: ${v ?? '(없음)'})`)
      o.scope = v as ConfirmScope
    } else if (a === '--method' || a === '--note') {
      // 승인 문장·메모는 `-`로 시작할 수도 있으므로 접두 검사를 하지 않는다(값 부재만 거부).
      const v = argv[++i]
      if (v === undefined) throw new Error(`${a} 값이 필요합니다`)
      if (a === '--method') o.method = v
      else o.note = v
    } else if (a === '--root') {
      const v = argv[++i]
      if (v === undefined || v.startsWith('-')) throw new Error(`--root 에 경로가 필요합니다 (받음: ${v ?? '(없음)'})`)
      o.root = v
    } else if (a.startsWith('-')) throw new Error(`알 수 없는 옵션: ${a}`)
    else o.reqId = a
  }
  return o
}

/**
 * 넓은 범위가 무엇을 뜻하는지(순수). 🔴 이 문장이 없으면 사용자는 "지금 이 변경만 승인했다"고 믿는다.
 */
export function scopeMeaning(scope: ConfirmScope): string {
  switch (scope) {
    case 'phase':
      return '이 phase 커밋 하나를 승인합니다(다음 phase는 다시 확인합니다).'
    case 'req':
      return '🔴 이 REQ의 **남은 phase 전부**를 미리 승인합니다 — 아직 작성되지 않은 변경까지 포함합니다.'
    case 'delivery':
      return '🔴 이 묶음(delivery set)의 **남은 REQ 전부**를 미리 승인합니다 — 아직 작성되지 않은 변경까지 포함합니다.'
  }
}

/** 기록할 확인(순수 — 시각은 주입). `now`가 주입 seam인 이유는 테스트를 위해서지 값을 지어내기 위해서가 아니다. */
export function buildConfirm(args: { scope: ConfirmScope; method: string; note: string | null; nowIso: string }): UserCommitConfirmed {
  return {
    confirmed: true,
    method: args.method,
    confirmed_at: args.nowIso,
    ...(args.note ? { note: args.note } : {}),
    scope: args.scope,
  }
}

export interface Deps {
  now: () => string
  log: (m: string) => void
}

const defaultDeps: Deps = { now: () => new Date().toISOString(), log: (m) => console.log(m) }

export function main(argv: string[] = process.argv.slice(2), deps: Deps = defaultDeps): void {
  const o = parseArgs(argv)
  // 🔴 setup 완료 게이트 — 다른 state 변경 verb와 동일하게 가장 앞이다.
  assertSetupComplete({ root: o.root })
  if (!o.reqId) throw new Error('REQ 필요 (예: req:confirm 2026-071 --scope req --method "<승인 문장>" --run)')
  if (!o.scope) throw new Error(`--scope ${CONFIRM_SCOPES.join('|')} 필요`)
  if (!o.method || o.method.trim() === '')
    throw new Error('--method "<승인 문장>" 필요 — 무엇을 근거로 승인했는지가 감사 기록의 내용입니다.')

  const cfg = loadConfig({ root: o.root })
  const reqId = o.reqId.startsWith('REQ-') ? o.reqId : `REQ-${o.reqId}`
  const ticketDir = join(cfg.workflowDirAbs, reqId)
  const ticketRel = relative(cfg.root, ticketDir).replace(/\\/g, '/')
  const state = loadState(ticketDir)

  const required = REQUIRED_CONFIRM_SCOPE[cfg.stopGate]
  deps.log(`[req:confirm] ${reqId} · risk=${String(state.risk_level)} · stopGate="${cfg.stopGate}"(요구 scope="${required}")`)
  deps.log(`  ${scopeMeaning(o.scope)}`)
  /**
   * 🔴 **불일치를 거부한다**(설계 r05 P1). 경고만 하면 사용자는 성공·checkpoint 를 받고서 나중에
   *    종결 지점에서 막힌다 — 그 사이의 기록은 아무것도 통과시키지 못하는 쓸모없는 커밋이다.
   *    "설정을 곧 바꿀 것"이라면 설정을 **먼저** 바꾸면 된다.
   */
  if (o.scope !== required)
    throw new Error(
      [
        `현재 stopGate="${cfg.stopGate}" 는 scope="${required}" 확인을 요구합니다(받은 값: "${o.scope}").`,
        '  범위는 크기 순서가 아니라 무엇을 승인했는지에 대한 진술이라, 다른 범위의 기록은 게이트를 통과하지 못합니다.',
        '  이 값으로 기록하려면 먼저 req.config.json 의 stopGate 를 바꾸세요.',
      ].join('\n'),
    )

  if (!o.run) {
    deps.log('[req:confirm] DRY-RUN — write 없음(--run 시 기록).')
    return
  }

  // 🔴 시각은 **실제 시계**. 손기록을 대체하는 것이 이 명령의 존재 이유다(REQ-2026-019 폐기 사유).
  const confirm = buildConfirm({ scope: o.scope, method: o.method, note: o.note, nowIso: deps.now() })
  const problem = userConfirmProblem(confirm)
  if (problem) throw new Error(`확인 기록 형식 오류(내부): ${problem}`)

  const next: WorkflowState = { ...state, user_commit_confirmed: confirm }
  writeState(ticketDir, next)
  const git = createGitAdapter(cfg.root)
  commitStateCheckpoint({
    root: cfg.root,
    ticketRel,
    ticketId: reqId,
    state: next,
    reason: `사람 확인 기록(scope=${o.scope})`,
    gitFn: (args) => git.exec(args),
  })
  deps.log(`[req:confirm] ✅ 기록 — scope=${o.scope} · ${confirm.confirmed_at}`)
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  try {
    main()
  } catch (err) {
    console.error(`req:confirm: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  }
}
