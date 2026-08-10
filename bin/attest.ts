#!/usr/bin/env tsx
/**
 * commitgate attest — **정당한 예외의 명시 승인** (REQ-2026-127 DEC-3).
 *
 * release·setup·수동 충돌 정정·(승인된 우회)처럼 CommitGate 승인 증거가 없는 것이 정상인 커밋을,
 * 사람이 **이유와 함께** append-only 감사 기록(`<ticketRoot>/attestations.jsonl`)으로 승인한다.
 * verify-range/integrate가 head tree의 이 파일을 읽어 해당 커밋을 `attested`로 분류한다.
 *
 * 🔴 서명이 아니다 — `attested_by`는 로컬 git identity일 뿐이다. 가치는 "누가·언제·왜"가
 *    **커밋된 기록**으로 남는 것이다(감사 전제 P-C).
 * 🔴 attestation은 invalid-evidence(손상 증거)를 구제하지 않는다 — 손상은 수정이 답이다.
 * 🔴 `--run`은 attestations.jsonl **한 파일만** 담은 부기 커밋을 만든다. 다른 staged 변경이 있으면
 *    거부한다(예외 기록에 코드가 섞여 들어가는 것 방지).
 */
import { resolve, join } from 'node:path'
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { loadConfig } from '../scripts/req/lib/config'
import { createGitAdapter, type GitAdapter } from '../scripts/req/lib/adapters'
import { isEntrypoint } from '../scripts/req/lib/cli-boundary'
import { bookkeepingMessage } from '../scripts/req/lib/bookkeeping'
import {
  attestationsPath,
  parseAttestations,
  serializeAttestationRow,
  type AttestationRow,
} from '../scripts/req/lib/attestations'

export interface Opts {
  dir: string
  run: boolean
  sha: string | null
  reason: string | null
}

export class HelpRequested extends Error {
  constructor() {
    super('help')
    this.name = 'HelpRequested'
  }
}

export function parseArgs(argv: string[]): Opts {
  let dir = process.cwd()
  let run = false
  let sha: string | null = null
  let reason: string | null = null
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string
    if (a === '--dir') {
      const v = argv[++i]
      if (v === undefined || v.startsWith('-')) throw new Error(`--dir 에 값이 필요합니다 (받음: ${v ?? '(없음)'})`)
      dir = v
    } else if (a === '--reason') {
      const v = argv[++i]
      if (v === undefined || v.startsWith('-')) throw new Error(`--reason 에 이유가 필요합니다 (받음: ${v ?? '(없음)'})`)
      reason = v
    } else if (a === '--run') run = true
    else if (a === '-h' || a === '--help') throw new HelpRequested()
    else if (!a.startsWith('-')) {
      if (sha !== null) throw new Error(`예상치 못한 인자: ${a} (대상 sha는 하나만)`)
      sha = a
    } else throw new Error(`알 수 없는 옵션: ${a}`)
  }
  return { dir: resolve(dir), run, sha, reason }
}

/** 로컬 git identity(`name <email>`) — 주체의 로컬 식별자(서명 아님). */
export function localIdentity(git: GitAdapter): string {
  const name = git.exec(['config', 'user.name']).trim()
  const email = git.exec(['config', 'user.email']).trim()
  return `${name} <${email}>`
}

export interface RunDeps {
  git: GitAdapter
  log: (line: string) => void
  now: () => string
  rootAbs: string
  ticketRoot: string
}

export function runAttest(opts: Opts, deps: RunDeps): number {
  if (opts.sha === null) throw new Error('대상 커밋 sha가 필요합니다: commitgate attest <sha> --reason "..."')
  if (opts.reason === null || opts.reason.trim() === '') throw new Error('--reason "..." 이 필요합니다 — 이유 없는 예외 승인은 감사 기록이 아닙니다')

  // 대상 확정: 축약 입력 허용 — 기록은 풀 OID. 존재하지 않으면 여기서 실패한다.
  let fullSha: string
  let tree: string
  try {
    fullSha = deps.git.exec(['rev-parse', '--verify', `${opts.sha}^{commit}`]).trim()
    tree = deps.git.exec(['rev-parse', `${fullSha}^{tree}`]).trim()
  } catch {
    throw new Error(`대상 커밋을 찾을 수 없습니다: ${opts.sha}`)
  }

  const row: AttestationRow = {
    schema_version: 1,
    sha: fullSha,
    tree,
    reason: opts.reason.trim(),
    attested_at: deps.now(),
    attested_by: localIdentity(deps.git),
  }
  const rel = attestationsPath(deps.ticketRoot)
  const abs = join(deps.rootAbs, ...rel.split('/'))

  if (!opts.run) {
    deps.log('commitgate attest — DRY-RUN (기록하지 않았습니다. 실행하려면 --run)')
    deps.log(`  파일: ${rel} (append-only·부기 커밋됨)`)
    deps.log(`  행  : ${serializeAttestationRow(row).trim()}`)
    return 0
  }

  // 오염 방지: 이 파일 외 staged 변경이 있으면 거부(부기 커밋에 코드가 섞이는 것 방지).
  const staged = deps.git
    .exec(['diff', '--cached', '--name-only'])
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((p) => p !== rel)
  if (staged.length > 0)
    throw new Error(`attest --run 은 ${rel} 만 커밋합니다 — 다른 staged 변경을 먼저 커밋하거나 unstage 하세요: ${staged.slice(0, 3).join(', ')}${staged.length > 3 ? ' …' : ''}`)

  // 기존 파일이 있으면 손상 여부를 알리되(감사 표면), append 자체는 막지 않는다(append-only 계약).
  if (existsSync(abs)) {
    const { problems } = parseAttestations(readFileSync(abs, 'utf8'))
    if (problems > 0) deps.log(`⚠️ ${rel} 에 손상 행 ${problems}건 — 해당 행은 검증에서 무시됩니다(이번 append와 무관)`)
  }
  mkdirSync(dirname(abs), { recursive: true })
  appendFileSync(abs, serializeAttestationRow(row), 'utf8')
  deps.git.exec(['add', rel])
  deps.git.exec(['commit', '-m', bookkeepingMessage(`attest — ${fullSha.slice(0, 8)} 예외 승인 기록`)])
  deps.log(`✅ attested: ${fullSha.slice(0, 8)} — ${row.reason}`)
  deps.log(`   기록: ${rel} (부기 커밋됨 — verify-range/integrate가 attested로 분류합니다)`)
  return 0
}

export function printHelp(): void {
  console.log(`commitgate attest — 승인 증거가 없는 것이 정상인 커밋의 명시 예외 승인(append-only 감사 기록)

사용법:
  npx commitgate attest <sha> --reason "..." [--run] [--dir <대상repo>]

동작:
  대상 커밋의 풀 OID·tree·이유·시각·로컬 git identity를 <ticketRoot>/attestations.jsonl 에
  append 하고 그 파일만 담은 부기 커밋을 만듭니다(기본은 dry-run — 기록될 행만 출력).
  verify-range / integrate 가 head tree의 이 기록을 읽어 해당 커밋을 attested 로 분류합니다.

  대상 예: release·setup 커밋 · 수동 충돌 정정 · 사람이 승인한 게이트 우회.
  🔴 손상 증거(invalid-evidence)는 attest 로 구제되지 않습니다 — 수정이 답입니다.
  🔴 서명이 아닙니다 — attested_by 는 로컬 identity 기록일 뿐입니다.

옵션:
  --reason "..."   필수 — 이유 없는 예외 승인은 받지 않습니다
  --run            실제 기록(기본은 dry-run)
  --dir <path>     대상 repo 루트(기본: 현재 디렉터리)
  -h, --help       도움말

exit: 0 = 성공/dry-run · 1 = 사용 오류/대상 없음.
`)
}

export async function runCli(argv: string[]): Promise<void> {
  try {
    const opts = parseArgs(argv)
    const cfg = loadConfig({ root: opts.dir })
    const git = createGitAdapter(cfg.root)
    const exit = runAttest(opts, {
      git,
      log: (l) => console.error(l),
      now: () => new Date().toISOString(),
      rootAbs: cfg.root,
      ticketRoot: cfg.ticketRoot,
    })
    if (exit !== 0) process.exitCode = exit
  } catch (err) {
    if (err instanceof HelpRequested) {
      printHelp()
      return
    }
    console.error(`commitgate attest: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  }
}

const isMain = isEntrypoint(import.meta.url)
if (isMain) void runCli(process.argv.slice(2))
