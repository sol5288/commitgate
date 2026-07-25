/**
 * `req:close --migrate`의 **순수 판정기** (REQ-2026-053·DEC-M3/M7).
 *
 * close-proof/`phase_design_ref` regime **이전에** 완료·병합돼 dev-complete로 자기증명될 수 없는 레거시
 * durable 티켓을, HEAD-committed 증거만으로 마이그레이션 종결 자격을 판정한다. IO는 호출부(`req-close.ts`)가 낸다 —
 * 이 모듈은 fs·git을 모른다(`lib/close-proof`·`lib/reconstruct`와 같은 태도).
 *
 * 🔴 자격은 좁다: **손상 아님 + durable + 커밋된 design 승인 + phase 증거 ≥1 + 정상 dev-complete 불가 +
 *    integrated(본선 병합)**. 하나라도 어긋나면 fail-closed 거부. 이미 종결이면 거부가 아니라 성공 no-op(멱등).
 *
 * 🔴 **`migrated-complete` close 이벤트·기본 상태·파서·`deriveBaseState` 확장(dev-complete 아래·needs-recovery
 *    위 비차단)은 phase-1(커밋 `3ed1b95` `close-proof.ts`)에 이미 landed.** 이 모듈(phase-2)은 그 이벤트를
 *    **발행할지 판정**만 한다. 종결→intake pass 전 파이프라인은 `req-close.test.ts` ⑮가 실 git으로 실증한다.
 */
import type { CloseProofRow, CloseProofEvent } from './close-proof'

/** 판정 입력 — 전부 HEAD-committed 사실 + integrated(git ancestry, 호출부가 계산). */
export interface MigrationFacts {
  ticketId: string
  ticketRel: string
  /** HEAD scaffold marker(`isDurabilityRequired`). false면 legacy. */
  durabilityRequired: boolean
  /** HEAD approvals.jsonl 본문(없으면 null). */
  manifestText: string | null
  /** `validateManifest` 결과(빈 배열=정상). 비어있지 않으면 corrupt 거부. */
  manifestProblems: readonly string[]
  /** HEAD ticket-close.jsonl 파싱 problems. 비어있지 않으면 corrupt 거부. */
  closeProblems: readonly string[]
  /** HEAD ticket-close.jsonl 파싱 행(이미 종결 여부 판정). */
  closeRows: readonly CloseProofRow[]
  /** committed 증거(design+phase) 무결성 problems(DEC-B6·B7). 비어있지 않으면 corrupt 거부. */
  evidenceIntegrityProblems: readonly string[]
  /** 커밋된 design 승인 참조(design_hash). 없으면 null. */
  committedDesignRef: string | null
  /** 매니페스트의 **모든** phase-evidenced id(결속 무관). 완료 inventory 원천. */
  evidencedPhaseIdsAll: readonly string[]
  /** **현재 design_ref에 결속된** phase id(정상 dev-complete 가능성 판정). */
  evidencedPhaseIdsBound: readonly string[]
  /**
   * 🔴 티켓의 **커밋된 phase 계획**(HEAD state.json `phases[].id`). r02 P1 대응 — integrated(마지막 매니페스트
   *    커밋이 본선 조상)만으로는 "앞 phase만 병합되고 뒷 phase가 진행 중/중단"인 부분 완료를 못 거른다.
   *    커밋된 계획이 있으면 그 **모든** phase가 증거로 있어야 완료로 본다. 계획이 비었으면(레거시 스캐폴드
   *    state.phases=[]) 이 검사는 vacuous — dev-completable(결속) 검사와 integrated가 남은 방어다.
   */
  committedPlannedPhaseIds: readonly string[]
  /** 티켓 증거가 본선(mainline)의 조상인가(완료성 증명 — DEC-M3.7). 호출부가 git ancestry로 계산. */
  integrated: boolean
  /** 발행 시각(ISO, 호출부가 실시계로 넣음). */
  nowIso: string
  /** 발행 행의 evidence_basis(마이그레이션 근거 아티팩트 경로 — 비어있으면 안 됨). */
  evidenceBasis: readonly string[]
}

export type MigrationPlan =
  | { kind: 'stamp'; row: CloseProofRow }
  /** 이미 terminal close(dev-complete/series-terminal/migrated-complete) — 성공 no-op(DEC-M7). */
  | { kind: 'noop'; existingState: CloseProofEvent }
  /** 자격 미달 — fail-closed 거부(비-스탬프). */
  | { kind: 'refuse'; reason: string; hint: string }

function refuse(reason: string, hint: string): MigrationPlan {
  return { kind: 'refuse', reason, hint }
}

/**
 * 마이그레이션 종결 계획(순수·DEC-M3/M7). 판정 순서가 계약이다:
 * corrupt 가드 → durability → **이미 종결이면 no-op** → design 승인 → phase 증거 → 정상 dev-complete 불가 →
 * integrated. 마지막에만 stamp.
 */
export function planMigrationClose(f: MigrationFacts): MigrationPlan {
  // 🔴 corrupt 가드 — pass 조건이 읽는 아티팩트가 손상됐으면 완료를 스탬프하지 않는다(fail-closed).
  if (f.manifestText !== null && f.manifestProblems.length)
    return refuse(`HEAD approvals.jsonl 손상: ${f.manifestProblems.slice(0, 3).join('; ')}`, '손상 증거에는 완료를 스탬프하지 않습니다 — 먼저 정정/복구')
  if (f.closeProblems.length)
    return refuse(`HEAD ticket-close.jsonl 손상: ${f.closeProblems.slice(0, 3).join('; ')}`, '손상 close-proof 정리 후 재시도')
  if (f.evidenceIntegrityProblems.length)
    return refuse(`committed 증거(design·phase archive) 손상/부재: ${f.evidenceIntegrityProblems.slice(0, 3).join('; ')}`, 'req:reconstruct 등으로 복구 후 재시도')

  // durability marker 없음 = legacy → intake가 애초에 차단하지 않으므로 종결 불필요.
  if (!f.durabilityRequired)
    return refuse('legacy 티켓(durability marker 없음) — intake가 차단하지 않아 종결이 불필요', '조치 불필요')

  // 🔴 DEC-M7: 이미 terminal close면 거부가 아니라 성공 no-op(재실행 멱등). 다른 검사보다 앞에 둬 재실행이
  //    깨끗한 no-op이 되게 한다(기존 행의 at을 보존).
  const terminal = f.closeRows.find(
    (r) => r.event === 'series-terminal' || r.event === 'dev-complete' || r.event === 'migrated-complete',
  )
  if (terminal) return { kind: 'noop', existingState: terminal.event }

  // 커밋된 design 승인 — 무엇에 대한 완료인지 불명이면 거부.
  if (f.committedDesignRef === null)
    return refuse('커밋된 design 승인(design_hash)이 없다 — 무엇에 대한 완료인지 불명', 'design 승인 증거 없이 마이그레이션 불가')

  // phase 증거 ≥1 — 실제 phase를 거친 티켓만.
  const inventory = [...new Set(f.evidencedPhaseIdsAll)].sort()
  if (inventory.length === 0)
    return refuse('커밋된 phase 증거가 없다 — 실제 phase를 거친 티켓만 마이그레이션', 'phase 리뷰·커밋을 먼저 완료')

  // 🔴 r02 P1: **부분 완료(진행 중/중단) 배제** — 커밋된 phase 계획(state.phases)이 있으면 그 모든 phase가
  //    증거로 있어야 한다. integrated는 "마지막 매니페스트 커밋이 본선 조상"만 봐서, 앞 phase만 병합되고 뒤
  //    phase가 아직 증거를 안 낸 티켓을 통과시킨다 — 이 committed 계획 검사가 그 틈을 닫는다.
  const evidencedSet = new Set(inventory)
  const missingPlanned = f.committedPlannedPhaseIds.filter((id) => !evidencedSet.has(id))
  if (missingPlanned.length)
    return refuse(
      `커밋된 phase 계획 중 증거 없는 phase: ${missingPlanned.join(', ')} — 부분 완료(진행 중/중단) 티켓은 마이그레이션 불가`,
      '모든 계획 phase를 완료·커밋(정상 dev-complete)하거나 종결한 뒤 재시도',
    )

  // 🔴 정상 dev-complete가 가능하면 거부 — 마이그레이션으로 강한 경로를 우회하지 않는다(DEC-M3.6).
  const bound = new Set(f.evidencedPhaseIdsBound)
  if (inventory.every((id) => bound.has(id)))
    return refuse('phase 증거가 현재 design_ref에 전부 결속됨 — 정상 dev-complete 가능', '`req:commit --finalize --run`(정상 완료 경로)을 사용')

  // 🔴 완료성 증명 = integrated(DEC-M3.7·P1-1) — 본선 미병합이면 진행 중일 수 있어 거부.
  if (!f.integrated)
    return refuse('티켓 작업이 본선(mainline)에 병합되지 않음 — 미완료/진행 중 가능성', '완료·병합 후 재시도(마이그레이션은 병합된 완료 티켓만)')

  // 방어: evidence_basis 비어있으면 스키마 위반(reconstructed:true는 근거 필수). 호출부가 항상 채운다.
  if (f.evidenceBasis.length === 0)
    return refuse('evidence_basis가 비어 있음(내부 오류 — 마이그레이션 근거 경로 미제공)', '버그 신고')

  const row: CloseProofRow = {
    ticket_id: f.ticketId,
    event: 'migrated-complete',
    series_id: null,
    resolution: null,
    phase_inventory: inventory,
    design_ref: f.committedDesignRef,
    at: f.nowIso,
    reconstructed: true,
    evidence_basis: [...f.evidenceBasis],
  }
  return { kind: 'stamp', row }
}
