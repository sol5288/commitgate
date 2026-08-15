// 🔴 순수 키 헬퍼만 가져온다 — **D10 예외를 여는 것과 창을 아는 것은 다른 일**이다.
//    (`lib/evidence-recovery` 직접 import 는 verb 에 금지돼 있다 — 그 가드의 대상은 예외 표면이다.)
import { consumedKeysAddedByHead, consumedKeysInState, consumedStateShaFor } from './evidence-recovery'

/**
 * **복구 창** 술어와 안내(REQ-2026-155 DEC-1, 순수 leaf).
 *
 * 🔴 `lib/evidence-recovery`(D10 예외 모듈)에서 **분리**한다. 그쪽은 "호출부는 `req:doctor`·
 *    `req:commit` 둘뿐"이라는 구조 가드로 표면을 좁게 유지한다(REQ-2026-142). 이 술어는 네 verb 가
 *    써야 하므로 같은 모듈에 두면 그 가드를 무의미하게 만든다 — **D10 예외를 넓히는 것과
 *    복구 창을 아는 것은 다른 일이다.**
 *
 * 🔴 fs·git 을 모른다. state 한 조각만 본다.
 */

/**
 * **복구 창인가** — source 커밋은 만들어졌고 증거 소비가 끝나지 않았다.
 *
 * 🔴 이 창에서 state 를 바꿔 checkpoint 커밋하면, 커밋된 증거의 `consumed_state_sha256` 결속이
 *    깨지고 이후 복구가 `state-mismatch` 로 영구 차단된다. `req:repolicy`·`req:confirm` 이 그랬다.
 *
 * 🔴 **`approval_evidence` 를 근거로 삼지 않는다**(REQ-2026-154 phase-1 r01 P1). 승인 핀은
 *    **승인 직후부터 소비까지** 살아 있는 **정상 상태**다 — 그것으로 판정하면 승인만 받아 둔 티켓의
 *    정책 채택이 막히고, 안내하는 `--finalize` 는 source 커밋이 없어 **완료할 수도 없다**(새 교착).
 *    위험한 창은 `pending_evidence_for` 가 가리키는 구간, 즉 **source 커밋 뒤·소비 전**뿐이다.
 */
export function inRecoveryWindow(state: { pending_evidence_for?: unknown; [k: string]: unknown }): boolean {
  const pending = state.pending_evidence_for
  return pending !== undefined && pending !== null
}

/**
 * **checkpoint 창**의 사실(REQ-2026-156 DEC-1) — 호출부가 git 에서 읽어 넣는다.
 *
 * 🔴 이 창의 표식은 **state 안에 없다**. `consumeState` 가 `pending_evidence_for` 를 제거하므로,
 *    evidence 커밋은 끝났고 소비 state 만 워킹트리에 남은 구간에서는 `inRecoveryWindow` 가 false 다.
 *    표식은 **HEAD 와 워킹트리의 관계**에 있다.
 */
export interface CheckpointWindowFacts {
  /** `HEAD:<ticket>/responses/approvals.jsonl`(없으면 `''`). */
  headManifest: string
  /** `HEAD^` 의 같은 파일(없거나 부모가 없으면 `''`). */
  parentManifest: string
  /** `HEAD:<ticket>/state.json`(없으면 `null`). */
  headStateText: string | null
}

/**
 * **evidence 커밋 뒤·소비 checkpoint 전**인가(REQ-2026-150 의 판별자 A·B 재사용).
 *
 * | # | 관측 |
 * |---|---|
 * | A | HEAD 매니페스트에 소비 행 R 이 있고 `HEAD^` 에 없다 |
 * | B | HEAD `state.json` 의 `consumed_approvals` 에 R 이 없다 |
 *
 * 🔴 **부모가 없으면(루트 커밋) A 는 true 다.** `consumedKeysAddedByHead(head, '')` 가 HEAD 의 행을
 *    새 행으로 보고, 의미상으로도 옳다 — 루트 커밋이 그 행을 추가했다면 그것이 곧 이 창이다.
 *    `planEvidenceRecovery` 의 checkpoint 분기가 이미 같은 규약을 쓴다.
 *
 * 🔴 **HEAD 매니페스트를 못 읽으면(`''`) false 다** — 아직 증거를 커밋한 적이 없다는 뜻이다.
 *    추가 안전장치가 새 교착을 만들면 안 된다.
 */
export type CheckpointWindowReason = 'none' | 'window' | 'malformed-binding'

/**
 * checkpoint 창 판정 — **왜** 막는지까지 돌려준다.
 *
 * 🔴 `malformed` 를 창에서 빼면 안 된다(외부 리뷰 P2). 결속값이 손상된 행은 `bound` 가 아니라
 *    필터에서 빠졌고, 그 상태에서 verb 가 state 를 checkpoint 커밋한 뒤 `--finalize` 가
 *    `state-mismatch` 로 거부하는 **영구 교착**이 남았다. **키가 있다고 주장하는 행은 전부 대상**이다.
 */
export function checkpointWindowReason(f: CheckpointWindowFacts): CheckpointWindowReason {
  if (!f.headManifest.trim()) return 'none'
  /**
   * 🔴 **결속(`consumed_state_sha256`)이 있는 행만 본다.**
   *
   * 이 가드가 지키는 것은 "커밋된 증거가 아는 소비 state 바이트"다. 결속이 없는 행은 바꿀 수 있는
   * 대조 대상이 없으므로 이 창의 대상이 아니다.
   *
   * 🔴 그리고 **그 좁힘이 없으면 영구 오탐이 난다**(실측): design 승인은 매니페스트에 소비 행을
   *    남기지만 **`consumed_approvals` 에는 기록하지 않는다**(소비는 `req:commit` 이 한다).
   *    그래서 A∧B 가 항상 참이 되어 네 verb 가 영영 막힌다.
   */
  const lookup = (k: string): ReturnType<typeof consumedStateShaFor> => consumedStateShaFor(f.headManifest, [k])
  // 🔴 `absent`(키 없음)만 제외한다 — `bound` 와 `malformed` 는 둘 다 "결속을 주장하는 행"이다.
  const added = consumedKeysAddedByHead(f.headManifest, f.parentManifest).filter((k) => lookup(k).kind !== 'absent')
  if (added.length === 0) return 'none'
  /**
   * 🔴 **B 는 `consumed_by_commit_sha` 만 본다**(phase_id 는 무시).
   *
   * REQ-2026-150 의 복구 키는 `${sha}#${phase_id}` 인데, 소비 state 의 `phase_id` 는
   * `state.current_phase` 에서 오고 매니페스트의 것은 승인의 `phase_id` 에서 온다 — **둘이 갈릴 수
   * 있다**(실측: `current_phase` 가 없으면 state 쪽이 `sha#` 가 되어 `sha#p1` 과 안 맞는다).
   * 그때 B 가 "기록 안 됨"으로 오판해 **네 verb 를 영영 막는다** — 새 교착이다.
   *
   * 🔴 source 커밋 하나는 승인 하나를 소비한다. 그러므로 "그 커밋의 소비가 state 에 있는가"가
   *    checkpoint 도래 여부의 옳은 질문이고, 틀리는 쪽이 **안전한 방향**(덜 막는다)이다.
   * 🔴 REQ-2026-150 의 복구 판정 키는 **바꾸지 않는다** — 거기서는 좁은 키가 위조를 막는다.
   */
  const shaOf = (k: string): string => k.split('#')[0] ?? k
  const recordedShas = new Set(consumedKeysInState(f.headStateText).map(shaOf))
  const open = added.filter((k) => !recordedShas.has(shaOf(k)))
  if (open.length === 0) return 'none'
  // 🔴 손상된 결속이 섞여 있으면 그 사실을 말한다 — 사람이 `--finalize` 의 정확한 오류로 이어간다.
  return open.some((k) => lookup(k).kind === 'malformed') ? 'malformed-binding' : 'window'
}

/** 불리언만 필요한 곳을 위한 별칭(순수). */
export function inCheckpointWindow(f: CheckpointWindowFacts): boolean {
  return checkpointWindowReason(f) !== 'none'
}

/**
 * **state 를 쓰면 안 되는 구간인가** — 두 창의 합집합(verb 가드의 단일 진입점).
 *
 * 🔴 창이 둘인 이유: 표식이 다른 곳에 있다. ①은 state 안(`pending_evidence_for`), ②는 HEAD 와
 *    워킹트리의 관계다. REQ-2026-155 는 ①만 보았고, ②에서 네 verb 가 결속을 깨뜨렸다.
 */
export function stateWriteBlocked(
  state: { pending_evidence_for?: unknown; [k: string]: unknown },
  facts: CheckpointWindowFacts,
): boolean {
  return stateWriteBlockedReason(state, facts) !== 'none'
}

/** 막는 **이유** — 안내 문구를 고르는 데 쓴다. */
export function stateWriteBlockedReason(
  state: { pending_evidence_for?: unknown; [k: string]: unknown },
  facts: CheckpointWindowFacts,
): CheckpointWindowReason {
  if (inRecoveryWindow(state)) return 'window'
  return checkpointWindowReason(facts)
}

/**
 * 복구 창 거부 메시지(순수).
 *
 * 🔴 **문구를 verb 마다 다시 쓰지 않는다.** 네 곳이 같은 말을 해야 하고, 갈라지면 어떤 곳은
 *    "아무것도 쓰지 않았다"를 빠뜨린다 — 그 한 줄이 사람이 다음을 판단하는 근거다.
 *
 * 🔴 안내는 **실행 가능해야 한다**: `--finalize` 는 이 창에서 실제로 성공하는 유일한 명령이다.
 */
export function recoveryWindowProblem(reqId: string, verb: string, reason: CheckpointWindowReason = 'window'): string {
  /**
   * 🔴 손상된 결속은 **다른 말을 해야 한다**(외부 리뷰 P2). 같은 문구를 쓰면 사람이 "복구하면
   *    되겠구나"로 읽는데, 실제로는 `--finalize` 가 `state-mismatch` 로 거부한다 — 그 사실을
   *    미리 알려야 다음 판단을 할 수 있다.
   */
  const head =
    reason === 'malformed-binding'
      ? `${reqId} 의 **증거 결속이 손상**됐습니다 — 이 상태에서 ${verb} 로 state 를 바꾸면 복구가 영영 불가능해집니다.\n`
      : `${reqId} 는 증거 복구가 끝나지 않은 상태입니다 — 이 창에서 ${verb} 로 state 를 바꾸면 커밋된 증거와의 결속이 깨집니다.\n`
  return (
    head +
    `  먼저 복구를 끝내십시오(정확한 사유가 거기서 나옵니다):\n` +
    `    npx commitgate req:commit ${reqId} --finalize --run\n` +
    `  🔴 아무것도 쓰지 않았습니다 — 복구 뒤 이 명령을 다시 실행하면 됩니다.`
  )
}

/**
 * `CheckpointWindowFacts` 조립에 필요한 바깥 세계(주입).
 *
 * 🔴 **조립을 한 곳에 둔다.** verb 마다 복제하면 그중 하나가 갈라지는 순간 "어떤 verb 는 막고
 *    어떤 verb 는 안 막는" 상태가 된다 — 이 REQ 가 고치는 결함의 모양 그대로다.
 */
export interface CheckpointWindowIo {
  ticketRel: string
  /** `git show <rev>:<path>` — 없으면 null(던지지 않는다). */
  blob: (rev: string, repoRelPath: string) => string | null
}

/** `CheckpointWindowIo` → `CheckpointWindowFacts`(단일 조립 지점). */
export function buildCheckpointWindowFacts(io: CheckpointWindowIo): CheckpointWindowFacts {
  const rel = io.ticketRel.replace(/\/+$/, '')
  return {
    headManifest: io.blob('HEAD', `${rel}/responses/approvals.jsonl`) ?? '',
    parentManifest: io.blob('HEAD^', `${rel}/responses/approvals.jsonl`) ?? '',
    headStateText: io.blob('HEAD', `${rel}/state.json`),
  }
}
