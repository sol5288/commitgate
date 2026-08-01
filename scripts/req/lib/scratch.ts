/**
 * 티켓 내부 경로 분류의 **단일 지점** (REQ-2026-012 phase-1b · 설계 D7·D8 / REQ-2026-092 DEC-1).
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
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔴 **이 파일은 같은 경로에 대해 정반대인 두 사실을 함께 갖는다** (REQ-2026-092).
 *
 *   - `reviewScratchPaths`는 `state.json`을 **관용**한다 — 워킹트리가 더러워도 리뷰를 막지 않는다.
 *   - `sourceCommitForbiddenStaged`는 같은 `state.json`을 **금지**한다 — staged면 커밋할 수 없다.
 *
 * 모순이 아니라 **축이 다르다**: 앞은 *워킹트리* 관용이고 뒤는 *인덱스* 금지다. 그런데 이 비대칭이
 * 정확히 소비자 교착 버그의 원인이었다 — D10(`findUnstagedOrUntracked`)이 `index==='?' || worktree!==' '`
 * 만 보느라 **staged이고 워킹트리가 clean한** `state.json`을 통과시켰고, 그것이 승인 tree에 실려
 * `req:commit`이 영원히 거부하는 승인이 됐다.
 *
 * 두 술어를 떼어 놓으면 다음 사람이 같은 사고를 반복한다. **한 파일에 둔 것이 의도다.**
 * ─────────────────────────────────────────────────────────────────────────────
 */
import type { StatusEntry } from './porcelain'
import { isUntracked } from './porcelain'

/** 티켓 디렉터리 안의 순수 untracked 도구 산출물. 커밋된 적이 없고 승인 증거가 아니다. */
export const TOOL_OUTPUT_BASENAMES = ['codex-response.json', '.review-preview.txt'] as const

/**
 * 리뷰 원장(REQ-2026-051)의 티켓-상대 경로. `state.json`과 **같은 범주**다 — 워크플로가 리뷰 중에
 * (attempt-opened/closed) `responses/` 아래에 쓰는 메타데이터이고, 승인 시점에 커밋된다.
 * 🔴 exact 경로로만 허용한다(rename/카피는 아래 responses/ 규칙으로 여전히 차단) — `responses/**` 전체를
 *    scratch로 열면 승인 아카이브 변조 구멍이 된다(REQ-2026-012 D8).
 */
export const REVIEW_LEDGER_RELNAME = 'responses/review-ledger.jsonl' as const

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
  return [
    `${dir}/${TOOL_OUTPUT_BASENAMES[0]}`,
    `${dir}/${TOOL_OUTPUT_BASENAMES[1]}`,
    `${dir}/state.json`,
    `${dir}/${REVIEW_LEDGER_RELNAME}`, // REQ-2026-051: 리뷰 중 append되는 원장(state.json과 동종). exact 경로만.
  ]
}

/**
 * source 커밋(승인 코드 커밋)에 **실릴 수 없는** staged 경로만 골라낸다 (REQ-2026-092 DEC-1, 순수).
 *
 * 정본은 `req:commit`이 source 커밋 직전에 강제하는 불변식이다 — 티켓의 `state.json`과 `responses/**`는
 * 워크플로 상태·승인 증거이지 코드가 아니며, 도구가 **별도 부기 커밋**으로 남긴다(evidence-finalize·
 * state checkpoint). 코드 커밋에 섞이면 증거가 코드 이력에 누수된다.
 *
 * 🔴 **호출부가 둘이고 둘 다 이 함수만 쓴다** — 갈라지면 그 자체가 REQ-2026-092의 버그다:
 *   1. `req:commit` — source 커밋 직전(거부 = 커밋 실패).
 *   2. `req:review-codex` — **phase 리뷰 시작 전**(거부 = 유료 호출 자체를 안 함).
 *
 * (2)가 없던 시절엔 (1)이 거부할 tree가 그대로 승인됐다. 그러면 `req:commit`의 두 조건
 * "staged tree == approved_diff_hash"와 "비-코드 staged 없음"이 **동시에 참이 될 수 없어**
 * 그 phase는 영원히 커밋 불가가 되고, 승인 행이 `approvals.jsonl`에 append되지 못해 티켓이 교착된다.
 *
 * @param stagedPaths staged **변경** 경로들. `git diff --cached --name-only`(`-z` 권장)의 산출.
 *   ⚠️ `git ls-files`(인덱스 전체)가 아니다 — HEAD와 내용이 같아 diff에 안 잡히는 경로는 tree를
 *   바꾸지 않으므로 교착을 만들지 않는다. 두 호출부 모두 diff 기반이어야 판정이 일치한다.
 * @param ticketDirRel 현재 티켓 디렉터리의 repo-상대 경로. **다른 티켓의 경로는 대상이 아니다.**
 * @returns 위반 경로(입력 순서 유지). 비어 있으면 통과.
 */
export function sourceCommitForbiddenStaged(
  stagedPaths: readonly string[],
  ticketDirRel: string,
): string[] {
  const dir = normDir(ticketDirRel)
  const statePath = `${dir}/state.json`
  const responsesPrefix = `${dir}/responses/`
  // 🔴 **`trim()`을 쓰지 않는다** (phase-1 r01 P1). 앞뒤 공백은 Git 경로의 **일부**다 —
  //    ` workflow/REQ-x/state.json`(선행 공백)은 `workflow/REQ-x/state.json`과 **다른 파일**이고,
  //    다듬으면 그 무고한 파일을 금지 경로로 오인해 정상 리뷰·커밋을 거부한다. 같은 이유로
  //    `review-codex.ts`의 `phaseCodeFiles`도 의도적으로 trim하지 않는다.
  //    `-z` 출력의 마지막 NUL 뒤 빈 조각만 길이로 거른다.
  return stagedPaths
    .map((p) => p.replace(/\\/g, '/'))
    .filter((p) => p.length > 0)
    .filter((p) => p === statePath || p.startsWith(responsesPrefix))
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

/**
 * 아카이브 base(=`design` 또는 phase id)에 허용되는 문자 — **파일명 규칙과 phase id 계약의 단일 원천**
 * (REQ-2026-096 DEC-1).
 *
 * 🔴 이 상수가 존재하는 이유: `archiveBaseName`(lib/evidence.ts)은 phase id를 **무해화 없이** 파일명
 *    base로 쓴다. 그래서 "phase id로 허용되는 문자"와 "아카이브 파일명으로 인식되는 문자"는 **같은 사실**이다.
 *    0.16.0까지 둘이 갈라져 있었고(`PHASE_ID_RE`는 `.`·`_` 허용, 여기는 불허), 그 결과 도구가 쓴 승인
 *    아카이브를 도구 자신이 인식하지 못해 **승인이 났는데 커밋할 수 없는 교착**이 났다(소비자 리포트).
 *    `req-next.ts`의 `PHASE_ID_RE`가 여기서 파생된다 — 다시 갈라질 수 없게.
 *
 * ⚠️ 설계 D7의 "정규식 보간 금지"는 **런타임 값** 보간 금지다(`isTicketDirName`이 문자열 분해를 쓰는 이유).
 *    아래는 모듈 내부 **리터럴 상수 하나**를 결합할 뿐이라 외부 입력이 닿지 않는다.
 */
const ARCHIVE_BASE_BODY = '[A-Za-z0-9][A-Za-z0-9-]*'
export const ARCHIVE_BASE_RE = new RegExp(`^${ARCHIVE_BASE_BODY}$`)

/** 아카이브 파일명 패턴: `<base>-rNN-(approved|needs-fix).json`(NN≥2자리). approvals.jsonl 등은 불일치. */
const ARCHIVE_NAME_RE = new RegExp(`^${ARCHIVE_BASE_BODY}-r\\d{2,}-(approved|needs-fix)\\.json$`)
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
