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
 *   - **abandoned**(REQ-2026-093 DEC-6): 🔴 **절대 산출하지 않는다.** 포기는 사람의 결정이고 사유·승인
 *     문장·시각은 그 사람만 안다 — HEAD 증거로 유도할 수 있는 값이 하나도 없다. 추측해 복원하면
 *     "누가 왜 포기했는가"를 도구가 지어내는 것이 된다(series-terminal(terminate)와 같은 이유).
 *     포기 행이 유실됐다면 사람이 `req:close --abandon`을 다시 실행하는 것이 유일한 경로다.
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
  /** 종결 사유. successor는 항상 `replace`(collect가 그렇게 거른다) — material field로 명시 검사한다. */
  resolution: 'replace'
  /** `successor_of.parent_replace_resolution.decided_at` — 종결 시점(부모 값). */
  at: string
}

export interface ReconstructCandidate {
  row: CloseProofRow
  evidenceBasis: string[]
}

export interface ReconstructPlan {
  /** 복원 예정(신규) 행. */
  candidates: ReconstructCandidate[]
  /** 복원 불가·불필요·모호 사유(진단 표시용 — write는 안 하지만 명령은 계속). */
  refusals: string[]
  /** 🔴 fail-closed conflict(HEAD 모순) — 하나라도 있으면 CLI는 **전체를 write 0으로 중단**한다. */
  conflicts: string[]
}

/**
 * 이 티켓의 복원 가능한 close-proof 행을 매트릭스(DEC-D2 multi-witness)대로 산출(순수). dev-complete는 절대 산출 안 함.
 *
 * 🔴 **parent_series_id별 그룹화**: 같은 series를 가리키는 복수 witness의 material field(resolution·at)가 **전부 일치**할
 *    때만 후보 1개(evidence_basis=모든 successor state 경로 정렬·중복제거). 불일치=ambiguity refusal(그 series write 0).
 * 🔴 **HEAD 정합**: 같은 자연키 행이 HEAD에 있으면 material 일치=멱등 no-op, 모순=**conflict**(숨기지 않고 fail-closed).
 *
 * @param existingRows 이 티켓 HEAD close-proof를 파싱한 행들. 손상 티켓은 CLI가 이 함수 **전에** 거른다.
 * @param successors 이 티켓을 부모로 지목하는 committed successor 증거들.
 */
export function planReconstruction(args: {
  ticketId: string
  existingRows: readonly CloseProofRow[]
  successors: readonly SuccessorEvidence[]
}): ReconstructPlan {
  const candidates: ReconstructCandidate[] = []
  const refusals: string[] = []
  const conflicts: string[] = []

  // ① parent_series_id별 그룹화(빈 필드는 미결정으로 개별 refusal).
  const groups = new Map<string, SuccessorEvidence[]>()
  for (const s of args.successors) {
    if (!s.parentSeriesId || !s.at || !s.resolution) {
      refusals.push(`successor ${s.successorTicketId}: parent_series_id·resolution·at 중 미결정 → 복원 불가(모호)`)
      continue
    }
    const g = groups.get(s.parentSeriesId)
    if (g) g.push(s)
    else groups.set(s.parentSeriesId, [s])
  }

  for (const seriesId of [...groups.keys()].sort()) {
    const witnesses = groups.get(seriesId)!
    // ② material field(resolution·at) 전부 일치해야 후보. 불일치=ambiguity(그 series 후보 없음).
    const ats = new Set(witnesses.map((w) => w.at))
    const resolutions = new Set(witnesses.map((w) => w.resolution))
    if (ats.size > 1 || resolutions.size > 1) {
      refusals.push(
        `series ${seriesId}: 복수 successor의 material field 불일치(at=[${[...ats].sort().join(', ')}] resolution=[${[...resolutions].sort().join(', ')}]) → ambiguity 복원 불가(write 0)`,
      )
      continue
    }
    const at = witnesses[0]!.at
    const resolution = witnesses[0]!.resolution
    // 완전 일치하는 복수 witness → evidence_basis에 모든 경로 정렬·중복제거.
    const evidenceBasis = [...new Set(witnesses.map((w) => w.successorStatePath))].sort()
    const row: CloseProofRow = {
      ticket_id: args.ticketId,
      event: 'series-terminal',
      series_id: seriesId,
      resolution,
      phase_inventory: null,
      design_ref: null,
      at,
      reconstructed: true,
      evidence_basis: evidenceBasis,
    }
    // ③ HEAD 정합: 같은 자연키 행이 있으면 material 일치=멱등 no-op, 모순=conflict(fail-closed).
    const key = closeProofRowKey(row)
    const prior = args.existingRows.find((r) => closeProofRowKey(r) === key)
    if (prior) {
      if (prior.resolution === resolution && prior.at === at) {
        refusals.push(`series ${seriesId}: 동일 series-terminal 행이 HEAD에 존재 → 복원 불필요(멱등 no-op)`)
      } else {
        conflicts.push(
          `series ${seriesId}: HEAD 행과 모순(HEAD at=${prior.at} resolution=${prior.resolution} ≠ 후보 at=${at} resolution=${resolution}) → fail-closed(숨기지 않음)`,
        )
      }
      continue
    }
    candidates.push({ row, evidenceBasis })
  }
  return { candidates, refusals, conflicts }
}
