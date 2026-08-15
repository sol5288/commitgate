/**
 * `.gitignore` 변경이 **ignore 범위를 좁힐 수 있는가**(REQ-2026-154 DEC-3, 순수).
 *
 * 🔴 **왜 필요한가**: 종결 티켓 안내는 미커밋 `.gitignore` 를 먼저 커밋하게 한다(REQ-2026-152) —
 *    stash 가 ignore 규칙을 되돌려 감춰져 있던 파일이 드러나기 때문이다. 그런데 그 변경이 규칙을
 *    **삭제·완화**하는 것이면 커밋은 반대로 작동한다: 완화가 새 티켓 브랜치에 **영구히** 남고,
 *    드러난 파일이 다음 리뷰를 D10 에서 막는다(실측 재현). 도구가 사람의 미커밋 결정을 대신
 *    확정하는 셈이다.
 *
 * 🔴 **패턴 의미를 해석하지 않는다.** gitignore 문법(와일드카드·`**`·디렉터리 접미)을 재구현하면
 *    부정 패턴 하나만 틀려도 반대로 안내한다 — 이 저장소가 여러 번 실패한 "손수 oracle" 부류다.
 *    여기서는 **순서와 부정 여부만** 본다.
 */

/** 줄바꿈만 정규화한다(CRLF/LF). 내용은 바꾸지 않는다. */
function lines(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n')
}

/**
 * `!` 로 시작하는 부정 패턴인가.
 *
 * 🔴 **`trim()` 을 쓰지 않는다**(REQ-2026-155 결함 4). gitignore 는 **후행** 공백만 버리고
 *    **선행 공백은 패턴의 일부**다. 실측(`git check-ignore -v`):
 *
 *      `.gitignore` = `*.log` + ` !keep.log`  →  `keep.log` 는 **여전히 1행 `*.log` 가 이긴다**
 *
 *    = 선행 공백이 있으면 부정이 **아니다**. 다듬으면 그런 줄을 부정으로 오인해 완료 티켓의
 *    후속 작업 안내를 불필요하게 막는다.
 *
 * 🔴 `\!literal` 은 이스케이프된 리터럴이라 첫 글자가 `\` — 부정이 아니다(종전과 같다).
 */
export function isNegation(line: string): boolean {
  return line.startsWith('!')
}

/**
 * `head` 의 줄들이 `work` 의 **순서를 보존한 부분수열**로 나타나고, 그 밖에 삽입된 줄이 전부
 * 비-부정인가.
 *
 * 🔴 **집합 비교로는 부족하다**(설계 r02 P1). gitignore 는 **마지막에 일치한 패턴이 이긴다** —
 *    같은 두 줄이라도 순서가 바뀌면 커버리지가 줄어든다:
 *    `!keep.log` → `*.log` (keep.log ignored) 를 `*.log` → `!keep.log` 로 뒤집으면 드러난다.
 *
 * **왜 이 조건이 충분한가**: HEAD 가 ignore 하던 경로 P 에 마지막으로 일치한 줄 L 은 비-부정이다.
 * 워킹에서 L 뒤에 오는 줄은 ① HEAD 의 L 이후 줄들(순서 그대로)과 ② 삽입된 비-부정 줄들뿐이다.
 * ②는 P 를 다시 ignore 하기만 하고 ①은 HEAD 와 같은 결과를 낸다 — P 는 계속 ignored 다. ∎
 */
export function preservesCoverage(headText: string, workText: string): boolean {
  const h = lines(headText)
  const w = lines(workText)
  let i = 0
  for (const line of w) {
    if (i < h.length && line === h[i]) {
      i++ // HEAD 의 줄 — 순서대로 소비한다.
      continue
    }
    // 삽입된 줄 — 부정이면 커버리지가 좁아질 수 있다.
    if (isNegation(line)) return false
  }
  // HEAD 의 줄이 전부 나타났는가(하나라도 사라졌으면 좁아질 수 있다).
  return i === h.length
}

/** 판정 입력 하나 — 한 `.gitignore` 경로의 HEAD/워킹 내용(둘 다 없으면 `null`). */
export interface GitignoreChange {
  path: string
  /** HEAD blob 내용. 신규 파일이면 `null`. */
  head: string | null
  /** 워킹 파일 내용. 삭제됐으면 `null`. */
  work: string | null
}

/**
 * 커버리지가 **좁아질 수 있는** 경로만 돌려준다(안전한 것은 빠진다).
 *
 * 🔴 **애매하면 좁아질 수 있다고 본다** — 틀리는 쪽이 안전하다.
 * 🔴 신규 파일(`head === null`)도 조건을 받는다: 하위 디렉터리에 `!keep.log` 만 든 새 파일은
 *    부모 규칙을 **부정**한다. "신규 = 순수 추가"는 틀렸다.
 */
export function narrowingPaths(changes: readonly GitignoreChange[]): string[] {
  const out: string[] = []
  for (const c of changes) {
    if (c.work === null) {
      out.push(c.path) // 삭제 — 그 파일의 규칙이 통째로 사라진다.
      continue
    }
    if (!preservesCoverage(c.head ?? '', c.work)) out.push(c.path)
  }
  return out
}
