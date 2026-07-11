/**
 * scratch(도구 산출물) 정의의 **단일 지점** (REQ-2026-012 phase-1b · 설계 D7·D8).
 *
 * 이전엔 세 곳(`req-next.ts`·`req-doctor.ts`·`review-codex.ts`)이 `codex-response.json`·
 * `.review-preview.txt`·`state.json` 세 경로를 각자 리터럴로 적었다. DRY가 아니라 **정확성** 문제였다 —
 * 한 곳이 바뀌면 clean-tree 판정이 갈라진다.
 *
 * 두 종류의 scratch가 있고 **범위가 다르다**:
 *   - review/doctor용: `reviewScratchPaths` — 현재 티켓의 정확한 3경로(`state.json` 포함).
 *   - `req:new`용: `isToolOutputScratch` — 티켓 생성 **전**이라 현재 티켓이 없다. 그래서 **어느 티켓의**
 *     untracked 도구 산출물이든 허용하되, `state.json`·`responses/**`는 **제외**한다(설계 D8: 그것을
 *     허용하면 증거 변조 구멍이 된다). 즉 `req:new`의 예외는 나머지 셋의 **진부분집합**이다.
 *
 * 아카이브 파일명 판정(`isArchiveFileName`)도 여기로 모은다 — `isAllowedResponsesScratch`가 그것을 쓰고,
 * 이 파일을 leaf(포르셀린만 의존)로 두면 `review-codex`↔`scratch` 순환 import가 생기지 않는다.
 */
import type { StatusEntry } from './porcelain'
import { isUntracked } from './porcelain'

/** 티켓 디렉터리 안의 순수 untracked 도구 산출물. 커밋된 적이 없고 승인 증거가 아니다. */
export const TOOL_OUTPUT_BASENAMES = ['codex-response.json', '.review-preview.txt'] as const

/** 경로 정규화: 역슬래시→슬래시(호출부가 넘기는 repo-상대는 이미 `/`지만 방어), 후행 슬래시 제거. */
function normDir(dirRel: string): string {
  return dirRel.replace(/\\/g, '/').replace(/\/+$/, '')
}

/**
 * review/doctor의 clean-tree 검사가 허용하는 **현재 티켓** 3경로(repo-상대).
 * 세 호출부가 리터럴로 만들던 `[codex-response.json, .review-preview.txt, state.json]`을 대체한다.
 */
export function reviewScratchPaths(ticketDirRel: string): string[] {
  const dir = normDir(ticketDirRel)
  return [`${dir}/${TOOL_OUTPUT_BASENAMES[0]}`, `${dir}/${TOOL_OUTPUT_BASENAMES[1]}`, `${dir}/state.json`]
}

/** `REQ-<4자리>-<숫자>` 디렉터리명인가(문자열 분해 — 정규식 보간 금지, 설계 D7). */
function isTicketDirName(seg: string): boolean {
  if (!seg.startsWith('REQ-')) return false
  const rest = seg.slice(4) // `2026-001`
  const dash = rest.indexOf('-')
  if (dash < 0) return false
  const year = rest.slice(0, dash)
  const num = rest.slice(dash + 1)
  if (year.length !== 4 || !isAllDigits(year)) return false
  return num.length > 0 && isAllDigits(num)
}

function isAllDigits(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 48 || c > 57) return false
  }
  return true
}

/**
 * `req:new`의 좁은 예외(설계 D7). **다음을 모두** 만족하는 엔트리만 무시한다:
 *   - untracked(X=Y=`?`). ` M`·`M `·`R ` 등 tracked·staged·rename은 무시하지 않는다.
 *   - `path`가 `<ticketRoot>/REQ-<4자리>-<숫자>/<basename>`이고 `<basename>` ∈ `TOOL_OUTPUT_BASENAMES`.
 *
 * `state.json`·`responses/**`는 basename 목록에 없으므로 자동으로 제외된다(설계 D8).
 * 이 술어는 승인을 **부여하지 않는다**(설계 D9) — 위조 파일을 통과시켜도 `req:new`는
 * `commit_allowed:false`인 새 state만 쓴다.
 */
export function isToolOutputScratch(entry: StatusEntry, ticketRoot: string): boolean {
  if (!isUntracked(entry)) return false
  const root = normDir(ticketRoot)
  // ticketRoot='.' 또는 canonical repo-root('')도 유효하다. 이때 Git 경로에는 './' 접두사가 없다.
  const prefix = root === '' || root === '.' ? '' : `${root}/`
  if (!entry.path.startsWith(prefix)) return false
  const rest = entry.path.slice(prefix.length) // `REQ-2026-001/codex-response.json`
  const slash = rest.indexOf('/')
  if (slash < 0) return false
  const ticketSeg = rest.slice(0, slash)
  const basename = rest.slice(slash + 1)
  if (basename.includes('/')) return false // 티켓 직계만
  if (!(TOOL_OUTPUT_BASENAMES as readonly string[]).includes(basename)) return false
  return isTicketDirName(ticketSeg)
}

// ─────────────────────────────────── 승인 증거 아카이브 (REQ-016 A1, review-codex에서 이동) ──

/** 아카이브 파일명 패턴: `<base>-rNN-(approved|needs-fix).json`(NN≥2자리). approvals.jsonl 등은 불일치. */
const ARCHIVE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9-]*-r\d{2,}-(approved|needs-fix)\.json$/
export function isArchiveFileName(name: string): boolean {
  return ARCHIVE_NAME_RE.test(name)
}

/**
 * 현재 티켓 `responses/` 하위의 **untracked 승인 아카이브 하나**만 스크래치로 허용(REQ-016 A1·D-016-4).
 * `approvals.jsonl`·tracked 수정/삭제/리네임·타 티켓·collapsed dir은 전부 위반(커밋된 증거 변조·주입 차단).
 *
 * StatusEntry 기반(설계 D11). untracked만 허용하므로 rename의 origPath는 볼 필요가 없다.
 * ⚠️ `entry.path`를 정규화하지 않는다 — `-z`가 준 원문이다. 역슬래시는 파일명의 일부다(옛 코드의 버그를 안 물려받는다).
 */
export function isAllowedResponsesScratch(entry: StatusEntry, ticketRel: string): boolean {
  if (!isUntracked(entry)) return false // X=Y=`?`
  const prefix = `${normDir(ticketRel)}/responses/`
  if (!entry.path.startsWith(prefix)) return false
  const name = entry.path.slice(prefix.length)
  if (name.includes('/')) return false // 직계만
  return isArchiveFileName(name)
}
