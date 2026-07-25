/**
 * lockfile diff **요약** (REQ-2026-056·DEC-E1).
 *
 * `git diff --cached` 전문이 리뷰 프롬프트에 들어가는데, lockfile(`package-lock.json`·`pnpm-lock.yaml` 등)은
 * 수천 줄 기계생성이라 토큰을 낭비하고 사람/리뷰어 신호를 묻는다. lockfile 구획의 hunk를 **요약**(경로·헤더
 * 보존 + ±N/M + 생략분 sha256)으로 대체한다.
 *
 * 🔴 **프롬프트만 바꾼다** — 승인 바인딩(reviewTree = git write-tree)은 전체 index라 이 문자열 변형과 무관하다.
 *    승인은 여전히 전체 lockfile을 결속한다(이 모듈은 그 사실을 강제하지 않지만, 호출부가 stagedDiff 문자열에만
 *    이 변형을 적용한다).
 *
 * 순수 모듈 — fs·git을 모른다(deterministic·`createHash`만).
 */
import { createHash } from 'node:crypto'

/** lockfile로 인식할 basename(정확 일치만 — 경로 부분문자열 오탐 방지). */
export const LOCKFILE_NAMES: ReadonlySet<string> = new Set([
  'package-lock.json',
  'npm-shrinkwrap.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
])

/** 경로 접두(`a/`·`b/`)·git C-quote(따옴표)를 벗겨 정규화한다. */
function stripPathDecoration(raw: string): string {
  let t = raw.trim()
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) t = t.slice(1, -1) // git quoted path
  if (t.startsWith('a/') || t.startsWith('b/')) t = t.slice(2)
  return t
}

/**
 * 한 구획의 **모든 후보 경로**를 헤더 줄에서 모은다(r01 P1). `diff --git`의 양쪽 경로는 공백에서 모호하므로
 * `---`/`+++`/`rename from|to`/`copy from|to`/`Binary files … differ`의 명시 경로도 함께 본다 —
 * rename(한쪽만 lockfile)·공백/따옴표 경로에서도 인식되게.
 */
function sectionPaths(section: string[]): string[] {
  const paths: string[] = []
  const add = (p: string | undefined): void => {
    if (p === undefined) return
    const s = stripPathDecoration(p)
    if (s && s !== '/dev/null') paths.push(s)
  }
  for (const line of section) {
    if (line.startsWith('--- ')) add(line.slice(4))
    else if (line.startsWith('+++ ')) add(line.slice(4))
    else if (line.startsWith('rename from ')) add(line.slice(12))
    else if (line.startsWith('rename to ')) add(line.slice(10))
    else if (line.startsWith('copy from ')) add(line.slice(10))
    else if (line.startsWith('copy to ')) add(line.slice(8))
    else if (line.startsWith('Binary files ')) {
      const m = /^Binary files (.+) and (.+) differ$/.exec(line)
      if (m) { add(m[1]); add(m[2]) }
    } else if (line.startsWith('diff --git ')) {
      const m = /^diff --git (.+) (.+)$/.exec(line) // best-effort(공백 경로면 ---/+++가 보완)
      if (m) { add(m[1]); add(m[2]) }
    }
  }
  return paths
}

/** 경로 basename이 lockfile인가(정확 일치). */
export function isLockfilePath(path: string): boolean {
  const base = path.replace(/\\/g, '/').split('/').pop() ?? ''
  return LOCKFILE_NAMES.has(base)
}

/** 구획이 lockfile을 다루는가(양쪽 경로·rename·binary 헤더 모두 검사). */
function sectionIsLockfile(section: string[]): { yes: boolean; display: string } {
  const paths = sectionPaths(section)
  const lock = paths.find(isLockfilePath)
  return { yes: lock !== undefined, display: lock ?? paths[paths.length - 1] ?? '(lockfile)' }
}

/** 한 파일 구획(`diff --git`으로 시작하는 줄 배열)을 요약(lockfile일 때만). 비-lockfile은 그대로. */
function summarizeSection(section: string[]): string[] {
  const { yes, display: path } = sectionIsLockfile(section)
  if (!yes) return section

  const hunkIdx = section.findIndex((l) => l.startsWith('@@ '))
  if (hunkIdx >= 0) {
    const header = section.slice(0, hunkIdx)
    const hunks = section.slice(hunkIdx)
    // `+++`/`---`는 파일 헤더라 hunkIdx 이후엔 없지만 방어적으로 제외한다.
    const plus = hunks.filter((l) => l.startsWith('+') && !l.startsWith('+++')).length
    const minus = hunks.filter((l) => l.startsWith('-') && !l.startsWith('---')).length
    const sha = createHash('sha256').update(hunks.join('\n'), 'utf8').digest('hex').slice(0, 12)
    return [
      ...header,
      `# [lockfile 전문 생략 — 요약 모드] ${path}: +${plus}/-${minus} lines · sha256(생략분)=${sha} · 전문은 config lockfilePromptFull:true`,
    ]
  }
  const binaryIdx = section.findIndex((l) => l.startsWith('Binary files ') && l.includes(' differ'))
  if (binaryIdx >= 0) {
    return [...section.slice(0, binaryIdx), `# [lockfile binary 변경 — 요약 모드] ${path} · 전문은 config lockfilePromptFull:true`]
  }
  // hunk도 binary도 없음(순수 rename/mode 변경 등) — 헤더만 작으니 그대로 둔다.
  return section
}

/**
 * staged diff의 lockfile 구획을 요약한다(순수). `opts.full`이면 원문 그대로.
 * 🔴 lockfile 구획이 하나도 없으면 **완전 no-op**(입력===출력) — 기존 byte-identical near-e2e 무회귀.
 */
export function summarizeLockfileDiff(stagedDiff: string, opts: { full: boolean }): string {
  if (opts.full || stagedDiff === '') return stagedDiff
  const lines = stagedDiff.split('\n')
  const starts: number[] = []
  for (let i = 0; i < lines.length; i++) if (lines[i]!.startsWith('diff --git ')) starts.push(i)
  if (starts.length === 0) return stagedDiff // 표준 파일 구획 없음 → 손대지 않는다.

  // 구획별로 요약(비-lockfile은 그대로). 요약이 하나도 일어나지 않으면 원문 반환(no-op 보장).
  const result: string[] = []
  if (starts[0]! > 0) result.push(...lines.slice(0, starts[0]!)) // 첫 구획 前 preamble(있으면) 보존.
  let changed = false
  for (let s = 0; s < starts.length; s++) {
    const from = starts[s]!
    const to = s + 1 < starts.length ? starts[s + 1]! : lines.length
    const section = lines.slice(from, to)
    const summarized = summarizeSection(section)
    if (summarized !== section) changed = true // summarizeSection은 요약 시에만 새 배열을 반환한다.
    result.push(...summarized)
  }
  if (!changed) return stagedDiff // lockfile 구획 없음(또는 요약 대상 없음) → 원문 그대로.
  return result.join('\n')
}
