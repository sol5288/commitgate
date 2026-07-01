#!/usr/bin/env tsx
/**
 * req-workflow init — AI REQ workflow kit을 대상 git repo에 설치(Stage A / Model A: vendored 스캐폴딩).
 *
 * 동작(멱등·비파괴):
 *   1. 대상 repo 감사(git repo·package.json 필수 → 없으면 fail-closed throw)
 *   2. `scripts/req/**` + `workflow/{machine,req.config}.schema.json` 복사(기존 파일은 --force 없으면 스킵)
 *   3. `req.config.json` 시드(부재 시): 감지한 packageManager + handoffPath:null(프로젝트별 값은 코어 DEFAULTS가 아니라 config에서 흡수)
 *   4. 대상 `package.json`에 req:* 스크립트·devDeps(ajv/tsx) 주입(기존 키 미덮어씀)
 *   5. `AGENTS.md` 부재 시 템플릿 생성(있으면 스킵 — Codex 계약 보존)
 *
 * 코어 승인 바인딩·staged tree 검증은 건드리지 않는다(복사만). 프로젝트 차이는 req.config.json에서만 흡수.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, copyFileSync } from 'node:fs'
import { resolve, join, dirname, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { PackageManager } from '../scripts/req/lib/config'

/** 이 패키지 루트(bin/ 기준 1단계 위). 복사 원본. */
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 대상 package.json에 주입할 req:* 스크립트. */
const REQ_SCRIPTS: Record<string, string> = {
  'req:new': 'tsx scripts/req/req-new.ts',
  'req:review-codex': 'tsx scripts/req/review-codex.ts',
  'req:doctor': 'tsx scripts/req/req-doctor.ts',
  'req:commit': 'tsx scripts/req/req-commit.ts',
}

/** 대상 package.json에 주입할 devDeps(워크플로 실행 전제). */
const REQ_DEV_DEPS: Record<string, string> = {
  ajv: '^8.20.0',
  tsx: '^4.19.1',
}

export interface InitOptions {
  dir: string
  force: boolean
  dryRun: boolean
}

export interface InitResult {
  targetRoot: string
  copied: string[] // repo-상대 경로(신규 복사)
  skipped: string[] // repo-상대 경로(이미 존재 → 미덮어씀)
  configCreated: boolean
  packageJsonAdded: string[] // 추가된 script/devDep 키
  agentsCreated: boolean
  packageManager: PackageManager
  dryRun: boolean
}

/** lockfile로 대상 패키지매니저 감지(없으면 npm — 가장 보편적 기본). */
export function detectPackageManager(root: string): PackageManager {
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn'
  if (existsSync(join(root, 'package-lock.json'))) return 'npm'
  return 'npm'
}

/** dir 하위 모든 파일의 절대경로(재귀). */
function walkFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry)
    if (statSync(abs).isDirectory()) out.push(...walkFiles(abs))
    else out.push(abs)
  }
  return out
}

/**
 * srcAbs 파일들을 targetRoot 하위 동일 상대경로로 복사. 기존 파일은 force 없으면 스킵.
 * srcBase는 상대경로 계산 기준(= PACKAGE_ROOT)이라 대상에서도 같은 레이아웃 유지.
 */
function copyInto(
  srcFiles: string[],
  srcBase: string,
  targetRoot: string,
  opts: InitOptions,
  copied: string[],
  skipped: string[],
): void {
  for (const srcAbs of srcFiles) {
    const rel = relative(srcBase, srcAbs).replace(/\\/g, '/')
    const destAbs = join(targetRoot, rel)
    if (existsSync(destAbs) && !opts.force) {
      skipped.push(rel)
      continue
    }
    copied.push(rel)
    if (opts.dryRun) continue
    mkdirSync(dirname(destAbs), { recursive: true })
    copyFileSync(srcAbs, destAbs)
  }
}

/** 설치 코어. IO는 여기서만(테스트가 임시 repo로 직접 호출). */
export function runInit(opts: InitOptions): InitResult {
  const targetRoot = resolve(opts.dir)

  // ── 감사(fail-closed) ─────────────────────────────────────────────
  if (!existsSync(targetRoot) || !statSync(targetRoot).isDirectory())
    throw new Error(`대상 디렉터리가 없음: ${targetRoot}`)
  if (!existsSync(join(targetRoot, '.git')))
    throw new Error(`대상이 git repo가 아님: ${targetRoot} — 'git init' 후 재시도(워크플로는 git 전제).`)
  const pkgPath = join(targetRoot, 'package.json')
  if (!existsSync(pkgPath))
    throw new Error(`package.json 없음: ${targetRoot} — 'npm init' 등으로 먼저 생성(req:* 스크립트 주입 대상).`)

  const copied: string[] = []
  const skipped: string[] = []

  // ── 1) scripts/req/** 복사 ────────────────────────────────────────
  copyInto(walkFiles(join(PACKAGE_ROOT, 'scripts', 'req')), PACKAGE_ROOT, targetRoot, opts, copied, skipped)

  // ── 2) workflow 스키마 2종만 복사(티켓 디렉터리는 제외) ─────────────
  const schemaFiles = ['machine.schema.json', 'req.config.schema.json'].map((f) =>
    join(PACKAGE_ROOT, 'workflow', f),
  )
  copyInto(schemaFiles, PACKAGE_ROOT, targetRoot, opts, copied, skipped)

  // ── 3) req.config.json 시드(부재 시) ──────────────────────────────
  const packageManager = detectPackageManager(targetRoot)
  const cfgPath = join(targetRoot, 'req.config.json')
  let configCreated = false
  if (!existsSync(cfgPath)) {
    configCreated = true
    if (!opts.dryRun) {
      // handoffPath:null — 코어 DEFAULTS의 프로젝트 고유값(palm 경로)을 상속하지 않도록 명시 비활성.
      const seed = { packageManager, handoffPath: null }
      writeFileSync(cfgPath, JSON.stringify(seed, null, 2) + '\n', 'utf8')
    }
  }

  // ── 4) 대상 package.json 패치(기존 키 미덮어씀) ────────────────────
  const packageJsonAdded: string[] = []
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
    scripts?: Record<string, string>
    devDependencies?: Record<string, string>
  }
  const scripts = pkg.scripts ?? {}
  const devDeps = pkg.devDependencies ?? {}
  for (const [k, v] of Object.entries(REQ_SCRIPTS)) {
    if (!(k in scripts)) {
      scripts[k] = v
      packageJsonAdded.push(`scripts.${k}`)
    }
  }
  for (const [k, v] of Object.entries(REQ_DEV_DEPS)) {
    if (!(k in devDeps)) {
      devDeps[k] = v
      packageJsonAdded.push(`devDependencies.${k}`)
    }
  }
  if (packageJsonAdded.length > 0 && !opts.dryRun) {
    pkg.scripts = scripts
    pkg.devDependencies = devDeps
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
  }

  // ── 5) AGENTS.md 시드(부재 시) ────────────────────────────────────
  const agentsPath = join(targetRoot, 'AGENTS.md')
  let agentsCreated = false
  if (!existsSync(agentsPath)) {
    agentsCreated = true
    if (!opts.dryRun) {
      copyFileSync(join(PACKAGE_ROOT, 'AGENTS.template.md'), agentsPath)
    }
  }

  return {
    targetRoot,
    copied,
    skipped,
    configCreated,
    packageJsonAdded,
    agentsCreated,
    packageManager,
    dryRun: opts.dryRun,
  }
}

export function parseArgs(argv: string[]): InitOptions {
  let dir = process.cwd()
  let force = false
  let dryRun = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dir') {
      const v = argv[i + 1]
      if (v === undefined) throw new Error('--dir 값 누락')
      dir = v
      i++
    } else if (a === '--force') {
      force = true
    } else if (a === '--dry-run') {
      dryRun = true
    } else if (a === '-h' || a === '--help') {
      printHelp()
      process.exit(0)
    } else {
      throw new Error(`알 수 없는 인자: ${a}`)
    }
  }
  return { dir: resolve(dir), force, dryRun }
}

function printHelp(): void {
  console.log(`req-workflow-init — AI REQ workflow kit 설치

사용법:
  npx req-workflow-init [--dir <대상repo>] [--force] [--dry-run]

옵션:
  --dir <path>   대상 repo 루트(기본: 현재 디렉터리)
  --force        기존 kit 파일 덮어쓰기(기본: 스킵)
  --dry-run      변경 없이 수행 예정 목록만 출력
  -h, --help     도움말

설치 후:
  1. <대상repo>에서 의존성 설치(감지된 패키지매니저)
  2. codex CLI 설치 확인(리뷰 실호출용)
  3. req.config.json 조정(branchPrefix/ticketRoot 등)
  4. <pm> req:new <slug> --run 으로 첫 티켓 생성`)
}

export function main(argv: string[]): void {
  const opts = parseArgs(argv)
  const r = runInit(opts)
  const tag = r.dryRun ? '[dry-run] ' : ''
  console.log(`${tag}req-workflow 설치: ${r.targetRoot}`)
  console.log(`${tag}  packageManager 감지: ${r.packageManager}`)
  console.log(`${tag}  복사 ${r.copied.length}개 / 스킵(기존) ${r.skipped.length}개`)
  for (const f of r.copied) console.log(`${tag}    + ${f}`)
  for (const f of r.skipped) console.log(`${tag}    = ${f} (이미 존재)`)
  console.log(`${tag}  req.config.json: ${r.configCreated ? '생성' : '이미 존재(유지)'}`)
  console.log(
    `${tag}  package.json: ${r.packageJsonAdded.length > 0 ? '추가 ' + r.packageJsonAdded.join(', ') : '변경 없음'}`,
  )
  console.log(`${tag}  AGENTS.md: ${r.agentsCreated ? '템플릿 생성' : '이미 존재(유지)'}`)
  if (!r.dryRun) {
    console.log(`\n다음:`)
    console.log(`  1. cd ${r.targetRoot} && ${r.packageManager} install`)
    console.log(`  2. codex --version   # 리뷰 실호출 전제(미설치면 review-codex --run이 fail-closed)`)
    console.log(`  3. req.config.json 확인(branchPrefix 등)`)
    console.log(`  4. ${r.packageManager} req:new <slug> --run`)
  }
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href
if (isMain) main(process.argv.slice(2))
