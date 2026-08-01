#!/usr/bin/env tsx
/**
 * req:close — 티켓의 **사후 종결** 두 모드.
 *
 *   1. `--migrate` — 레거시 **완료** 티켓 마이그레이션 종결(REQ-2026-053·DEC-M). 아래 본문.
 *   2. `--abandon` — 사람의 **포기** 선언(REQ-2026-093). `runAbandon` 참조.
 *
 * 🔴 두 모드는 **의미가 반대다**: `--migrate`는 "완료됐음을 사후 확인"(integrated 증명 필요),
 *    `--abandon`은 "완료되지 않을 것임을 선언"(증명 대상 없음). 그래서 상호배타이고, 포기 경로는
 *    마이그레이션의 사전 조건(mainline 해소·매니페스트 무결성·integrated)을 **하나도 공유하지 않는다**.
 *
 * ── 이하 `--migrate` ──
 *
 * close-proof/`phase_design_ref` regime **이전에** 완료·병합돼 dev-complete로 자기증명될 수 없는 durable
 * 티켓을, 운영자 확인 후 `migrated-complete` close-proof 행으로 감사 가능하게 종결한다. 자격 판정은
 * `lib/close-migrate`(순수)가, HEAD blob 수집·integrated 계산·durable 커밋은 이 CLI가 낸다.
 *
 * 🔴 **HEAD-committed 증거 + git ancestry만** 근거로 쓴다 — 워킹 state·미커밋 원장·추정 phase 목록 미사용.
 * 🔴 완료성 증명 = **integrated**(티켓 매니페스트 커밋이 본선 조상). mainline ref는 **운영자 입력을 받지 않고**
 *    신뢰된 ref로만 해소(origin/HEAD→origin/main→로컬 main). 미해소면 fail-closed.
 * 🔴 기본 **dry-run**. `--run` 후에만 write. 새 행은 `reconstructed:true` + 비어있지 않은 evidence_basis.
 *    쓰기 전 close-proof clean 가드(미커밋 close-proof를 HEAD 기반 쓰기가 덮지 않게). append-only·자연키 멱등.
 *
 * 사용: req:close <REQ> --migrate [--run] [--root <dir>]
 *       req:close <REQ> --abandon --reason "<사유>" --confirm "<승인 문장>" [--run] [--root <dir>]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadConfig, packageRoot } from './lib/config'
import { createGitAdapter, safeSpawnSyncStatus, type GitAdapter } from './lib/adapters'
import { createEvidencePorts } from './lib/evidence-ports'
import {
  isDurabilityRequired,
  verifyCommittedEvidenceIntegrity,
  validateManifest,
  evidencedPhaseIdsFromManifest,
  designHashFromManifest,
  splitUnboundPhases,
  plannedPhaseIdsFromState,
} from './lib/evidence'
import { parseCloseProof, appendCloseProofRow, closeProofPath, verifiedTerminalEvent, type CloseProofRow } from './lib/close-proof'
import { planMigrationClose, type MigrationFacts } from './lib/close-migrate'
import { assertSetupComplete } from './lib/setup-gate'
import { bookkeepingMessage } from './lib/bookkeeping'

let gitAdapter: GitAdapter = createGitAdapter(packageRoot())
function git(args: string[]): string {
  return gitAdapter.exec(args)
}

export interface Opts {
  reqId: string | null
  migrate: boolean
  /** REQ-2026-093: 사람의 명시적 포기 종결. `migrate`와 상호배타. */
  abandon: boolean
  reason: string | null
  confirm: string | null
  run: boolean
  root: string | null
}

/** 인자 파싱(fail-closed): 값 누락·알 수 없는 옵션은 즉시 throw. mainline override는 **의도적으로 없다**(DEC-M3.7). */
export function parseArgs(argv: string[]): Opts {
  const o: Opts = { reqId: null, migrate: false, abandon: false, reason: null, confirm: null, run: false, root: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === undefined) continue
    if (a === '--') continue
    else if (a === '--migrate') o.migrate = true
    else if (a === '--abandon') o.abandon = true
    else if (a === '--run') o.run = true
    else if (a === '--reason' || a === '--confirm') {
      // 🔴 사유·승인 문장은 `-`로 시작할 수 있으므로 접두 검사를 하지 않는다(값 부재만 거부).
      //    `req:confirm`의 `--method`/`--note`와 같은 취급이다.
      const v = argv[++i]
      if (v === undefined) throw new Error(`${a} 값이 필요합니다`)
      if (a === '--reason') o.reason = v
      else o.confirm = v
    } else if (a === '--root') {
      const v = argv[++i]
      if (v === undefined) throw new Error('--root 값 필요')
      o.root = v
    } else if (a.startsWith('-')) throw new Error(`알 수 없는 옵션: ${a}`)
    else o.reqId = a
  }
  return o
}

/**
 * 🔴 mainline ref를 **신뢰된 소스로만** 해소한다(DEC-M3.7·r02 P1). 운영자 입력을 받지 않는다 —
 *    임의 feature/HEAD ref로 integrated를 통과시키는 우회를 막는다. 순서:
 *    ① origin/HEAD(원격이 선언한 기본 브랜치) → ② origin/main·master → ③ 로컬 main·master. 없으면 null(fail-closed).
 */
export function resolveMainline(gitFn: (a: string[]) => string): string | null {
  try {
    const sym = gitFn(['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD']).trim()
    if (sym) return sym.replace(/^refs\/remotes\//, '') // 예: refs/remotes/origin/main → origin/main
  } catch {
    /* origin/HEAD 없음 — 다음 후보로 */
  }
  for (const ref of ['origin/main', 'origin/master', 'main', 'master']) {
    try {
      if (gitFn(['rev-parse', '--verify', '--quiet', ref]).trim()) return ref
    } catch {
      /* 해당 ref 없음 */
    }
  }
  return null
}

/** `git merge-base --is-ancestor a b` — a가 b의 조상이면 true(exit 0), 아니면 false(exit 1), 그 외는 throw. */
export function isAncestor(root: string, a: string, b: string): boolean {
  const res = safeSpawnSyncStatus('git', ['merge-base', '--is-ancestor', a, b], { cwd: root })
  if (res.status === 0) return true
  if (res.status === 1) return false
  throw new Error(`git merge-base --is-ancestor 실패(status=${res.status ?? 'null'}): ${res.stderr.trim()}`)
}

/**
 * HEAD state.json 본문에서 커밋된 phase 계획 id(`phases[].id`)를 뽑는다(파싱 불가·부재 → []). r02 P1 완료성 기준.
 * 🔴 REQ-2026-072: 구현은 `lib/evidence`(정본)로 옮겼다 — `req:rebind`의 완료 재판정이 같은 파서를 쓴다.
 *    기존 이름은 호출부·테스트 호환을 위해 유지한다.
 */
export const committedPlannedPhaseIds = plannedPhaseIdsFromState

/**
 * 🔴 포기 종결(REQ-2026-093 DEC-4). 사람이 "이 티켓은 더 진행하지 않는다"를 선언해 durable 종결한다.
 *
 * **무엇을 하지 않는가가 이 함수의 계약이다**(DEC-5): 커밋된 phase 증거·`approvals.jsonl`·설계 승인·
 * 원장을 **한 바이트도 건드리지 않는다.** `ticket-close.jsonl`에 선언 한 줄을 append할 뿐이다.
 *
 * 그리고 **의도적으로 적게 검사한다**. 마이그레이션 경로가 요구하는 mainline 해소·integrated·매니페스트
 * 무결성을 여기서 요구하면, 바로 그것들이 깨진 티켓(= 탈출구가 가장 필요한 티켓)에서 탈출구가 사라진다.
 * 유일하게 fail-closed로 막는 것은 **close-proof 자신의 손상·미커밋**이다 — 감사 파일에 덧쓰기 때문이다.
 */
function runAbandon(args: {
  o: Opts
  cfg: { root: string }
  reqId: string
  ticketRel: string
  manifestRel: string
}): void {
  const { o, cfg, reqId, ticketRel, manifestRel } = args
  const reason = (o.reason ?? '').trim()
  const confirm = (o.confirm ?? '').trim()
  if (!reason) throw new Error('--reason 이 필요합니다(포기 사유는 감사 기록의 핵심입니다) — 예: --reason "요구가 철회됨"')
  if (!confirm) throw new Error('--confirm 이 필요합니다(누가 어떻게 승인했는지) — 예: --confirm "PM 승인 2026-08-01"')

  const ports = createEvidencePorts(cfg.root, `${ticketRel}/responses`)
  const stateText = ports.headText(`${ticketRel}/state.json`)
  if (!isDurabilityRequired(stateText))
    throw new Error(
      `${reqId}: durable 티켓이 아닙니다(legacy) — 포기 종결 대상이 아닙니다.\n` +
        `  legacy 티켓은 req:new intake를 막지 않으므로 탈출구가 필요 없습니다.`,
    )

  const closeText = ports.headText(closeProofPath(ticketRel))
  const closeParsed = closeText ? parseCloseProof(closeText) : { rows: [], problems: [] }
  if (closeParsed.problems.length)
    throw new Error(
      `${reqId}: 커밋된 close-proof가 손상돼 있어 덧쓸 수 없습니다(fail-closed): ${closeParsed.problems.slice(0, 3).join('; ')}`,
    )

  // 매니페스트는 **한 번만** 읽는다(아래 멱등 판정과 가시성 경고가 같은 값을 쓴다 — 두 번 읽으면 갈릴 수 있다).
  const manifestText = ports.headText(manifestRel)
  const committedDesignRef = manifestText ? designHashFromManifest(manifestText) : null

  // 🔴 멱등(DEC-7): 이미 종결된 티켓이면 성공 no-op. `deriveBaseState`와 **같은 술어**를 쓴다.
  const already = verifiedTerminalEvent({
    closeProofRows: closeParsed.rows,
    evidencedPhaseIds: manifestText ? evidencedPhaseIdsFromManifest(manifestText, committedDesignRef) : [],
    committedDesignRef,
  })
  if (already) {
    console.log(`[req:close] ${reqId} 이미 종결(${already}) — no-op(write 0).`)
    return
  }

  // 🔴 DEC-8 가시성: 커밋된 phase가 있으면 **결정 직전에** 그 사실과 "지워지지 않는다"를 알린다.
  //    🔴 여기서는 design 결속으로 거르지 **않는다**(인자 없는 `evidencedPhaseIdsFromManifest`).
  //    경고의 목적은 "무엇이 유효한 완료인가"가 아니라 "무엇이 이미 커밋돼 남는가"이기 때문이다 —
  //    결속이 끊긴 phase도 커밋은 그대로 남으므로 사용자에게 알려야 한다.
  const committedPhases = manifestText ? evidencedPhaseIdsFromManifest(manifestText) : []
  console.log(`[req:close] ${reqId} 포기 종결(abandoned) 계획:`)
  console.log(`  사유    : ${reason}`)
  console.log(`  승인    : ${confirm}`)
  if (committedPhases.length) {
    console.log(`  ⚠️  이 티켓에는 이미 커밋된 phase가 ${committedPhases.length}개 있습니다: ${committedPhases.join(', ')}`)
    console.log('     포기해도 그 커밋과 증거는 **지워지지 않고 히스토리에 그대로 남습니다** — 되돌리기가 아닙니다.')
  }
  console.log('  이 명령은 ticket-close.jsonl 에 선언 한 줄만 추가합니다(증거·매니페스트·원장 무변경).')

  if (!o.run) {
    console.log('[req:close] DRY-RUN — write 없음(--run 시 실행).')
    return
  }

  const cpRel = closeProofPath(ticketRel)
  const cpDirty = git(['status', '--porcelain', '--', cpRel]).trim()
  if (cpDirty)
    throw new Error(
      `${reqId}: close-proof(${cpRel})에 미커밋 변경이 있어 종결을 거부합니다(fail-closed) — HEAD 기반 쓰기가 미커밋 행을 덮을 수 있습니다.\n` +
        `  먼저 미커밋 close-proof 변경을 커밋/정리한 뒤 다시 실행하세요.`,
    )

  const row: CloseProofRow = {
    ticket_id: reqId,
    event: 'abandoned',
    series_id: null,
    resolution: null,
    phase_inventory: null,
    design_ref: null,
    // 🔴 R3: 시각은 **도구가 실제 시계에서** 찍는다. 사람이 적어 넣는 자리를 만들지 않는다.
    at: new Date().toISOString(),
    reconstructed: false,
    evidence_basis: null,
    abandon_reason: reason,
    method: confirm,
  }
  const abs = join(cfg.root, cpRel)
  const existing = existsSync(abs) ? readFileSync(abs, 'utf8') : ''
  const res = appendCloseProofRow(existing, row)
  if (res.outcome === 'conflict') throw new Error(`close proof 충돌(fail-closed): ${res.problems.join('; ')}`)
  if (res.outcome === 'duplicate') {
    console.log('[req:close] 동일 abandoned 행이 이미 존재 — no-op(멱등).')
    return
  }
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, res.content, 'utf8')
  // 🔴 pathspec 커밋 — 이 경로만. 사용자가 stage해 둔 코드/문서는 인덱스에 그대로 남는다.
  git(['add', '--', cpRel])
  git(['commit', '-m', bookkeepingMessage(`chore(${reqId}): abandoned close proof (사람 포기 선언·REQ-2026-093)`), '--', cpRel])
  console.log(`[req:close] ✅ ${reqId} 포기 종결 커밋 — 이제 req:new 가 이 티켓 때문에 막히지 않습니다.`)
}

export function main(argv: string[] = process.argv.slice(2)): void {
  const o = parseArgs(argv)
  // 🔴 setup 완료 게이트(REQ-2026-062 DEC-6) — **가장 앞**이다. 다른 어떤 IO·판정보다 먼저여야 부분 상태가 남지 않는다.
  assertSetupComplete({ root: o.root })
  if (!o.reqId) throw new Error('REQ 필요 (예: req:close 2026-049 --migrate)')
  // 🔴 REQ-2026-093: 두 모드는 의미가 다르다(완료 확인 vs 포기 선언) — 동시 지정은 fail-closed.
  if (o.migrate && o.abandon) throw new Error('--migrate 와 --abandon 은 함께 쓸 수 없습니다(완료 종결과 포기 종결은 다른 결정입니다)')
  if (!o.migrate && !o.abandon)
    throw new Error('모드가 필요합니다 — --migrate(레거시 완료 종결) 또는 --abandon(포기 종결)')
  const cfg = loadConfig({ root: o.root })
  gitAdapter = createGitAdapter(cfg.root)
  const reqId = o.reqId.startsWith('REQ-') ? o.reqId : `REQ-${o.reqId}`
  const ticketDir = join(cfg.workflowDirAbs, reqId)
  const ticketRel = relative(cfg.root, ticketDir).replace(/\\/g, '/')
  const manifestRel = `${ticketRel}/responses/approvals.jsonl`

  // 🔴 REQ-2026-093: 포기 경로는 **여기서 갈라진다** — 아래 마이그레이션 준비(mainline 해소·매니페스트
  //    무결성·integrated 판정)를 **하나도 거치지 않는다**. 그것이 이 명령의 존재 이유다:
  //    mainline이 없는 저장소나 매니페스트가 손상된 티켓에서도 탈출구는 살아 있어야 한다.
  //    (`resolveMainline`은 미해소 시 throw한다 — 그 경로에 태우면 탈출구가 다시 막힌다.)
  if (o.abandon) return runAbandon({ o, cfg, reqId, ticketRel, manifestRel })

  // 1. HEAD 사실 수집(read-only). intake와 같은 포트·함수.
  const ports = createEvidencePorts(cfg.root, `${ticketRel}/responses`)
  const stateText = ports.headText(`${ticketRel}/state.json`)
  const durabilityRequired = isDurabilityRequired(stateText)
  const manifestText = ports.headText(manifestRel)
  const closeText = ports.headText(closeProofPath(ticketRel))
  const evidencedPhaseIdsAll = manifestText ? evidencedPhaseIdsFromManifest(manifestText) : []
  const manifestProblems = manifestText ? validateManifest(manifestText, { ticketRel, validPhaseIds: evidencedPhaseIdsAll }) : []
  const closeParsed = closeText ? parseCloseProof(closeText) : { rows: [], problems: [] }
  const committedDesignRef = manifestText ? designHashFromManifest(manifestText) : null
  const evidencedPhaseIdsBound = manifestText ? evidencedPhaseIdsFromManifest(manifestText, committedDesignRef) : []
  // 🔴 REQ-2026-072 DEC-2: 미결속 phase 중 재결속 가능한 것(= `phase_design_ref` 보유). intake 안내와
  //    **같은 helper**로 계산한다 — 한쪽이 권한 명령을 다른 쪽이 거부하는 표류를 막는다.
  const unboundSplit = manifestText ? splitUnboundPhases(manifestText, committedDesignRef) : { unbound: [], rebindable: [], legacy: [] }
  const integrity = verifyCommittedEvidenceIntegrity({ ticketRel, manifestText, ports })

  // 2. integrated(완료성 증명) — 티켓 매니페스트를 마지막으로 수정한 HEAD 커밋이 mainline의 조상인가.
  const mainline = resolveMainline((a) => git(a))
  if (!mainline)
    throw new Error(
      `${reqId}: mainline(main/origin/main)을 결정할 수 없어 integrated(완료성)를 판정할 수 없습니다 — fail-closed. ` +
        `본선 브랜치가 존재하는 저장소에서 실행하세요.`,
    )
  let lastManifestCommit = ''
  try {
    lastManifestCommit = git(['rev-list', '-1', 'HEAD', '--', manifestRel]).trim()
  } catch {
    lastManifestCommit = ''
  }
  const integrated = !!lastManifestCommit && isAncestor(cfg.root, lastManifestCommit, mainline)

  // 3. 순수 판정.
  const facts: MigrationFacts = {
    ticketId: reqId,
    ticketRel,
    durabilityRequired,
    manifestText,
    manifestProblems,
    closeProblems: closeParsed.problems,
    closeRows: closeParsed.rows,
    evidenceIntegrityProblems: integrity.problems,
    committedDesignRef,
    evidencedPhaseIdsAll,
    evidencedPhaseIdsBound,
    rebindablePhaseIds: unboundSplit.rebindable,
    committedPlannedPhaseIds: committedPlannedPhaseIds(stateText),
    integrated,
    nowIso: new Date().toISOString(),
    evidenceBasis: [manifestRel], // 마이그레이션 근거: 티켓 매니페스트(design_hash·phase_design_ref·archive_inventory의 단일 출처).
  }
  const plan = planMigrationClose(facts)

  if (plan.kind === 'refuse')
    throw new Error(`${reqId} 마이그레이션 종결 불가: ${plan.reason}\n  → ${plan.hint}`)
  if (plan.kind === 'noop') {
    console.log(`[req:close] ${reqId} 이미 종결(${plan.existingState}) — no-op(write 0).`)
    return
  }

  // plan.kind === 'stamp'
  console.log(`[req:close] ${reqId} 마이그레이션 종결(migrated-complete) 계획 (integrated=본선 조상, mainline=${mainline}):`)
  console.log(
    `  phase_inventory=[${plan.row.phase_inventory?.join(', ')}] design_ref=${(plan.row.design_ref ?? '').slice(0, 12)} ` +
      `evidence_basis=[${plan.row.evidence_basis?.join(', ')}]`,
  )
  if (!o.run) {
    console.log('[req:close] DRY-RUN — write 없음(--run 시 실행).')
    return
  }

  // 🔴 쓰기 전 clean 가드: close-proof가 HEAD와 동일해야(미커밋 close-proof를 HEAD 기반 쓰기가 잃지 않게).
  const cpRel = closeProofPath(ticketRel)
  const cpDirty = git(['status', '--porcelain', '--', cpRel]).trim()
  if (cpDirty)
    throw new Error(
      `${reqId}: close-proof(${cpRel})에 미커밋 변경이 있어 종결을 거부합니다(fail-closed) — HEAD 기반 쓰기가 미커밋 행을 덮을 수 있습니다.\n` +
        `  먼저 미커밋 close-proof 변경을 커밋/정리한 뒤 다시 실행하세요.`,
    )

  const abs = join(cfg.root, cpRel)
  const existing = existsSync(abs) ? readFileSync(abs, 'utf8') : ''
  const res = appendCloseProofRow(existing, plan.row)
  if (res.outcome === 'conflict') throw new Error(`close proof 충돌(fail-closed): ${res.problems.join('; ')}`)
  if (res.outcome === 'duplicate') {
    console.log('[req:close] 동일 migrated-complete 행이 이미 존재 — no-op(멱등).')
    return
  }
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, res.content, 'utf8')
  git(['add', '--', cpRel])
  git(['commit', '-m', bookkeepingMessage(`chore(${reqId}): migrated-complete close proof (레거시 마이그레이션 종결·REQ-2026-053)`), '--', cpRel])
  console.log(`[req:close] ✅ ${reqId} migrated-complete durable commit(reconstructed:true·evidence_basis).`)
}

/** bin dispatch 진입점(친절한 1줄 오류 + exit 1 경계). */
export function runCli(argv: string[]): void {
  try {
    main(argv)
  } catch (err) {
    console.error(`commitgate: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  }
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href
if (isMain) main()
