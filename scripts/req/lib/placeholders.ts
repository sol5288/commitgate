/**
 * 예약 placeholder 등록부(REQ-2026-149) — **도구가 자기 출력을 자기가 되받는 고리**를 끊는다.
 *
 * 🔴 **왜 필요한가**: 도구는 안내에 `--confirm "승인 문장"` 같은 **실행 가능한 값**을 박는다.
 *    그 줄을 값 수정 없이 실행하면 사람의 결정 없이 replace·abandon·HIGH 확인·**main 병합 위임**이
 *    기록된다. 받는 쪽은 지금까지 `trim() !== ''` 만 봤다.
 *
 * 🔴 **무엇을 주장하지 않는가**: 값의 **진정성**은 판정하지 않는다. `--confirm "x"` 는 통과한다.
 *    사람인지 기술적으로 증명하지 못한다는 한계는 그대로다. 이 모듈은 **도구가 만든 범용 라벨**만
 *    거부한다 — 실제 사람의 결정 기록이 정확히 그 문자열일 이유가 없기 때문이다.
 *
 * 🔴 **거부는 무조건이다.** 도구가 낸 값인지 사람이 친 값인지 구별할 방법이 없다. 출처를 묻지 않는다.
 *
 * 🔴 **leaf 다.** import 가 없다 — 안내를 내는 쪽과 값을 받는 쪽이 **같은 목록**을 참조해야 하고,
 *    그러려면 양쪽 어디에서도 가져올 수 있어야 한다.
 */

/**
 * 도구가 안내에 실제로 박는 사람-결정 자리표시자.
 *
 * 🔴 **여기에 없는 문자열을 안내에 새로 박으면 고리가 다시 열린다.** REQ-2026-148/149 는 표면을
 *    세 번 놓쳤다(`req:close --abandon` · `req:confirm --method` · `req:delegate --sentence`).
 *    안내를 내는 코드는 이 상수를 **참조해서** 렌더링한다 — 문자열을 두 벌 두지 않는다.
 */
export const PLACEHOLDER_APPROVAL = '승인 문장'
export const PLACEHOLDER_APPROVAL_ANGLED = '<승인 문장>'
export const PLACEHOLDER_DELEGATE_SENTENCE = '사람이 말한 승인 문장'
export const PLACEHOLDER_WHY_REPLACE = '왜 대체하는가'
export const PLACEHOLDER_WHY_ABANDON = '왜 버리는가'
export const PLACEHOLDER_REASON = '<사유>'
export const PLACEHOLDER_NOTE = '<메모>'

export const RESERVED_HUMAN_PLACEHOLDERS: readonly string[] = [
  PLACEHOLDER_APPROVAL,
  PLACEHOLDER_APPROVAL_ANGLED,
  PLACEHOLDER_DELEGATE_SENTENCE,
  PLACEHOLDER_WHY_REPLACE,
  PLACEHOLDER_WHY_ABANDON,
  PLACEHOLDER_REASON,
  PLACEHOLDER_NOTE,
]

/** 비교용 정규화 — 앞뒤 공백 제거·연속 공백 1칸·소문자화. `"  승인  문장 "` 도 같은 값이 된다. */
function normalize(v: string): string {
  return v.replace(/\s+/g, ' ').trim().toLowerCase()
}

const RESERVED_NORMALIZED = new Set(RESERVED_HUMAN_PLACEHOLDERS.map(normalize))

/** 이 값이 도구가 만든 자리표시자인가(정규화 비교). */
export function isReservedPlaceholder(v: string): boolean {
  return RESERVED_NORMALIZED.has(normalize(v))
}

/**
 * 사람-결정 인자 검증(순수). 문제가 없으면 `null`.
 *
 * 🔴 두 가지를 한 자리에서 본다: **내용 존재**(trim 후 비어 있지 않음)와 **자리표시자 아님**.
 *    받는 쪽마다 따로 쓰면 한 곳이 빠진다 — 이 REQ 가 실제로 세 번 겪은 일이다.
 */
export function humanDecisionProblem(flag: string, v: string | null | undefined): string | null {
  if (typeof v !== 'string' || v.trim() === '') return `${flag} 가 비어 있습니다 — 무엇을 근거로 결정했는지가 기록의 내용입니다.`
  if (isReservedPlaceholder(v))
    return (
      `${flag} 값이 도구가 안내에 넣은 **자리표시자**입니다(${JSON.stringify(v.trim())}).\n` +
      `  안내를 그대로 붙여넣지 말고 그 자리를 실제 내용으로 바꿔 다시 실행하십시오.\n` +
      `  🔴 이 값을 그대로 기록하면 감사 이력에 "사람이 무엇을 근거로 결정했는지"가 남지 않습니다.`
    )
  return null
}
