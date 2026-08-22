/**
 * 자율 진행 규칙이 열거하는 `stopGate` 값 검사 (REQ-2026-171 DEC-2) — **순수 함수**.
 *
 * ## 왜 테스트 파일 밖에 있는가
 * 판정 함수가 그것을 단정하는 테스트 파일 안에 있으면 **오라클이 자기 자신을 검사하는** 꼴이 되어
 * 회귀 테스트가 공허해진다(REQ-2026-158 교훈). 여기 두면 두 테스트가 **같은 함수**를 서로 다른
 * 입력으로 태울 수 있다 — 실물(실제 계약 + 실제 enum)과 **합성**(가짜 문장 + 늘린 enum).
 *
 * ## 합성 입력이 왜 필요한가 (design-r01 P1)
 * "enum 을 늘리면 red" 라는 변이만으로는 **파생이 증명되지 않는다**. 같은 테스트 파일에 이미
 * `stopGate 는 네 값이다` 단정이 있어서, enum 을 늘리면 그 기존 단정이 **먼저** red 가 된다.
 * 새 가드를 고정 문자열로 구현해도 변이가 red 라 증거가 되지 못한다.
 * 그래서 실제 enum·실제 템플릿을 **건드리지 않는** 합성 입력으로 이 함수를 직접 태운다.
 */

/** 자율 규칙 문장을 여는 표지. 🔴 계약 안에서 **1회만** 등장하는 문자열이어야 가드가 산다. */
export const AUTONOMY_RULE_MARKER = '**통제점이 아닌 판단은 권장안으로 진행한다.**'

/** 이 규칙이 **제외**하는 값. 규칙의 의미가 "phase 만 빼고 전부"이므로 여기서 하나만 다룬다. */
export const AUTONOMY_EXCLUDED = 'phase'

/**
 * 규칙 문장 구간을 잘라낸다. 표지에서 시작해 **다음 빈 줄까지**(= 그 문단).
 *
 * 🔴 **구간을 넓게 잡지 않는다.** 이 저장소가 같은 함정을 이미 기록해 두었다 —
 *    *"가드의 적용 범위가 검사 대상보다 넓으면 무관한 등장이 오라클을 대신 만족시킨다"*.
 *    문단 밖에는 `auto` 를 말하는 다른 문장이 여럿 있어서, 넓게 잡으면 열거에서 값을 지워도 통과한다.
 */
export function autonomyRuleParagraph(contractText: string): string | null {
  // 🔴 **줄바꿈을 먼저 정규화한다.** 이 저장소는 `core.autocrlf` 환경이라 워킹 파일이 CRLF 다.
  //    `\n\n` 로 찾으면 `\r\n\r\n` 에 걸리지 않아 **문단이 파일 끝까지 늘어나고**, 그러면 규칙 밖의
  //    `auto` 등장이 오라클을 대신 만족시킨다(정확히 이 파일이 경고하는 실패 모드다 — 실제로 밟았다).
  const lf = contractText.replace(/\r\n/g, '\n')
  const from = lf.indexOf(AUTONOMY_RULE_MARKER)
  if (from === -1) return null
  const rest = lf.slice(from)
  const end = rest.indexOf('\n\n')
  return end === -1 ? rest : rest.slice(0, end)
}

/** 문단에서 backtick 으로 감싼 토큰을 뽑는다(``` `req` ``` → `req`). 중복 제거·정렬. */
export function backtickTokens(paragraph: string): string[] {
  const out = new Set<string>()
  for (const m of paragraph.matchAll(/`([^`\n]+)`/g)) out.add((m[1] as string).trim())
  return [...out].sort()
}

/**
 * 자율 규칙 문단이 **`phase` 를 제외한 모든 `stopGate` 값**을 열거하는가.
 * 문제가 없으면 `null`, 있으면 사람이 읽는 사유.
 *
 * @param contractText  계약 전문(`AGENTS.template.md`)
 * @param allStopGates  `stopGate` 값 **전체**. 🔴 호출부가 스키마 enum 에서 파생해 넘긴다 —
 *                      이 함수는 목록을 스스로 갖지 않는다(가지면 그게 곧 고정 문자열이다).
 */
export function autonomyEnumerationProblem(
  contractText: string,
  allStopGates: readonly string[],
): string | null {
  const para = autonomyRuleParagraph(contractText)
  if (para === null) return `자율 규칙 문단을 찾지 못했다(표지: ${AUTONOMY_RULE_MARKER})`

  const expected = [...allStopGates].filter((g) => g !== AUTONOMY_EXCLUDED).sort()
  if (expected.length === 0) return 'stopGate 값 목록이 비었거나 phase 뿐이다 — 파생 원천을 확인하라'

  const tokens = new Set(backtickTokens(para))
  const missing = expected.filter((g) => !tokens.has(g))
  if (missing.length > 0)
    return `자율 규칙 열거에 빠진 stopGate 값: ${missing.join(', ')} (문단: ${para.slice(0, 80)}…)`

  // 🔴 제외 값이 **제외로** 적혀 있어야 한다. 열거에 섞여 있으면 규칙이 뒤집힌다.
  if (!para.includes(`\`${AUTONOMY_EXCLUDED}\``) && !para.includes(`"${AUTONOMY_EXCLUDED}"`))
    return `자율 규칙이 제외 값(${AUTONOMY_EXCLUDED})을 말하지 않는다`

  return null
}
