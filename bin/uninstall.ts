#!/usr/bin/env tsx
/**
 * commitgate uninstall — **읽기 전용 removal planner** (REQ-2026-007).
 *
 * 이 모듈은 아무것도 지우지 않는다. repo를 읽어 제거 계획과 "사용자가 직접 검토 후 실행할 명령"만 출력한다.
 *
 * 왜 실제 삭제를 하지 않는가:
 *   `runInit`은 무엇을 새로 만들었고(copied) 무엇이 이미 있었는지(skipped/merged)를 계산만 하고 **디스크에 원장을 남기지 않는다**.
 *   따라서 uninstall 시점에 `AGENTS.md`(부재 시에만 생성)·`req.config.json`(누락 키만 병합)·`package.json`(부재 키만 주입)이
 *   CommitGate 소유인지 사용자 소유인지 구분할 수 없다. 원장 없는 blind delete는 사용자 데이터를 파괴한다.
 *   CommitGate는 git hook·git config를 건드리지 않는 **순수 in-tree 스캐폴더**이므로 되돌리기의 정본은 git이다.
 *
 * 읽기 전용 계약(테스트로 고정 — tests/unit/uninstall.test.ts):
 *   - `node:fs`에서 조회 API만 가져온다(파일을 만들거나 고치거나 지우는 API를 import하지 않는다).
 *   - git은 read-only 서브커맨드 allowlist(`rev-parse`·`status`·`ls-files`·`log`)만 호출한다.
 *   - 해시는 `node:crypto`로 계산한다(`git hash-object`는 objects/에 쓸 수 있어 쓰지 않는다).
 *   - npm을 spawn하지 않는다. 캐시 정리 명령은 문자열로 출력만 한다.
 *   - 삭제 플래그(`--run`/`--force`)를 제공하지 않는다 — 이 부재가 계약이다.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadConfig, stripBom, DEFAULTS } from '../scripts/req/lib/config'
import { createGitAdapter, type GitAdapter, type GitRunner } from '../scripts/req/lib/adapters'
import {
  PACKAGE_ROOT,
  KIT_SOURCE_DIR_REL,
  KIT_SCHEMA_RELPATHS,
  KIT_COPY_RELPATHS,
  REQ_SCRIPTS,
  REQ_DEV_DEPS,
  assertGitWorkTree,
} from './init'

export interface UninstallOptions {
  dir: string
}

/** CommitGate가 복사한 파일(kit 소스 + init이 실제로 복사한 스키마). 바이트 비교로 무결성만 표기. */
export interface ToolArtifact {
  path: string // repo-상대
  present: boolean
  /** 현재 실행 중인 패키지의 원본과 바이트 동일? `differs`는 "편집됐거나 **다른 버전**이 설치함"일 뿐 사용자 소유 단정이 아니다. */
  match: 'identical' | 'differs' | 'absent'
  tracked: boolean
  /**
   * 이 경로를 추가(A)한 **가장 최근** 커밋 sha. **현재 tracked인 파일에 한해서만** 채운다(phase R2 P2).
   * 과거에 추가됐다가 삭제된 경로는 `git log --diff-filter=A`에 낡은 add 커밋이 남아 있어,
   * 새로 설치한 untracked 파일을 "커밋됨"으로 오판하고 엉뚱한 커밋의 revert를 권하게 된다.
   */
  introducedBy: string | null
}

/** origin 판별 불가 → **항상 자동 제거 대상에서 제외**. `path`는 파일 또는 `package.json#scripts.req:new` 형태. */
export interface AmbiguousArtifact {
  path: string
  present: boolean
  note: string
}

/** 설정된 ticketRoot — REQ 티켓 state.json·approvals.jsonl 등 감사 증거. */
export interface EvidenceDir {
  path: string
  ticketCount: number
}

export interface ScaffoldCommit {
  sha: string
  subject: string
}

export interface UninstallFacts {
  targetRoot: string
  /** `loadConfig` 해소값. 증거 보호 축(설치 경로 축은 KIT_SCHEMA_RELPATHS). */
  ticketRoot: string
  schemaPath: string
  /** config를 읽지 못해 DEFAULTS로 강등했으면 사유. planner는 쓰기가 없으므로 강등이 안전하다. */
  configError: string | null
  installed: boolean
  packageJsonDirty: boolean
  tool: ToolArtifact[]
  ambiguous: AmbiguousArtifact[]
  evidence: EvidenceDir[]
  info: string[]
  /**
   * kit 디렉터리(`scripts/req/`) 안에 있지만 이 패키지가 설치한 파일이 **아닌** 것들(phase R1 P1).
   * 사용자가 직접 넣은 파일일 수 있으므로 제거 후보에 넣지 않고, 디렉터리 통삭제도 제안하지 않는다.
   */
  unknownKitFiles: string[]
}

export type UninstallMode = 'not-installed' | 'uncommitted' | 'committed' | 'mixed'

export interface UninstallPlan {
  facts: UninstallFacts
  mode: UninstallMode
  /** 패키지 원본과 바이트 동일 → 사용자가 지워도 잃을 것이 없는 파일. */
  removable: ToolArtifact[]
  /** 원본과 다름 → 사용자 검토 후 판단. */
  review: ToolArtifact[]
  /** ambiguous 중 실제로 존재하는 것 — 자동 제거 금지 목록. */
  keep: AmbiguousArtifact[]
  /** 티켓이 실제로 쌓인 증거 디렉터리 — 삭제 금지. */
  protect: EvidenceDir[]
  scaffoldCommits: ScaffoldCommit[]
}

const TICKET_DIR_RE = /^REQ-\d{4}-\d+$/

// ─────────────────────────────────────────────────────── 읽기 헬퍼 ──

function sha256(abs: string): string {
  return createHash('sha256').update(readFileSync(abs)).digest('hex')
}

/** dir 하위 모든 파일의 절대경로(재귀, 조회만). */
function walkFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry)
    if (statSync(abs).isDirectory()) out.push(...walkFiles(abs))
    else out.push(abs)
  }
  return out
}

const toRel = (abs: string): string => relative(PACKAGE_ROOT, abs).replace(/\\/g, '/')

/** git이 추적 중인가(인덱스에 있는가). */
function isTracked(git: GitAdapter, rel: string): boolean {
  return git.exec(['ls-files', '--', rel]).length > 0
}

/** 이 경로를 처음 추가한 커밋(sha, subject). HEAD 이력에 없으면 null. */
function introducingCommit(git: GitAdapter, rel: string): ScaffoldCommit | null {
  const out = git.exec(['log', '--diff-filter=A', '-n', '1', '--format=%H%x09%s', '--', rel])
  if (!out) return null
  const tab = out.indexOf('\t')
  if (tab < 0) return null
  return { sha: out.slice(0, tab), subject: out.slice(tab + 1) }
}

/** JSON 객체 파싱(실패/비-객체면 null — planner는 fail-closed 하지 않고 "확인 불가"로 표기). */
function readJsonObject(abs: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(stripBom(readFileSync(abs, 'utf8')))
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function stringMap(obj: Record<string, unknown> | null, key: string): Record<string, string> {
  const v = obj?.[key]
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, string>
  return {}
}

// ──────────────────────────────────────────────── 사실 수집 (IO=읽기) ──

/**
 * 대상 repo를 읽어 `UninstallFacts`를 만든다. **읽기만 한다.**
 * `run` 주입 시 모든 git 호출이 그 runner를 통과한다(테스트가 서브커맨드를 감시).
 */
export function collectFacts(opts: UninstallOptions, run?: GitRunner): UninstallFacts {
  const targetRoot = resolve(opts.dir)
  if (!existsSync(targetRoot) || !statSync(targetRoot).isDirectory())
    throw new Error(`대상 디렉터리가 없음: ${targetRoot}`)
  assertGitWorkTree(targetRoot, run)
  const git = createGitAdapter(targetRoot, run)

  // 증거 보호 축: config에서 해소. 읽지 못하면 DEFAULTS로 강등하되 그 사실을 알린다
  // (깨진 config 때문에 제거 안내를 못 받는 건 부당하다 — planner는 쓰기가 없어 강등이 안전).
  let ticketRoot = DEFAULTS.ticketRoot
  let schemaPath = DEFAULTS.schemaPath
  let configError: string | null = null
  try {
    const cfg = loadConfig({ root: targetRoot })
    ticketRoot = cfg.ticketRoot
    schemaPath = cfg.schemaPath
  } catch (e) {
    configError = (e as Error).message
  }

  const info: string[] = []
  if (configError)
    info.push(`req.config.json을 읽을 수 없어 기본값(DEFAULTS)으로 강등했습니다 — ${configError}`)
  // 설치 경로 축(KIT_SCHEMA_RELPATHS)과 설정 경로 축(schemaPath)은 갈라질 수 있다.
  if (!(KIT_SCHEMA_RELPATHS as readonly string[]).includes(schemaPath))
    info.push(
      `schemaPath=${schemaPath} — 런타임이 읽는 경로이지만 init이 복사한 파일이 아닙니다(제거 후보 아님).`,
    )

  // ── tool: kit 소스 + init이 **실제로 복사한** 파일들(스키마 2종 + review-persona.md — 항상 리터럴 workflow/, ticketRoot 무관)
  // 복사 축(KIT_COPY_RELPATHS)을 쓴다. 위 info의 스키마 축(KIT_SCHEMA_RELPATHS)과 의도적으로 다른 상수다.
  const kitSourceRels = walkFiles(join(PACKAGE_ROOT, KIT_SOURCE_DIR_REL)).map(toRel)
  const toolRels = [...kitSourceRels, ...KIT_COPY_RELPATHS]
  const tool: ToolArtifact[] = toolRels.map((rel) => {
    const dest = join(targetRoot, rel)
    const src = join(PACKAGE_ROOT, rel)
    if (!existsSync(dest))
      return { path: rel, present: false, match: 'absent', tracked: false, introducedBy: null }
    const match: ToolArtifact['match'] =
      existsSync(src) && sha256(dest) === sha256(src) ? 'identical' : 'differs'
    const tracked = isTracked(git, rel)
    return {
      path: rel,
      present: true,
      match,
      tracked,
      // untracked면 이력의 add 커밋은 "지금 이 설치본"의 도입 커밋이 아니다 → 조회조차 하지 않는다(phase R2 P2).
      introducedBy: tracked ? (introducingCommit(git, rel)?.sha ?? null) : null,
    }
  })

  // ── ambiguous: origin 판별 불가 → 자동 제거 대상에서 항상 제외
  const ambiguous: AmbiguousArtifact[] = []

  const agentsAbs = join(targetRoot, 'AGENTS.md')
  if (existsSync(agentsAbs)) {
    const tpl = join(PACKAGE_ROOT, 'AGENTS.template.md')
    const same = existsSync(tpl) && sha256(agentsAbs) === sha256(tpl)
    ambiguous.push({
      path: 'AGENTS.md',
      present: true,
      note: same
        ? 'init 템플릿과 동일 — 그래도 자동 제거 대상이 아닙니다(Codex 계약 파일)'
        : '템플릿과 다름 — 사용자/팀이 작성했거나 편집했습니다',
    })
  }

  const cfgAbs = join(targetRoot, 'req.config.json')
  if (existsSync(cfgAbs)) {
    const parsed = readJsonObject(cfgAbs)
    let note: string
    if (!parsed) note = '파싱 불가 — 내용을 직접 확인하세요'
    else {
      const keys = Object.keys(parsed).sort().join(',')
      note =
        keys === 'handoffPath,packageManager' && parsed.handoffPath === null
          ? 'init 시드와 동일 — 그래도 자동 제거 대상이 아닙니다'
          : '사용자 값 포함(init은 누락 키만 병합합니다) — 값을 보존하세요'
    }
    ambiguous.push({ path: 'req.config.json', present: true, note })
  }

  const pkgAbs = join(targetRoot, 'package.json')
  const pkg = existsSync(pkgAbs) ? readJsonObject(pkgAbs) : null
  const scripts = stringMap(pkg, 'scripts')
  const devDeps = stringMap(pkg, 'devDependencies')
  for (const [k, injected] of Object.entries(REQ_SCRIPTS)) {
    const cur = scripts[k]
    if (cur === undefined) continue
    ambiguous.push({
      path: `package.json#scripts.${k}`,
      present: true,
      note: cur === injected ? 'init 주입값과 동일' : `사용자 값(init 주입값과 다름): ${cur}`,
    })
  }
  for (const [k, injected] of Object.entries(REQ_DEV_DEPS)) {
    const cur = devDeps[k]
    if (cur === undefined) continue
    ambiguous.push({
      path: `package.json#devDependencies.${k}`,
      present: true,
      note:
        cur === injected
          ? 'init 주입값과 동일 — 다른 곳에서도 쓰일 수 있습니다'
          : `사용자 값(init 주입값과 다름): ${cur}`,
    })
  }

  // ── evidence: 설정된 ticketRoot 하위 REQ-* (하드코딩 workflow/ 아님)
  const evidence: EvidenceDir[] = []
  const ticketRootAbs = join(targetRoot, ticketRoot)
  if (existsSync(ticketRootAbs) && statSync(ticketRootAbs).isDirectory()) {
    const ticketCount = readdirSync(ticketRootAbs, { withFileTypes: true }).filter(
      (d) => d.isDirectory() && TICKET_DIR_RE.test(d.name),
    ).length
    evidence.push({ path: ticketRoot, ticketCount })
  }

  // ── kit 디렉터리 안의 미분류 파일(phase R1 P1): 사용자가 넣었을 수 있으므로 제거 후보에서 제외하고 통삭제도 금지.
  const kitDirAbs = join(targetRoot, KIT_SOURCE_DIR_REL)
  const knownKit = new Set(kitSourceRels)
  const unknownKitFiles =
    existsSync(kitDirAbs) && statSync(kitDirAbs).isDirectory()
      ? walkFiles(kitDirAbs)
          .map((abs) => relative(targetRoot, abs).replace(/\\/g, '/'))
          .filter((rel) => !knownKit.has(rel))
          .sort()
      : []

  const packageJsonDirty = existsSync(pkgAbs) && git.exec(['status', '--porcelain', '--', 'package.json']).length > 0
  const installed = tool.some((t) => t.present) || ambiguous.some((a) => a.present)

  return {
    targetRoot,
    ticketRoot,
    schemaPath,
    configError,
    installed,
    packageJsonDirty,
    tool,
    ambiguous,
    evidence,
    info,
    unknownKitFiles,
  }
}

// ────────────────────────────────────────────────────── 계획 (순수) ──

/** facts → plan. **순수 함수**(IO 없음). */
export function buildPlan(facts: UninstallFacts): UninstallPlan {
  const present = facts.tool.filter((t) => t.present)
  // 도입 커밋은 **현재 tracked인 파일**에서만 인정한다(phase R2 P2 — 낡은 add 커밋으로 인한 오판 차단).
  const introduced = present.filter((t) => t.tracked && t.introducedBy !== null)

  let mode: UninstallMode
  if (!facts.installed) mode = 'not-installed'
  else if (introduced.length === 0) mode = 'uncommitted'
  else if (introduced.length === present.length) mode = 'committed'
  else mode = 'mixed'

  // 도입 커밋 후보(중복 제거, 첫 등장 순).
  const seen = new Set<string>()
  const scaffoldCommits: ScaffoldCommit[] = []
  for (const t of introduced) {
    const sha = t.introducedBy as string
    if (seen.has(sha)) continue
    seen.add(sha)
    scaffoldCommits.push({ sha, subject: '' })
  }

  return {
    facts,
    mode,
    removable: present.filter((t) => t.match === 'identical'),
    review: present.filter((t) => t.match === 'differs'),
    keep: facts.ambiguous.filter((a) => a.present),
    protect: facts.evidence.filter((e) => e.ticketCount > 0),
    scaffoldCommits,
  }
}

/** subject를 붙인 scaffoldCommits(IO=git log). buildPlan은 순수하게 유지하고 여기서만 보강. */
function enrichCommits(plan: UninstallPlan, git: GitAdapter): UninstallPlan {
  if (plan.scaffoldCommits.length === 0) return plan
  const anchorByS = new Map<string, string>()
  for (const t of plan.facts.tool) {
    if (t.introducedBy && !anchorByS.has(t.introducedBy)) anchorByS.set(t.introducedBy, t.path)
  }
  const scaffoldCommits = plan.scaffoldCommits.map((c) => {
    const anchor = anchorByS.get(c.sha)
    const found = anchor ? introducingCommit(git, anchor) : null
    return { sha: c.sha, subject: found?.subject ?? '' }
  })
  return { ...plan, scaffoldCommits }
}

// ────────────────────────────────────────────────────── 출력 (순수) ──

const MODE_LABEL: Record<UninstallMode, string> = {
  'not-installed': '설치 흔적 없음',
  uncommitted: '설치됨 — 아직 커밋되지 않음',
  committed: '설치됨 — 커밋됨',
  mixed: '설치됨 — 일부만 커밋됨',
}

/** plan → 사람이 읽는 계획 텍스트. **순수 함수**. 여기서 출력하는 명령은 전부 "사용자가 직접 실행할 것"이다. */
export function renderPlan(plan: UninstallPlan): string {
  const { facts } = plan
  const L: string[] = []

  L.push('[commitgate uninstall] 읽기 전용 제거 계획 — 이 명령은 어떤 파일도 지우지 않습니다.')
  L.push(`  대상       : ${facts.targetRoot}`)
  L.push(`  상태       : ${MODE_LABEL[plan.mode]}`)
  L.push(`  ticketRoot : ${facts.ticketRoot}${facts.configError ? ' (기본값 강등)' : ''}`)
  for (const i of facts.info) L.push(`  참고       : ${i}`)
  L.push('')

  if (plan.mode === 'not-installed') {
    L.push('이 repo에서 CommitGate 설치 흔적을 찾지 못했습니다. 되돌릴 것이 없습니다.')
    L.push('')
    L.push(renderNpxSection())
    return L.join('\n')
  }

  L.push('## 1. CommitGate 소유 파일')
  if (plan.removable.length) {
    L.push('   패키지 원본과 바이트 동일 — 지워도 잃을 내용이 없습니다:')
    for (const t of plan.removable) L.push(`     - ${t.path}${t.tracked ? ' (tracked)' : ' (untracked)'}`)
  }
  if (plan.review.length) {
    L.push('   원본과 다름 — 편집됐거나 다른 버전이 설치했습니다. 지우기 전에 직접 확인하세요:')
    for (const t of plan.review) L.push(`     ~ ${t.path}${t.tracked ? ' (tracked)' : ' (untracked)'}`)
  }
  if (!plan.removable.length && !plan.review.length) L.push('     (없음)')
  if (facts.unknownKitFiles.length) {
    L.push(`   ${KIT_SOURCE_DIR_REL}/ 안에 CommitGate가 설치하지 않은 파일이 있습니다 — 건드리지 마세요:`)
    for (const f of facts.unknownKitFiles) L.push(`     ? ${f}`)
  }
  L.push('')

  L.push('## 2. 자동 제거 대상이 아님 — 직접 판단하세요')
  L.push('   init은 무엇을 새로 만들었는지 디스크에 기록하지 않습니다. 따라서 아래 항목이')
  L.push('   CommitGate 소유인지 원래 있던 것인지 이 도구는 알 수 없습니다.')
  if (plan.keep.length) for (const a of plan.keep) L.push(`     - ${a.path}  —  ${a.note}`)
  else L.push('     (없음)')
  L.push('')

  L.push('## 3. 감사 증거 — 삭제하지 마세요')
  if (plan.protect.length)
    for (const e of plan.protect) L.push(`     - ${e.path}/  (REQ 티켓 ${e.ticketCount}개 · state.json · approvals.jsonl)`)
  else L.push(`     ${facts.ticketRoot}/ 에 REQ 티켓이 아직 없습니다. 티켓이 생기면 이 디렉터리는 감사 증거가 됩니다.`)
  L.push('')

  L.push('## 4. 되돌리는 방법 (아래 명령은 직접 실행하세요)')
  L.push(...renderRevertSection(plan))
  L.push('')

  L.push('## 5. 잔여물 경고')
  L.push('   - git은 빈 디렉터리를 추적하지 않습니다. 위 파일을 지운 뒤 `git status`가 clean이어도')
  L.push(`     빈 디렉터리(scripts/ · ${facts.ticketRoot}/)가 파일시스템에 남을 수 있습니다.`)
  L.push('   - node_modules의 ajv · cross-spawn · tsx 는 다른 패키지도 쓸 수 있어 제거를 권하지 않습니다.')
  L.push('')

  L.push(renderNpxSection())
  return L.join('\n')
}

function renderRevertSection(plan: UninstallPlan): string[] {
  const L: string[] = []
  const { facts } = plan

  if (plan.mode === 'committed' || plan.mode === 'mixed') {
    if (plan.scaffoldCommits.length === 1) {
      const c = plan.scaffoldCommits[0] as ScaffoldCommit
      L.push('   스캐폴딩 도입 커밋:')
      L.push(`     ${c.sha}  ${c.subject}`)
      L.push('   이 커밋이 스캐폴딩만 담고 있다면:')
      L.push(`     git revert ${c.sha}`)
      L.push('   다른 변경이 섞여 있으면 revert가 무관한 작업까지 되돌립니다 — 먼저 `git show`로 확인하세요.')
    } else {
      L.push('   ⚠️ 스캐폴딩 도입 커밋이 여러 개로 흩어져 있어 단일 revert로 되돌릴 수 없습니다:')
      for (const c of plan.scaffoldCommits) L.push(`     ${c.sha}  ${c.subject}`)
      L.push('   각 커밋의 내용을 확인한 뒤(`git show <sha>`) 되돌릴 범위를 직접 정하세요.')
    }
    if (plan.mode === 'mixed') L.push('   일부 파일은 아직 커밋되지 않았습니다 — 아래 미커밋 절차도 함께 보세요.')
  }

  if (plan.mode === 'uncommitted' || plan.mode === 'mixed') {
    L.push('   1) 무엇이 바뀌었는지 확인:')
    L.push('        git status --porcelain -uall')
    L.push('        git diff -- package.json')
    if (facts.packageJsonDirty) {
      L.push('   2) package.json 되돌리기:')
      L.push('        git checkout HEAD -- package.json')
      L.push('      ⚠️ 이 명령은 package.json의 다른 미커밋 편집도 함께 버립니다. 먼저 위 diff를 확인하세요.')
      L.push('      ⚠️ `HEAD`를 빼면 인덱스에서 복원되어, `git add` 이후에는 주입된 req:* 스크립트가 그대로 남습니다.')
    }
    if (plan.removable.length) {
      // ⚠️ 디렉터리 통삭제(`rm -rf <kit dir>`)는 제안하지 않는다(phase R1 P1): 그 디렉터리에 사용자가 넣은
      //    미분류 파일이 있으면 함께 지워진다. **분류된 파일만 파일 단위로** 나열한다.
      L.push('   3) 원본과 동일한 파일만 삭제(직접 실행):')
      for (const t of plan.removable) L.push(`        rm -f ${t.path}`)
    }
    if (plan.review.length) L.push('   4) 위 "원본과 다름" 파일은 내용을 확인한 뒤 직접 결정하세요.')
  }
  return L
}

function renderNpxSection(): string {
  return [
    '## npx 캐시 (repo 스캐폴딩과 무관 — 별도 정리)',
    '   `npx commitgate`는 전역 설치가 아닙니다. 패키지는 npm 캐시의 `_npx/<hash>/`에만 들어갑니다.',
    '     확인          : npm ls -g commitgate      (비어 있으면 전역 설치 아님)',
    '     전역이었다면  : npm uninstall -g commitgate',
    '   캐시에 남은 npx 패키지 정리:',
    '     Windows (PowerShell) : Remove-Item -Recurse -Force "$(npm config get cache)\\_npx"',
    '     macOS / Linux        : rm -rf "$(npm config get cache)/_npx"',
    '   ⚠️ `npm cache clean --force`는 `_cacache`만 비우고 `_npx`는 지우지 않습니다 — CommitGate 제거 명령이 아닙니다.',
  ].join('\n')
}

// ─────────────────────────────────────────────────────────── 파사드 ──

/** 사실 수집 → 계획. 읽기 전용. `run` 주입 시 모든 git 호출이 그 runner를 통과. */
export function planUninstall(opts: UninstallOptions, run?: GitRunner): UninstallPlan {
  const facts = collectFacts(opts, run)
  const git = createGitAdapter(resolve(opts.dir), run)
  return enrichCommits(buildPlan(facts), git)
}

/** 계획을 stdout에 출력하고 텍스트를 반환. */
export function runUninstall(opts: UninstallOptions, run?: GitRunner): string {
  const text = renderPlan(planUninstall(opts, run))
  console.log(text)
  return text
}

export function parseArgs(argv: string[]): UninstallOptions {
  let dir = process.cwd()
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dir') {
      const v = argv[i + 1]
      if (v === undefined) throw new Error('--dir 값 누락')
      dir = v
      i++
    } else if (a === '-h' || a === '--help') {
      printHelp()
      process.exit(0)
    } else {
      throw new Error(`알 수 없는 인자: ${a}`)
    }
  }
  return { dir: resolve(dir) }
}

function printHelp(): void {
  console.log(`commitgate uninstall — 제거 계획 출력(읽기 전용)

사용법:
  npx commitgate uninstall [--dir <대상repo>]

이 명령은 **아무것도 지우지 않습니다.** repo를 읽어 무엇이 설치됐는지 분류하고,
사용자가 직접 검토 후 실행할 git/삭제 명령을 출력합니다.

옵션:
  --dir <path>   대상 repo 루트(기본: 현재 디렉터리)
  -h, --help     도움말

왜 자동 삭제가 없나:
  init은 "무엇을 새로 만들었는지"를 디스크에 기록하지 않습니다. 그래서 AGENTS.md·req.config.json·
  package.json의 값이 CommitGate 소유인지 사용자 소유인지 구분할 수 없고, blind 삭제는 데이터를 파괴합니다.
  이 kit은 git repo에 파일만 추가하므로 되돌리기의 정본은 git입니다.`)
}

/** CLI 경계: 예상된 실패(throw)를 친절한 한 줄 + exit 1로 변환(스택트레이스 노출 방지). init.ts runCli와 동일 정책. */
export function runCli(argv: string[]): void {
  try {
    runUninstall(parseArgs(argv))
  } catch (err) {
    console.error(`commitgate uninstall: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  }
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href
if (isMain) runCli(process.argv.slice(2))
