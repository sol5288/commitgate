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
import { buildReport, type Report, type EvidenceRange } from '../scripts/req/lib/report'
import { verifyRangeDeep, type DeepVerifyReport } from '../scripts/req/lib/verify-range'
import { readBlobsAtRef } from '../scripts/req/lib/git-batch'
import { collectDeepInput } from './verify-range'

export interface Opts {
  dir: string
  json: boolean
  /** REQ-2026-128(0.22): evidence 범위 지정. 미지정 = trunk와의 merge-base..HEAD. */
  base: string | null
  head: string | null
  last: number | null
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
  let base: string | null = null
  let head: string | null = null
  let last: number | null = null
  const takeValue = (flag: string, v: string | undefined): string => {
    if (v === undefined || v.startsWith('-')) throw new Error(`${flag} 에 값이 필요합니다 (받음: ${v ?? '(없음)'})`)
    return v
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dir') dir = takeValue(a, argv[++i])
    else if (a === '--base') base = takeValue(a, argv[++i])
    else if (a === '--head') head = takeValue(a, argv[++i])
    else if (a === '--last') {
      const v = takeValue(a, argv[++i])
      last = Number.parseInt(v, 10)
      if (!Number.isInteger(last) || last < 1) throw new Error(`--last 는 1 이상의 정수여야 합니다 (받음: ${v})`)
    } else if (a === '--json') json = true
    else if (a === '-h' || a === '--help') throw new HelpRequested()
    else throw new Error(`알 수 없는 옵션: ${a}`)
  }
  if (base !== null && last !== null) throw new Error('--base 와 --last 는 함께 쓸 수 없습니다(범위 기준이 둘이 됩니다)')
  return { dir: resolve(dir), json, base, head, last }
}

/** 로그 파일 읽기 — 부재는 null(섹션 부재로 흐른다 — 추정 금지). */
function readLog(rootAbs: string, rel: string): string | null {
  const abs = join(rootAbs, ...rel.split('/'))
  return existsSync(abs) ? readFileSync(abs, 'utf8') : null
}

/**
 * evidence 범위 verify — 계산 불가(trunk 없음·git 실패)는 null(섹션 부재).
 * 🔴 심층 수집(REQ-2026-127)을 verify-range CLI와 공유한다 — manifest당 `git show` N+1이었던
 *    0.21 경로(실측 ~29.5초)를 cat-file --batch 배치로 대체(REQ-2026-128).
 */
function tryVerifyRange(rootAbs: string, ticketRoot: string, trunkBranch: string | null, opts: Opts): { report: DeepVerifyReport; range: EvidenceRange } | null {
  try {
    const git = createGitAdapter(rootAbs)
    const headSha = git.exec(['rev-parse', '--verify', `${opts.head ?? 'HEAD'}^{commit}`]).trim()
    let baseSha: string
    let source: EvidenceRange['source']
    if (opts.base !== null) {
      baseSha = git.exec(['rev-parse', '--verify', `${opts.base}^{commit}`]).trim()
      source = 'explicit'
    } else if (opts.last !== null) {
      // HEAD~N이 이력보다 깊으면 루트까지로 좁힌다(전 범위) — 실패보다 정직한 축소.
      try {
        baseSha = git.exec(['rev-parse', '--verify', `${headSha}~${opts.last}^{commit}`]).trim()
      } catch {
        baseSha = git.exec(['rev-list', '--max-parents=0', headSha]).trim().split('\n')[0] as string
      }
      source = 'last'
    } else {
      if (trunkBranch === null) return null
      baseSha = git.exec(['merge-base', trunkBranch, headSha]).trim()
      source = 'merge-base'
    }
    const report = verifyRangeDeep(collectDeepInput(git, (ref, paths) => readBlobsAtRef(rootAbs, ref, paths), baseSha, headSha, ticketRoot))
    return {
      report,
      range: { base: baseSha, head: headSha, source, empty: baseSha === headSha, generatedAt: new Date().toISOString() },
    }
  } catch {
    return null
  }
}

export function collectReport(dir: string, opts?: Pick<Opts, 'base' | 'head' | 'last'>): Report {
  const cfg = loadConfig({ root: dir })
  const rangeOpts: Opts = { dir, json: false, base: opts?.base ?? null, head: opts?.head ?? null, last: opts?.last ?? null }
  return buildReport({
    doctorRuns: readLog(cfg.root, 'workflow/.doctor-runs.jsonl'),
    reviewCalls: readLog(cfg.root, 'workflow/.review-calls.jsonl'),
    verifyRuns: readLog(cfg.root, 'workflow/.verify-runs.jsonl'),
    verifyRange: tryVerifyRange(cfg.root, cfg.ticketRoot, cfg.trunkBranch, rangeOpts),
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
    if (d.v2 === null) {
      lines.push('  ("검사별 적용 가능 수"는 v1 행에서 계산할 수 없습니다 — 0.22의 스키마 v2 행이 쌓이면 여기 나옵니다)')
    } else {
      lines.push(`  [스키마 v2 — ${d.v2.rows}실행 기준${d.v2.v1Rows ? ` · 구버전 v1 행 ${d.v2.v1Rows}건은 분모 계산 불가로 제외` : ''}]`)
      for (const c of d.v2.checks) {
        if (c.fired === 0 && c.notApplicable === 0) continue
        const rate = c.applicable > 0 ? ` (발화율 ${Math.round((100 * c.fired) / c.applicable)}%)` : ''
        lines.push(`    ${c.id}: 적용 가능 ${c.applicable} · 발화 ${c.fired}${rate} · FAIL ${c.fail} · 차단 ${c.blocked}${c.notApplicable ? ` · 해당없음 ${c.notApplicable}` : ''}`)
      }
      const rc = Object.entries(d.v2.reasonCodes).sort((a, b) => b[1] - a[1])
      if (rc.length) lines.push(`    reason: ${rc.map(([k, n]) => `${k} ${n}`).join(' · ')}`)
      lines.push('    (무발화 = 이 창에서 조건이 없었다는 뜻이지 검사가 무가치하다는 뜻이 아닙니다)')
    }
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
  if (!r.evidence) lines.push('(판정 불가 — trunk 없음·git 실패, 또는 미계산. --base <ref>로 범위를 지정할 수 있습니다)')
  else {
    const e = r.evidence
    lines.push(`검증 범위: ${e.range.base.slice(0, 8)}..${e.range.head.slice(0, 8)} (${e.range.source}) · 계산 시각 ${e.range.generatedAt}`)
    if (e.range.empty)
      lines.push('  빈 범위 — base==head(trunk 위 기본 실행 등). 과거 이력을 보려면 --base <ref> 또는 --last <N>을 지정하세요.')
    lines.push(
      `커밋 분류: 승인 소비 ${e.counts.approved} · 부기 ${e.counts.bookkeeping} · 머지 ${e.counts.merge} · attested ${e.counts.attested} · 손상 증거 ${e.counts['invalid-evidence']} · 미입증 ${e.counts.unproven}`,
    )
    for (const n of e.verificationNotes) lines.push(`  ℹ️ ${n}`)
    for (const inv of e.invalid) lines.push(`  ✗ ${inv.sha.slice(0, 8)} ${inv.subject} — ${inv.problems[0] ?? ''}`)
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
                        [--base <ref>] [--head <ref>] [--last <N>]

범위(evidence 섹션):
  기본은 trunk와의 merge-base..HEAD 입니다. trunk 위에서는 빈 범위(0 커밋)가 되므로,
  과거 이력을 보려면 --base <ref>(예: v0.21.0) 또는 --last <N>(HEAD~N..HEAD)을 지정하세요.
  --head 로 검증 대상 끝점을 바꿀 수 있습니다. --base 와 --last 는 동시 지정 불가.

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
    const report = collectReport(opts.dir, opts)
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
