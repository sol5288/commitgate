#!/usr/bin/env tsx
/**
 * commitgate quickstart — 기존 CLAUDE.md/AGENTS.md에 Quick Start 블록을 opt-in·멱등 백필 (REQ-2026-040).
 *
 * REQ-2026-039가 템플릿에 Quick Start를 넣었지만 init은 **seed-once**라 기존 파일엔 닿지 않는다. 이 모듈은
 * 마커(`<!-- commitgate:quickstart -->`) 기반으로 **관리 블록만** 삽입/치환하고 나머지 내용은 보존한다.
 * sync(whole-file copy)와 달리 read-merge-write이므로 별도 verb다(설계 D1).
 *
 * phase-1(REQ-2026-040): 순수 함수(extract/inject). phase-2: CLI verb·plan/apply·confinement·doctor 연동 헬퍼.
 */
import { existsSync, lstatSync, readFileSync, writeFileSync, realpathSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { PACKAGE_ROOT, statWritableDest, assertGitWorkTree, AGENTS_CONTRACT_MARKER } from './init'
import { makeRunCli, isEntrypoint } from '../scripts/req/lib/cli-boundary'

/** 마커 쌍(포함) 매칭. 비탐욕 — 첫 close에서 끝난다. 마커 문자열의 정본은 이 정규식이다(REQ-2026-103: 참조 0인 상수 2개 제거). */
const QS_RE = /<!-- commitgate:quickstart -->[\s\S]*?<!-- \/commitgate:quickstart -->/

/**
 * commitgate가 관리하는 블록 하나(REQ-2026-136 DEC-1).
 *
 * 🔴 마커 문자열을 블록마다 손으로 늘리지 않는다 — **id에서 생성**한다(`blockRe`).
 */
export interface ManagedBlock {
  /** 마커 id — `<!-- commitgate:<id> -->` … `<!-- /commitgate:<id> -->` */
  id: string
  /** 이 블록을 넣을 대상 파일(repo 상대). */
  targets: readonly string[]
}

/**
 * 관리 블록 집합.
 *
 * 🔴 **계약 본문(`autonomy`)은 `AGENTS.md`에만** 넣는다. `CLAUDE.md`의 몫은 항상 로드되는 자립형
 *    Quick Start이고(REQ-2026-039), 계약 전문을 거기 복제하면 두 벌이 갈라지며 Quick Start의 존재
 *    이유(첫 요청에서 올바른 첫 행동)가 희석된다.
 */
export const MANAGED_BLOCKS: readonly ManagedBlock[] = [
  { id: 'quickstart', targets: ['CLAUDE.md', 'AGENTS.md'] },
  { id: 'autonomy', targets: ['AGENTS.md'] },
]

/** id → 마커 쌍(포함) 정규식. 비탐욕. */
export function blockRe(id: string): RegExp {
  return new RegExp(`<!-- commitgate:${id} -->[\\s\\S]*?<!-- /commitgate:${id} -->`)
}

/** 문서 안 관리 마커 하나(등장 순서 스캔용). */
interface MarkerToken {
  id: string
  kind: 'open' | 'close'
  index: number
}

/** 모든 관리 마커를 **등장 순서대로** 뽑는다(어떤 id든 — 미등록 id도 포함). */
function scanMarkers(content: string): MarkerToken[] {
  // 🔴 닫는 마커의 슬래시는 `commitgate` **앞**이다(`<!-- /commitgate:id -->`).
  const re = /<!-- (\/?)commitgate:([a-z0-9-]+) -->/g
  const out: MarkerToken[] = []
  for (const m of content.matchAll(re)) {
    // `<!-- commitgate:contract -->`(파일 정체성 마커)는 **쌍이 없는 단독 마커**다 — 스트림에서 제외한다.
    if (m[2] === 'contract') continue
    out.push({ id: m[2] as string, kind: m[1] ? 'close' : 'open', index: m.index })
  }
  return out
}

/** 마커 스트림 위반 사유(빈 배열 = 정상). */
export type MarkerStreamProblem = string

/**
 * **문서 전체 마커 스트림** 검증(REQ-2026-136 DEC-4).
 *
 * 🔴 블록마다 "여는 1 · 닫는 1"만 세면 **교차 중첩을 놓친다**:
 * ```
 * <!-- commitgate:quickstart --> … <!-- commitgate:autonomy --> …
 * <!-- /commitgate:quickstart --> … <!-- /commitgate:autonomy -->
 * ```
 * 두 id 모두 "정상 쌍 1회"로 보이지만, 앞 블록을 치환하면 **다른 블록의 여는 마커가 지워진다.**
 * 그래서 등장 순서를 하나의 스트림으로 훑어 스택 깊이 0/1만 허용한다.
 */
export function markerStreamProblems(content: string): MarkerStreamProblem[] {
  const problems: MarkerStreamProblem[] = []
  const stack: string[] = []
  const closed = new Set<string>()
  for (const t of scanMarkers(content)) {
    if (t.kind === 'open') {
      if (stack.length > 0) {
        problems.push(`'${t.id}' 여는 마커가 '${stack[0] as string}' 블록 안에 중첩됨`)
        continue
      }
      if (closed.has(t.id)) problems.push(`'${t.id}' 블록이 2회 이상 있음`)
      stack.push(t.id)
    } else {
      const top = stack.pop()
      if (top === undefined) problems.push(`'${t.id}' 닫는 마커에 대응하는 여는 마커가 없음`)
      else if (top !== t.id) {
        problems.push(`마커가 교차함 — '${top}' 이 열린 채 '${t.id}' 이 닫힘`)
        // 교차 이후의 판정은 신뢰할 수 없다. 남은 스택을 비워 중복 보고를 막는다.
        stack.length = 0
      } else closed.add(t.id)
    }
  }
  for (const open of stack) problems.push(`'${open}' 블록이 닫히지 않음`)
  return problems
}

const toLf = (s: string): string => s.replace(/\r\n/g, '\n')

/** 템플릿 본문에서 마커 포함 Quick Start 블록을 뽑는다. 부재면 null. */
export function extractQuickstartBlock(templateBody: string): string | null {
  const m = templateBody.match(QS_RE)
  return m ? m[0] : null
}

export type InjectAction = 'noop' | 'updated' | 'inserted'
export interface InjectResult {
  content: string
  action: InjectAction
  /** action==='inserted'일 때만: 삽입 위치(plan 표시용). */
  insertAt?: 'after-heading' | 'top'
}

/**
 * 파일의 **dominant** EOL(CRLF 개수 vs standalone LF 개수 비교). CRLF가 한 번 섞였다고 CRLF로 보지
 * 않는다(design-r01 P1 — LF 우세 파일에 CRLF 블록을 넣으면 혼합 줄바꿈이 된다).
 */
function dominantEol(s: string): '\r\n' | '\n' {
  const crlf = (s.match(/\r\n/g) ?? []).length
  const standaloneLf = (s.match(/\n/g) ?? []).length - crlf
  return crlf > standaloneLf ? '\r\n' : '\n'
}

/** block의 줄바꿈을 dominant EOL에 맞춘다(혼합 줄바꿈 방지). */
function matchEol(block: string, eol: '\r\n' | '\n'): string {
  const lf = toLf(block)
  return eol === '\r\n' ? lf.replace(/\n/g, '\r\n') : lf
}

/**
 * 첫 top-level `# ` heading **줄 종결자 뒤**의 오프셋. **fenced code block 안의 `# `는 제외**한다
 * (design-r01 P1). 펜스 판정은 CommonMark를 따른다(design-r02 P1): 여는 펜스의 **문자(`` ` `` / `~`)와
 * 길이**를 기억하고, **같은 문자·opening 이상 길이·info string 없는** 줄만 닫기로 본다 — 그래서
 * `` ``` `` 펜스 안의 `~~~`(또는 더 짧은 펜스)는 닫기가 아니라 코드 내용이다. heading이 없으면 null.
 */
function afterFirstHeadingOffset(s: string): number | null {
  let fenceChar: '`' | '~' | null = null // null = 펜스 밖
  let fenceLen = 0
  let i = 0
  while (i < s.length) {
    const nl = s.indexOf('\n', i)
    const lineEnd = nl === -1 ? s.length : nl
    const nextStart = nl === -1 ? s.length : nl + 1
    let line = s.slice(i, lineEnd)
    if (line.endsWith('\r')) line = line.slice(0, -1)
    if (fenceChar === null) {
      const open = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
      const fence = open?.[1]
      if (fence !== undefined) {
        // CommonMark: backtick 펜스의 info string엔 backtick이 올 수 없다(인라인 코드 오인 방지). tilde는 무관.
        const invalidBacktick = fence.charAt(0) === '`' && (open?.[2] ?? '').includes('`')
        if (!invalidBacktick) {
          fenceChar = fence.charAt(0) as '`' | '~'
          fenceLen = fence.length
        }
        // invalidBacktick이면 유효 opening 아님 — 일반 줄(``` 로 시작하니 heading도 아님).
      } else if (/^# /.test(line)) {
        return nextStart
      }
    } else {
      // 펜스 안: 같은 문자·opening 이상 길이·(trailing 공백 외)info string 없는 닫기만 닫는다.
      const close = /^ {0,3}([`~]{3,})[ \t]*$/.exec(line)?.[1]
      if (close !== undefined && close === fenceChar.repeat(close.length) && close.length >= fenceLen) {
        fenceChar = null
        fenceLen = 0
      }
    }
    i = nextStart
  }
  return null
}

/**
 * 기존 파일에 Quick Start 블록을 주입한다(순수 — IO 없음). **관리 블록(마커 사이)만** 건드리고
 * 블록 밖 내용은 바이트 보존한다.
 *   - 마커 有 & (줄바꿈 정규화 후) 동일 → `noop`.
 *   - 마커 有 & 다름 → in-place 치환(`updated`).
 *   - 마커 無 → 삽입(`inserted`). 첫 top-level `# ` heading(코드펜스 밖) **바로 뒤**, 없으면 **파일 맨 앞**.
 * 삽입 블록의 줄바꿈은 파일 dominant EOL을 따른다.
 */
export function injectQuickstart(fileContent: string, block: string): InjectResult {
  const existing = fileContent.match(QS_RE)
  const eol = dominantEol(fileContent)
  const eolBlock = matchEol(block, eol)
  if (existing) {
    if (toLf(existing[0]) === toLf(block)) return { content: fileContent, action: 'noop' }
    // 함수 replacer — block 안의 `$`가 특수치환으로 해석되지 않게 한다.
    return { content: fileContent.replace(QS_RE, () => eolBlock), action: 'updated' }
  }
  const at = afterFirstHeadingOffset(fileContent)
  if (at !== null) {
    const content = fileContent.slice(0, at) + eol + eolBlock + eol + eol + fileContent.slice(at)
    return { content, action: 'inserted', insertAt: 'after-heading' }
  }
  return { content: eolBlock + eol + eol + fileContent, action: 'inserted', insertAt: 'top' }
}

/**
 * 블록 하나를 주입한다(순수 · 임의 id — REQ-2026-136 DEC-1). `injectQuickstart`의 일반화다.
 *
 * 🔴 **부재 시 삽입 위치는 파일 끝**이다(DEC-4b). Quick Start는 "첫 H1 뒤"였지만, 계약 절은 문맥 의존
 *    heading(`### 4-1 …`)이라 같은 규칙을 쓰면 §4 앞에 놓여 계층이 뒤집힌다. 사용자가 절 순서를 바꿔 둔
 *    파일에서 "적절한 자리"를 추측하면 엉뚱한 곳에 들어간다 — 위치가 완벽하지 않은 것과 사용자 문서를
 *    잘못 건드리는 것은 위험도가 다르다.
 * 🔴 이미 있으면 **그 자리에서** 치환한다(위치를 옮기지 않는다).
 */
export function injectManagedBlock(fileContent: string, id: string, block: string): InjectResult {
  const re = blockRe(id)
  const existing = fileContent.match(re)
  const eol = dominantEol(fileContent)
  const eolBlock = matchEol(block, eol)
  if (existing) {
    if (toLf(existing[0]) === toLf(block)) return { content: fileContent, action: 'noop' }
    return { content: fileContent.replace(re, () => eolBlock), action: 'updated' }
  }
  // Quick Start 는 기존 계약(첫 H1 뒤)을 유지한다 — 이 REQ 는 그 동작을 바꾸지 않는다.
  if (id === 'quickstart') return injectQuickstart(fileContent, block)
  const sep = fileContent.length === 0 || fileContent.endsWith('\n') || fileContent.endsWith('\r') ? '' : eol
  return { content: `${fileContent}${sep}${eol}${eolBlock}${eol}`, action: 'inserted', insertAt: 'top' }
}

// ─────────────────────────────────────────────────────── CLI verb (phase-2) ──

/** 백필 대상 = always-loaded 두 채널. AGENTS.md는 계약 마커가 있을 때만 대상(계약 아닌 파일 미접촉). */
const TARGET_FILES = ['CLAUDE.md', 'AGENTS.md'] as const
const TEMPLATE_REL = 'templates/CLAUDE.template.md'

export interface QuickstartOptions {
  dir: string
  apply: boolean
}
export type FileAction = 'noop' | 'replace' | 'insert' | 'skip'
export interface FilePlan {
  rel: string
  action: FileAction
  insertAt?: 'after-heading' | 'top' // action==='insert'만
  reason?: string // action==='skip'만
}
export interface QuickstartPlan {
  targetRoot: string
  files: FilePlan[]
  writes: { rel: string; content: string }[]
}

/** targetRoot·PACKAGE_ROOT 동일성 판정용 정규화(sync.canonical과 동일 기법). */
function canonical(p: string): string {
  try {
    return resolve(realpathSync.native(p))
  } catch {
    return resolve(p)
  }
}

/** 패키지 템플릿에서 SSOT Quick Start 블록을 읽는다. 부재면 throw(REQ-2026-039가 보장). */
export function shippedQuickstartBlock(): string {
  const block = extractQuickstartBlock(readFileSync(join(PACKAGE_ROOT, TEMPLATE_REL), 'utf8'))
  if (block === null) throw new Error(`템플릿에 Quick Start 블록이 없습니다: ${TEMPLATE_REL}`)
  return block
}

type TargetState = { kind: 'absent' } | { kind: 'unsafe' } | { kind: 'file'; content: string }
/**
 * 대상 파일 상태를 confinement-안전하게 읽는다. `lstat`로 존재(심링크 포함) 판정하고, `statWritableDest`가
 * null이면 안전하지 않은 경로(symlink escape 등)로 보고 미접촉한다(REQ-2026-024 재사용 — 재구현 금지).
 */
function readSafeTarget(root: string, rel: string): TargetState {
  const abs = join(root, rel)
  try {
    lstatSync(abs)
  } catch {
    return { kind: 'absent' }
  }
  if (statWritableDest(root, rel) === null) return { kind: 'unsafe' }
  return { kind: 'file', content: readFileSync(abs, 'utf8') }
}

/** 백필이 필요한 파일과 그 사유. `insert`=블록 부재 · `replace`=블록은 있으나 shipped와 다름(드리프트). */
export interface QuickstartBackfillTarget {
  rel: string
  action: 'insert' | 'replace'
}

/**
 * 소비 repo에서 **백필이 필요한** always-loaded 파일(doctor D21 입력, REQ-2026-101 DEC-1).
 *
 * 🔴 **판정을 재구현하지 않고 `planQuickstart`에서 파생한다** — verb(`quickstart --apply`)가 쓰는
 *    바로 그 계획기다. 그래서 "진단이 필요하다고 한 파일"과 "적용이 실제로 쓰는 파일"이 **정의상
 *    같다.** skip 사유(부재·symlink·계약 마커 없음)도 계획기가 이미 처리하므로 여기서 다시 적지 않는다.
 *
 * 🔴 **이전 구현(`missingQuickstartFiles`)은 마커 부재만 봤다.** 그래서 블록 내용을 개정해도 이미
 *    설치된 소비자는 아무 신호를 받지 못했고, 신호가 없으니 아무도 `quickstart --apply`를 실행하지
 *    않았다. 갱신 기계(`injectQuickstart`의 `updated` 경로)는 처음부터 있었는데 **탐지만 없었다.**
 *
 * `undefined` = 판정 불가(shipped 블록 조회 실패 등). 호출부는 **조용히 통과**시킨다(DEC-7) —
 * D19/D20/D24의 "미계산·조회 불가 → OK" 선례와 같다. 이 검사는 advisory이고 어떤 게이트도 여기
 * 서 있지 않다. doctor는 `req:commit`의 하드 게이트라 여기서 throw가 새면 커밋이 벽돌이 된다.
 */
export function quickstartBackfillTargets(root: string): QuickstartBackfillTarget[] | undefined {
  let block: string
  try {
    block = shippedQuickstartBlock()
  } catch {
    return undefined
  }
  try {
    return planQuickstart(root, block).files
      .filter((f): f is typeof f & { action: 'insert' | 'replace' } => f.action === 'insert' || f.action === 'replace')
      .map((f) => ({ rel: f.rel, action: f.action }))
  } catch {
    return undefined
  }
}

/** 백필 계획(순수 판정 — 쓰기 없음). 파일별 action + 삽입 위치 + skip 사유. */
export function planQuickstart(targetRoot: string, block: string): QuickstartPlan {
  const files: FilePlan[] = []
  const writes: { rel: string; content: string }[] = []
  for (const rel of TARGET_FILES) {
    const st = readSafeTarget(targetRoot, rel)
    if (st.kind === 'absent') {
      files.push({ rel, action: 'skip', reason: '부재 — 생성은 init 소관(백필 대상 아님)' })
      continue
    }
    if (st.kind === 'unsafe') {
      files.push({ rel, action: 'skip', reason: '안전하지 않은 경로(symlink 등) — 미접촉' })
      continue
    }
    if (rel === 'AGENTS.md' && !st.content.includes(AGENTS_CONTRACT_MARKER)) {
      files.push({ rel, action: 'skip', reason: 'CommitGate 계약 마커 없음 — 미접촉' })
      continue
    }
    /**
     * 🔴 REQ-2026-136 DEC-4: **파일 단위 안전 게이트.** 마커 스트림이 깨졌으면(반쪽·중복·중첩·교차)
     *    이 파일에는 **아무것도 쓰지 않는다.** 판정 함수를 만들어 두고 여기에 연결하지 않으면
     *    보호가 실재하지 않는다 — 교차 중첩 파일에서 블록 치환이 다른 블록의 마커와 그 사이
     *    **사용자 내용을 함께 덮어쓴다**(phase-1 r01 P1).
     */
    const streamProblems = markerStreamProblems(st.content)
    if (streamProblems.length > 0) {
      files.push({
        rel,
        action: 'skip',
        reason:
          `commitgate 관리 마커가 손상돼 안전하게 식별할 수 없음 — 자동 수정하지 않습니다: ${streamProblems.slice(0, 3).join('; ')}. ` +
          `해당 마커 쌍을 손으로 정리한 뒤 다시 실행하세요.`,
      })
      continue
    }
    const r = injectQuickstart(st.content, block)
    if (r.action === 'noop') {
      files.push({ rel, action: 'noop' })
      continue
    }
    files.push({ rel, action: r.action === 'updated' ? 'replace' : 'insert', insertAt: r.insertAt })
    writes.push({ rel, content: r.content })
  }
  return { targetRoot, files, writes }
}

/** 계획을 사람이 읽는 줄 배열로(shell 연산자 미사용 — sync.renderPlan 관례). */
export function renderQuickstartPlan(plan: QuickstartPlan, apply: boolean): string[] {
  const GLYPH: Record<FileAction, string> = { noop: '＝', replace: '～', insert: '＋', skip: '·' }
  const LABEL: Record<FileAction, string> = {
    noop: '최신(변경 없음)',
    replace: '블록 상이 → 교체',
    insert: '블록 없음 → 삽입',
    skip: '건너뜀',
  }
  const L: string[] = ['']
  L.push(`[commitgate quickstart] 기존 파일 Quick Start 백필 ${apply ? '(--apply: 파일을 씁니다)' : '계획 (dry-run — 아무것도 쓰지 않습니다)'}`)
  L.push(`  대상: ${plan.targetRoot}`)
  L.push('')
  for (const f of plan.files) {
    const pos = f.action === 'insert' ? ` (${f.insertAt === 'top' ? '파일 맨 앞' : '# 제목 뒤'})` : ''
    const why = f.reason ? ` — ${f.reason}` : ''
    L.push(`  ${GLYPH[f.action]} ${f.rel} — ${LABEL[f.action]}${pos}${why}`)
  }
  L.push('')
  if (!apply) {
    if (plan.writes.length > 0) {
      L.push('  ⚠️  --apply 전에는 아무것도 쓰지 않습니다. 적용하려면: npx commitgate quickstart --apply')
      L.push(`  (변경 예정 ${plan.writes.length}개. --apply 후 git diff 로 확인하고 스테이징·커밋하십시오.)`)
    } else {
      L.push('  변경 없음 — 이미 최신이거나 대상이 없습니다.')
    }
  } else if (plan.writes.length > 0) {
    L.push(`  ✅ ${plan.writes.length}개 파일 갱신. 다음: git diff 로 확인 후 커밋하십시오.`)
    for (const w of plan.writes) L.push(`     git add -- ${w.rel}`)
  } else {
    L.push('  변경 없음 — 이미 최신이거나 대상이 없습니다(쓰기 0건).')
  }
  return L
}

/**
 * 실행. 기본 plan(dry-run, 쓰기 0건), `--apply`에서만 쓴다.
 * 🔴 `targetRoot===PACKAGE_ROOT` 하드 거부(sync 선례) + `assertGitWorkTree` + 쓰기 직전 confinement 재검증.
 */
export function runQuickstart(opts: QuickstartOptions): QuickstartPlan {
  const targetRoot = resolve(opts.dir)
  if (!existsSync(targetRoot)) throw new Error(`대상 디렉터리가 없음: ${targetRoot}`)
  assertGitWorkTree(targetRoot)
  if (canonical(targetRoot) === canonical(PACKAGE_ROOT))
    throw new Error('quickstart 대상이 CommitGate 패키지 자신입니다 — 소비 repo(commitgate를 devDependency로 설치한 곳)에서 실행하세요.')

  const block = shippedQuickstartBlock()
  const plan = planQuickstart(targetRoot, block)

  if (opts.apply) {
    for (const w of plan.writes) {
      statWritableDest(targetRoot, w.rel) // 쓰기 직전 confinement 재검증(TOCTOU 최소화 — 단일 경로 재사용)
      writeFileSync(join(targetRoot, w.rel), w.content)
    }
  }

  for (const line of renderQuickstartPlan(plan, opts.apply)) console.log(line)
  return plan
}

/** CLI 파싱(fail-closed). `--flag=value` 미지원, 미지 토큰은 throw(sync/init 관례). */
export function parseArgs(argv: string[]): QuickstartOptions {
  let dir = process.cwd()
  let apply = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dir') {
      const v = argv[i + 1]
      if (v === undefined) throw new Error('--dir 값 누락')
      dir = v
      i++
    } else if (a === '--apply') {
      apply = true
    } else if (a === '--dry-run') {
      apply = false // 기본값이지만 명시 허용
    } else if (a === '-h' || a === '--help') {
      printHelp()
      process.exit(0)
    } else {
      throw new Error(`알 수 없는 인자: ${String(a)}`)
    }
  }
  return { dir: resolve(dir), apply }
}

function printHelp(): void {
  console.log(`commitgate quickstart — 기존 CLAUDE.md/AGENTS.md에 Quick Start 블록을 백필

사용법:
  npx commitgate quickstart [--dir <대상repo>]          계획만 출력(기본 — 아무것도 쓰지 않음)
  npx commitgate quickstart --apply [--dir <대상repo>]  Quick Start 블록 주입

하는 일:
  기존 CLAUDE.md(존재)·AGENTS.md(계약 마커 존재)에 관리 블록(<!-- commitgate:quickstart -->)만
  삽입/교체하고 블록 밖 내용은 보존합니다. 멱등(재실행=변경 없음). 부재 파일은 건드리지 않습니다(init 소관).

하지 않는 일:
  파일 생성 · 계약 마커 없는 AGENTS.md · 블록 밖 내용 수정 · symlink escape 경로 쓰기.
`)
}

export const runCli = makeRunCli((argv) => runQuickstart(parseArgs(argv)), 'commitgate quickstart')

const isMain = isEntrypoint(import.meta.url)
if (isMain) runCli(process.argv.slice(2))
