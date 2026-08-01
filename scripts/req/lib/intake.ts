/**
 * req:new intake gate (REQ-2026-052 phase-3b, DEC-C) — 새 REQ 생성 전, **HEAD-committed durable 증거만으로**
 * 각 기존 티켓의 기본 상태를 파생해 미종결(developing/needs-recovery) durable 티켓이 있으면 fail-closed로 막는다.
 *
 * 🔴 판정 입력은 **오직 HEAD blob**: scaffold marker(`state.json`)·`approvals.jsonl`·`ticket-close.jsonl`·
 *    `review-ledger.jsonl`. 워킹 `state.json`·워킹트리·미커밋 원장은 절대 보지 않는다(DEC-B4). 스캔은 git
 *    **조회만**(read-only) — write-tree·commit·state 수정 없음.
 * 🔴 **corrupt/부분 HEAD 증거**(매니페스트·close-proof 손상)는 pass 조건(dev-complete/series-terminal)이 읽는
 *    아티팩트이므로, 손상 시 통과시키지 않고 **block**한다(fail-closed). 손상된 신호로 완료를 위장할 수 없다.
 * 🔴 오버레이(`integrated`·`reconstructed`)는 기본 상태 판정을 바꾸지 않는다 — 게이트는 `baseStateBlocksIntake`
 *    (기본 상태만) 으로 결정한다. legacy(durability marker 없음)는 차단하지 않고 표시만 한다.
 *
 * 순수 판정(`classifyIntake`)과 IO 수집(`scanTicketIntake`·`scanIntake`)을 분리한다.
 */
import {
  deriveBaseState,
  baseStateBlocksIntake,
  isReconstructed,
  parseCloseProof,
  recoveryGuidance,
  type CloseBaseState,
  type CloseProofRow,
} from './close-proof'
import {
  isDurabilityRequired,
  verifyCommittedEvidenceIntegrity,
  validateManifest,
  evidencedPhaseIdsFromManifest,
  designHashFromManifest,
  splitUnboundPhases,
} from './evidence'
import { parseLedger } from './review-ledger'
import { createEvidencePorts } from './evidence-ports'

export type IntakeVerdict = 'pass' | 'block' | 'legacy'

export interface IntakeTicketResult {
  ticketId: string
  ticketRel: string
  /** 파생 기본 상태. 매니페스트/close-proof 손상은 5-상태 밖의 `corrupt`(항상 block). */
  baseState: CloseBaseState | 'corrupt'
  verdict: IntakeVerdict
  reason: string
  /** `reconstructed` 오버레이(표시용 — 게이트 판정엔 영향 없음). */
  reconstructed: boolean
  /**
   * 🔴 **적용 가능한** 복구 안내(REQ-2026-072 DEC-5). 차단된 티켓에만 채워진다.
   *    `req:close --migrate`의 거부 문구와 **같은 생성기**(`recoveryGuidance`)를 쓴다 — 한쪽이 권한
   *    명령을 다른 쪽이 거부하는 상태(이 REQ가 고치는 결함)가 다시 생기지 않게.
   */
  hints: string[]
}

export interface IntakeFacts {
  ticketId: string
  ticketRel: string
  /** HEAD scaffold marker(`isDurabilityRequired`). false면 legacy. */
  durabilityRequired: boolean
  /** HEAD approvals.jsonl 본문(없으면 null). */
  manifestText: string | null
  /** `validateManifest` 결과(빈 배열=정상). 비어있지 않으면 corrupt block. */
  manifestProblems: string[]
  /** HEAD ticket-close.jsonl 파싱 결과. problems 비어있지 않으면 corrupt block. */
  closeParsed: { rows: CloseProofRow[]; problems: string[] }
  /** 🔴 committed 증거(design+phase) 무결성 문제(DEC-B6·B7). 비어있지 않으면 corrupt block(삭제/변조). */
  evidenceIntegrityProblems: string[]
  ledgerHasApprovedClose: boolean
  committedEvidenceComplete: boolean
  committedDesignRef: string | null
  /** **design-bound**(현재 committed design_ref에 결속된) phase evidence의 phase id. */
  evidencedPhaseIds: string[]
  /** 결속 무관 **전량**의 phase evidence id — 미결속 phase를 알아내는 분모(REQ-2026-072 DEC-5). */
  evidencedPhaseIdsAll: string[]
  /** 미결속 중 `phase_design_ref`가 있어 `req:rebind` 대상인 phase id(`splitUnboundPhases`). */
  rebindablePhaseIds: string[]
}

/**
 * HEAD 사실 → intake 판정(순수). corrupt(매니페스트/close-proof 손상)는 기본 상태 밖의 별도 block 사유다.
 */
export function classifyIntake(facts: IntakeFacts): IntakeTicketResult {
  const head = { ticketId: facts.ticketId, ticketRel: facts.ticketRel }
  // legacy(durability marker 없음)는 차단하지 않고 표시만(DEC-C·요구).
  if (!facts.durabilityRequired)
    return { ...head, baseState: 'legacy', verdict: 'legacy', reason: 'legacy 티켓(durability marker 없음) — 표시만, 차단 안 함', reconstructed: false, hints: [] }
  // 🔴 pass 조건(dev-complete/series-terminal)이 읽는 아티팩트가 손상됐으면 통과 금지(fail-closed).
  if (facts.manifestText !== null && facts.manifestProblems.length)
    return { ...head, baseState: 'corrupt', verdict: 'block', reason: `HEAD approvals.jsonl 손상 — 통과 불가(fail-closed): ${facts.manifestProblems.slice(0, 3).join('; ')}`, reconstructed: false, hints: [] }
  if (facts.closeParsed.problems.length)
    return { ...head, baseState: 'corrupt', verdict: 'block', reason: `HEAD ticket-close.jsonl 손상 — 통과 불가(fail-closed): ${facts.closeParsed.problems.slice(0, 3).join('; ')}`, reconstructed: false, hints: [] }
  // 🔴 DEC-B6·B7: committed 증거(design·phase archive) blob 부재/변조도 통과 조건이 읽는 증거의 손상 →
  //    corrupt block(dev-complete·series-terminal 위장 차단). design 행이 없는 미완 티켓은 손상 대상 아님(불완전≠손상).
  if (facts.evidenceIntegrityProblems.length)
    return { ...head, baseState: 'corrupt', verdict: 'block', reason: `committed 증거 손상 — 통과 불가(fail-closed): ${facts.evidenceIntegrityProblems.slice(0, 3).join('; ')}`, reconstructed: false, hints: [] }
  const state = deriveBaseState({
    durabilityRequired: true,
    closeProofRows: facts.closeParsed.rows,
    ledgerHasApprovedClose: facts.ledgerHasApprovedClose,
    committedEvidenceComplete: facts.committedEvidenceComplete,
    evidencedPhaseIds: facts.evidencedPhaseIds,
    committedDesignRef: facts.committedDesignRef,
  })
  const blocked = baseStateBlocksIntake(state) // 기본 상태만 본다 — 오버레이 무관(요구).
  const reason = blocked
    ? state === 'developing'
      ? '미종결 durable 티켓(developing) — 모든 phase 완료·커밋 또는 종결 후 재시도'
      : 'HEAD 증거 불일치(needs-recovery) — 승인 흔적은 있으나 커밋된 증거 불완전, 복구 필요'
    : state === 'dev-complete'
      ? '개발 완료(dev-complete)'
      : state === 'series-terminal'
        ? 'series 종결(replace/human-resolution)'
        : // 🔴 REQ-2026-053: migrated-complete는 **phase-1(커밋 3ed1b95 close-proof.ts)**에서 event·base-state·
          //    파서·deriveBaseState(dev-complete 아래·needs-recovery 위 비차단)로 이미 확장됐다. 이 phase-2 diff는
          //    명령(req:close)과 이 reason 케이스만 추가한다. 종결→pass 전 파이프라인은 req-close.test.ts ⑮가 실증.
          state === 'migrated-complete'
          ? '개발 완료(마이그레이션 종결·migrated-complete)'
          : // 🔴 REQ-2026-093(DEC-8): 통과시키되 **상태를 말한다**. 포기는 완료가 아니므로 문구가
            //    그것을 감추면 안 된다 — 나중에 이력을 읽는 사람이 "완료됐다"로 오해한다.
            state === 'abandoned'
            ? '사람이 포기 선언(abandoned) — 완료가 아니며, 커밋된 증거는 그대로 남아 있습니다'
            : String(state)
  return {
    ...head,
    baseState: state,
    verdict: blocked ? 'block' : 'pass',
    reason,
    reconstructed: isReconstructed(facts.closeParsed.rows),
    // 🔴 REQ-2026-072 DEC-5: 차단된 티켓에만, **적용 가능한** 복구 경로를 붙인다. 결속이 끊긴 phase가
    //    없으면(=이 축의 문제가 아니면) 빈 배열이라 기존 문구가 그대로 남는다.
    hints: blocked ? recoveryHints(facts) : [],
  }
}

/**
 * 차단 티켓의 복구 안내(순수). `req:close --migrate`의 거부 문구와 **같은 생성기**를 쓴다 —
 * 두 곳이 각자 문구를 만들면 한쪽이 권한 명령을 다른 쪽이 거부하는 상태로 다시 갈라진다.
 *
 * 🔴 "미결속"만 보고 `req:rebind`를 권하지 않는다: `phase_design_ref` 없는 phase에 rebind를 권하면
 *    사용자는 복사해 실행하고 거부당한다 — 막다른 길을 하나 더 만드는 것이다(design-r01 P1).
 */
function recoveryHints(facts: IntakeFacts): string[] {
  const bound = new Set(facts.evidencedPhaseIds)
  const unbound = facts.evidencedPhaseIdsAll.filter((id) => !bound.has(id))
  return recoveryGuidance({ ticketId: facts.ticketId, unboundPhaseIds: unbound, rebindablePhaseIds: facts.rebindablePhaseIds }).lines
}

/**
 * 한 티켓의 HEAD 사실을 모아 판정(IO — git 조회만, read-only). `ports`가 HEAD blob 접근 정본.
 */
export function scanTicketIntake(root: string, ticketRel: string, ticketId: string): IntakeTicketResult {
  const ports = createEvidencePorts(root, `${ticketRel}/responses`)
  const durabilityRequired = isDurabilityRequired(ports.headText(`${ticketRel}/state.json`))
  if (!durabilityRequired)
    return classifyIntake({ ticketId, ticketRel, durabilityRequired: false, manifestText: null, manifestProblems: [], closeParsed: { rows: [], problems: [] }, evidenceIntegrityProblems: [], ledgerHasApprovedClose: false, committedEvidenceComplete: false, committedDesignRef: null, evidencedPhaseIds: [], evidencedPhaseIdsAll: [], rebindablePhaseIds: [] })
  const manifestText = ports.headText(`${ticketRel}/responses/approvals.jsonl`)
  const closeText = ports.headText(`${ticketRel}/responses/ticket-close.jsonl`)
  const ledgerText = ports.headText(`${ticketRel}/responses/review-ledger.jsonl`)
  // validPhaseIds는 매니페스트 자신의 phase 행 id로 만든다(HEAD state.phases는 설계상 []이므로 멤버십 검사만 무효화 —
  // verifyCommittedDesignEvidence와 동일 기법). 나머지 구조·경로·sha·주입·kind 격리·phase_design_ref 형식은 강제된다.
  const manifestPhaseIds = manifestText ? evidencedPhaseIdsFromManifest(manifestText) : []
  const manifestProblems = manifestText ? validateManifest(manifestText, { ticketRel, validPhaseIds: manifestPhaseIds }) : []
  const closeParsed = closeText ? parseCloseProof(closeText) : { rows: [], problems: [] }
  const ledgerParsed = ledgerText ? parseLedger(ledgerText) : { rows: [], problems: [] }
  const ledgerHasApprovedClose = ledgerParsed.rows.some((r) => r.event === 'attempt-closed' && r.outcome === 'approved')
  const committedDesignRef = manifestText ? designHashFromManifest(manifestText) : null
  const evidencedPhaseIds = manifestText ? evidencedPhaseIdsFromManifest(manifestText, committedDesignRef) : []
  // 🔴 REQ-2026-072 DEC-5: 복구 안내용 사실. `req:close --migrate`와 **같은 helper**로 계산한다(새 IO 없음 —
  //    이미 읽은 HEAD 매니페스트만 본다).
  const rebindablePhaseIds = manifestText ? splitUnboundPhases(manifestText, committedDesignRef).rebindable : []
  // 🔴 DEC-B7: committed 증거(design+phase) 무결성 종합 — intake·req:commit 공유 모듈. designEvidenceComplete로
  //    needs-recovery 판정 입력(committedEvidenceComplete)을 같은 조회에서 얻는다(중복 조회 없음).
  const integrity = verifyCommittedEvidenceIntegrity({ ticketRel, manifestText, ports })
  return classifyIntake({ ticketId, ticketRel, durabilityRequired: true, manifestText, manifestProblems, closeParsed, evidenceIntegrityProblems: integrity.problems, ledgerHasApprovedClose, committedEvidenceComplete: integrity.designEvidenceComplete, committedDesignRef, evidencedPhaseIds, evidencedPhaseIdsAll: manifestPhaseIds, rebindablePhaseIds })
}

/**
 * HEAD tree의 `workflow/REQ-*` 디렉터리 이름(정렬). 🔴 **워킹 디렉터리를 읽지 않는다**(HEAD only).
 *
 * 🔴 **후행 슬래시가 load-bearing이다**: `git ls-tree -d --name-only HEAD workflow/`(슬래시 有)는 `workflow/`의
 *    **직계 자식 tree**(= `workflow/REQ-*`)를 열거한다. 슬래시가 **없으면**(`workflow`) ls-tree는 그 항목 자신
 *    (`workflow`) 한 줄만 낸다 → 자식을 못 보고 스캔이 통째로 비어 **게이트가 우회된다**. 그래서 아래에서 항상
 *    `${dir}/`로 슬래시를 붙인다. 이 정상 경로는 `req-new-intake.test.ts`의 실 git 열거·생성 전 차단 e2e가 고정한다
 *    (열거가 비면 developing 티켓이 차단되지 않아 그 테스트가 실패한다).
 */
export function listHeadTicketIds(workflowDirRel: string, gitFn: (a: string[]) => string): string[] {
  const dir = workflowDirRel.replace(/\\/g, '/').replace(/\/+$/, '')
  let out: string
  try {
    out = gitFn(['ls-tree', '-d', '--name-only', 'HEAD', `${dir}/`]) // 🔴 후행 슬래시 필수(직계 자식 열거).
  } catch {
    return [] // workflow/ 가 HEAD에 없음(첫 REQ 등) → 스캔 대상 없음.
  }
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((p) => p.split('/').pop() ?? '')
    .filter((n) => /^REQ-\d{4}-\d+$/.test(n))
    .sort()
}

/**
 * HEAD의 `workflow/REQ-*` 티켓 전부를 스캔(read-only). `excludeTicketId`(대체될 부모 등)는 스캔에서 제외한다 —
 * 그 티켓은 지금 정규 replace 흐름으로 종결되므로 후속 생성을 막아선 안 된다(제외는 부모의 replace 검증이 이미 끝난 뒤에만 쓴다).
 */
export function scanIntake(
  root: string,
  workflowDirRel: string,
  gitFn: (a: string[]) => string,
  excludeTicketId?: string | null,
): { tickets: IntakeTicketResult[]; blocked: IntakeTicketResult[] } {
  const ticketIds = listHeadTicketIds(workflowDirRel, gitFn).filter((id) => id !== excludeTicketId)
  const dir = workflowDirRel.replace(/\\/g, '/').replace(/\/+$/, '')
  const tickets = ticketIds.map((id) => scanTicketIntake(root, `${dir}/${id}`, id))
  return { tickets, blocked: tickets.filter((t) => t.verdict === 'block') }
}
