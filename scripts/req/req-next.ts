#!/usr/bin/env tsx
/**
 * req:next — 워크플로의 **다음 행동**을 상태에서 계산해 한 줄로 알려준다 (REQ-2026-010 phase-2).
 *
 * 존재 이유: "끊지 말고 끝까지 진행하라"를 에이전트의 기억에 맡기면 컨텍스트가 길어질수록 신뢰도가 떨어진다.
 * 다음 행동은 `state.json` + git 상태의 **결정론적 함수**이므로 도구가 계산한다. 에이전트 루프는 이렇게 짧아진다:
 *   `req:next`를 실행 → 시키는 것을 하고 → 다시 `req:next`. `AWAIT_HUMAN`이면 그 문장 그대로 승인받기 전엔 멈춘다.
 *
 * ⚠️ **읽기 전용이다**(D6-1). 어떤 상태도 쓰지 않는다.
 *   - `git write-tree` 금지 — object DB에 tree object를 쓴다. 그래서 바인딩 비교는 `captureIndexHash`(ls-files)로 한다.
 *   - `git status`·`git diff --cached`는 stat cache 갱신으로 `.git/index`를 **다시 쓴다**. 모든 호출을
 *     `--no-optional-locks`(= `GIT_OPTIONAL_LOCKS=0`의 CLI 등가물)로 감싼다.
 *   - `createReadOnlyGit`이 allowlist를 **런타임에도** 강제한다(테스트뿐 아니라 실행 중에도).
 *
 * ⚠️ **강제(enforcement)가 아니라 자문(advisory)이다.** 승인 게이트는 여전히 `req:review-codex`/`req:commit`에 있다.
 * `req:next`가 틀려도 게이트는 뚫리지 않는다. 그래서 애매하면 `RUN` 쪽으로 기운다(fail-forward).
 *
 * 사용: req:next <REQ-id> [--json] [--root <path>] [--ticket <dir>]   (저장소 패키지매니저의 실행 형식으로)
 */
import { resolve, join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadConfig, buildScriptInvocation, type PackageManager } from './lib/config'
import { createGitAdapter, type GitAdapter } from './lib/adapters'
import { parseStatusZ, STATUS_Z_ARGS } from './lib/porcelain'
import { reviewScratchPaths } from './lib/scratch'
import {
  loadState,
  readPhases,
  captureDesignBinding,
  captureIndexHash,
  findUnstagedOrUntracked,
  type WorkflowState,
  type ReviewKind,
  type LastReviewMarker,
} from './review-codex'

// ─────────────────────────────────────────────── 읽기 전용 git 경계 (D6-1) ──

type GitFn = (args: string[]) => string

/** `req:next`가 호출해도 되는 git subcommand. 전부 무쓰기. */
export const READONLY_GIT_SUBCOMMANDS: ReadonlySet<string> = new Set(['rev-parse', 'status', 'diff', 'ls-files'])

/**
 * argv에서 전역 플래그(`--no-optional-locks`, `-c <k=v>`, 기타 `-`로 시작)를 걷어낸 **첫 subcommand**.
 * 없으면 null.
 */
export function gitSubcommand(args: string[]): string | null {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === undefined) continue
    if (a === '-c') {
      i++ // -c 는 값을 하나 먹는다
      continue
    }
    if (a.startsWith('-')) continue
    return a
  }
  return null
}

/**
 * 읽기 전용 git 래퍼. 두 가지를 한다.
 *   1. 모든 호출 앞에 `--no-optional-locks`를 붙여 `.git/index` stat-cache 재기록을 막는다.
 *   2. allowlist 밖 subcommand(`write-tree`·`add`·`commit`·`reset` …)를 **실행 전에 throw**한다.
 *
 * (2)가 방어의 핵심이다 — 나중에 누가 무심코 `captureGitBinding`(write-tree)을 끌어 쓰면 즉시 터진다.
 */
export function createReadOnlyGit(adapter: GitAdapter): GitFn {
  return (args) => {
    const sub = gitSubcommand(args)
    if (sub === null || !READONLY_GIT_SUBCOMMANDS.has(sub))
      throw new Error(
        `req:next는 읽기 전용이다 — 허용되지 않은 git subcommand: ${sub ?? '(없음)'} (허용: ${[...READONLY_GIT_SUBCOMMANDS].join(', ')})`,
      )
    return adapter.exec(['--no-optional-locks', ...args])
  }
}

// ──────────────────────────────────────────────────────── 판정 결과 타입 ──

export type NextKind = 'RUN' | 'AGENT' | 'AWAIT_HUMAN' | 'DONE' | 'BLOCKED'

export interface NextAction {
  kind: NextKind
  /** 사람이 읽는 설명. 한 문장. */
  detail: string
  /** kind=RUN일 때 그대로 실행할 명령. */
  command?: string
  /** kind=AWAIT_HUMAN일 때 통제점 식별자. */
  controlPoint?: string
  /** kind=AWAIT_HUMAN일 때 **그 문장 그대로** 받아야 하는 승인 문장. */
  approvalSentence?: string
  /** kind=BLOCKED일 때 진단(state 덤프·검증 오류). */
  diagnostics?: string[]
}

/**
 * exit 계약. `RUN`/`AGENT`는 0(계속 진행 가능), `AWAIT_HUMAN`/`DONE`은 "루프를 멈춰라"라서 0과 구분한다.
 * `BLOCKED`=2는 `req:review-codex`의 blocked와 숫자를 맞춘다.
 *
 * ⚠️ `req:next`는 **CI 게이트가 아니다**. 판정 정본은 stdout(`--json`)의 `kind` 필드이고, exit code는 셸 루프 편의다.
 * CI가 10/11을 실패로 읽지 않도록 주의.
 */
export const NEXT_EXIT_CODES: Record<NextKind, number> = {
  RUN: 0,
  AGENT: 0,
  BLOCKED: 2,
  AWAIT_HUMAN: 10,
  DONE: 11,
}

export function nextExitCode(kind: NextKind): number {
  return NEXT_EXIT_CODES[kind]
}

// ────────────────────────────────────────────────────── 순수 판정 코어 ──

export interface NextInput {
  /** 후속 명령이 대상으로 삼을 티켓. `--ticket`으로 읽었으면 그대로 보존된다(R5). */
  target: NextTarget
  state: WorkflowState
  packageManager: PackageManager
  /** 설계 문서 3종이 git 인덱스에 전부 있는가. */
  designDocsInIndex: boolean
  /** 현재 설계문서 바인딩 해시. 계산 불가면 null. */
  currentDesignHash: string | null
  hasStagedChanges: boolean
  /** G1: `findUnstagedOrUntracked`가 비었는가(리뷰 가능한 워킹트리). */
  worktreeReviewClean: boolean
  /** 현재 인덱스 전체 해시(`captureIndexHash`). 계산 불가면 null. */
  currentIndexHash: string | null
}

/** `consumed_approvals[]`에서 phase_id를 안전하게 읽는다. */
function readConsumed(state: WorkflowState): { phase_id: string | null }[] {
  const raw = (state as { consumed_approvals?: unknown }).consumed_approvals
  if (!Array.isArray(raw)) return []
  return raw
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
    .map((e) => ({ phase_id: typeof e.phase_id === 'string' ? e.phase_id : null }))
}

/**
 * 다음 대상 phase (REQ-2026-010 design R2).
 *
 * ⚠️ 진행도의 정본은 `consumed_approvals[].phase_id`이지 `phases[].approved`가 **아니다.**
 * `applyVerdict`는 승인 시 `approved`를 `true`로만 토글하고 미승인 시 되돌리지 않는다(sticky).
 * 그래서 "승인 → 코드 수정 → 재리뷰 NEEDS_FIX" 상태에서 `approved`로 세면 대상이 0개가 되어 판정이 무너진다.
 * `consumed_approvals`는 `req:commit`이 실제 커밋 시에만 append하는 append-only 원장이다.
 *
 * ⚠️ **전제: `phaseModelProblems(state)`가 비어 있어야 한다.** id가 중복이면 소비 1건이 같은 id의
 * 모든 항목을 소비 처리해 `null`(=전부 끝남)을 반환한다. `resolveNext`가 호출 전에 걸러 준다.
 */
export function nextPhaseId(state: WorkflowState): string | null {
  const consumed = new Set(readConsumed(state).map((c) => c.phase_id).filter((p): p is string => p !== null))
  const pending = readPhases(state).find((p) => !consumed.has(p.id))
  return pending?.id ?? null
}

/**
 * `req:next`가 **렌더링하는 명령의 argv 토큰**에 허용되는 형식 (phase-2 R3/R4 P2).
 * `config.ts`의 designDocs basename 패턴과 같은 계약이며, 두 곳에 쓴다: `--phase <id>` 값, positional REQ id.
 *
 * - **선행 `-` 금지**: `review-codex`의 `parseArgs`는 `--phase` 값이 `-`로 시작하면 "값 누락"으로 throw하고,
 *   positional로 오면 unknown option으로 죽는다.
 * - **공백·따옴표·세미콜론 금지**: `renderAction`이 argv를 `.join(' ')`로 렌더링하므로 argv 경계가 깨진다.
 *   `state.id = 'REQ-2026-010 bad'`면 `... -- 2026-010 bad --kind phase ...`가 되어 `bad`가 REQ id로 읽힌다.
 *
 * `req:next`의 계약은 "다음 행동을 알려준다"가 아니라 **"실행 가능하고 옳은 다음 행동만 알려준다"**이다.
 * 렌더링할 수 없으면 `RUN`/`AWAIT_HUMAN`을 내지 않고 `BLOCKED`로 진단한다.
 */
export const CLI_SAFE_ARG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** phase id는 argv 토큰이다. `CLI_SAFE_ARG_RE`와 같은 계약. */
export const PHASE_ID_RE = CLI_SAFE_ARG_RE

/** REQ id(`REQ-` 접두 제거 후)도 positional argv 토큰이다. */
export const REQ_ID_RE = CLI_SAFE_ARG_RE

/**
 * `--ticket <dir>` 값에서 **argv/셸 렌더링을 깨뜨리는** 문자 (phase-2 R6 P2).
 *
 * ⚠️ 화이트리스트를 쓰면 안 된다. 정상 경로가 전부 막힌다:
 *   `D:\proj\workflow\REQ-2026-010`(콜론) · `/tmp/x/REQ-2026-010`(선행 `/`) · `./workflow/REQ-2026-010`(선행 `.`).
 * 그래서 **실제로 문제가 되는 문자만** 막는다: 공백류(`.join(' ')` 경계 파괴), 따옴표/백틱,
 * 명령 구분·치환·리다이렉트 메타문자.
 *
 * 선행 `-`는 별도로 막는다(옵션으로 파싱된다).
 * 참고: Windows 역슬래시 경로는 POSIX 셸에 그대로 붙여넣으면 이스케이프로 해석될 수 있다. `req:next`의
 * 출력은 **표시용**이고 실행 주체는 사람/에이전트이므로, 여기서는 argv 경계만 보장한다.
 */
export const UNSAFE_CLI_PATH_CHARS = /[\s"'`$;&|<>()*?!#~^%{}[\]]/

/** `--ticket <dir>` 값이 후속 명령에 그대로 실릴 수 있는지. */
export function ticketPathProblems(ticketDir: string): string[] {
  if (ticketDir.trim() === '') return ['--ticket 경로가 비어 있다']
  if (ticketDir.startsWith('-'))
    return [`--ticket 경로가 '-'로 시작한다: ${JSON.stringify(ticketDir)} — 후속 명령에서 옵션으로 파싱된다.`]
  const bad = UNSAFE_CLI_PATH_CHARS.exec(ticketDir)
  if (bad)
    return [
      `--ticket 경로에 argv/셸을 깨뜨리는 문자가 있다: ${JSON.stringify(bad[0])} in ${JSON.stringify(ticketDir)} — 공백·따옴표·명령 구분자는 쓸 수 없다.`,
    ]
  return []
}

/**
 * 후속 명령이 대상으로 삼을 티켓 (phase-2 R5 P2).
 *
 * ⚠️ **`reqId` 문자열만으로는 부족하다.** `req:next --ticket <dir>`로 비표준 위치의 티켓을 읽고
 * `req:review-codex -- <reqId>`를 지시하면, 그 명령은 **기본 위치**(`workflow/REQ-<id>`)를 리뷰한다.
 * 방금 판정한 티켓이 아니다. 그래서 "어떻게 지목했는가"를 그대로 보존해 명령에 되돌려 준다.
 */
export type NextTarget = { kind: 'req'; reqId: string } | { kind: 'ticket'; ticketDir: string }

/** 후속 명령에 붙일 target argv. */
function targetArgs(t: NextTarget): string[] {
  return t.kind === 'req' ? [t.reqId] : ['--ticket', t.ticketDir]
}

/**
 * target이 후속 명령에 안전하고 **실제로 방금 판정한 티켓을 가리키는지** 검증한다 (phase-2 R5 P2).
 *
 * `kind: 'req'`에서 **identity 검증**이 핵심이다. `main()`이 `workflow/REQ-2026-010/state.json`을 읽었는데
 * 그 안의 `id`가 `REQ-2026-999`면, argv-safe하다는 이유로 통과시켜선 안 된다 — 렌더링한 명령이
 * **다른 티켓**을 대상으로 한다. 이 경우는 state 손상이므로 `BLOCKED`.
 */
export function targetProblems(target: NextTarget, state: WorkflowState): string[] {
  if (target.kind === 'ticket') return ticketPathProblems(target.ticketDir)
  const problems = reqIdProblems(target.reqId)
  if (problems.length) return problems
  const expected = `REQ-${target.reqId}`
  if (state.id !== expected)
    return [
      `state.json의 id(${JSON.stringify(state.id)})가 요청한 티켓(${expected})과 다르다 — 후속 명령이 다른 티켓을 대상으로 하게 된다. state.json을 확인하라.`,
    ]
  return []
}

/**
 * `phases`를 진행도 계산에 쓸 수 있는지 검사한다 (phase-2 R1/R2/R3 P2). 문제가 있으면 사유 목록, 없으면 빈 배열.
 *
 * 넷 다 **조용한 오판정**으로 이어지는 같은 실패 class다.
 *
 *   1. **배열이 아님**(`phases: {…}` / `null`): `Array.isArray` 실패 → `rawLen=0` → **레거시로 오분류**되어
 *      소비 이력만 있으면 `DONE`이 나온다.
 *   2. **malformed 항목**: `readPhases`가 `{id: string}`이 아닌 항목을 걸러내므로 배열이 비어 보이고
 *      `pending=null`이 된다(그런데 `rawLen>0`이라 레거시 분기로도 안 간다) → 조용한 `DONE`.
 *   3. **빈 id**(`id: ''`): `readPhases`는 통과시키지만 `--phase` 인자로 쓸 수 없다. `reviewCmd`가 `--phase`를
 *      빠뜨린 명령을 지시하고, `review-codex`의 `resolvePhaseTarget`이 "대상 모호"로 죽는다.
 *   4. **CLI-불안전 id**(`--bad`, 공백 포함): `req:next`가 **실행 불가능한 `RUN`**을 지시한다.
 *      `--phase --bad`는 `parseArgs`가 값 누락으로 throw하고, 공백은 `.join(' ')` 렌더링에서 argv를 깬다.
 *   5. **중복 id**: `consumed_approvals`에 `p1` 1건만 있어도 `phases=[p1, p1]` 두 항목이 모두 소비 처리된다.
 *
 * 판정 불가면 조용히 넘어가지 않고 `BLOCKED`(fail-closed). state는 사람이 고쳐야 한다.
 * ⚠️ `phases` **부재**와 **빈 배열**만이 정상적인 "여기서 판단하지 않음"이다(레거시 또는 미분해).
 */
export function phaseModelProblems(state: WorkflowState): string[] {
  const raw = (state as { phases?: unknown }).phases
  if (raw === undefined) return [] // 부재 = 레거시. 다른 분기가 처리한다.
  if (!Array.isArray(raw))
    return [`phases가 배열이 아니다(${raw === null ? 'null' : typeof raw}) — 레거시로 오분류되어 조용히 DONE이 될 수 있다`]
  if (raw.length === 0) return [] // 빈 배열 = 레거시 또는 미분해.

  const problems: string[] = []
  const parsed = readPhases(state)
  if (parsed.length !== raw.length)
    problems.push(`phases[]에 형식이 잘못된 항목 ${raw.length - parsed.length}개(문자열 id 필요) — 진행도를 셀 수 없다`)

  const empty = parsed.filter((p) => p.id.trim() === '').length
  if (empty) problems.push(`phases[].id가 비어 있는 항목 ${empty}개 — \`--phase\` 인자로 쓸 수 없다`)

  const unsafe = parsed.filter((p) => p.id.trim() !== '' && !PHASE_ID_RE.test(p.id)).map((p) => JSON.stringify(p.id))
  if (unsafe.length)
    problems.push(
      `phases[].id가 CLI 인자로 안전하지 않다: ${unsafe.join(', ')} — ${String(PHASE_ID_RE)} 형식이어야 한다(선행 '-'는 --phase 값 누락으로, 공백은 argv 깨짐으로 이어진다)`,
    )

  const seen = new Set<string>()
  const dup = new Set<string>()
  for (const p of parsed) {
    if (seen.has(p.id)) dup.add(p.id)
    seen.add(p.id)
  }
  if (dup.size) problems.push(`phases[].id 중복: ${[...dup].join(', ')} — 소비 1건이 같은 id의 모든 항목을 소비 처리한다`)

  return problems
}

/**
 * 렌더링할 명령의 positional REQ id가 argv-안전한지 (phase-2 R4 P2).
 *
 * `main()`은 CLI 인자가 아니라 **`state.id`에서 파생한** reqId를 쓴다(`state.id.replace(/^REQ-/, '')`).
 * 그래서 `state.json`이 손상되면 `req:next`가 **다른 티켓을 대상으로 하는 명령**을 지시할 수 있다:
 *   `state.id = 'REQ-2026-010 bad'` → `... -- 2026-010 bad --kind phase ...` → `bad`가 REQ id로 읽힌다.
 *   `state.id = 'REQ---bad'`        → `... -- --bad ...`                     → unknown option으로 죽는다.
 */
export function reqIdProblems(reqId: string): string[] {
  if (REQ_ID_RE.test(reqId)) return []
  return [
    `REQ id가 CLI 인자로 안전하지 않다: ${JSON.stringify(reqId)} — ${String(REQ_ID_RE)} 형식이어야 한다. state.json의 \`id\`를 확인하라.`,
  ]
}

/**
 * `phaseId === null`은 **레거시**(phase 미추적)라 `--phase`를 붙이지 않는 것이 옳다.
 * 빈 문자열 id는 여기 도달할 수 없다 — `phaseModelProblems`의 0번 분기가 먼저 `BLOCKED`로 막는다.
 * (도달했다면 `--phase` 없는 명령이 나가고 `resolvePhaseTarget`이 "대상 모호"로 죽는다.)
 */
function reviewCmd(pm: PackageManager, target: NextTarget, kind: ReviewKind, phaseId: string | null): string {
  const args = [...targetArgs(target), '--kind', kind]
  if (phaseId !== null) args.push('--phase', phaseId)
  args.push('--run')
  return buildScriptInvocation(pm, 'req:review-codex', args).join(' ')
}

function commitCmd(pm: PackageManager, target: NextTarget): string {
  return buildScriptInvocation(pm, 'req:commit', [...targetArgs(target), '--run']).join(' ')
}

/**
 * 대상(REQ id 또는 `--ticket`) 미지정 에러 문구(DEC-011-1). **config 로드 이후**라 pm별로 파생한다.
 * 리터럴을 박으면 다른 pm 프로젝트의 사용자가 그대로 따라 할 수 없는 명령을 안내받는다.
 */
export function missingTargetHint(pm: PackageManager): string {
  return `REQ id 또는 --ticket <dir> 필요 (예: ${buildScriptInvocation(pm, 'req:next', ['2026-010']).join(' ')})`
}

interface RunCandidate {
  command: string
  kind: ReviewKind
  phaseId: string | null
  /** 이 리뷰가 바인딩할 대상의 현재 해시. null이면 비교 불가 → G2 통과(fail-forward). */
  compareHash: string | null
  detail: string
}

/**
 * `RUN` 후보에 두 게이트를 적용한다. 통과 못 하면 다른 kind로 강등한다.
 *
 * **G1 (D10 전제)**: `review-codex`의 `main()`은 호출 전 워킹트리가 staged+스크래치뿐인지 검사해
 * 아니면 throw한다. 그걸 모른 채 `RUN`을 지시하면 그 명령은 즉시 죽는다.
 *
 * **G2 (바인딩 신선도, outcome-aware)**: `last_review`가 같은 `(kind, phase_id)` + 같은 `compare_hash`면
 * 직전 리뷰가 이미 이 바인딩을 봤다는 뜻이다. NEEDS_FIX 후에도 staged는 남으므로, 이걸 안 보면
 * 같은 바인딩을 무한 재리뷰한다(`blocked_review` 회로차단기는 BLOCKED만 잡고 NEEDS_FIX는 못 잡는다).
 */
function gateRunCandidate(input: NextInput, cand: RunCandidate): NextAction {
  // G1
  if (!input.worktreeReviewClean)
    return {
      kind: 'AGENT',
      detail:
        '워킹트리에 unstaged/untracked 변경이 있어 리뷰(D10)가 실패한다. 의도한 변경은 `git add`, 그 외는 정리한 뒤 다시 req:next.',
    }

  // G2
  const lr = input.state.last_review as LastReviewMarker | undefined
  const sameTarget =
    !!lr &&
    lr.review_kind === cand.kind &&
    (lr.phase_id ?? null) === cand.phaseId &&
    typeof lr.compare_hash === 'string' &&
    cand.compareHash !== null &&
    lr.compare_hash === cand.compareHash

  if (sameTarget && lr) {
    switch (lr.outcome) {
      case 'needs-fix':
        return {
          kind: 'AGENT',
          detail: `직전 리뷰가 이 바인딩을 보고 NEEDS_FIX를 냈다. findings를 수정하고 \`git add\` 후 다시 req:next. (같은 바인딩 재리뷰는 낭비)`,
        }
      case 'blocked':
        return {
          kind: 'BLOCKED',
          detail:
            '직전 리뷰가 이 바인딩에서 BLOCKED(지적 없이 미승인)였다. 같은 리뷰를 재시도하지 말 것 — 리뷰 대상을 바꾸거나 사람이 판단한다.',
          diagnostics: [
            'AGENTS.md §3: BLOCKED(exit 2)는 같은 리뷰 재시도 금지.',
            '스레드 고착이 의심되면 사람이 `--fresh-thread`로 1회만 회복을 시도할 수 있다(req:next는 자동으로 지시하지 않는다 — 회로차단기가 무력화된다).',
          ],
        }
      case 'invalid':
        if (lr.count >= 2)
          return {
            kind: 'BLOCKED',
            detail: `같은 바인딩에서 리뷰 응답이 ${lr.count}회 연속 무효(구조/도메인 검증 실패)다. 도구·스키마 문제로 보고 사람에게 보고한다.`,
            diagnostics: lr.errors.length ? lr.errors : ['(저장된 검증 오류 없음)'],
          }
        return { kind: 'RUN', detail: `${cand.detail} (직전 응답이 무효였다 — 1회 재시도)`, command: cand.command }
      case 'approved':
        return {
          kind: 'BLOCKED',
          detail:
            '방어적 차단: 이 바인딩은 이미 승인됐는데 승인 상태가 state에 보이지 않는다. state가 손상됐을 수 있다.',
          diagnostics: [`last_review=${JSON.stringify(lr)}`, `commit_allowed=${String(input.state.commit_allowed)}`],
        }
      default:
        break // 알 수 없는 outcome → fail-forward
    }
  }

  return { kind: 'RUN', detail: cand.detail, command: cand.command }
}

/**
 * 다음 행동 판정(순수). 먼저 매치되는 분기가 이긴다.
 *
 * ⚠️ `blocked_review`를 **읽지 않는다**(design R5 P2). 그 마커의 `review_binding`은 phase에서 tree OID라
 * `req:next`가 재계산할 수 없어 "현재 바인딩에 대한 것인가"를 판정할 수 없다. stale 마커로 영구히 막히는
 * 것보다, G2(`last_review.compare_hash`)로 바인딩 변경을 정확히 감지하는 편이 맞다. 회로차단기의 **강제**는
 * `review-codex`의 `shouldShortCircuitBlockedReview`에 그대로 남아 있다(codex 호출 없이 exit 2).
 */
export function resolveNext(input: NextInput): NextAction {
  const { state, packageManager: pm, target } = input

  // 0. state를 신뢰할 수 없으면 **아무 판정도 하지 않는다**(phase-2 R1/R2/R3/R4 P2).
  //    - reqId/phase id가 argv-불안전하면 렌더링한 명령이 실행 불가능하거나 **엉뚱한 티켓**을 대상으로 한다.
  //    - phases[]가 손상되면 nextPhaseId가 null을 반환해 조용한 DONE으로 이어진다.
  //    살아 있는 승인(1번)보다도 먼저 막는다 — 손상된 state에서 "커밋을 승인하라"고 말하면 엉뚱한 phase가 소비된다.
  const modelProblems = [...targetProblems(target, state), ...phaseModelProblems(state)]
  if (modelProblems.length)
    return {
      kind: 'BLOCKED',
      detail: 'state.json을 신뢰할 수 없어 다음 행동을 판정하지 않는다. 사람이 state를 고쳐야 한다.',
      diagnostics: modelProblems,
    }

  // 1. 살아 있는 승인이 가장 쉽게 상한다 — 다른 어떤 행동도 D9(staged tree == approved tree)를 깨뜨린다.
  if (state.commit_allowed === true)
    return {
      kind: 'AWAIT_HUMAN',
      detail: 'phase 승인이 살아 있다. 커밋 전 사람 확인이 필요하다.',
      command: commitCmd(pm, target),
      controlPoint: 'req:commit --run 직전',
      approvalSentence: 'req:commit --run 승인',
    }

  // 2. 설계 문서가 인덱스에 없으면 3번의 freshness 판정(captureDesignBinding)이 throw한다. 여기서 먼저 거른다.
  if (!input.designDocsInIndex)
    return {
      kind: 'AGENT',
      detail: '설계 문서 00/01/02가 git 인덱스에 없다. 작성한 뒤 `git add` 하고 다시 req:next.',
    }

  // 3. design 미승인 또는 stale(문서가 승인 이후 바뀜).
  const designApprovedHash = typeof state.design_approved_hash === 'string' ? state.design_approved_hash : null
  const designValid =
    state.design_approved === true && designApprovedHash !== null && designApprovedHash === input.currentDesignHash
  if (!designValid)
    return gateRunCandidate(input, {
      command: reviewCmd(pm, target, 'design', null),
      kind: 'design',
      phaseId: null,
      compareHash: input.currentDesignHash,
      detail: state.design_approved === true ? '설계 문서가 승인 이후 변경됐다(stale). 재승인이 필요하다.' : '설계 승인이 필요하다.',
    })

  const rawPhases = (state as { phases?: unknown }).phases
  const rawLen = Array.isArray(rawPhases) ? rawPhases.length : 0
  const consumed = readConsumed(state)

  if (rawLen === 0) {
    // 4. 신규 티켓(req:new이 approval_evidence_required=true를 심는다) — 아직 phase를 안 나눴다.
    if (state.approval_evidence_required === true)
      return {
        kind: 'AGENT',
        detail: '`02-plan.md`에 phase를 분해하고 `state.json`의 `phases[]`를 채운 뒤 다시 req:next.',
      }

    // 5~7. 레거시 티켓(필드 자체가 없음 — phase 추적 없이 리뷰하던 시절).
    if (!('approval_evidence_required' in state))
      return resolveLegacy(input, consumed)

    return {
      kind: 'BLOCKED',
      detail: 'phases[]가 비었는데 approval_evidence_required가 true도 아니고 부재도 아니다 — 신규/레거시를 구분할 수 없다.',
      diagnostics: [`approval_evidence_required=${JSON.stringify(state.approval_evidence_required)}`],
    }
  }

  // 8~10. phase 추적 티켓.
  const pending = nextPhaseId(state)
  if (pending !== null) {
    if (!input.hasStagedChanges)
      return { kind: 'AGENT', detail: `phase \`${pending}\`를 구현하고 테스트를 통과시킨 뒤 \`git add\` 하고 다시 req:next.` }
    return gateRunCandidate(input, {
      command: reviewCmd(pm, target, 'phase', pending),
      kind: 'phase',
      phaseId: pending,
      compareHash: input.currentIndexHash,
      detail: `phase \`${pending}\`의 staged 변경을 리뷰받는다.`,
    })
  }

  if (input.worktreeReviewClean && !input.hasStagedChanges)
    return {
      kind: 'DONE',
      detail:
        '모든 phase가 승인·커밋됐다. 다음은 통합 통제점 — `[I1]` PR 생성 또는 `[B1]` protected branch direct push. 경로 선택과 승인은 사람이 한다.',
    }

  return {
    kind: 'BLOCKED',
    detail: '모든 phase가 소비됐는데 워킹트리가 깨끗하지 않다. 남은 변경이 이 티켓 범위인지 사람이 판단해야 한다.',
    diagnostics: [
      `hasStagedChanges=${String(input.hasStagedChanges)}`,
      `worktreeReviewClean=${String(input.worktreeReviewClean)}`,
      `phases=${readPhases(state).map((p) => p.id).join(', ') || '(없음)'}`,
      `consumed=${consumed.map((c) => c.phase_id ?? '(null)').join(', ') || '(없음)'}`,
    ],
  }
}

/**
 * 레거시 티켓(`phases[]` 없음 + `approval_evidence_required` 필드 부재).
 *
 * `phases[]`가 없어 "전부 consumed"가 vacuous truth가 되므로, 소비 이력으로만 완료를 판정한다(design R2 P2-A).
 * 남은 phase가 있는지는 **도구가 알 수 없다** — `DONE`의 detail이 그 사실을 말한다. 조용히 "다 끝났다"고 하지 않는다.
 */
function resolveLegacy(input: NextInput, consumed: { phase_id: string | null }[]): NextAction {
  const { state, packageManager: pm, target } = input

  if (input.hasStagedChanges)
    return gateRunCandidate(input, {
      command: reviewCmd(pm, target, 'phase', null),
      kind: 'phase',
      phaseId: null,
      compareHash: input.currentIndexHash,
      detail: '레거시 티켓(phase 미추적)의 staged 변경을 리뷰받는다.',
    })

  if (consumed.length === 0)
    return { kind: 'AGENT', detail: '구현하고 테스트를 통과시킨 뒤 `git add` 하고 다시 req:next.' }

  if (input.worktreeReviewClean)
    return {
      kind: 'DONE',
      detail:
        '레거시 티켓(phases[] 미추적) — 승인·커밋 이력이 있고 워킹트리가 깨끗하다. **남은 phase 여부는 도구가 알 수 없다**: `02-plan.md`를 확인하라. 통합은 `[I1]`/`[B1]` 통제점.',
    }

  return {
    kind: 'BLOCKED',
    detail: '레거시 티켓에 소비 이력이 있지만 워킹트리가 깨끗하지 않다. 남은 변경을 사람이 판단해야 한다.',
    diagnostics: [`consumed=${consumed.length}건`, `worktreeReviewClean=false`],
  }
}

// ──────────────────────────────────────────────────────────────── CLI ──

export interface Opts {
  reqId: string | null
  ticket: string | null
  root: string | null
  json: boolean
}

export function parseArgs(argv: string[]): Opts {
  const o: Opts = { reqId: null, ticket: null, root: null, json: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === undefined) continue
    // bare `--`는 옵션이 아니라 POSIX end-of-options 마커다(DEC-011-3). npm은 `npm run x -- a`에서
    // 이를 제거하지만 pnpm/yarn은 그대로 넘긴다 → 흡수한다. 이후 인자도 계속 옵션으로 파싱한다
    // (전부 위치인자로 삼키면 `req:commit <id> -- --run`이 조용히 dry-run이 된다).
    if (a === '--') continue
    else if (a === '--json') o.json = true
    else if (a === '--ticket') o.ticket = argv[++i] ?? null
    else if (a === '--root') {
      const v = argv[++i]
      if (v === undefined) throw new Error('--root 값 필요')
      o.root = v
    } else if (a.startsWith('-')) throw new Error(`알 수 없는 옵션: ${a}`)
    else o.reqId = a
  }
  return o
}

/** 사람이 읽는 출력. `displayId`는 표시 전용(argv가 아니다) — `state.id`를 그대로 쓴다. */
export function renderAction(displayId: string, a: NextAction): string {
  const lines = [`[req:next] ${a.kind}  ${displayId}`, `  ${a.detail}`]
  if (a.command && a.kind === 'RUN') lines.push('', `  $ ${a.command}`)
  if (a.kind === 'AWAIT_HUMAN') {
    lines.push('', `  통제점: ${a.controlPoint ?? '(미지정)'}`)
    lines.push(`  승인 문장: "${a.approvalSentence ?? '(미지정)'}"`)
    if (a.command) lines.push(`  승인 후 실행: $ ${a.command}`)
  }
  for (const d of a.diagnostics ?? []) lines.push(`  - ${d}`)
  return lines.join('\n')
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2))
  const cfg = loadConfig({ root: opts.root })
  const roGit = createReadOnlyGit(createGitAdapter(cfg.root))

  // target은 **사용자가 티켓을 지목한 방식 그대로** 보존한다(R5). `--ticket`으로 읽었으면 후속 명령도 `--ticket`을 쓴다 —
  // 그러지 않으면 `req:review-codex -- <reqId>`가 기본 위치의 **다른 티켓**을 리뷰한다.
  if (!opts.ticket && !opts.reqId) throw new Error(missingTargetHint(cfg.packageManager))
  const target: NextTarget = opts.ticket
    ? { kind: 'ticket', ticketDir: opts.ticket }
    : { kind: 'req', reqId: (opts.reqId as string).replace(/^REQ-/, '') }

  const ticketDir =
    target.kind === 'ticket' ? resolve(target.ticketDir) : join(cfg.workflowDirAbs, `REQ-${target.reqId}`)

  const state = loadState(ticketDir)
  const ticketRel = relative(cfg.root, ticketDir).replace(/\\/g, '/')

  // 설계문서 인덱스 존재 + 현재 해시. 인덱스에 없으면 captureDesignBinding이 throw → null로 흡수(2번 분기가 처리).
  let currentDesignHash: string | null = null
  try {
    currentDesignHash = captureDesignBinding(ticketRel, roGit, cfg.designDocs).designHash
  } catch {
    currentDesignHash = null
  }

  const statusEntries = parseStatusZ(roGit([...STATUS_Z_ARGS]))
  // review-codex/doctor와 동일한 스크래치 집합(lib/scratch SSOT) — 워크플로 도구가 쓰는 메타데이터는 D10 대상이 아니다.
  const scratch = reviewScratchPaths(ticketRel)

  const action = resolveNext({
    target,
    state,
    packageManager: cfg.packageManager,
    designDocsInIndex: currentDesignHash !== null,
    currentDesignHash,
    hasStagedChanges: roGit(['diff', '--cached', '--name-only']).trim().length > 0,
    worktreeReviewClean: findUnstagedOrUntracked(statusEntries, scratch, ticketRel).length === 0,
    currentIndexHash: captureIndexHash(roGit),
  })

  if (opts.json) console.log(JSON.stringify({ req_id: state.id, ...action }, null, 2))
  else console.log(renderAction(state.id, action))

  const code = nextExitCode(action.kind)
  if (code !== 0) process.exit(code)
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href
if (isMain) main()
