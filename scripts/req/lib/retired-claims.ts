/**
 * **폐기된 주장**(retired claims) 정본 — REQ-2026-112.
 *
 * 한때 참이었으나 동작 변경으로 거짓이 된 서술들이다. 두 소비자가 이 목록 **하나**를 쓴다:
 *
 * | 소비자 | 무엇을 하는가 |
 * |---|---|
 * | `tests/unit/docs-stale-claims.test.ts` | **이 저장소**의 문서·코드 표면에 되살아나지 않았는지 검사 |
 * | `req:doctor`의 D29 | **소비자 저장소**의 계약 파일(`AGENTS.md`)에 남아 있으면 WARN |
 *
 * 🔴 **왜 테스트가 아니라 여기인가**: 목록이 테스트에만 있으면 소비자 쪽 진단이 그것을 볼 수 없다.
 *    두 벌로 두면 한쪽만 갱신되는 순간 진단이 **조용히 거짓**이 된다 — 이 저장소가 자산 skew로
 *    두 번 데인 지점이다(REQ-2026-025·038). `scripts/req`는 배포 대상이라 소비자에게 함께 간다.
 *
 * 🔴 **항목을 추가할 때의 규칙**(REQ-2026-104): 등재할 문자열은 **정정문에도 남기지 않는다.**
 *    부분 문자열 검사기는 "주장"과 "철회를 설명하려고 옛 문구를 인용한 것"을 구별하지 못한다 —
 *    정정문이 옛 표현을 축자 인용하면 그 순간 가드가 스스로 실패한다. 인용부호 구간을 예외 처리하는
 *    파서를 만드는 대신(REQ-2026-044가 오라클을 명세 못 해 폐기한 길이다) **정정문을 풀어 쓴다.**
 *
 * 🔴 **이 검사가 하지 않는 것**: 문서가 코드와 일치하는지 **일반적으로** 판정하지 않는다.
 *    같은 주장을 다른 표현으로 쓰면 통과한다 — 그건 사람 리뷰의 몫이다. 실제로 그 한계가
 *    실현된 적이 있어(`정책과 무관하게 유지`) 변형을 별도 항목으로 등재했다.
 */

export interface RetiredClaim {
  /** 되살아나면 안 되는 **고정 문장**. 부분 문자열로 검사한다(문장부호·줄바꿈에 취약하지 않게). */
  text: string
  /** 왜 거짓이 되었는가. 진단 메시지가 이 문장을 **그대로** 쓴다 — 사유를 두 곳에서 다르게 쓰지 않는다. */
  why: string
}

export const RETIRED_CLAIMS: readonly RetiredClaim[] = [
  {
    text: '어느 값에서도 매 phase 확인',
    why: 'REQ-071이 제거한 HIGH 백스톱 (configuration.md)',
  },
  {
    text: '정책과 무관하게 매 phase 확인',
    why: 'REQ-071이 제거한 HIGH 백스톱 (workflow.md)',
  },
  {
    text: '기본값은 매 phase 커밋 전에',
    why: 'stopGate 기본값은 이제 req 다 (workflow.md)',
  },
  {
    text: 'HIGH-risk tickets stop at every phase under any value',
    why: 'the HIGH backstop REQ-071 removed (configuration.en.md)',
  },
  {
    text: 'HIGH-risk tickets still stop at every phase',
    why: 'the HIGH backstop REQ-071 removed (workflow.en.md)',
  },
  {
    text: 'By default the loop stops at `AWAIT_HUMAN` before every phase commit',
    why: 'the stopGate default is now req (workflow.en.md)',
  },
  {
    text: 'it would livelock on HIGH',
    why: 'no longer the reason there is no "all" value (configuration.en.md)',
  },
  /**
   * 🔴 이 두 건은 REQ-2026-073이 **쓰다가 리뷰에서 걸린 문장**이다(phase-3 r01 P1).
   *    "커밋·통합되지 않는다"는 커밋 단위 보장으로 읽히는데, 기본값 `req`에서 HIGH 티켓의
   *    중간 phase는 Codex 승인만으로 커밋된다 — 고치려던 것과 **같은 종류의 과잉 약속**이었다.
   */
  {
    text: '사람 확인 없이 커밋·통합되지 않습니다',
    why: '커밋 단위 보장으로 읽히는 과잉 약속 — 확인은 stopGate 지점에서만 요구된다',
  },
  {
    text: 'never committed or integrated without a human confirmation',
    why: 'reads as a per-commit guarantee — confirmation is required only at the stopGate point',
  },
  /**
   * 🔴 REQ-2026-100 — `docs/development.md`가 "전체 스위트를 돌리고 **게이트 판정도 이것을 본다**"고
   *    적고 있었다. 사실이 아니다: `req:doctor`·`req:commit` 어디에도 테스트를 실행하는 코드가 없다.
   */
  {
    text: '게이트 판정도 이것을 봅니다',
    why: '게이트는 테스트를 실행하지 않는다 (development.md · REQ-2026-100)',
  },
  {
    text: 'that is what the gate judges',
    why: 'the gate does not run tests (development.en.md · REQ-2026-100)',
  },
  /**
   * 🔴 REQ-2026-103 — 도달 불가였던 resume 코드를 "향후 opt-in용으로 보존"이라 서술했다.
   *    호출부가 상수라 실행될 수 없는 경로였는데, 문서만 보면 켜기만 하면 되는 기능처럼 읽혔다.
   *    ko 전용 항목이다 — 없던 문장을 영문으로 만들어 등재하면 영원히 발화하지 않는 항목이 는다.
   */
  {
    text: '향후 opt-in용',
    why: 'resume은 도달 불가 코드였다 — "켜면 되는 보존 코드"가 아니다 (ssot-design 06·G-06 · REQ-2026-103)',
  },
  /**
   * 🔴 REQ-2026-112 — **표현 변형**이다. 위의 두 항목과 같은 주장인데 문장이 달라 부분 문자열
   *    검사를 빠져나갔다. `docs/ssot-design/04`는 이미 검사 **범위 안**이었는데도 통과했다 —
   *    **범위를 넓히는 것만으로는 부족하다**는 실증이다.
   */
  {
    text: '정책과 무관하게 유지',
    why: 'REQ-071이 제거한 HIGH 백스톱의 표현 변형 (ssot-design 04 · REQ-2026-112)',
  },
]

/**
 * 본문에서 폐기된 주장을 찾는다. **매칭의 정본**이다.
 *
 * 🔴 `req:doctor`는 `RETIRED_CLAIMS` 배열을 import하지 않고 **이 함수만** 가져간다.
 *    배열을 손에 쥐지 않으면 사본을 둘 자리가 없다(설계 DEC-4의 ① 구조 방어).
 */
export function retiredClaimsIn(text: string): RetiredClaim[] {
  return RETIRED_CLAIMS.filter((c) => text.includes(c.text))
}
