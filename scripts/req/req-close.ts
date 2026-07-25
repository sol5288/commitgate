#!/usr/bin/env tsx
/**
 * req:close — 레거시 완료 티켓 **마이그레이션 종결**(REQ-2026-053·DEC-M).
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
} from './lib/evidence'
import { parseCloseProof, appendCloseProofRow, closeProofPath } from './lib/close-proof'
import { planMigrationClose, type MigrationFacts } from './lib/close-migrate'

let gitAdapter: GitAdapter = createGitAdapter(packageRoot())
function git(args: string[]): string {
  return gitAdapter.exec(args)
}

export interface Opts {
  reqId: string | null
  migrate: boolean
  run: boolean
  root: string | null
}

/** 인자 파싱(fail-closed): 값 누락·알 수 없는 옵션은 즉시 throw. mainline override는 **의도적으로 없다**(DEC-M3.7). */
export function parseArgs(argv: string[]): Opts {
  const o: Opts = { reqId: null, migrate: false, run: false, root: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === undefined) continue
    if (a === '--') continue
    else if (a === '--migrate') o.migrate = true
    else if (a === '--run') o.run = true
    else if (a === '--root') {
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

/** HEAD state.json 본문에서 커밋된 phase 계획 id(`phases[].id`)를 뽑는다(파싱 불가·부재 → []). r02 P1 완료성 기준. */
export function committedPlannedPhaseIds(stateText: string | null): string[] {
  if (!stateText) return []
  let raw: unknown
  try {
    raw = JSON.parse(stateText)
  } catch {
    return []
  }
  const phases = (raw as { phases?: unknown }).phases
  if (!Array.isArray(phases)) return []
  return phases
    .map((p) => (p && typeof p === 'object' ? (p as { id?: unknown }).id : undefined))
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
}

export function main(argv: string[] = process.argv.slice(2)): void {
  const o = parseArgs(argv)
  if (!o.reqId) throw new Error('REQ 필요 (예: req:close 2026-049 --migrate)')
  if (!o.migrate) throw new Error('현재 --migrate 모드만 지원합니다 (예: req:close 2026-049 --migrate --run)')
  const cfg = loadConfig({ root: o.root })
  gitAdapter = createGitAdapter(cfg.root)
  const reqId = o.reqId.startsWith('REQ-') ? o.reqId : `REQ-${o.reqId}`
  const ticketDir = join(cfg.workflowDirAbs, reqId)
  const ticketRel = relative(cfg.root, ticketDir).replace(/\\/g, '/')
  const manifestRel = `${ticketRel}/responses/approvals.jsonl`

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
  git(['commit', '-m', `chore(${reqId}): migrated-complete close proof (레거시 마이그레이션 종결·REQ-2026-053)`, '--', cpRel])
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
