/**
 * 통합 판정이 읽는 **티켓 사실** (REQ-2026-172 로 `bin/integrate.ts` 에서 이관).
 *
 * 🔴 **왜 lib 인가**(DEC-3): `req:delegate` 의 발급 시점 preflight 가 통합과 **같은 사실**을 봐야 한다.
 *    scripts CLI 가 `bin/integrate.ts`(통합 실행 표면 전체)를 끌어오게 두지 않는다.
 *    동작은 한 줄도 바뀌지 않았다 — 위치와 `readBlobs` 타입 표기만 바뀌었다.
 *
 * 🔴 이 모듈은 leaf 다: `config`(타입)·`review-series`·`verify-range`(포트 타입)만 의존한다.
 */
import { isStopGate, type StopGate } from './config'
import { hasInconclusiveSeries } from './review-series'
import type { ReadBlobsPort } from './verify-range'

/**
 * 티켓 `state.json` 에서 위험도·예산·리뷰 상태를 읽는다(head tree 기준).
 *
 * 🔴 읽지 못하면 **fail-closed** 로 되돌린다: 위험도 미상은 `HIGH` 로, 리뷰 상태는 미결로 본다.
 *    자율 통합의 입력을 "모르니까 통과"로 읽으면 그것이 곧 구멍이다.
 */
export function readTicketFacts(
  readBlobs: ReadBlobsPort,
  ref: string,
  ticketRoot: string,
  reqId: string,
  hardCap: number,
): {
  riskLevel: string | null
  budgetHardCapReached: boolean
  reviewInconclusive: boolean
  /**
   * 이 티켓의 **정책 스냅샷**(REQ-2026-159). `null` = state 는 읽었지만 스냅샷이 없거나 손상
   * (= legacy → config 폴백). `effectiveStopGate` 와 **같은 기준**이다.
   */
  snapshotStopGate: StopGate | null
  /**
   * 🔴 **state 자체를 읽지 못했다**(부재·JSON 깨짐). legacy 와 **구분**해야 한다 —
   *    legacy 는 "읽었고 스냅샷이 없다"이고, 이쪽은 **어느 정책이 지배하는지 모른다**이다.
   */
  stateUnreadable: boolean
} {
  const rel = `${ticketRoot}/${reqId}/state.json`
  const unknown = {
    riskLevel: 'HIGH',
    budgetHardCapReached: false,
    reviewInconclusive: true,
    snapshotStopGate: null,
    stateUnreadable: true,
  }
  let text: string
  try {
    const buf = readBlobs(ref, [rel]).get(rel)
    if (buf === null || buf === undefined) return unknown
    text = buf.toString('utf8')
  } catch {
    return unknown
  }
  let st: { risk_level?: unknown; review_series?: unknown; policy_snapshot?: unknown }
  try {
    st = JSON.parse(text) as typeof st
  } catch {
    return unknown
  }
  // 🔴 스냅샷 해석은 **정본 resolver 와 같은 기준**이어야 한다 — 규칙을 두 벌 만들면 갈라진다.
  //    `effectiveStopGate` 는 config 폴백까지 하므로, 여기서는 "스냅샷 자체"만 꺼낸다.
  const snapRaw = st.policy_snapshot
  const pinned =
    snapRaw !== null && typeof snapRaw === 'object' ? (snapRaw as { stop_gate?: unknown }).stop_gate : undefined
  const snapshotStopGate: StopGate | null = isStopGate(pinned) ? pinned : null
  const series = Array.isArray(st.review_series) ? (st.review_series as { attempts?: unknown; closed_reason?: unknown }[]) : []
  return {
    riskLevel: typeof st.risk_level === 'string' ? st.risk_level : 'HIGH',
    /**
     * 🔴 **예산 축은 orphan 을 그대로 센다**(REQ-2026-163 DEC-2). phase 를 개명해도 리뷰 예산이
     *    리셋되면 안 된다 — 그것이 열리면 hardCap 이 우회로가 된다.
     */
    budgetHardCapReached: series.some((s) => typeof s.attempts === 'number' && s.attempts >= hardCap),
    /**
     * 🔴 **orphan series 는 세지 않는다**(REQ-2026-163 DEC-1). `phases[]` 에 없는 phase 의 열린 series 는
     *    현재 phase 들이 검수됐는지에 대해 아무것도 말하지 않는다 — 존재하지 않는 phase 에는 소비될
     *    승인이 없다. 그것을 미판정으로 세면 리뷰 지적을 따른 phase 개명이 **자율 통합을 영구 차단**한다
     *    (REQ-2026-161 이 실제로 그렇게 막혔다).
     */
    reviewInconclusive: hasInconclusiveSeries(st as { phases?: unknown; review_series?: unknown }),
    snapshotStopGate,
    stateUnreadable: false,
  }
}
