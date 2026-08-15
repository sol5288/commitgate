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
 * 복구 창 거부 메시지(순수).
 *
 * 🔴 **문구를 verb 마다 다시 쓰지 않는다.** 네 곳이 같은 말을 해야 하고, 갈라지면 어떤 곳은
 *    "아무것도 쓰지 않았다"를 빠뜨린다 — 그 한 줄이 사람이 다음을 판단하는 근거다.
 *
 * 🔴 안내는 **실행 가능해야 한다**: `--finalize` 는 이 창에서 실제로 성공하는 유일한 명령이다.
 */
export function recoveryWindowProblem(reqId: string, verb: string): string {
  return (
    `${reqId} 는 증거 복구가 끝나지 않은 상태입니다 — 이 창에서 ${verb} 로 state 를 바꾸면 커밋된 증거와의 결속이 깨집니다.\n` +
    `  먼저 복구를 끝내십시오:\n` +
    `    npx commitgate req:commit ${reqId} --finalize --run\n` +
    `  🔴 아무것도 쓰지 않았습니다 — 복구 뒤 이 명령을 다시 실행하면 됩니다.`
  )
}
