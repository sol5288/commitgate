/**
 * req:reconstruct 복원 가능성 매트릭스 (REQ-2026-052 phase-4·DEC-D2) — **순수** 산출.
 *
 * 🔴 close-proof lifecycle event는 `dev-complete`·`series-terminal` 둘뿐이다. 이 모듈은 **HEAD-committed
 *    immutable evidence가 행의 모든 필드를 명확·모호없이 결정할 때만** 복원 후보를 낸다:
 *   - **dev-complete**: 🔴 **절대 산출하지 않는다.** `phase_inventory`를 approvals.jsonl의 phase_id 집합으로
 *     합성하면 계획됐으나 미커밋인 phase를 조용히 빼는 DEC-B5 P1이 재발한다. inventory 독립 기록이 없으므로
 *     self-verifying 행이 없으면 복원 근거가 없다 → 재검토·재내구화가 유일 경로.
 *   - **series-terminal(replace)**: 커밋된 **successor** 티켓의 `successor_of`(parent_series_id 포함)가
 *     이 티켓 replace 종결을 완전히 증명할 때만.
 *   - **series-terminal(terminate)**: successor를 만들지 않아 증거가 없다 → 불가.
 *
 * fs·git·review-codex를 모르는 leaf(부작용·evidence 추출은 CLI가 한다).
 */
import { type CloseProofRow, closeProofRowKey } from './close-proof'

/** 이 티켓을 replace 부모로 지목하는 committed successor의 추출 증거(CLI가 HEAD blob에서 뽑아 넣는다). */
export interface SuccessorEvidence {
  /** successor 티켓 id(진단용). */
  successorTicketId: string
  /** successor `state.json`의 repo-상대 경로 — evidence_basis. */
  successorStatePath: string
  /** `successor_of.parent_series_id` — 부모의 replace 종결 series_id. */
  parentSeriesId: string
  /** `successor_of.parent_replace_resolution.at` — 종결 시점(부모 값). */
  at: string
}

export interface ReconstructCandidate {
  row: CloseProofRow
  evidenceBasis: string[]
}

export interface ReconstructPlan {
  /** 복원 예정(신규) 행. */
  candidates: ReconstructCandidate[]
  /** 복원 불가·불필요 사유(진단 표시용). */
  refusals: string[]
}

/**
 * 이 티켓의 복원 가능한 close-proof 행을 매트릭스(DEC-D2)대로 산출(순수). dev-complete는 절대 산출 안 함.
 *
 * @param existingRows 이 티켓 HEAD close-proof를 파싱한 행들(모순/중복 판정 기준). 손상 티켓은 CLI가 이 함수 **전에** 거른다.
 * @param successors 이 티켓을 부모로 지목하는 committed successor 증거들.
 */
export function planReconstruction(args: {
  ticketId: string
  existingRows: readonly CloseProofRow[]
  successors: readonly SuccessorEvidence[]
}): ReconstructPlan {
  const candidates: ReconstructCandidate[] = []
  const refusals: string[] = []
  const seen = new Set<string>()
  for (const s of args.successors) {
    // 필드 완전성(요구 불변식 #3): series_id·at가 모두 명확해야 한다.
    if (!s.parentSeriesId || !s.at) {
      refusals.push(`successor ${s.successorTicketId}: parent_series_id 또는 at 미결정 → 복원 불가(모호)`)
      continue
    }
    const row: CloseProofRow = {
      ticket_id: args.ticketId,
      event: 'series-terminal',
      series_id: s.parentSeriesId,
      resolution: 'replace',
      phase_inventory: null,
      design_ref: null,
      at: s.at,
      reconstructed: true,
      evidence_basis: [s.successorStatePath],
    }
    const key = closeProofRowKey(row)
    // 🔴 기존 HEAD 행과 모순/중복: 같은 자연키가 이미 있으면 복원 불필요(append가 duplicate/conflict로 안전 처리).
    if (args.existingRows.some((r) => closeProofRowKey(r) === key)) {
      refusals.push(`series ${s.parentSeriesId}: 이미 series-terminal 행이 HEAD에 존재 → 복원 불필요`)
      continue
    }
    if (seen.has(key)) continue // 같은 실행에서 중복 successor는 한 번만.
    seen.add(key)
    candidates.push({ row, evidenceBasis: [s.successorStatePath] })
  }
  return { candidates, refusals }
}
