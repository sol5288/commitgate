/**
 * 결정적 full-review 판정 (REQ-2026-118) — **델타 이탈을 리뷰어 재량에서 기계 판정으로**.
 *
 * 델타 설계 리뷰의 이탈 신호(`full_review_requested`)는 소비자 3곳 누적 **0건**(0/241 + 0/1,647행,
 * 2026-08-09 실측)으로 사실상 휴면이다. 같은 기간 설계 재개는 32.6% — 판단을 확률적 신호에 맡긴
 * 구조가 원인일 가능성이 높다. 이 모듈은 "델타로 볼 범위를 벗어났는가"를 **결정적 조건**으로 판정한다.
 *
 * 🔴 순수 모듈 — git·fs를 모른다. baseline blob 본문·delta 결과는 호출부(review-codex)가 수집한다.
 * 🔴 방향은 항상 델타→full(더 넓은 리뷰)뿐이다. full→델타 자동 축소는 없다.
 * 🔴 재량 경로(`full_review_requested`)는 건드리지 않는다 — 이 판정은 그 **앞단**에 선다.
 */

/** review-codex의 설계 문서 키와 동일(순환 import를 피해 여기 재선언 — 값 불일치는 타입이 잡는다). */
export type DesignDocKey = 'requirement' | 'design' | 'plan'

export type FullReviewReason = 'no-baseline' | 'invalid-baseline' | 'all-docs-changed' | 'phase-structure-changed'

/**
 * 02-plan 본문에서 **phase id 집합**을 뽑는다 — `## ` 헤딩 줄의 백틱 `phase-…` 토큰
 * (스캐폴드 관례: `## Phase 1 — 제목 (\`phase-1-…\`)`). 본문 산문의 백틱 토큰은 세지 않는다
 * (헤딩 줄만) — phase 언급과 phase 선언을 구별한다.
 */
export function planPhaseIds(planBody: string): Set<string> {
  const ids = new Set<string>()
  for (const line of planBody.split('\n')) {
    if (!line.startsWith('## ')) continue
    for (const m of line.matchAll(/`(phase-[a-z0-9][a-z0-9-]*)`/g)) if (m[1]) ids.add(m[1])
  }
  return ids
}

/** 집합 동일성(순서 무관). */
function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false
  for (const x of a) if (!b.has(x)) return false
  return true
}

export interface AutoFullInput {
  /**
   * baseline 상태 3분해(호출부의 `hasDesignBaseline`/`hasValidDesignBaseline` 판정에서 파생):
   * `absent` = design_baseline 없음(첫 리뷰) · `invalid` = 있으나 형식 불량 · `valid` = 델타 가능.
   */
  baselineState: 'valid' | 'absent' | 'invalid'
  /** baselineState=valid일 때의 델타(키별 변경/미변경). valid가 아니면 null. */
  delta: { changed: DesignDocKey[]; unchanged: DesignDocKey[] } | null
  /** baseline plan blob 본문. 읽기 실패 = null → 구조 비교는 **건너뛴다**(모르는 것으로 강제 전환하지 않는다). */
  baselinePlanBody: string | null
  currentPlanBody: string
}

/**
 * 결정적 판정(설계 DEC-1 — 첫 일치가 사유):
 * - `no-baseline` / `invalid-baseline` — **동작 무변경**(지금도 full로 돈다). 기록용 사유다.
 * - `all-docs-changed` — 전 문서 변경이면 델타의 절감·범위 축소 이득이 없고, 전면 개정을
 *   "[승인 baseline]" 태그 뒤에 부분 심사하는 것이 위험하다 → full 강제.
 * - `phase-structure-changed` — plan의 phase id 집합 변경은 승인 계약의 골격 변경 → full 강제.
 * - null — 델타 유지.
 */
export function autoFullReviewReason(input: AutoFullInput): FullReviewReason | null {
  if (input.baselineState === 'absent') return 'no-baseline'
  if (input.baselineState === 'invalid') return 'invalid-baseline'
  const delta = input.delta
  if (delta === null) return 'invalid-baseline' // valid인데 delta 미계산 — 방어(정상 경로에서 도달 불가)
  if (delta.unchanged.length === 0 && delta.changed.length > 0) return 'all-docs-changed'
  if (input.baselinePlanBody !== null && !sameSet(planPhaseIds(input.baselinePlanBody), planPhaseIds(input.currentPlanBody)))
    return 'phase-structure-changed'
  return null
}
