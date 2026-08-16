/**
 * 리뷰 **series 레코드**의 판정 (REQ-2026-163 phase-1).
 *
 * 🔴 **무엇을 푸는가**: 리뷰 지적을 따라 mid-ticket 으로 phase 를 개명·재정렬하면
 *    (REQ-2026-161 이 `phase-2-check-c6` → `phase-3-check-c6` 로 그렇게 했다) `state.json` 의 옛 series
 *    레코드가 `closed_reason: null` 로 남는다. attempt 는 전부 닫혔는데 **series 레코드만** 열려 있다.
 *    `bin/integrate.ts` 가 그것을 `reviewInconclusive` 로 세어 `stopGate: "auto"` 자율 통합이
 *    **영구 차단**됐다.
 *
 * 🔴 **게이트가 옳게 거부한 것이 아니다.** `phases[]` 에 없는 phase 의 series 가 열려 있다는 사실은
 *    **현재 phase 들이 검수됐는지에 대해 아무것도 말하지 않는다** — 존재하지 않는 phase 에는 소비될
 *    승인이 없다. 그래서 사람 승인으로 열어 주는 탈출구가 아니라 **판정에서 빼는 것**이 답이다
 *    (설계 DEC-1). 탈출구였다면 정상 행위마다 통제점이 하나씩 늘었을 것이다.
 *
 * 🔴 **우회가 열리지 않는다**(설계 DEC-2): 승인 증거는 phase 별이라 새 이름의 phase 는 자기 승인을
 *    새로 받아야 하고, 예산 축(`attempts >= hardCap`)은 이 모듈이 **건드리지 않으므로** 개명으로
 *    리뷰 예산이 리셋되지 않는다.
 *
 * 🔴 **`series_id` 를 파싱하지 않는다**(design r01 observation). 레코드에 `review_kind` 와 `phase_id` 가
 *    이미 보존돼 있고, phase id 에 `#` 가 들어갈 수 있어 문자열 분해는 조용히 틀린다.
 */

/** 판정에 필요한 최소 형태. `state.json` 전체를 요구하지 않는다(테스트가 리터럴로 구성 가능). */
export interface SeriesLike {
  series_id?: unknown
  review_kind?: unknown
  phase_id?: unknown
  closed_reason?: unknown
}

export interface StateLike {
  phases?: unknown
  review_series?: unknown
}

/** 열린 orphan 1건 — series id 와 **사라진** phase id. */
export interface OrphanSeries {
  seriesId: string
  phaseId: string
}

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

/** `phases[]` 의 id 집합. 형태가 깨진 원소는 조용히 건너뛴다(판정 입력이 아니다). */
export function phaseIds(state: StateLike): Set<string> {
  const out = new Set<string>()
  for (const p of asArray(state.phases)) {
    if (p !== null && typeof p === 'object') {
      const id = (p as { id?: unknown }).id
      if (typeof id === 'string' && id !== '') out.add(id)
    }
  }
  return out
}

/** series 레코드 배열(형태가 아닌 원소 제외). */
function seriesOf(state: StateLike): SeriesLike[] {
  return asArray(state.review_series).filter((s): s is SeriesLike => s !== null && typeof s === 'object')
}

const isOpen = (s: SeriesLike): boolean => s.closed_reason === null
const idOf = (s: SeriesLike): string => (typeof s.series_id === 'string' ? s.series_id : '')

/**
 * **열린 orphan** — `review_kind === 'phase'` 이고 그 `phase_id` 가 `phases[]` 에 없는 열린 series.
 *
 * 🔴 **`design:` series 는 대상이 아니다.** `phases[]` 와 무관하므로 열려 있으면 그대로 미판정이다.
 * 🔴 `phase_id` 를 읽지 못하면 orphan 으로 보지 않는다 — **모르는 것을 "없는 phase"로 읽지 않는다.**
 *    (판정 불가를 통과 사유로 쓰면 그게 곧 구멍이다.)
 */
export function orphanPhaseSeries(state: StateLike): OrphanSeries[] {
  const known = phaseIds(state)
  const out: OrphanSeries[] = []
  for (const s of seriesOf(state)) {
    if (!isOpen(s)) continue
    if (s.review_kind !== 'phase') continue
    const pid = s.phase_id
    if (typeof pid !== 'string' || pid === '') continue
    if (known.has(pid)) continue
    out.push({ seriesId: idOf(s), phaseId: pid })
  }
  return out
}

/**
 * **미판정 series** — 열린 series 에서 orphan 을 뺀 것. `integrate` 가 `reviewInconclusive` 로 쓴다.
 *
 * 🔴 `integrate` 와 `doctor` 가 **같은 술어**를 쓴다. 두 곳에서 각자 판정하면 "doctor 는 괜찮다는데
 *    integrate 가 막는" 상태가 다시 생긴다(REQ-2026-094 가 같은 결론에 도달했다).
 */
export function inconclusiveSeries(state: StateLike): string[] {
  const orphanIds = new Set(orphanPhaseSeries(state).map((o) => o.seriesId))
  return seriesOf(state)
    .filter((s) => isOpen(s))
    .map(idOf)
    .filter((id) => !orphanIds.has(id))
}

/** 미판정 series 가 하나라도 있는가(= 통합을 막아야 하는가). */
export function hasInconclusiveSeries(state: StateLike): boolean {
  return inconclusiveSeries(state).length > 0
}
