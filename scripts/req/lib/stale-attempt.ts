/**
 * 열린 attempt 해소(`--close-stale`)의 **순수 판정** — REQ-2026-141 DEC-3·DEC-3a.
 *
 * 🔴 **왜 필요한가**(실측): `req:review-codex` 가 `attempt-opened` 를 커밋한 뒤 중단되면 원장에 **닫히지
 *    않은 attempt** 가 박힌다. 다음 리뷰는 state 기준으로 같은 번호를 다시 열려다
 *    `리뷰 원장 무결성 실패(fail-closed)` 에 부딪히고, 그 티켓의 리뷰가 **영구 차단**된다.
 *    (REQ-2026-140 phase-6 에서 실제로 밟았다.)
 *
 * 🔴 **이 모듈은 순수하다** — 파일도 git 도 만지지 않는다. 원장 행과 state 를 받아 "무엇을 해야 하는가"만
 *    돌려준다. 그래서 부분 실패 재실행의 수렴을 배선 없이 테스트할 수 있다.
 */
import type { LedgerRow } from './review-ledger'

/** 이 명령이 실제로 할 일. 🔴 **둘은 독립이다** — 부분 실패 복구에서 한쪽만 필요할 수 있다. */
export interface StaleClosePlan {
  /** 원장에 `attempt-closed(abandoned)` 를 append 해야 하는가. 이미 있으면 `false`. */
  appendRow: boolean
  /** 닫는 대상 attempt 번호. */
  attempt: number
  /** `SeriesRecord.attempts` 를 이 값까지 올려야 하는가(`null` = 이미 충분). */
  raiseAttemptsTo: number | null
  /**
   * `void_attempts` 가 **최소 이 값**이어야 한다 — 이 series 에서 **판정이 없던 회차 수**
   * (`invalid` + `abandoned`, 이번에 쓸 것 포함).
   *
   * 🔴 **증분이 아니라 원장에서 파생한다**(phase-2 리뷰 r01 P1). 증분으로 두면 두 방향으로 틀린다:
   *    원장 커밋 뒤 state 쓰기 전에 끊기면 **한 번도 반영되지 않고**(그 회차가 autoBudget 을 계속 먹는다),
   *    재실행에서 또 올리면 **두 번 센다**. 원장이 정본이므로 거기서 세면 몇 번을 실행해도 같은 값이다.
   */
  voidAttemptsAtLeast: number
  /** 사람에게 보여줄 요약. */
  detail: string
}

export type StaleCloseVerdict = { ok: true; plan: StaleClosePlan } | { ok: false; reason: string; hint: string }

export interface StaleCloseInput {
  /** 그 티켓 원장의 **모든** 행(파싱 완료). */
  rows: readonly LedgerRow[]
  seriesId: string
  /** 대상 series 의 현재 `attempts`(state). series 가 없으면 `null`. */
  seriesAttempts: number | null
  /** 대상 series 가 state 에서 **열려 있는가**(`closed_reason === null`). */
  seriesOpen: boolean
  reason: string
}

/**
 * 무엇을 해야 하는지 정한다.
 *
 * 🔴 **재실행이 수렴해야 한다**(DEC-3a). 이 명령은 durable 원장과 scratch state 두 곳을 바꾸므로 그 사이에서
 *    끊길 수 있다. 그때 재실행이 막히면 **이 명령이 고치려는 교착을 스스로 만든다.** 그래서 원장을
 *    정본으로 두고, 이미 있는 행은 **다시 만들지 않는다** — 새 타임스탬프로 같은 자연키를 구성하면
 *    무결성 가드가 던진다.
 */
export function planStaleClose(input: StaleCloseInput): StaleCloseVerdict {
  if (input.reason.trim() === '')
    return { ok: false, reason: '사유가 비어 있다', hint: '--reason "<왜 이 회차를 버리는가>" 를 지정하세요 — 근거 없는 종결은 기록이 아닙니다' }
  if (input.seriesAttempts === null)
    return { ok: false, reason: `state 에 series 가 없다: ${input.seriesId}`, hint: 'req:next 로 현재 series 를 확인하세요' }
  if (!input.seriesOpen)
    return { ok: false, reason: `이미 닫힌 series 다: ${input.seriesId}`, hint: '닫힌 series 에는 버릴 회차가 없습니다' }

  const mine = input.rows.filter((r) => r.series_id === input.seriesId)
  const opened = new Set(mine.filter((r) => r.event === 'attempt-opened').map((r) => r.attempt))
  const closed = new Set(mine.filter((r) => r.event === 'attempt-closed').map((r) => r.attempt))
  /**
   * `void_attempts` 의 정본 — **판정이 없던 회차 전부**다.
   *
   * 🔴 `abandoned` 만 세면 안 된다(phase-2 리뷰 r04 P1). 이 필드는 원래 `invalid`(호출은 나갔으나 리뷰어가
   *    판정을 못 낸 회차)를 위해 있었고(REQ-2026-084 DEC-4), 호출부가 기존 값과 `max` 를 취하므로
   *    abandoned 만 세면 **둘이 겹쳐 하나가 사라진다** — invalid 1 + abandoned 1 인데 값이 1로 남는다.
   *    두 종류를 **합쳐야** 파생값이 기존 값을 온전히 포함한다.
   */
  const voided = mine.filter(
    (r) =>
      r.event === 'attempt-closed' &&
      (r.outcome === 'abandoned' || r.outcome === 'invalid') &&
      // 🔴 **환불된 회차는 빼야 한다**(phase-2 리뷰 r05 P1). `pre_dispatch_failed` 는 호출이 나가지
      //    **않은** 회차라 `refunded_attempts` 로 이미 두 상한에서 빠져 있다. void 로 또 세면
      //    productive 가 실제보다 작아져 **autoBudget 게이트가 느슨해진다** — fail-closed 의 반대다.
      r.lifecycle !== 'pre_dispatch_failed',
  ).length
  // 🔴 **가장 이른 열린 attempt** 를 고른다 — 재실행이 순서대로 해소하고, 어느 것이 닫혔는지가 결정적이다.
  const open = [...opened].filter((n) => !closed.has(n)).sort((a, b) => a - b)

  if (open.length === 0) {
    /**
     * 열린 attempt 가 없다. 두 경우를 **구별한다**:
     *  - state 가 원장보다 뒤처져 있으면 → **부분 실패 복구**(행은 이미 있고 state 만 남았다)
     *  - 둘 다 정합이면 → no-op
     */
    const maxOpened = opened.size === 0 ? 0 : Math.max(...opened)
    if (maxOpened > input.seriesAttempts)
      return {
        ok: true,
        plan: {
          appendRow: false,
          attempt: maxOpened,
          raiseAttemptsTo: maxOpened,
          // 🔴 행은 이미 있으므로 그 수가 곧 정답이다 — 끊긴 지점과 무관하게 같은 값이 된다.
          voidAttemptsAtLeast: voided,
          detail: `원장에는 attempt ${maxOpened} 까지 있는데 state 는 ${input.seriesAttempts} 다 — state 만 맞춥니다(행은 이미 있습니다)`,
        },
      }
    return { ok: false, reason: '버릴 열린 attempt 가 없다', hint: '이미 정합한 상태입니다 — 할 일이 없습니다' }
  }

  const attempt = open[0] as number
  return {
    ok: true,
    plan: {
      appendRow: true,
      attempt,
      raiseAttemptsTo: attempt > input.seriesAttempts ? attempt : null,
      // 이번에 쓸 행까지 포함한 수.
      voidAttemptsAtLeast: voided + 1,
      detail: `attempt ${attempt} 를 버립니다(열린 회차 ${open.length}건 중 가장 이른 것)`,
    },
  }
}
