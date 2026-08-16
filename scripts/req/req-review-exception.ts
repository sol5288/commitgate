#!/usr/bin/env tsx
/**
 * req:review-exception — needs-exception 구간의 사람 예외를 **검증·원자 기록**한다(REQ-2026-055·DEC-RE).
 *
 * 지금까지 `state.json`의 `review_exception_confirmed`를 손으로 편집하던 것을 대체한다: 현재 예산이 실제
 * needs-exception인지·어느 series·회차인지 **소비 게이트와 같은 함수**로 계산하고, 구조화 rationale을 durable하게
 * 남긴 **뒤에만** 소비 가능한 state를 기록한다(부분 실패 시 rationale 없는 예외 방지).
 *
 * 🔴 durable 먼저(review-exceptions.jsonl 커밋) → state.json 마지막. 🔴 confirmed_at 실시계(날조 금지).
 * 🔴 소비 로직(consumeReviewException)·예산 게이트 무변경 — 이 명령은 **기록만** 한다.
 *
 * 사용: req:review-exception <REQ> --kind design|phase [--phase <id>] --method "<승인문장>" --rationale-file <path> [--run]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { loadConfig, packageRoot, type ReviewBudget } from './lib/config'
import { stateWriteBlockedReason, recoveryWindowProblem, buildCheckpointWindowFacts, type CheckpointWindowReason } from './lib/recovery-window'
import { createGitAdapter, type GitAdapter } from './lib/adapters'
import { assertSetupComplete } from './lib/setup-gate'
import { bookkeepingMessage } from './lib/bookkeeping'
import { humanDecisionProblem } from './lib/placeholders'
import { allShellSafe, quoteArg } from './lib/shell-safe'
import { commitStateCheckpoint } from './lib/state-checkpoint'
// 🔴 REQ-2026-147: `successorSlug` 는 leaf(`lib/nonconvergence`)로 내려갔다 — `review-codex` 가
//    써야 하는데 여기서 가져가면 런타임 순환이 된다. re-export 로 기존 호출부·테스트를 유지한다.
import { successorSlug } from './lib/nonconvergence'
// REQ-2026-163 DEC-4: orphan 판정의 정본. integrate·doctor 와 같은 술어를 쓴다.
import { orphanPhaseSeries } from './lib/review-series'
import { closeProofPath } from './lib/close-proof'
export { successorSlug }
import {
  loadState,
  writeState,
  openSeriesRecord,
  budgetCounts,
  checkReviewBudget,
  isSeriesKeyTerminal,
  closeSeriesHumanResolutionById,
  // REQ-2026-163: orphan 기록 종결(사람 결정이 아니라 도구가 검증한 사실).
  closeSeriesOrphaned,
  appendCloseProofRowToDisk,
  type WorkflowState,
  type ReviewKind,
  type ReviewExceptionConfirmed,
} from './review-codex'
import {
  exceptionsPath,
  appendExceptionGrant,
  findExistingGrant,
  parseRationale,
  type ExceptionGrantRow,
} from './lib/review-exception'
import { makeRunCli, isEntrypoint } from './lib/cli-boundary'
// REQ-2026-141: 열린 attempt 해소. 판정은 순수 모듈이 하고 여기서는 IO 만 한다.
import { ledgerPath, parseLedger } from './lib/review-ledger'
import { planStaleClose } from './lib/stale-attempt'
import { appendLedgerRowToDisk } from './review-codex'

let gitAdapter: GitAdapter = createGitAdapter(packageRoot())
function git(args: string[]): string {
  return gitAdapter.exec(args)
}

export interface Opts {
  reqId: string | null
  kind: ReviewKind | null
  phase: string | null
  method: string | null
  rationaleFile: string | null
  run: boolean
  root: string | null
  /**
   * REQ-2026-141: 닫히지 않은 attempt 를 버릴 대상 series. 지정하면 **예외 부여가 아니라 해소 모드**다.
   * 🔴 두 모드는 겹치지 않는다 — 예외 부여는 "한 번 더 돌린다", 해소는 "이 회차를 버린다" 다.
   */
  closeStale: string | null
  /**
   * REQ-2026-163: **orphan series 기록 종결** 모드의 대상 series_id.
   * 🔴 `--close-stale`(열린 attempt 버리기)·`--resolve`(사람의 대체 결정)와 **다른 축**이다 —
   *    이쪽은 "phase 가 `phases[]` 에서 사라졌다"는 **도구가 검증하는 사실**이다.
   */
  closeOrphan: string | null
  reason: string | null
  /**
   * REQ-2026-145: 사람의 **대체(replace) 결정** 기록 모드. 값은 `replace` 만 받는다.
   * 🔴 이 모드는 예외 부여·해소와 겹치지 않는다 — 예외 부여는 "한 번 더 돌린다", 해소는 "이 회차를
   *    버린다", 이쪽은 **"이 REQ 를 대체한다"** 다.
   */
  resolve: string | null
  /** `--resolve` 의 대상 series_id(원문 대조). */
  series: string | null
  /** 사람이 말한 승인 문장 그대로 → `HumanResolution.method`. */
  confirm: string | null
}

/** 인자 파싱(fail-closed): 값 누락·알 수 없는 옵션은 즉시 throw. */
export function parseArgs(argv: string[]): Opts {
  const o: Opts = {
    reqId: null,
    kind: null,
    phase: null,
    method: null,
    rationaleFile: null,
    run: false,
    root: null,
    closeStale: null,
    closeOrphan: null,
    reason: null,
    resolve: null,
    series: null,
    confirm: null,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === undefined) continue
    if (a === '--') continue
    else if (a === '--run') o.run = true
    else if (a === '--kind') {
      const v = argv[++i]
      if (v !== 'design' && v !== 'phase') throw new Error(`--kind 값은 design 또는 phase여야 함 (받음: ${v ?? '(없음)'})`)
      o.kind = v
    } else if (a === '--phase') {
      const v = argv[++i]
      if (v === undefined) throw new Error('--phase 값 필요')
      o.phase = v
    } else if (a === '--method') {
      const v = argv[++i]
      if (v === undefined) throw new Error('--method 값 필요')
      o.method = v
    } else if (a === '--close-orphan') {
      const v = argv[++i]
      if (v === undefined || v.startsWith('-')) throw new Error(`--close-orphan 에 series_id 가 필요합니다 (받음: ${v ?? '(없음)'})`)
      o.closeOrphan = v
    } else if (a === '--close-stale') {
      const v = argv[++i]
      if (v === undefined || v.startsWith('-')) throw new Error(`--close-stale 에 series_id 가 필요합니다 (받음: ${v ?? '(없음)'})`)
      o.closeStale = v
    } else if (a === '--reason') {
      // 사유는 `-`로 시작할 수 있어 접두 검사를 하지 않되, 값 누락은 거부한다.
      const v = argv[++i]
      if (v === undefined) throw new Error('--reason 값 필요')
      o.reason = v
    } else if (a === '--resolve') {
      const v = argv[++i]
      if (v === undefined || v.startsWith('-')) throw new Error(`--resolve 에 값이 필요합니다 (받음: ${v ?? '(없음)'})`)
      o.resolve = v
    } else if (a === '--series') {
      const v = argv[++i]
      if (v === undefined || v.startsWith('-')) throw new Error(`--series 에 series_id 가 필요합니다 (받음: ${v ?? '(없음)'})`)
      o.series = v
    } else if (a === '--confirm') {
      // 승인 문장은 `-`로 시작할 수 있어 접두 검사를 하지 않되, 값 누락은 거부한다(--reason 과 동형).
      const v = argv[++i]
      if (v === undefined) throw new Error('--confirm 값 필요')
      o.confirm = v
    } else if (a === '--rationale-file') {
      const v = argv[++i]
      if (v === undefined) throw new Error('--rationale-file 값 필요')
      o.rationaleFile = v
    } else if (a === '--root') {
      const v = argv[++i]
      if (v === undefined) throw new Error('--root 값 필요')
      o.root = v
    } else if (a.startsWith('-')) throw new Error(`알 수 없는 옵션: ${a}`)
    else o.reqId = a
  }
  return o
}

export type ReviewExceptionPlan =
  | { ok: true; seriesId: string; forAttempt: number }
  | { ok: false; reason: string; hint: string }

/**
 * 예외 부여 자격 판정(순수·DEC-RE1). 🔴 회차를 **소비 게이트와 같은 함수**(budgetCounts·checkReviewBudget)로
 * 계산 → consumeReviewException의 for_attempt 검증과 정확히 일치(REQ-2026-054 유효 회차 기준).
 * REQ-2026-084 DEC-7: 계수 출처가 `budgetCounts` 하나여야 부여-소비가 갈리지 않는다.
 */
export function planReviewException(state: WorkflowState, kind: ReviewKind, phaseId: string | null, budget: ReviewBudget): ReviewExceptionPlan {
  if (isSeriesKeyTerminal(state, kind, phaseId))
    return { ok: false, reason: '이 series는 human-resolution으로 종결됨', hint: '예산 예외가 아니라 대체 REQ가 필요(req:new --successor-of)' }
  const open = openSeriesRecord(state, kind, phaseId)
  if (!open) return { ok: false, reason: '열린 series가 없음 — 예외 걸 대상이 없다', hint: '먼저 req:review-codex로 리뷰를 시작하세요' }
  const counts = budgetCounts(state, kind, phaseId)
  const decision = checkReviewBudget(counts, budget)
  if (decision.kind === 'allow')
    return { ok: false, reason: `아직 예외 불요(판정 회차 ${counts.productive} < autoBudget ${budget.autoBudget})`, hint: '그냥 req:review-codex로 리뷰하세요' }
  if (decision.kind === 'hard-blocked')
    return { ok: false, reason: `예산 소진 — 예외로도 불가(hardCap ${budget.hardCap})`, hint: '종료하거나 정합한 대체 REQ를 작성하세요' }
  /**
   * 🔴 REQ-2026-132 DEC-4b: `onSoftLimit: "auto"` 에서는 6~8회차가 사람 승인 **없이** 진행된다.
   *    여기서 예외를 부여하면 도구가 스스로 "auto 는 사람 승인을 만들지 않는다"를 어긴다 —
   *    쓰이지도 않을 사람 승인 기록만 남는다.
   */
  if (decision.kind === 'soft-auto')
    return {
      ok: false,
      reason: `이 설정(reviewBudget.onSoftLimit: "auto")에서는 ${decision.attempt}회차가 사람 승인 없이 진행됩니다 — 부여할 예외가 없습니다`,
      hint: '사람 승인을 요구하려면 req.config.json 의 reviewBudget.onSoftLimit 를 "ask" 로 바꾸세요',
    }
  return { ok: true, seriesId: open.series_id, forAttempt: decision.attempt }
}

export function main(argv: string[] = process.argv.slice(2)): void {
  const o = parseArgs(argv)
  // 🔴 setup 완료 게이트(REQ-2026-062 DEC-6) — **가장 앞**이다. 다른 어떤 IO·판정보다 먼저여야 부분 상태가 남지 않는다.
  assertSetupComplete({ root: o.root })
  if (!o.reqId) throw new Error('REQ 필요 (예: req:review-exception 2026-001 --kind design --method "…" --rationale-file r.md)')
  /**
   * 🔴 REQ-2026-155 DEC-1: **복구 창 가드는 모드 분기보다 앞**이다(설계 r03 P1).
   *
   * `--close-stale`·`--resolve` 는 일반 경로 가드를 **지나지 않고** 각자 state 를 바꾼다(후자는
   * checkpoint 도 낸다). 모드마다 가드를 흩어 놓으면 새 모드에서 또 빠지므로 **한 자리**에 둔다.
   *
   * 🔴 여기서 state 를 한 번 더 읽는다 — 아래 경로들이 각자 다시 읽지만, **분기 전에 판정**하려면
   *    이 자리가 유일하다. 읽기 실패(티켓 없음 등)는 종전 오류가 그대로 나도록 삼킨다.
   */
  if (o.run) {
    const rid = o.reqId.startsWith('REQ-') ? o.reqId : `REQ-${o.reqId}`
    let blocked: CheckpointWindowReason = 'none'
    try {
      const c = loadConfig({ root: o.root })
      const dir = join(c.workflowDirAbs, rid)
      const rel = relative(c.root, dir).replace(/\\/g, '/')
      const g = createGitAdapter(c.root)
      blocked = stateWriteBlockedReason(
        loadState(dir),
        // 🔴 REQ-2026-156: 읽기 실패는 차단하지 않는다 — 빈 값으로 떨어진다.
        buildCheckpointWindowFacts({
          ticketRel: rel,
          blob: (rev, p) => {
            try {
              return g.exec(['show', `${rev}:${p}`])
            } catch {
              return null
            }
          },
        }),
      )
    } catch {
      blocked = 'none'
    }
    if (blocked !== 'none') throw new Error(recoveryWindowProblem(rid, 'req:review-exception', blocked))
  }
  // 🔴 해소 모드는 예외 부여와 **완전히 다른 경로**다 — `--kind`·rationale 을 요구하지 않는다.
  if (o.closeStale !== null) return runCloseStale(o)
  // 🔴 REQ-2026-163: orphan 기록 종결도 **다른 경로**다 — `--kind`·rationale·승인 문장을 요구하지 않는다.
  if (o.closeOrphan !== null) return runCloseOrphan(o)
  // 🔴 REQ-2026-145: 대체 결정 기록도 **완전히 다른 경로**다 — `--kind`·rationale 을 요구하지 않는다.
  if (o.resolve !== null) return runResolve(o)
  if (!o.kind) throw new Error('--kind design|phase 필요')
  if (o.kind === 'phase' && !o.phase) throw new Error('--kind phase는 --phase <id> 필요')
  if (!o.method || o.method.trim() === '') throw new Error('--method "<승인문장>" 필요')
  if (!o.rationaleFile) throw new Error('--rationale-file <path> 필요')

  const cfg = loadConfig({ root: o.root })
  gitAdapter = createGitAdapter(cfg.root)
  const reqId = o.reqId.startsWith('REQ-') ? o.reqId : `REQ-${o.reqId}`
  const ticketDir = join(cfg.workflowDirAbs, reqId)
  const ticketRel = relative(cfg.root, ticketDir).replace(/\\/g, '/')
  const state = loadState(ticketDir)
  const phaseId = o.kind === 'phase' ? o.phase : null

  // 1. 자격 판정 + rationale 검증(순수 — write 前 모든 거부 조건).
  const plan = planReviewException(state, o.kind, phaseId, cfg.reviewBudget)
  const rp = parseRationale(readFileSync(resolve(o.rationaleFile), 'utf8'))
  if (!plan.ok) throw new Error(`${reqId} 예외 부여 불가: ${plan.reason}\n  → ${plan.hint}`)
  if (!rp.ok) throw new Error(`rationale 검증 실패(--rationale-file):\n  - ${rp.problems.join('\n  - ')}`)

  console.log(`[req:review-exception] ${reqId} 예외 부여 계획: series=${plan.seriesId} for_attempt=${plan.forAttempt} (kind=${o.kind}${phaseId ? ` phase=${phaseId}` : ''})`)
  if (!o.run) {
    console.log('[req:review-exception] DRY-RUN — write 없음(--run 시 실행). rationale 4섹션 검증 OK.')
    return
  }

  // 2. 🔴 clean 가드 — state 변경 前(DEC-RE4·r01 P1). 미커밋 review-exceptions를 HEAD 기반이 덮지 않게.
  const exRel = exceptionsPath(ticketRel)
  const exDirty = git(['status', '--porcelain', '--', exRel]).trim()
  if (exDirty)
    throw new Error(
      `${reqId}: ${exRel}에 미커밋 변경이 있어 예외 기록을 거부합니다(fail-closed) — HEAD 기반 append가 미커밋 행을 덮을 수 있습니다.\n` +
        `  먼저 미커밋 변경을 커밋/정리한 뒤 다시 실행하세요.`,
    )

  // 3. 🔴 durable rationale 먼저. 기존 행이 있으면 confirmed_at 재사용(재실행 복구·conflict 아님).
  const abs = join(cfg.root, exRel)
  const existing = existsSync(abs) ? readFileSync(abs, 'utf8') : ''
  const naturalKey = { ticket_id: reqId, series_id: plan.seriesId, for_attempt: plan.forAttempt }
  const prior = findExistingGrant(existing, naturalKey)
  const confirmedAt = prior ? prior.confirmed_at : new Date().toISOString()
  const row: ExceptionGrantRow = {
    ticket_id: reqId,
    review_kind: o.kind,
    phase_id: phaseId,
    series_id: plan.seriesId,
    for_attempt: plan.forAttempt,
    method: o.method,
    confirmed_at: confirmedAt,
    rationale: rp.rationale,
    reconstructed: false,
  }
  const res = appendExceptionGrant(existing, row)
  if (res.outcome === 'conflict') throw new Error(`${reqId}: 예외 원장 충돌(fail-closed): ${res.problems.join('; ')}`)
  if (res.outcome === 'appended') {
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, res.content, 'utf8')
    git(['add', '--', exRel])
    git(['commit', '-m', bookkeepingMessage(`chore(${reqId}): review exception grant ${plan.seriesId} #${plan.forAttempt}`), '--', exRel])
  }
  // res.outcome === 'duplicate' → durable 이미 존재(멱등·커밋 없음).

  // 4. durable 확정 후에만 소비 가능한 state 기록(scratch). confirmed_at은 durable 행과 동일 값.
  const exception: ReviewExceptionConfirmed = {
    confirmed: true,
    method: o.method,
    confirmed_at: confirmedAt,
    for_series_id: plan.seriesId,
    for_attempt: plan.forAttempt,
    note: rp.rationale.prev_findings.split('\n')[0]?.slice(0, 200) ?? '',
  }
  writeState(ticketDir, { ...state, review_exception_confirmed: exception } as WorkflowState)
  console.log(`[req:review-exception] ✅ ${reqId} 예외 기록 완료 — rationale durable(${res.outcome === 'appended' ? '신규 커밋' : '기존 재사용'}) + review_exception_confirmed 기록. 이제 req:review-codex를 실행하세요.`)
}

/**
 * `--close-stale` — 닫히지 않은 attempt 를 **기록을 남기며** 해소한다 (REQ-2026-141 DEC-3·DEC-3a).
 *
 * 🔴 **재실행이 수렴한다.** durable 원장과 scratch state 두 곳을 바꾸므로 그 사이에서 끊길 수 있는데,
 *    그때 재실행이 막히면 **이 명령이 고치려는 교착을 스스로 만든다.** 그래서 원장을 정본으로 두고
 *    이미 있는 행은 다시 만들지 않는다(같은 자연키에 새 타임스탬프면 무결성 가드가 던진다).
 */
function runCloseStale(o: Opts): void {
  const seriesId = o.closeStale as string
  const cfg = loadConfig({ root: o.root })
  gitAdapter = createGitAdapter(cfg.root)
  const reqId = (o.reqId as string).startsWith('REQ-') ? (o.reqId as string) : `REQ-${o.reqId}`
  const ticketDir = join(cfg.workflowDirAbs, reqId)
  const ticketRel = relative(cfg.root, ticketDir).replace(/\\/g, '/')
  const state = loadState(ticketDir)

  const ledgerRel = ledgerPath(ticketRel)
  const ledgerAbs = join(cfg.root, ledgerRel)
  const parsed = parseLedger(existsSync(ledgerAbs) ? readFileSync(ledgerAbs, 'utf8') : '')
  if (parsed.problems.length > 0)
    throw new Error(`${reqId}: 리뷰 원장 손상 ${parsed.problems.length}건 — ${parsed.problems[0]}`)

  const series = (state.review_series ?? []) as { series_id: string; attempts: number; closed_reason: unknown }[]
  const rec = series.find((r) => r.series_id === seriesId)
  const verdict = planStaleClose({
    rows: parsed.rows,
    seriesId,
    seriesAttempts: rec ? rec.attempts : null,
    seriesOpen: rec ? rec.closed_reason === null : false,
    reason: o.reason ?? '',
  })
  if (!verdict.ok) throw new Error(`${reqId}: ${verdict.reason}\n  → ${verdict.hint}`)
  const plan = verdict.plan

  console.log(`[req:review-exception --close-stale] ${reqId} ${seriesId}: ${plan.detail}`)
  if (!o.run) {
    console.log('[req:review-exception --close-stale] DRY-RUN — write 없음(--run 시 실행).')
    return
  }

  // 1) durable 먼저 — 원장이 정본이다. 이미 있으면 만들지 않는다(멱등).
  if (plan.appendRow) {
    const src = parsed.rows.find((r) => r.series_id === seriesId && r.attempt === plan.attempt && r.event === 'attempt-opened')
    if (!src) throw new Error(`${reqId}: attempt ${plan.attempt} 의 attempt-opened 행을 찾지 못했습니다(fail-closed)`)
    appendLedgerRowToDisk(cfg.root, ticketRel, {
      ...src,
      event: 'attempt-closed',
      lifecycle: 'abandoned',
      outcome: 'abandoned',
      at: new Date().toISOString(),
      stale_close_reason: (o.reason as string).trim(),
    })
  }

  /**
   * 🔴 **durable 기록을 확인한다**(phase-2 리뷰 r04 P1). `appendLedgerRowToDisk` 는 write 오류를
   *    경고로 삼키므로, 그것만 믿고 state 를 바꾸면 **원장에는 #N 이 열린 채인데 state 는 진행된**
   *    상태가 된다 — "durable 먼저, 그 뒤 state" 계약이 조용히 깨진다. 다시 읽어 확인한다.
   */
  if (plan.appendRow) {
    const after = parseLedger(existsSync(ledgerAbs) ? readFileSync(ledgerAbs, 'utf8') : '')
    const written = after.rows.some(
      (r) =>
        r.series_id === seriesId && r.attempt === plan.attempt && r.event === 'attempt-closed' && r.outcome === 'abandoned',
    )
    if (!written)
      throw new Error(
        `${reqId}: 원장에 종결 행을 남기지 못했습니다(fail-closed) — state 를 바꾸지 않았습니다.\n` +
          `  ${ledgerRel} 의 쓰기 권한·디스크 상태를 확인한 뒤 다시 실행하세요.`,
      )
  }

  /**
   * 🔴 **커밋은 append 여부와 분리한다**(phase-2 리뷰 r03 P1). 앞선 실행이 행을 **파일에 쓰고 커밋 전에**
   *    끊겼으면, 재실행은 그 행을 "이미 있다"고 보고 `appendRow: false` 로 간다 — 커밋을 그 분기에
   *    묶어 두면 행이 워킹트리에만 영영 남아 이후 리뷰가 dirty-tree 게이트에 막힌다.
   *    그래서 **원장이 더러우면 언제든 확정**한다(방금 썼든, 앞선 실행이 쓰다 말았든).
   */
  if (git(['status', '--porcelain', '--', ledgerRel]).trim() !== '') {
    git(['add', '--', ledgerRel])
    git([
      'commit',
      '-m',
      bookkeepingMessage(`chore(${reqId}): close stale attempt ${seriesId} #${plan.attempt}`),
      '--',
      ledgerRel,
    ])
  }

  // 2) durable 확정 후에만 scratch state 를 맞춘다(방향 고정 — 충돌 시 원장이 이긴다).
  {
    const next = series.map((r: (typeof series)[number]) =>
      r.series_id === seriesId
        ? {
            ...r,
            attempts: plan.raiseAttemptsTo === null ? r.attempts : Math.max(r.attempts, plan.raiseAttemptsTo),
            // 🔴 호출은 나갔고 판정은 없었다 — `autoBudget` 에서만 빠지고 `hardCap` 에는 남는다.
            //    원장에서 파생한 값으로 **끌어올리기만** 한다(멱등 — 몇 번 실행해도 같다).
            void_attempts: Math.max((r as { void_attempts?: number }).void_attempts ?? 0, plan.voidAttemptsAtLeast),
          }
        : r,
    )
    writeState(ticketDir, { ...state, review_series: next } as WorkflowState)
  }
  console.log(
    `[req:review-exception --close-stale] ✅ ${reqId} ${seriesId} #${plan.attempt} 해소 — ` +
      `${plan.appendRow ? '원장 기록 + ' : '원장은 이미 기록됨 · '}state 정합화. 이제 req:review-codex 를 다시 실행할 수 있습니다.`,
  )
}


// ───────────────────────────── REQ-2026-145: 대체(replace) 결정 기록 ──

export type ResolvePlan =
  | { ok: true; seriesId: string; kind: ReviewKind; phaseId: string | null }
  | { ok: false; reason: string; hint: string }

/**
 * 대체 결정 자격 판정(순수). write 前 모든 거부 조건이 여기 있다.
 *
 * 🔴 **`series_id` 를 파싱하지 않는다.** 형식은 `` `${kind}:${phaseId ?? '-'}#${seq}` `` 인데 phase id 에
 *    `#` 이 들어가면(`phase#alpha`) 쪼개기가 깨진다. `state.review_series` 에서 **원문 대조**로 찾아
 *    그 레코드의 `review_kind`·`phase_id` 를 그대로 쓴다.
 */
export function planResolveReplace(state: WorkflowState, input: { resolve: string; seriesId: string; reason: string; confirm: string }): ResolvePlan {
  const openList = (): string =>
    ((state.review_series ?? []) as { series_id: string; closed_reason: unknown }[])
      .filter((r) => r.closed_reason === null)
      .map((r) => r.series_id)
      .join(' · ') || '(열린 series 없음)'
  if (input.resolve !== 'replace')
    return {
      ok: false,
      reason: `--resolve 값은 replace 만 지원합니다 (받음: ${input.resolve})`,
      hint: '지금 소비처가 있는 결정은 replace 뿐입니다 — 다른 값은 기록해도 쓰이지 않습니다.',
    }
  // 🔴 "필수"는 인자 존재가 아니라 **내용 존재**다. `note` 는 선택 필드이고 `isValidHumanResolution`
  //    도 검사하지 않으므로, 여기서 막지 않으면 **빈 근거를 가진 replace 결정이 그대로 커밋된다**.
  // 🔴 REQ-2026-149: 내용 존재 **와** 자리표시자 아님을 한 자리에서 본다. 도구가 안내에 박은
  //    `"왜 대체하는가"`·`"승인 문장"` 을 그대로 실행하면 사람 결정 없이 replace 가 커밋된다.
  const reasonProblem = humanDecisionProblem('--reason', input.reason)
  if (reasonProblem) return { ok: false, reason: reasonProblem, hint: '왜 대체하는지 한 문장으로 적으십시오 — 근거 없는 종결은 기록이 아닙니다.' }
  const confirmProblem = humanDecisionProblem('--confirm', input.confirm)
  if (confirmProblem) return { ok: false, reason: confirmProblem, hint: '사람이 말한 승인 문장을 그대로 넘기십시오.' }

  const rec = ((state.review_series ?? []) as { series_id: string; review_kind: ReviewKind; phase_id: string | null; closed_reason: unknown }[]).find(
    (r) => r.series_id === input.seriesId,
  )
  if (!rec)
    return { ok: false, reason: `series ${input.seriesId} 를 찾을 수 없습니다`, hint: `이 티켓의 열린 series: ${openList()}` }
  if (rec.closed_reason !== null)
    return {
      ok: false,
      reason: `series ${input.seriesId} 는 이미 종결됐습니다(${String(rec.closed_reason)})`,
      hint: `같은 결정을 두 번 기록하지 않습니다. 이 티켓의 열린 series: ${openList()}`,
    }
  return { ok: true, seriesId: rec.series_id, kind: rec.review_kind, phaseId: rec.phase_id ?? null }
}

/**
 * orphan series 판정(순수) — REQ-2026-163 phase-2.
 *
 * 🔴 **`phases[]` 에 있는 phase 의 series 는 거부한다.** 그것을 닫아 주면 필요한 리뷰를 건너뛰는 길이
 *    된다 — 이 명령의 정당성은 "그 phase 가 더 이상 없다"는 **사실**에서만 나온다.
 * 🔴 **이미 닫혔으면 수렴**이다(거부 아님). 재실행이 막히면 이 명령이 고치려는 교착을 스스로 만든다
 *    (`--close-stale` 이 같은 규율을 문서로 못 박고 있다).
 */
export type CloseOrphanPlan =
  | { kind: 'close'; seriesId: string; phaseId: string }
  | { kind: 'noop'; seriesId: string; detail: string }
  | { kind: 'refuse'; seriesId: string; reason: string; hint: string }

export function planCloseOrphan(state: WorkflowState, seriesId: string, reason: string): CloseOrphanPlan {
  const reasonProblem = humanDecisionProblem('--reason', reason)
  if (reasonProblem)
    return { kind: 'refuse', seriesId, reason: reasonProblem, hint: '왜 그 phase 가 사라졌는지 한 줄로 적으십시오.' }

  const series = ((state.review_series ?? []) as { series_id?: unknown; closed_reason?: unknown }[]).find(
    (r) => r.series_id === seriesId,
  )
  if (!series) return { kind: 'refuse', seriesId, reason: `series ${seriesId} 를 찾을 수 없습니다`, hint: '`req:doctor` 의 D34 가 대상 series id 를 알려 줍니다.' }
  if (series.closed_reason !== null)
    return { kind: 'noop', seriesId, detail: `이미 종결됨(${String(series.closed_reason)}) — 쓸 것이 없습니다` }

  const orphan = orphanPhaseSeries(state as { phases?: unknown; review_series?: unknown }).find((x) => x.seriesId === seriesId)
  if (!orphan)
    return {
      kind: 'refuse',
      seriesId,
      reason: `series ${seriesId} 는 orphan 이 아닙니다 — 그 phase 가 아직 phases[] 에 있습니다`,
      hint: '살아 있는 phase 의 series 를 닫으면 필요한 리뷰를 건너뛰게 됩니다. 그 phase 를 정상 리뷰로 종결하십시오.',
    }
  return { kind: 'close', seriesId, phaseId: orphan.phaseId }
}

/**
 * orphan series 기록 종결 실행 (REQ-2026-163).
 *
 * durable 정본은 **close-proof `series-terminal`(`resolution: 'orphaned'`)** 이다 — 리뷰 원장은
 * `attempt-*` 뿐이라 series 수준 사건을 담을 수 없다(설계 DEC-3). 그 행은 `verifiedTerminalEvent` 가
 * **티켓 종결에서 제외**하므로 진행 중인 티켓이 종결로 보이지 않는다(DEC-3b).
 */
function runCloseOrphan(o: Opts): void {
  const seriesId = o.closeOrphan as string
  const cfg = loadConfig({ root: o.root })
  gitAdapter = createGitAdapter(cfg.root)
  const reqId = (o.reqId as string).startsWith('REQ-') ? (o.reqId as string) : `REQ-${o.reqId}`
  const ticketDir = join(cfg.workflowDirAbs, reqId)
  const ticketRel = relative(cfg.root, ticketDir).replace(/\\/g, '/')
  const state = loadState(ticketDir)

  const plan = planCloseOrphan(state, seriesId, o.reason ?? '')
  if (plan.kind === 'refuse') throw new Error(`${reqId}: ${plan.reason}
  → ${plan.hint}`)
  if (plan.kind === 'noop') {
    console.log(`[req:review-exception --close-orphan] ${reqId} ${seriesId}: ${plan.detail}`)
    return
  }

  console.log(`[req:review-exception --close-orphan] ${reqId} ${seriesId}: phases[] 에 없는 phase '${plan.phaseId}' 의 series 를 기록 종결합니다.`)
  if (!o.run) {
    console.log('[req:review-exception --close-orphan] DRY-RUN — write 없음(--run 시 실행).')
    return
  }

  /**
   * 🔴 durable 먼저. state 만 바뀌고 proof 가 없으면 다음 실행이 "이미 닫힘"으로 수렴해 기록이 영영 없다.
   * 🔴 **그리고 그 proof 를 반드시 커밋한다**(phase-2 r01 P1). `commitStateCheckpoint` 는 설계상
   *    `state.json` 만 pathspec 으로 담으므로, proof 를 디스크에만 두면 워킹트리에 남아 다음 정리에서
   *    사라진다 — 계획이 요구한 durable 기록과 `orphan_reason` 감사 근거가 영구히 유실된다.
   *    `durableParentSeriesTerminal` 이 쓰는 것과 **같은 pathspec 커밋** 방식이다(다른 staged 미접촉).
   */
  const cpRel = closeProofPath(ticketRel)
  const cpAbs = join(cfg.root, cpRel)
  const before = existsSync(cpAbs) ? readFileSync(cpAbs, 'utf8') : ''
  appendCloseProofRowToDisk(cfg.root, ticketRel, {
    ticket_id: reqId,
    event: 'series-terminal',
    series_id: seriesId,
    resolution: 'orphaned',
    phase_inventory: null,
    design_ref: null,
    at: new Date().toISOString(), // 🔴 실제 시계 — 지어내지 않는다(REQ-2026-019 폐기 사유)
    reconstructed: false,
    evidence_basis: null,
    orphan_reason: (o.reason as string).trim(),
  })

  const after = existsSync(cpAbs) ? readFileSync(cpAbs, 'utf8') : ''
  if (after !== before) {
    git(['add', '--', cpRel])
    git(['commit', '-m', bookkeepingMessage(`chore(${reqId}): series-terminal close proof (orphaned) — ${seriesId}`), '--', cpRel])
  }

  const { next, changed } = closeSeriesOrphaned(state, seriesId)
  if (changed) writeState(ticketDir, next)
  commitStateCheckpoint({
    root: cfg.root,
    ticketRel,
    ticketId: reqId,
    state: next,
    reason: `${seriesId} orphan 기록 종결`,
    gitFn: git,
  })
  console.log(`[req:review-exception --close-orphan] ✅ ${reqId} ${seriesId} 종결 기록·커밋 완료(closed_reason=orphaned).`)
}

/**
 * 대체 결정 기록 실행.
 *
 * 🔴 **이 verb 가 만든 더러움(`state.json`)은 스스로 0 으로 만든다.** 안 그러면 바로 다음
 *    `req:new --successor-of` 가 clean-worktree 검사에 막힌다 — 두 단계로 안내해 놓고 1단계가 2단계를
 *    막으면 그건 이 REQ 가 고치려는 결함과 **같은 모양**이다.
 *
 * 🔴 **남의 staged 파일은 건드리지 않는다.** 실제 hardCap 상태에는 리뷰에 올린 설계 문서가 staged 로
 *    남아 있는데, 무엇인지 모르는 채 커밋하면 코드·비밀이 딸려 들어간다(`git add -A` 금지와 같은 이유).
 *    대신 **막는 경로를 실제 값으로 열거**하고 다음 명령을 준다.
 */
function runResolve(o: Opts): void {
  const cfg = loadConfig({ root: o.root })
  gitAdapter = createGitAdapter(cfg.root)
  const reqId = (o.reqId as string).startsWith('REQ-') ? (o.reqId as string) : `REQ-${o.reqId}`
  const ticketDir = join(cfg.workflowDirAbs, reqId)
  const ticketRel = relative(cfg.root, ticketDir).replace(/\\/g, '/')
  const state = loadState(ticketDir)

  if (!o.series) throw new Error('--resolve 는 --series 로 대상 series_id 를 받아야 합니다 — 짐작하지 않습니다')
  const plan = planResolveReplace(state, {
    resolve: o.resolve as string,
    seriesId: o.series,
    reason: o.reason ?? '',
    confirm: o.confirm ?? '',
  })
  if (!plan.ok) throw new Error(`${reqId}: ${plan.reason}
  → ${plan.hint}`)

  console.log(`[req:review-exception --resolve] ${reqId} ${plan.seriesId} 를 대체(replace) 결정으로 종결합니다.`)
  if (!o.run) {
    console.log('[req:review-exception --resolve] DRY-RUN — write 없음(--run 시 실행).')
    return
  }

  // 🔴 `decided_at` 은 **실제 시계**다. 지어내지 않는다(REQ-2026-019 가 타임스탬프 날조로 폐기됐다).
  const next = closeSeriesHumanResolutionById(state, plan.seriesId, {
    decision: 'replace',
    method: (o.confirm as string).trim(), // 받은 승인 문장 그대로
    decided_at: new Date().toISOString(),
    note: (o.reason as string).trim(),
  })
  writeState(ticketDir, next)

  // 🔴 checkpoint 를 **명시적으로** 커밋한다. `--close-stale` 이 이미 그렇게 한다고 가정하지 않는다 —
  //    그 경로는 state 를 쓴 뒤 checkpoint 를 부르지 않는다(복제할 기존 동작이 없다).
  commitStateCheckpoint({
    root: cfg.root,
    ticketRel,
    ticketId: reqId,
    state: next,
    reason: `${plan.seriesId} 대체 결정`,
    gitFn: git,
  })

  const slug = successorSlug(state.branch, reqId)
  console.log(`[req:review-exception --resolve] ✅ ${reqId} ${plan.seriesId} 대체 결정 기록·커밋 완료.`)
  const dirty = git(['status', '--porcelain'])
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.slice(2).trim())
  if (dirty.length) {
    console.log('')
    console.log('⚠️  아직 워킹트리에 남은 변경이 있어 req:new 가 거부합니다:')
    for (const d of dirty) console.log(`     ${d}`)
    // 🔴 REQ-2026-149 결함 2: `git commit` 만 내면 **이미 staged 인 티켓 밖 파일까지** 실린다.
    //    `git add` 로 untracked 를 올리고, `-- <pathspec>` 으로 커밋 범위를 티켓에 가둔다.
    if (allShellSafe(ticketRel)) {
      console.log('   먼저 정리하십시오(티켓만 담는 파킹 커밋):')
      console.log(`     git add -- ${quoteArg(ticketRel)}`)
      // 🔴 pathspec 이 필수다 — 이미 staged 인 티켓 밖 파일이 이 커밋에 실리면 안 된다.
      console.log(`     git commit -m "chore(${reqId}): 설계 파킹 — 대체 REQ 로 이어감" -- ${quoteArg(ticketRel)}`)
    } else {
      console.log(`   먼저 ${ticketRel} 만 담는 파킹 커밋을 만드십시오(경로에 셸 특수문자가 있어 명령을 만들지 않았습니다).`)
    }
    console.log('   그 다음:')
  }
  /**
   * 🔴 **반쪽 명령열을 내지 않는다**(phase-1 r02 P1). 파킹을 명령으로 못 냈는데 `req:new` 만 내면
   *    사용자가 그것을 실행했다가 남은 변경 때문에 거부된다.
   */
  const parkRenderable = dirty.length === 0 || allShellSafe(ticketRel)
  if (parkRenderable && allShellSafe(slug, reqId))
    console.log(`     npx commitgate req:new ${slug} --successor-of ${reqId} --run`)
  else console.log(`     정리 후 req:new 로 대체 REQ 를 만드십시오 — slug=${slug} · --successor-of ${reqId}`)
}

/** bin dispatch 진입점(친절한 1줄 오류 + exit 1 경계). */
export const runCli = makeRunCli(main)

const isMain = isEntrypoint(import.meta.url)
if (isMain) main()
