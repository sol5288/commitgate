#!/usr/bin/env tsx
/**
 * commitgate report — **로컬 관측 요약**(읽기 전용·비대화형·비배선) (REQ-2026-124).
 *
 * `check`와 같은 지위다: 어떤 게이트에서도 spawn되지 않고, 질문하지 않고, **아무것도 쓰지 않는다**
 * (로그 append조차 없음 — 완전 조회). 집계는 순수 lib(`scripts/req/lib/report.ts`)가 하고 여기는
 * 수집(로그 3종 읽기 + trunk 기준 verify-range 산출)·렌더만 한다.
 *
 * 🔴 네트워크·유료 호출 없음. 출력은 로그가 이미 담은 저위험 데이터(id·개수·SHA)의 재구성뿐이다.
 */
import { resolve, join } from 'node:path'
import { readFileSync, existsSync } from 'node:fs'
import { loadConfig } from '../scripts/req/lib/config'
import { createGitAdapter } from '../scripts/req/lib/adapters'
import { isEntrypoint } from '../scripts/req/lib/cli-boundary'
import { buildReport, type Report } from '../scripts/req/lib/report'
import { verifyRange, type VerifyRangeReport } from '../scripts/req/lib/verify-range'
import { collectCommits, collectManifestContents } from './verify-range'

export interface Opts {
  dir: string
  json: boolean
}

export class HelpRequested extends Error {
  constructor() {
    super('help')
    this.name = 'HelpRequested'
  }
}

/** fail-closed 인자 파싱(check.ts 관례 — 값 자리 옵션 삼킴 금지). */
export function parseArgs(argv: string[]): Opts {
  let dir = process.cwd()
  let json = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dir') {
      const v = argv[++i]
      if (v === undefined || v.startsWith('-')) throw new Error(`--dir 에 경로가 필요합니다 (받음: ${v ?? '(없음)'})`)
      dir = v
    } else if (a === '--json') json = true
    else if (a === '-h' || a === '--help') throw new HelpRequested()
    else throw new Error(`알 수 없는 옵션: ${a}`)
  }
  return { dir: resolve(dir), json }
}

/** 로그 파일 읽기 — 부재는 null(섹션 부재로 흐른다 — 추정 금지). */
function readLog(rootAbs: string, rel: string): string | null {
  const abs = join(rootAbs, ...rel.split('/'))
  return existsSync(abs) ? readFileSync(abs, 'utf8') : null
}

/** trunk 기준 verify-range — 계산 불가(trunk 없음·git 실패)는 null(섹션 부재). */
function tryVerifyRange(rootAbs: string, trunkBranch: string | null): VerifyRangeReport | null {
  if (trunkBranch === null) return null
  try {
    const git = createGitAdapter(rootAbs)
    const head = git.exec(['rev-parse', '--verify', 'HEAD^{commit}']).trim()
    const base = git.exec(['merge-base', trunkBranch, head]).trim()
    return verifyRange({
      commits: collectCommits(git, base, head),
      manifestContents: collectManifestContents(git, head, loadConfig({ root: rootAbs }).ticketRoot),
    })
  } catch {
    return null
  }
}

export function collectReport(dir: string): Report {
  const cfg = loadConfig({ root: dir })
  return buildReport({
    doctorRuns: readLog(cfg.root, 'workflow/.doctor-runs.jsonl'),
    reviewCalls: readLog(cfg.root, 'workflow/.review-calls.jsonl'),
    verifyRuns: readLog(cfg.root, 'workflow/.verify-runs.jsonl'),
    verifyRange: tryVerifyRange(cfg.root, cfg.trunkBranch),
  })
}

const NONE = '(데이터 없음 — 원천 로그가 아직 없습니다)'

/** 사람용 렌더 — `--json`과 **같은 Report에서 파생**(check.ts DEC-5 관례). */
export function renderHuman(r: Report): string {
  const lines: string[] = ['commitgate report — 로컬 관측 요약(읽기 전용)']
  lines.push('', '## doctor')
  if (!r.doctor) lines.push(NONE)
  else {
    const d = r.doctor
    lines.push(`실행 ${d.runs} · 티켓 ${d.tickets} · WARN-only 실행 ${d.warnOnlyRuns}${d.runs ? ` (${Math.round((100 * d.warnOnlyRuns) / d.runs)}%)` : ''}`)
    for (const c of d.checks) lines.push(`  ${c.id}: 발화 ${c.fired}${c.fail ? ` (FAIL ${c.fail})` : ''}`)
    lines.push(`  해소 관측: ${d.resolved} 해소 · ${d.openSubjects} 미해소 — 대상 추적 가능 검사(${d.resolvableChecks.join(', ') || '없음'})에 한함`)
    lines.push('  ("검사별 적용 가능 수"는 기록되지 않아 제공하지 않습니다 — 로그는 발화만 담습니다)')
  }
  lines.push('', '## review')
  if (!r.review) lines.push(NONE)
  else {
    const v = r.review
    lines.push(`호출 ${v.calls} · 대상 ${v.targets} · 대상당 총 호출 중앙값 ${v.callsPerTargetMedian ?? '-'} / 최대 ${v.callsPerTargetMax ?? '-'} (시리즈당이 아님 — archive_round는 시리즈 리셋 없음)`)
    lines.push(`  outcome: ${Object.entries(v.outcomes).map(([k, n]) => `${k} ${n}`).join(' · ') || '-'}`)
    lines.push(`  design delta 모드: ${v.deltaDesignCalls}/${v.deltaDesignWithField} (필드 보유 행 기준)`)
    if (Object.keys(v.fullReviewReasons).length)
      lines.push(`  full 전환 사유: ${Object.entries(v.fullReviewReasons).map(([k, n]) => `${k} ${n}`).join(' · ')}`)
    lines.push(`  프롬프트 바이트 p50/p95: ${v.promptBytesP50 ?? '-'} / ${v.promptBytesP95 ?? '-'} · 소요 ms p50/p95: ${v.durationMsP50 ?? '-'} / ${v.durationMsP95 ?? '-'}`)
  }
  lines.push('', '## evidence')
  if (!r.evidence) lines.push('(판정 불가 — trunk 없음·git 실패, 또는 미계산)')
  else {
    const e = r.evidence
    lines.push(`trunk 대비 커밋: 승인 소비 ${e.counts.approved} · 부기 ${e.counts.bookkeeping} · 머지 ${e.counts.merge} · 미입증 ${e.counts.unproven}`)
    for (const u of e.unproven) lines.push(`  ? ${u.sha.slice(0, 8)} ${u.subject}`)
    if (e.manifestProblems) lines.push(`  ⚠️ approvals.jsonl 파싱 문제 ${e.manifestProblems}행`)
    lines.push(`  최신 doctor 관측(${e.latestDoctorAt ?? '-'}): D25 [${e.d25Subjects.join(', ') || '없음'}] · D30 [${e.d30Subjects.join(', ') || '없음'}]`)
  }
  lines.push('', '## ci')
  if (!r.ci) lines.push(NONE)
  else lines.push(`verify-range 실행 ${r.ci.runs} · 선택: ${Object.entries(r.ci.byChoice).map(([k, n]) => `${k} ${n}`).join(' · ') || '-'}`)
  const skippedTotal = r.problems.reduce((s, p) => s + p.skipped, 0)
  if (skippedTotal > 0) lines.push('', `⚠️ 손상으로 건너뛴 행: ${r.problems.filter((p) => p.skipped).map((p) => `${p.file} ${p.skipped}`).join(' · ')}`)
  return lines.join('\n')
}

export function renderJson(r: Report): string {
  return JSON.stringify(r, null, 2)
}

export function printHelp(): void {
  console.log(`commitgate report — 로컬 관측 요약(읽기 전용·비대화형)

사용법:
  npx commitgate report [--dir <대상repo>] [--json]

섹션:
  doctor    실행·티켓·검사별 발화/FAIL·WARN-only 비율·해소 관측(subjects 검사 한정)
  review    대상당 총 호출 분포·outcome·delta 비율·full 전환 사유·프롬프트/소요 분위수
  evidence  trunk 대비 verify-range 요약 + 최신 doctor의 D25/D30 대상
  ci        GitHub CI opt-in/생략 선택 분포

원천: workflow/.doctor-runs.jsonl · .review-calls.jsonl · .verify-runs.jsonl (로컬 전용).
없는 원천은 "데이터 없음"으로 표기합니다 — 추정하지 않습니다.

하지 않는 일: 파일 쓰기 · 네트워크 · 유료 호출 · 게이트 배선.
exit: 사용 오류만 1, 그 외 0(데이터 부재도 0 — 진단이 아니라 요약입니다).
`)
}

export function runCli(argv: string[]): void {
  try {
    const opts = parseArgs(argv)
    const report = collectReport(opts.dir)
    console.log(opts.json ? renderJson(report) : renderHuman(report))
  } catch (err) {
    if (err instanceof HelpRequested) {
      printHelp()
      return
    }
    console.error(`commitgate report: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  }
}

const isMain = isEntrypoint(import.meta.url)
if (isMain) runCli(process.argv.slice(2))
