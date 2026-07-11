/**
 * `git status --porcelain=v1 -z` 파서 (REQ-2026-012 phase-1a · 설계 D11·D11-1).
 *
 * 목적: porcelain 출력을 해석하는 **단일 지점**. 이전에는 세 곳이 각자 파싱했고 둘은 경로를 망가뜨렸다
 *   - `bin/init.ts`의 `parsePorcelainLine`(rename에서 dest만) — 삭제 예정(phase-1b)
 *   - `req-doctor.ts`의 `statusPaths`(인용 해제 없음 + 역슬래시를 `/`로 치환)
 *   - `review-codex.ts`의 `findUnstagedOrUntracked` 인라인 파싱(동일 결함)
 *
 * ⚠️ **왜 `-z`인가.** 기본 porcelain은 `"`·`\`·제어문자·(quotePath=true면)비-ASCII가 든 경로를 **C-인용**한다.
 *    `core.quotePath=false`는 비-ASCII 인용만 끄므로 나머지는 여전히 인용된다. 인용된 경로를 디코드하면
 *    "원문 보존"과 "디코드된 경로 반환"을 동시에 만족할 수 없고(설계 D11), 경로에 ` -> `가 들어가면
 *    rename delimiter 분할도 깨진다. `-z`는 **인용을 아예 하지 않으므로** 두 문제가 함께 사라진다.
 *
 * ⚠️ **rename/copy 필드 순서가 `->` 형식과 반대다.**
 *      `--porcelain`     : `R  old -> new`
 *      `--porcelain -z`  : `R  new\0old\0`      ← NEW가 먼저
 *
 * ⚠️ **`R`/`C`는 index(X)와 worktree(Y) 양쪽에 온다**(설계 D11-1, `git-status(1)`의 `[ D] R`·`[ D] C`).
 *    실측: `mv a c && git add -N c` → ` R c.txt\0a.txt\0` (X=' ', Y='R').
 *    X만 검사하면 OLD 경로가 **독립 레코드로 새어 나가고** `origPath`가 소실된다. 그러면
 *    `findUnstagedOrUntracked`/D13이 rename의 src·dest를 둘 다 검사해 막던
 *    "비허용 경로 → 허용 경로 rename으로 `responses/` 주입·코드 삭제 우회"(A2-P2-1)가 뚫린다. 보안 회귀다.
 *
 * ⚠️ **경로를 정규화하지 않는다.** git은 언제나 `/`를 구분자로 내므로 역슬래시는 **파일명의 일부**다.
 *    옛 코드의 `.replace(/\\/g, '/')`는 `a\b.txt`를 `a/b.txt`로 뭉갰다 — 그 버그를 여기서 고친다.
 *
 * fail-closed: 형식이 어긋나거나 rename 레코드의 `origPath`가 없으면 throw한다. `undefined`를 흘리지 않는다.
 */

/** porcelain v1 레코드 하나. `-z`이므로 `path`는 인용되지 않은 원문이다. */
export interface StatusEntry {
  /** X — index(스테이지) 상태 문자. 변경 없음은 `' '`. */
  index: string
  /** Y — worktree 상태 문자. 변경 없음은 `' '`. untracked는 X=Y=`'?'`. */
  worktree: string
  /** `-z`가 먼저 내는 경로. rename/copy면 **목적지(NEW)**, 그 외는 유일한 경로. */
  path: string
  /** rename/copy일 때만 존재하는 **원본(OLD)** 경로. */
  origPath?: string
}

/** `R`(rename)·`C`(copy)는 index·worktree 어느 열에 와도 추가 경로 필드를 소비한다(설계 D11-1). */
export function isRenameOrCopy(index: string, worktree: string): boolean {
  return index === 'R' || index === 'C' || worktree === 'R' || worktree === 'C'
}

/**
 * `git status --porcelain=v1 -z --untracked-files=all`의 **원문**을 엔트리 배열로 분해한다.
 *
 * 레코드 형식은 `XY<space><path>`이고 NUL로 구분된다. rename/copy 레코드는 뒤이어 OLD 경로 필드를 하나 더 갖는다.
 * 후행 NUL이 만드는 마지막 빈 필드만 버린다 — 그 외 위치의 빈 필드는 형식 오류다(fail-closed).
 */
export function parseStatusZ(raw: string): StatusEntry[] {
  const fields = raw.split('\0')
  // `-z` 출력은 언제나 NUL로 끝나므로 마지막 원소는 빈 문자열이다. 클린 트리(`''`)도 `['']`가 된다.
  if (fields.length > 0 && fields[fields.length - 1] === '') fields.pop()

  const out: StatusEntry[] = []
  for (let i = 0; i < fields.length; i++) {
    const rec = fields[i]
    if (rec === undefined) throw new Error('porcelain -z: 레코드 인덱스 이탈(내부 오류)')
    // `XY<space>` + 최소 한 글자 경로.
    if (rec.length < 4 || rec[2] !== ' ')
      throw new Error(`porcelain -z: 레코드 형식 오류(XY<space><path> 아님): ${JSON.stringify(rec)}`)

    const index = rec[0] as string
    const worktree = rec[1] as string
    const path = rec.slice(3) // 정규화하지 않는다 — 역슬래시는 파일명의 일부다.

    if (isRenameOrCopy(index, worktree)) {
      const origPath = fields[++i]
      if (origPath === undefined || origPath === '')
        throw new Error(`porcelain -z: rename/copy 레코드에 원본 경로가 없다(truncated): ${JSON.stringify(rec)}`)
      out.push({ index, worktree, path, origPath })
    } else {
      out.push({ index, worktree, path })
    }
  }
  return out
}

/**
 * 이 엔트리가 건드리는 **모든** 경로. rename/copy는 `[OLD, NEW]` 순서다.
 *
 * 순서는 옛 `statusPaths`(`[body.slice(0,arrow), body.slice(arrow+4)]` = `[old, new]`)와 같다 —
 * 호출부의 `flatMap(statusPaths)` 시맨틱을 보존한다.
 */
export function entryPaths(e: StatusEntry): string[] {
  return e.origPath === undefined ? [e.path] : [e.origPath, e.path]
}

/** untracked(`??`) 판정. `-z`에서도 X=Y=`'?'`다. */
export function isUntracked(e: StatusEntry): boolean {
  return e.index === '?' && e.worktree === '?'
}

/** 사람이 읽는 한 줄. 에러 메시지·진단 출력용(`->` 형식으로 되돌려 익숙한 모양을 유지). */
export function formatStatusEntry(e: StatusEntry): string {
  const code = `${e.index}${e.worktree}`
  return e.origPath === undefined ? `${code} ${e.path}` : `${code} ${e.origPath} -> ${e.path}`
}

/** 모든 호출부가 공유하는 정본 인자. 다른 형태를 쓰면 파싱 경계가 깨진다(설계 D10). */
export const STATUS_Z_ARGS = ['status', '--porcelain=v1', '-z', '--untracked-files=all'] as const
