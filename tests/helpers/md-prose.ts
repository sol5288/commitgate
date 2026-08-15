/**
 * 마크다운에서 **코드(펜스·들여쓰기·인라인)를 뺀 산문**만 남긴다.
 *
 * 🔴 문서 회귀 가드가 **도구 출력의 축자 인용**까지 검사하면 안 된다 — 그 안의 문자열을 고치면
 *    문서가 도구와 달라진다. 그래서 검사 前에 코드를 제거한다.
 *
 * 🔴 **펜스 판별을 손으로 만들지 않는다**(phase-1 r02 P1). CommonMark 의 펜스 규칙은
 *    컨테이너 접두사(block quote·리스트)·최대 3칸 들여쓰기·여는 길이 이상이며 공백만 허용되는
 *    닫힘 등으로 얽혀 있어, 손수 만든 판별기는 고칠 때마다 새 엣지가 나온다
 *    (REQ-2026-041 → 042 의 교훈: **손수 검증 oracle 은 바닥이 없다 → 도구에 위임한다**).
 *    이 저장소는 이미 `docs:lint` 로 remark 에 의존하므로 **같은 파서**를 쓴다.
 *
 * 🔴 **테스트 안의 지역 함수로 두지 않는다**(r01 P1 의 교훈): 지역 함수면 회귀 테스트가 그 함수를
 *    부르지 못해 **규칙을 다시 적는 공허한 오라클**이 된다.
 */
import { fromMarkdown } from 'mdast-util-from-markdown'
import { visit } from 'unist-util-visit'

/**
 * 코드 노드(`code` = 펜스·들여쓰기 코드 블록, `inlineCode` = 백틱 한 쌍)를 제외한 텍스트를 잇는다.
 *
 * 🔴 인라인 코드도 뺀다 — 산문 속 `` `--flag 6~8` `` 같은 축자 인용도 도구의 문자열이다.
 * 🔴 노드 **위치 정보**로 원본에서 잘라내지 않고 텍스트만 모은다: 원본 오프셋을 다루면 그 계산이
 *    다음 결함이 된다. 가드는 "금지 문자열이 산문에 있나"만 물으므로 텍스트 결합으로 충분하다.
 */
export function prose(md: string): string {
  const tree = fromMarkdown(md)
  const out: string[] = []
  visit(tree, (node: { type: string; value?: string }) => {
    if (node.type === 'code' || node.type === 'inlineCode') return 'skip'
    if (typeof node.value === 'string') out.push(node.value)
    return undefined
  })
  // 🔴 줄바꿈으로 잇는다 — 인접 노드가 붙어 **없던 문자열이 생기는** 것을 막는다.
  return out.join('\n')
}
