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
// REQ-2026-094: 승인 행 복원의 산출 타입. type-only import라 순환 없음(evidence는 이 모듈을 모른다).
import type { ManifestEntry } from './evidence'

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

// ─────────────────────────────────────────────────────────────────────────────
// REQ-2026-094: 승인 행(approvals.jsonl) 복원 판정 — 순수
//
// 🔴 이 모듈의 기존 원칙을 **그대로** 적용한다: HEAD-committed immutable evidence가 행의 **모든** 필드를
//    명확·모호없이 결정할 때만 후보를 낸다. 결정되지 않는 값은 **비운다**(채우면 그 자체가 날조다).
//
// 실측 근거(REQ-2026-094 §2): 소비 기록(`consumed_approvals[]`)만으로는 `approved_at`을 알 수 없고,
// `consumed_at`은 `approval_consumed_at`과 **다른 스탬프**다(같은 phase에서 …41.497Z vs …41.660Z).
// 그래서 1차 증인은 HEAD-committed `state.json.approval_evidence`다 — 승인 절반을 원본 값 그대로 담는다.
// ─────────────────────────────────────────────────────────────────────────────

/** W1 — HEAD `state.json.approval_evidence`에서 뽑은 phase 승인 핀(호출부가 파싱해 넣는다). */
export interface ApprovalEvidenceWitness {
  phase_id: string
  response_path: string
  response_sha256: string
  review_base_sha: string
  approved_tree: string
  approved_at: string
  /** 선택 — 있으면 그대로 옮긴다(부재는 레거시 무회귀, `phase_design_ref`는 매니페스트에서도 선택이다). */
  phase_design_ref?: string
}

/** W4 — HEAD `state.json.consumed_approvals[]`의 해당 항목(있을 수도, 없을 수도). */
export interface ConsumedWitness {
  approved_tree: string | null
  consumed_by_commit_sha: string
}

/** 승인 행 복원의 입력. 🔴 전부 **HEAD-committed 사실**. CLI가 포트로 채운다(이 모듈은 fs·git를 모른다). */
export interface ApprovalRestoreInput {
  ticketRel: string
  /** W1. 없으면 복원 불가(승인 절반을 결정할 수 없다). */
  evidence: ApprovalEvidenceWitness | null
  /** W2 — `evidence.response_path` blob의 HEAD 실제 sha256. 파일이 없으면 null. */
  archiveSha256AtHead: string | null
  /** W3 — tree가 `evidence.approved_tree`와 같은 **HEAD 조상 커밋**들. 정확히 하나여야 한다. */
  treeMatchCommits: readonly string[]
  /** W4(선택) — 소비 기록. 있으면 W1·W3와 일치해야 한다. */
  consumed: ConsumedWitness | null
  /** 이미 HEAD 매니페스트에 이 phase의 승인 행이 있는가(있으면 복원 불필요). */
  hasManifestRow: boolean
}

export interface ApprovalRestorePlan {
  /** 복원할 행. 증인이 하나라도 어긋나면 null. */
  candidate: ManifestEntry | null
  /** 왜 낼 수 없는지(또는 낼 필요가 없는지). 사용자에게 그대로 보여 준다. */
  refusals: string[]
}

/**
 * 승인 행 복원 판정(순수, REQ-2026-094 DEC-3). 증인 W1~W4가 **모두** 성립할 때만 후보를 낸다.
 *
 * 🔴 후보 행에는 `consumed_at`·`user_commit_confirmed`가 **없다**. 그 둘을 결정하는 HEAD 증거가
 *    존재하지 않기 때문이다 — 복원 시각 따위로 채우면 "언제 소비됐나"에 대한 거짓 진술이 된다.
 *    대신 `reconstructed:true` + `evidence_basis`로 **복원본임을 명시**한다(close-proof와 같은 어휘).
 *
 * 🔴 이 함수는 **승인을 부여하지 않는다**(DEC-6). 산출은 매니페스트 행 하나뿐이고, `commit_allowed`·
 *    `approved_diff_hash` 같은 승인 상태는 호출부도 건드리지 않는다.
 */
export function planApprovalRestore(input: ApprovalRestoreInput): ApprovalRestorePlan {
  const refusals: string[] = []
  if (input.hasManifestRow) return { candidate: null, refusals: ['이미 HEAD 매니페스트에 승인 행이 있습니다 — 복원 불필요(no-op)'] }

  const w1 = input.evidence
  if (!w1) {
    return {
      candidate: null,
      refusals: [
        'W1 없음: HEAD의 state.json에 이 phase의 approval_evidence가 없습니다.',
        '  승인 절반(approved_at·response_sha256·approved_tree …)을 결정할 방법이 없어 복원할 수 없습니다.',
        '  값을 추정해 채우지 않습니다 — 그것은 승인 기록의 날조입니다.',
      ],
    }
  }

  // W2 — 아카이브가 HEAD에 있고 내용이 핀과 일치해야 한다.
  if (input.archiveSha256AtHead === null)
    refusals.push(`W2 없음: 승인 아카이브가 HEAD에 없습니다(${w1.response_path}).`)
  else if (input.archiveSha256AtHead !== w1.response_sha256)
    refusals.push(
      `W2 불일치: 아카이브 내용이 핀과 다릅니다 — HEAD=${input.archiveSha256AtHead.slice(0, 12)} ≠ 핀=${w1.response_sha256.slice(0, 12)}.`,
    )

  // W3 — 승인 tree와 같은 tree를 가진 HEAD 조상 커밋이 **정확히 하나**. 그것이 source 커밋이다.
  //      `req:commit`은 인덱스를 커밋하므로 source 커밋의 tree가 곧 approved_tree다(검증 가능한 사실).
  const matches = [...new Set(input.treeMatchCommits)]
  if (matches.length === 0)
    refusals.push(
      `W3 없음: 승인 tree(${w1.approved_tree.slice(0, 12)})와 같은 커밋이 HEAD 이력에 없습니다 — 승인된 코드가 커밋되지 않았습니다.`,
    )
  else if (matches.length > 1)
    refusals.push(`W3 모호: 같은 tree를 가진 커밋이 ${matches.length}개입니다(${matches.map((c) => c.slice(0, 8)).join(', ')}) — 어느 것이 source인지 결정할 수 없습니다.`)

  // W4(선택) — 소비 기록이 있으면 W1·W3와 **둘 다** 일치해야 한다(설계 r01 observation).
  const w4 = input.consumed
  if (w4) {
    if (w4.approved_tree !== null && w4.approved_tree !== w1.approved_tree)
      refusals.push(`W4 불일치: 소비 기록의 approved_tree가 승인 핀과 다릅니다(${String(w4.approved_tree).slice(0, 12)} ≠ ${w1.approved_tree.slice(0, 12)}).`)
    if (matches.length === 1 && w4.consumed_by_commit_sha !== matches[0])
      refusals.push(
        `W4 불일치: 소비 기록의 consumed_by_commit_sha(${w4.consumed_by_commit_sha.slice(0, 8)})가 tree로 결정된 커밋(${(matches[0] as string).slice(0, 8)})과 다릅니다.`,
      )
  }

  if (refusals.length) return { candidate: null, refusals }

  const sourceSha = matches[0] as string
  const candidate: ManifestEntry = {
    kind: 'phase',
    phase_id: w1.phase_id,
    response_path: w1.response_path,
    response_sha256: w1.response_sha256,
    review_base_sha: w1.review_base_sha,
    approved_tree: w1.approved_tree,
    ...(w1.phase_design_ref === undefined ? {} : { phase_design_ref: w1.phase_design_ref }),
    approved_at: w1.approved_at,
    consumed_by_commit_sha: sourceSha,
    // 🔴 consumed_at·user_commit_confirmed는 **넣지 않는다**(결정 불가). 아래 두 필드가 그 사실을 기록한다.
    reconstructed: true,
    evidence_basis: [
      `${input.ticketRel}/state.json#approval_evidence`,
      w1.response_path,
      `commit:${sourceSha}`,
      ...(w4 ? [`${input.ticketRel}/state.json#consumed_approvals`] : []),
    ],
  }
  return { candidate, refusals: [] }
}
