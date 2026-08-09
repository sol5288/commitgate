/**
 * phase 실효 위험 감지 (REQ-2026-119) — **staged 경로의 민감 패턴 매치**(순수).
 *
 * 위험도는 티켓 생성 시 입력값(`state.risk_level`, 기본 LOW·소비자 272티켓 중 HIGH 1.5%)만 신뢰되고,
 * phase가 실제로 무엇을 건드리는지는 어떤 표면도 보지 않는다 — LOW 문서 티켓의 한 phase가 결제
 * 웹훅을 수정해도 조용하다. 이 모듈은 그 간극을 **감지**한다(D31 WARN의 입력).
 *
 * 🔴 관측 우선 — 여기엔 강제가 없다. 확인 강제는 발화율 데이터가 쌓인 뒤 별도 REQ의 결정이다
 *    (0.13.0 block→warn 정정·REQ-2026-066 "조건은 실제 데이터로 측정" 선례).
 * 🔴 순수 모듈 — fs·git·config를 모른다. staged 경로·패턴은 호출부가 넘긴다.
 */

/**
 * 기본 민감 패턴(설계 DEC-1) — **좁게 시작한다**. 오탐은 WARN이어도 경고 피로가 되고(D30 실측),
 * 수습이 확장보다 비싸다. 의도적으로 뺀 것: `auth`(author·oauth-doc 오탐), `token`(tokenizer),
 * `deploy`(일반 디렉터리명), `schema`(도구 저장소 상시 오탐). 프로젝트별 조정은 `riskPaths`가 담당.
 */
export const DEFAULT_RISK_PATTERNS: readonly string[] = [
  '.env',
  'secret',
  'credential',
  'password',
  'private-key',
  'payment',
  'webhook',
  'migration',
]

export interface RiskHit {
  pattern: string
  count: number
  /** 대표 경로(≤3) — 메시지 표시용. 실행 로그에는 싣지 않는다(경로는 subjects 허용 목록 밖). */
  samples: string[]
}

/** 대표 경로 상한 — 메시지 폭주 방지(설계 DEC-1). */
const SAMPLE_LIMIT = 3

/**
 * 매치 = 경로 **소문자화 후 부분 문자열 포함**(설계 DEC-1). glob·정규식을 쓰지 않는 이유:
 * 패턴 문법 오류가 침묵 비활성이 되는 표면을 만들지 않기 위해서다 — 문자열 포함은 오해의 여지가
 * 없고, 과잉 매치의 비용은 WARN이라 낮다.
 */
export function effectiveRiskHits(stagedPaths: readonly string[], patterns: readonly string[]): RiskHit[] {
  const hits: RiskHit[] = []
  for (const rawPattern of patterns) {
    const pattern = rawPattern.toLowerCase()
    if (pattern === '') continue // 빈 패턴은 모든 경로에 일치한다 — 의미 없는 전량 오탐을 막는다.
    const matched = stagedPaths.filter((p) => p.toLowerCase().includes(pattern))
    if (matched.length === 0) continue
    hits.push({ pattern: rawPattern, count: matched.length, samples: matched.slice(0, SAMPLE_LIMIT) })
  }
  return hits
}
