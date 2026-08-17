#!/usr/bin/env tsx
/**
 * req:delegate — `stopGate: "auto"` 의 **사전 위임**을 발급·철회·조회한다 (REQ-2026-140 phase-3).
 *
 * 🔴 **판단은 사람, 실행은 도구**다. `req:confirm` 과 같은 구조다(`docs/agent-prompt.md` 가 정한 경계):
 *    사람이 승인 문장을 말하고, 에이전트가 그 문장을 **그대로** 넘겨 이 명령을 돌린다.
 *    도구가 보장하는 것은 **시각·SHA·만료·소비의 정직성**이다.
 *
 * 🔴 **도구가 보장하지 못하는 것**: 승인 문장이 실제로 사람에게서 왔는지는 검증할 수 없다.
 *    `req:confirm` 과 같은 한계이고, 문서에 그대로 적는다 — 보장하지 않는 것을 보장한다고 쓰지 않는다.
 *
 * 🔴 **`at`·`expires_at`·두 SHA 를 사람이 적을 자리가 없다.** 전부 도구가 읽는다(REQ-2026-019 폐기 사유).
 *
 * 사용:
 *   req:delegate --scope ticket:2026-140 --source <branch> --sentence "<문장>" [--allow-push] [--allow-bypass] [--high-risk] [--ttl-hours N] [--run]
 *   req:delegate --revoke <id> --reason "<사유>" [--run]
 *   req:delegate --status [--scope ticket:2026-140]
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { loadConfig } from './lib/config'
import { createGitAdapter, type GitAdapter } from './lib/adapters'
import { assertSetupComplete } from './lib/setup-gate'
import { bookkeepingMessage } from './lib/bookkeeping'
import { humanDecisionProblem, PLACEHOLDER_REASON } from './lib/placeholders'
import { makeRunCli, isEntrypoint, readFreeTextValue } from './lib/cli-boundary'
import { helpGate, renderVerbHelp } from './lib/verb-help'
import {
  DEFAULT_TTL_HOURS,
  MAX_TTL_HOURS,
  DELEGATION_LEDGER_REL,
  foldDelegations,
  parseDelegationLedger,
  parseInstantMs,
  type DelegationIssued,
  type DelegationRevoked,
  type DelegationRow,
  type DelegationScope,
} from './lib/delegation'

/**
 * 만료 기본값과 상한(시간).
 *
 * 🔴 **상한이 있는 것이 요점이다.** 위임은 사람 없이 main 을 바꿀 권한이라, "무기한"은 곧 상시 권한이다.
 *    기본을 짧게 두고 상한을 걸어, 길게 쓰려면 **의식적으로 값을 적게** 만든다.
 */
/** 🔴 정본은 `lib/delegation` 이다(사용법 등록부와 공유해야 해서 내렸다). 기존 import 경로 보존용 re-export. */
export { DEFAULT_TTL_HOURS, MAX_TTL_HOURS }

export interface Opts {
  mode: 'issue' | 'revoke' | 'status'
  scope: DelegationScope | null
  source: string | null
  sentence: string | null
  allowPush: boolean
  allowBypass: boolean
  highRisk: boolean
  ttlHours: number
  revokeId: string | null
  reason: string | null
  root: string | null
  run: boolean
}

/** 자유 텍스트 값 자리에서 이 중 하나가 오면 값 누락으로 본다(옵션을 문장으로 삼키지 않는다). */
export const KNOWN_OPTIONS = [
  '--scope',
  '--source',
  '--sentence',
  '--allow-push',
  '--allow-bypass',
  '--high-risk',
  '--ttl-hours',
  '--revoke',
  '--reason',
  '--status',
  '--root',
  '--run',
] as const

/**
 * `ticket:<REQ>` 또는 `delivery:<slug>` 를 파싱한다.
 *
 * 🔴 접두를 요구한다 — `--scope 2026-140` 처럼 종류가 빠지면 도구가 **추측**해야 하고, 추측이 틀리면
 *    엉뚱한 대상에 권한이 생긴다.
 */
export function parseScopeArg(v: string): DelegationScope {
  const [kind, ...rest] = v.split(':')
  const value = rest.join(':')
  if (kind === 'ticket' && value !== '') return { kind: 'ticket', req_id: normalizeReqId(value) }
  if (kind === 'delivery' && value !== '') return { kind: 'delivery', slug: value }
  throw new Error(`--scope 는 ticket:<REQ> 또는 delivery:<slug> 형식입니다 (받음: ${v})`)
}

/** `2026-140` 도 `REQ-2026-140` 도 받는다 — 원장에는 항상 정규형으로 적는다. */
export function normalizeReqId(v: string): string {
  return /^REQ-/i.test(v) ? v.toUpperCase() : `REQ-${v}`
}

export function parseArgs(argv: string[]): Opts {
  const o: Opts = {
    mode: 'issue',
    scope: null,
    source: null,
    sentence: null,
    allowPush: false,
    allowBypass: false,
    highRisk: false,
    ttlHours: DEFAULT_TTL_HOURS,
    revokeId: null,
    reason: null,
    root: null,
    run: false,
  }
  let sawStatus = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === undefined || a === '--') continue
    if (a === '--run') o.run = true
    else if (a === '--allow-push') o.allowPush = true
    else if (a === '--allow-bypass') o.allowBypass = true
    else if (a === '--high-risk') o.highRisk = true
    else if (a === '--status') sawStatus = true
    else if (a === '--scope') o.scope = parseScopeArg(readFreeTextValue(argv, ++i, '--scope', KNOWN_OPTIONS))
    else if (a === '--source') o.source = readFreeTextValue(argv, ++i, '--source', KNOWN_OPTIONS)
    else if (a === '--sentence') o.sentence = readFreeTextValue(argv, ++i, '--sentence', KNOWN_OPTIONS)
    else if (a === '--reason') o.reason = readFreeTextValue(argv, ++i, '--reason', KNOWN_OPTIONS)
    else if (a === '--revoke') o.revokeId = readFreeTextValue(argv, ++i, '--revoke', KNOWN_OPTIONS)
    else if (a === '--ttl-hours') {
      const raw = readFreeTextValue(argv, ++i, '--ttl-hours', KNOWN_OPTIONS)
      const n = Number(raw)
      if (!Number.isInteger(n) || n < 1 || n > MAX_TTL_HOURS)
        throw new Error(`--ttl-hours 는 1~${MAX_TTL_HOURS} 의 정수여야 합니다 (받음: ${raw})`)
      o.ttlHours = n
    } else if (a === '--root') {
      const v = argv[++i]
      if (v === undefined || v.startsWith('-')) throw new Error(`--root 에 경로가 필요합니다 (받음: ${v ?? '(없음)'})`)
      o.root = v
    } else throw new Error(`알 수 없는 인자: ${a}`)
  }

  // 🔴 모드는 **하나**여야 한다. 겹치면 무엇을 하려는지 도구가 정하게 되고, 그 선택이 곧 권한이다.
  if (sawStatus && o.revokeId !== null) throw new Error('--status 와 --revoke 는 함께 쓸 수 없습니다')
  o.mode = sawStatus ? 'status' : o.revokeId !== null ? 'revoke' : 'issue'
  return o
}

/**
 * 철회 입력의 완전성(fail-closed).
 *
 * 🔴 **사유는 필수다**(phase-3 리뷰 r01 P1). 발급에 근거를 요구하면서 철회는 비워 두면, 원장에
 *    "누가 왜 권한을 거둬들였는지 알 수 없는 행"이 남는다 — 철회도 감사 대상이다. help 가 이미
 *    `--reason` 을 필수로 적고 있었는데 코드가 강제하지 않았다(문서와 동작의 어긋남).
 */
export function revokeProblem(o: Opts): string | null {
  if (o.revokeId === null || o.revokeId.trim() === '') return '--revoke <id> 가 필요합니다'
  // 🔴 REQ-2026-149: 발급 성공 안내가 `--revoke <id> --reason "…" --run` 을 실행 가능한 형태로
  //    낸다. 그 원문을 그대로 실행하면 사유가 `"<사유>"` 인 철회 행이 원장에 남는다 — 도구가 자기
  //    출력을 소비해 감사 기록을 훼손한다.
  {
    const p = humanDecisionProblem('--reason', o.reason)
    if (p) return `${p}
  근거 없는 철회는 기록하지 않습니다.`
  }
  return null
}

/** 발급 입력의 완전성(fail-closed). 🔴 승인 문장이 비면 **권한 근거 없는 권한**이므로 발급하지 않는다. */
export function issueProblem(o: Opts): string | null {
  if (o.scope === null) return '--scope 가 필요합니다 (ticket:<REQ> 또는 delivery:<slug>)'
  if (o.source === null) return '--source <branch> 가 필요합니다 — 어느 브랜치에서 통합할지 고정해야 합니다'
  // 🔴 REQ-2026-149: **가장 중대한 자리다.** `req:next` 가 `--sentence` 자리에 등록부 자리표시자를
  //    실행 가능한 형태로 내는데, 그 값이 여는 것은 **main 병합 권한**이다. 도구가 만든 범용
  //    문자열로 위임이 발급되면 REQ-2026-140 의 "임의의 문장으로 병합 권한이 생기면 안 된다"를
  //    도구가 스스로 어긴다.
  {
    const p = humanDecisionProblem('--sentence', o.sentence)
    if (p) return `${p}
  근거 없는 위임은 발급하지 않습니다.`
  }
  return null
}

export interface RunDeps {
  rootAbs: string
  ticketRoot: string
  trunkBranch: string | null
  git: GitAdapter
  /** 🔴 실제 시계. 주입 seam 은 테스트를 위한 것이지 값을 지어내기 위한 것이 아니다. */
  now: () => string
  newId: () => string
  log: (line: string) => void
}

const ledgerAbs = (rootAbs: string): string => join(rootAbs, ...DELEGATION_LEDGER_REL.split('/'))

function readLedger(rootAbs: string): string | null {
  const abs = ledgerAbs(rootAbs)
  return existsSync(abs) ? readFileSync(abs, 'utf8') : null
}

/** `at` + ttl 시간. 🔴 문자열 산술이 아니라 epoch 계산이다(시각 파싱은 delegation 모듈이 정본). */
export function expiryOf(nowIso: string, ttlHours: number): string {
  const ms = parseInstantMs(nowIso)
  if (ms === null) throw new Error(`현재 시각이 ISO instant 가 아닙니다: ${nowIso}`)
  return new Date(ms + ttlHours * 3_600_000).toISOString()
}

/** 원장에 한 행을 append 하고 **그 파일만** 부기 커밋한다. */
function appendAndCommit(deps: RunDeps, row: DelegationRow, subject: string): void {
  const staged = deps.git
    .exec(['diff', '--cached', '--name-only'])
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((p) => p !== DELEGATION_LEDGER_REL)
  if (staged.length > 0)
    throw new Error(
      `req:delegate --run 은 ${DELEGATION_LEDGER_REL} 만 커밋합니다 — 다른 staged 변경을 먼저 커밋하거나 unstage 하세요: ${staged.slice(0, 3).join(', ')}${staged.length > 3 ? ' …' : ''}`,
    )
  const abs = ledgerAbs(deps.rootAbs)
  mkdirSync(dirname(abs), { recursive: true })
  appendFileSync(abs, `${JSON.stringify(row)}\n`, 'utf8')
  deps.git.exec(['add', DELEGATION_LEDGER_REL])
  deps.git.exec(['commit', '-m', bookkeepingMessage(subject)])
}

export function runDelegate(o: Opts, deps: RunDeps): number {
  if (o.mode === 'status') return runStatus(o, deps)
  if (o.mode === 'revoke') return runRevoke(o, deps)
  return runIssue(o, deps)
}

function runIssue(o: Opts, deps: RunDeps): number {
  const problem = issueProblem(o)
  if (problem !== null) throw new Error(problem)
  const scope = o.scope as DelegationScope
  const source = o.source as string
  const trunkBranch = deps.trunkBranch
  if (trunkBranch === null) throw new Error('req.config.json 의 trunkBranch 가 없습니다 — 위임 대상을 고정할 수 없습니다')

  // 🔴 두 SHA 는 **지금 읽는다**. 사람이 적으면 그 순간부터 사실이 아닐 수 있다.
  const trunkSha = deps.git.exec(['rev-parse', '--verify', `${trunkBranch}^{commit}`]).trim()
  const baseSha = deps.git.exec(['rev-parse', '--verify', `${source}^{commit}`]).trim()

  const at = deps.now()
  const row: DelegationIssued = {
    kind: 'issued',
    id: deps.newId(),
    at,
    scope,
    trunk_branch: trunkBranch,
    trunk_sha: trunkSha,
    source_branch: source,
    base_sha: baseSha,
    expires_at: expiryOf(at, o.ttlHours),
    // 🔴 DEC-5a: 발급 자체가 local_merge 다. push·bypass 만 opt-in.
    permissions: { local_merge: true, origin_push: o.allowPush, bypass_protection: o.allowBypass },
    high_risk_ack: o.highRisk,
    approval_sentence: (o.sentence as string).trim(),
  }

  deps.log(`commitgate req:delegate — ${scope.kind}:${scope.kind === 'ticket' ? scope.req_id : scope.slug}`)
  deps.log(`  대상 trunk : ${trunkBranch} @ ${trunkSha.slice(0, 8)}`)
  deps.log(`  소스 브랜치: ${source} @ ${baseSha.slice(0, 8)}`)
  deps.log(`  만료       : ${row.expires_at} (${o.ttlHours}시간)`)
  deps.log(`  허용 작업  : local merge${o.allowPush ? ' · origin push' : ''}${o.allowBypass ? ' · protection bypass' : ''}`)
  deps.log(`  HIGH 위험  : ${o.highRisk ? '위임함' : '위임하지 않음(HIGH 티켓이면 통합이 막힙니다)'}`)
  if (o.allowBypass) deps.log('  ⚠️ branch protection 우회를 위임했습니다 — 사용 시 원장과 최종 보고에 남습니다.')

  if (!o.run) {
    deps.log(`DRY-RUN — 기록하지 않았습니다. 실행하려면 --run 을 지정하세요.`)
    return 0
  }
  appendAndCommit(deps, row, `delegate — ${row.id.slice(0, 8)} 사전 위임 발급`)
  deps.log(`✅ 위임 발급: ${row.id}`)
  deps.log(`   기록: ${DELEGATION_LEDGER_REL} (부기 커밋됨)`)
  deps.log(`   철회: npx commitgate req:delegate --revoke ${row.id} --reason "${PLACEHOLDER_REASON}" --run`)
  return 0
}

function runRevoke(o: Opts, deps: RunDeps): number {
  const problem = revokeProblem(o)
  if (problem !== null) throw new Error(problem)
  const id = o.revokeId as string
  const { rows, problems } = parseDelegationLedger(readLedger(deps.rootAbs))
  if (problems.length > 0)
    throw new Error(`${DELEGATION_LEDGER_REL} 에 손상 행 ${problems.length}건 — ${problems[0]}`)
  const target = rows.find((r) => r.kind === 'issued' && r.id === id)
  if (target === undefined) throw new Error(`발급 기록에 없는 id 입니다: ${id}`)
  const ended = rows.find((r) => (r.kind === 'consumed' || r.kind === 'revoked') && r.id === id)
  if (ended !== undefined) throw new Error(`이미 ${ended.kind === 'revoked' ? '철회' : '소비'}된 위임입니다: ${id}`)

  const row: DelegationRevoked = { kind: 'revoked', id, at: deps.now(), reason: (o.reason as string).trim() }
  deps.log(`commitgate req:delegate --revoke ${id}`)
  if (!o.run) {
    deps.log('DRY-RUN — 기록하지 않았습니다. 실행하려면 --run 을 지정하세요.')
    return 0
  }
  appendAndCommit(deps, row, `delegate — ${id.slice(0, 8)} 사전 위임 철회`)
  deps.log(`✅ 철회: ${id}`)
  return 0
}

function runStatus(o: Opts, deps: RunDeps): number {
  const { rows, problems } = parseDelegationLedger(readLedger(deps.rootAbs))
  if (problems.length > 0) {
    deps.log(`⚠️ ${DELEGATION_LEDGER_REL} 손상 ${problems.length}건 — 판정은 fail-closed 로 거부됩니다`)
    for (const p of problems.slice(0, 3)) deps.log(`   - ${p}`)
  }
  const scopes: DelegationScope[] =
    o.scope !== null
      ? [o.scope]
      : rows.filter((r): r is DelegationIssued => r.kind === 'issued').map((r) => r.scope)
  const seen = new Set<string>()
  let shown = 0
  for (const scope of scopes) {
    const key = scope.kind === 'ticket' ? `ticket:${scope.req_id}` : `delivery:${scope.slug}`
    if (seen.has(key)) continue
    seen.add(key)
    const f = foldDelegations(rows, scope)
    for (const a of f.active) {
      shown++
      deps.log(`[active]  ${key} · ${a.id} · 만료 ${a.expires_at}`)
      deps.log(`          소스 ${a.source_branch} → ${a.trunk_branch}@${a.trunk_sha.slice(0, 8)}`)
      deps.log(
        `          권한 local_merge${a.permissions.origin_push ? ' · origin_push' : ''}${a.permissions.bypass_protection ? ' · bypass' : ''}${a.high_risk_ack ? ' · HIGH' : ''}`,
      )
      deps.log(`          근거 "${a.approval_sentence}"`)
    }
    for (const t of f.terminated) {
      shown++
      deps.log(`[${t.by === 'revoked' ? 'revoked ' : 'consumed'}] ${key} · ${t.row.id} · ${t.at}`)
    }
  }
  if (shown === 0) deps.log('발급된 위임이 없습니다.')
  return 0
}

/** 🔴 본문 정본은 `lib/verb-help` 하나다(REQ-2026-166 DEC-2) — 두 곳에 두면 다시 갈라진다. */
export function printHelp(): void {
  console.log(renderVerbHelp('req:delegate'))
}

export function main(argv: string[]): void {
  // 🔴 사용법은 어떤 파싱·설정 읽기보다 **앞**이다(REQ-2026-166 DEC-2).
  if (helpGate('req:delegate', argv)) return
  const o = parseArgs(argv)
  const cfg = loadConfig({ root: o.root })
  assertSetupComplete(cfg)
  const git = createGitAdapter(cfg.root)
  runDelegate(o, {
    rootAbs: cfg.root,
    ticketRoot: cfg.ticketRoot,
    trunkBranch: cfg.trunkBranch,
    git,
    now: () => new Date().toISOString(),
    newId: () => randomUUID(),
    log: (l) => console.log(l),
  })
}

/**
 * 🔴 **export 해야 한다** — `dispatch.test.ts` 가 `VERB_MODULES` 의 모든 대상이 `runCli` 를 내보내는지
 *    검사한다(REQ-2026-090 경계 계약). phase-3 에서 `const` 로만 두어 그 계약이 깨졌고,
 *    **전체 스위트에서만** 드러났다 — 이 verb 만 골라 돌린 테스트는 dispatch 표면을 보지 않는다.
 */
export const runCli = makeRunCli(main, 'req:delegate')
if (isEntrypoint(import.meta.url)) runCli(process.argv.slice(2))
