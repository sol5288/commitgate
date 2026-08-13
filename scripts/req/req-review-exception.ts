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
import { createGitAdapter, type GitAdapter } from './lib/adapters'
import { assertSetupComplete } from './lib/setup-gate'
import { bookkeepingMessage } from './lib/bookkeeping'
import {
  loadState,
  writeState,
  openSeriesRecord,
  budgetCounts,
  checkReviewBudget,
  isSeriesKeyTerminal,
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
  reason: string | null
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
    reason: null,
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
    } else if (a === '--close-stale') {
      const v = argv[++i]
      if (v === undefined || v.startsWith('-')) throw new Error(`--close-stale 에 series_id 가 필요합니다 (받음: ${v ?? '(없음)'})`)
      o.closeStale = v
    } else if (a === '--reason') {
      // 사유는 `-`로 시작할 수 있어 접두 검사를 하지 않되, 값 누락은 거부한다.
      const v = argv[++i]
      if (v === undefined) throw new Error('--reason 값 필요')
      o.reason = v
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
  // 🔴 해소 모드는 예외 부여와 **완전히 다른 경로**다 — `--kind`·rationale 을 요구하지 않는다.
  if (o.closeStale !== null) return runCloseStale(o)
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

/** bin dispatch 진입점(친절한 1줄 오류 + exit 1 경계). */
export const runCli = makeRunCli(main)

const isMain = isEntrypoint(import.meta.url)
if (isMain) main()
