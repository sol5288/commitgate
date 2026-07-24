#!/usr/bin/env tsx
/**
 * req:reconstruct — 소실된 close-proof lifecycle 행을 **HEAD-committed immutable evidence만으로** 복원한다
 * (REQ-2026-052 phase-4·DEC-D2). 복원 가능성 매트릭스는 `lib/reconstruct`(순수)가 판정하고, 이 CLI는 evidence를
 * HEAD blob에서 뽑아 넣고 부작용(durable commit)을 낸다.
 *
 * 🔴 **HEAD blob만** 읽는다 — runtime state·워킹트리·미커밋 원장·추정 phase 목록을 근거로 쓰지 않는다.
 * 🔴 `verifyCommittedEvidenceIntegrity`가 실패한(손상) 티켓은 **복원하지 않고 fail-closed**한다.
 * 🔴 **dev-complete·phase_design_ref·design/phase archive는 절대 합성하지 않는다.** state.json을 고치지 않는다.
 * 🔴 기본 **dry-run**. `--run` + **`--confirm`(사람 확인)** 후에만 write. 새 행은 `reconstructed:true` +
 *    비어있지 않은 `evidence_basis`. append-only·자연키 멱등 → 재시도가 중복 행/추가 커밋을 만들지 않는다.
 *
 * 사용: req:reconstruct <REQ> [--run] [--confirm] [--root <dir>]
 */
import { writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadConfig, packageRoot } from './lib/config'
import { createGitAdapter, type GitAdapter } from './lib/adapters'
import { createEvidencePorts } from './lib/evidence-ports'
import { verifyCommittedEvidenceIntegrity } from './lib/evidence'
import { parseCloseProof, appendCloseProofRow, closeProofPath, type CloseProofRow } from './lib/close-proof'
import { planReconstruction, type SuccessorEvidence, type ReconstructPlan } from './lib/reconstruct'
import { listHeadTicketIds } from './lib/intake'
import { isValidHumanResolution } from './review-codex'

let gitAdapter: GitAdapter = createGitAdapter(packageRoot())
function git(args: string[]): string {
  return gitAdapter.exec(args)
}
/** `HEAD:<repoRel>` blob 텍스트(없으면 null). */
function headBlob(repoRel: string): string | null {
  try {
    return git(['show', `HEAD:${repoRel}`])
  } catch {
    return null
  }
}

export interface Opts {
  reqId: string | null
  run: boolean
  confirm: boolean
  root: string | null
}

/** 인자 파싱(fail-closed): 값 누락·알 수 없는 옵션은 즉시 throw. */
export function parseArgs(argv: string[]): Opts {
  const o: Opts = { reqId: null, run: false, confirm: false, root: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === undefined) continue
    if (a === '--') continue
    else if (a === '--run') o.run = true
    else if (a === '--confirm') o.confirm = true
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
 * 이 티켓을 replace 부모로 지목하는 committed successor 증거를 HEAD tree에서 수집(read-only).
 * 🔴 구식 successor_of(`parent_series_id` 없음)·비-replace·형식 무효는 제외한다(복원 불가 — 수집 안 함).
 */
export function collectSuccessorEvidence(workflowDirRel: string, parentReqId: string, gitFn: (a: string[]) => string): SuccessorEvidence[] {
  const headBlobVia = (rel: string): string | null => {
    try {
      return gitFn(['show', `HEAD:${rel}`])
    } catch {
      return null
    }
  }
  const out: SuccessorEvidence[] = []
  for (const id of listHeadTicketIds(workflowDirRel, gitFn)) {
    if (id === parentReqId) continue
    const rel = `${workflowDirRel}/${id}`
    const stateText = headBlobVia(`${rel}/state.json`)
    if (stateText === null) continue
    let so: unknown
    try {
      so = (JSON.parse(stateText) as { successor_of?: unknown }).successor_of
    } catch {
      continue
    }
    if (!so || typeof so !== 'object') continue
    const s = so as { req_id?: unknown; parent_series_id?: unknown; parent_replace_resolution?: unknown }
    if (s.req_id !== parentReqId) continue
    if (typeof s.parent_series_id !== 'string' || !s.parent_series_id) continue // 구식 → 복원 불가
    const hr = s.parent_replace_resolution
    if (!isValidHumanResolution(hr) || (hr as { decision?: unknown }).decision !== 'replace') continue
    out.push({
      successorTicketId: id,
      successorStatePath: `${rel}/state.json`,
      parentSeriesId: s.parent_series_id,
      resolution: 'replace', // collect는 decision==='replace'만 통과시킨다(material field로 명시).
      at: (hr as { decided_at: string }).decided_at,
    })
  }
  return out
}

function renderPlan(reqId: string, plan: ReconstructPlan): string {
  const lines: string[] = [`[req:reconstruct] ${reqId} — 복원 계획(HEAD-committed 증거 기준)`]
  if (plan.candidates.length) {
    lines.push('  복원 예정 행:')
    for (const c of plan.candidates)
      lines.push(`    - series-terminal series_id=${c.row.series_id} resolution=${c.row.resolution} at=${c.row.at} · evidence_basis=[${c.evidenceBasis.join(', ')}]`)
  } else {
    lines.push('  복원 예정 행: 없음')
  }
  if (plan.refusals.length) {
    lines.push('  복원 불가·불필요·모호:')
    for (const r of plan.refusals) lines.push(`    - ${r}`)
  }
  if (plan.conflicts.length) {
    lines.push('  🔴 fail-closed conflict(HEAD 모순 — write 0):')
    for (const c of plan.conflicts) lines.push(`    - ${c}`)
  }
  return lines.join('\n')
}

export function main(argv: string[] = process.argv.slice(2)): void {
  const o = parseArgs(argv)
  if (!o.reqId) throw new Error('REQ 필요 (예: req:reconstruct 2026-029)')
  const cfg = loadConfig({ root: o.root })
  gitAdapter = createGitAdapter(cfg.root)
  const reqId = o.reqId.startsWith('REQ-') ? o.reqId : `REQ-${o.reqId}`
  const ticketDir = join(cfg.workflowDirAbs, reqId)
  const ticketRel = relative(cfg.root, ticketDir).replace(/\\/g, '/')
  const workflowDirRel = relative(cfg.root, cfg.workflowDirAbs).replace(/\\/g, '/')

  // 🔴 1. 손상 티켓은 복원하지 않는다(fail-closed) — verifyCommittedEvidenceIntegrity(design+phase HEAD 무결성).
  const ports = createEvidencePorts(cfg.root, `${ticketRel}/responses`)
  const manifestText = ports.headText(`${ticketRel}/responses/approvals.jsonl`)
  const integrity = verifyCommittedEvidenceIntegrity({ ticketRel, manifestText, ports })
  if (integrity.problems.length)
    throw new Error(`${reqId}: committed 증거 손상 — 복원 거부(fail-closed): ${integrity.problems.slice(0, 3).join('; ')}`)

  // 2. 이 티켓 HEAD close-proof(모순/중복 판정 기준). 손상이면 거부.
  const cpRel = closeProofPath(ticketRel)
  const cpText = headBlob(cpRel)
  const parsed = cpText ? parseCloseProof(cpText) : { rows: [], problems: [] }
  if (parsed.problems.length)
    throw new Error(`${reqId}: HEAD close-proof 손상 — 복원 거부: ${parsed.problems.slice(0, 3).join('; ')}`)

  // 3. successor 증거 수집(HEAD tree) → 매트릭스(순수) 판정.
  const successors = collectSuccessorEvidence(workflowDirRel, reqId, (a) => git(a))
  const plan = planReconstruction({ ticketId: reqId, existingRows: parsed.rows, successors })
  console.log(renderPlan(reqId, plan))

  // 🔴 conflict(HEAD 모순)는 dry-run/`--run` 무관하게 **명령 전체를 fail-closed**한다 — 멱등으로 숨기지 않는다.
  if (plan.conflicts.length)
    throw new Error(`${reqId}: HEAD close-proof와 모순되는 복원 대상(conflict) — fail-closed(write 0): ${plan.conflicts.join('; ')}`)

  // 4. 실행 모델.
  if (!o.run) {
    console.log('[req:reconstruct] DRY-RUN — write 없음(--run 시 실행).')
    return
  }
  if (!o.confirm) {
    console.log('[req:reconstruct] --run 지정됐으나 사람 확인 없음 — write 0. 위 계획을 확인했으면 `--confirm` 을 추가하세요.')
    return
  }
  if (plan.candidates.length === 0) {
    console.log('[req:reconstruct] 복원 가능한 행이 없습니다 — no-op(write 0).')
    return
  }

  // 🔴 5. 쓰기 전 안전: 대상 close-proof가 **HEAD와 동일**(워킹트리·인덱스에 미커밋 변경 없음)이어야 한다.
  //    아니면 HEAD 기반으로 덮어쓰다 사용자의 미커밋 close-proof 행을 **잃는다**(리뷰 P1). 불일치면 fail-closed.
  const cpDirty = git(['status', '--porcelain', '--', cpRel]).trim()
  if (cpDirty)
    throw new Error(
      `${reqId}: close-proof(${cpRel})에 미커밋 변경이 있어 복원을 거부합니다(fail-closed) — HEAD 기반 쓰기가 미커밋 행을 덮어쓸 수 있습니다.\n` +
        `  먼저 미커밋 close-proof 변경을 커밋하거나 정리한 뒤 다시 실행하세요.`,
    )

  // 6. 쓰기: append(자연키 멱등) → durable commit(pathspec). 재시도는 duplicate라 커밋 diff 없음.
  let content = cpText ?? ''
  let appended = 0
  for (const c of plan.candidates) {
    const res = appendCloseProofRow(content, c.row)
    if (res.outcome === 'appended') {
      content = res.content
      appended++
    } else if (res.outcome === 'conflict') {
      throw new Error(`복원 충돌(fail-closed): ${res.problems.join('; ')}`)
    }
    // duplicate → 이미 존재(멱등 skip).
  }
  if (appended === 0) {
    console.log('[req:reconstruct] 대상 행이 이미 모두 존재 — no-op(멱등).')
    return
  }
  writeFileSync(join(cfg.root, cpRel), content, 'utf8')
  git(['add', '--', cpRel])
  git(['commit', '-m', `chore(${reqId}): reconstruct series-terminal close proof (evidence-based)`, '--', cpRel])
  console.log(`[req:reconstruct] ✅ ${appended}행 복원·durable commit(reconstructed:true·evidence_basis).`)
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
