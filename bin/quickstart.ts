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
import { pathToFileURL } from 'node:url'
import { PACKAGE_ROOT, statWritableDest, assertGitWorkTree, AGENTS_CONTRACT_MARKER } from './init'

export const QUICKSTART_MARKER_OPEN = '<!-- commitgate:quickstart -->'
export const QUICKSTART_MARKER_CLOSE = '<!-- /commitgate:quickstart -->'
/** 마커 쌍(포함) 매칭. 비탐욕 — 첫 close에서 끝난다. */
const QS_RE = /<!-- commitgate:quickstart -->[\s\S]*?<!-- \/commitgate:quickstart -->/

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

/** 소비 repo에서 Quick Start 블록이 없는 always-loaded 파일 목록(doctor D21용). 부재·계약아님·최신은 제외. */
export function missingQuickstartFiles(root: string): string[] {
  const missing: string[] = []
  for (const rel of TARGET_FILES) {
    const st = readSafeTarget(root, rel)
    if (st.kind !== 'file') continue
    if (rel === 'AGENTS.md' && !st.content.includes(AGENTS_CONTRACT_MARKER)) continue // 계약 아님 → 미접촉
    if (!st.content.includes(QUICKSTART_MARKER_OPEN)) missing.push(rel)
  }
  return missing
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

export function runCli(argv: string[]): void {
  try {
    runQuickstart(parseArgs(argv))
  } catch (err) {
    console.error(`commitgate quickstart: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  }
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href
if (isMain) runCli(process.argv.slice(2))
