#!/usr/bin/env tsx
/**
 * commitgate check — **비대화형** 진단 verb (REQ-2026-061).
 *
 * `setup`(대화형 전용·사람만)의 **거울상**이다. 역할을 완전히 갈라 놓으면 "setup은 대화형 전용"이라는
 * 규칙에 예외가 생기지 않는다(REQ-2026-060 §4.1). 에이전트·CI가 자유롭게 호출한다.
 *
 * 🔴 **읽기 전용이다.** 질문하지 않고, 파일을 쓰지 않고, 아무것도 고치지 않는다. 로그인이 필요하면
 *    `commitgate setup`을 **안내만** 한다(실행은 대화형이 필요하므로 setup의 소관).
 * 🔴 **어떤 게이트에도 배선되지 않는다.** `req:commit`이 `req:doctor`를 하드 게이트로 spawn하는 것과 다르다 —
 *    `check`는 어디서도 spawn되지 않으므로 exit code가 무엇이든 기존 워크플로를 막지 않는다.
 *    그래서 D19~D23을 WARN 상한으로 묶은 제약이 여기엔 적용되지 않고, FAIL이 exit 1을 낼 수 있다.
 */
import { resolve } from 'node:path'
import { loadConfig, type ResolvedConfig } from '../scripts/req/lib/config'
import {
  createReviewerProbes,
  codexMissingCheckMessage,
  type AuthProbeResult,
  type VersionProbeResult,
} from '../scripts/req/lib/adapters'
import { isEntrypoint } from '../scripts/req/lib/cli-boundary'

/** `req:doctor`와 같은 어휘(사용자가 이미 아는 등급). */
export type CheckLevel = 'OK' | 'WARN' | 'FAIL'

export interface CheckItem {
  id: 'C1' | 'C2' | 'C3' | 'C4'
  level: CheckLevel
  msg: string
}

export interface CheckReport {
  /** FAIL 0건인가. exit code의 근거(DEC-4). */
  ok: boolean
  checks: CheckItem[]
  summary: { ok: number; warn: number; fail: number }
}

/** 설정 로드 결과 — `loadConfig`의 throw를 진단으로 흡수한 형태(DEC-6). */
export type ConfigResult = { ok: true; cfg: ResolvedConfig } | { ok: false; error: string }

export interface CheckInputs {
  config: ConfigResult
  version: VersionProbeResult
  auth: AuthProbeResult
}

/**
 * 진단 판정(**순수** — DEC-2). config 읽기·probe 호출은 호출부가 수집해 넘긴다.
 * `req:doctor`의 `checks(inp)`와 같은 관례라 테스트가 live codex 없이 전 분기를 돈다.
 */
export function runChecks(inp: CheckInputs): CheckReport {
  const checks: CheckItem[] = []

  // C1 — req.config.json 파싱·스키마.
  if (inp.config.ok) checks.push({ id: 'C1', level: 'OK', msg: 'req.config.json 유효(또는 부재 — 기본값 사용)' })
  else checks.push({ id: 'C1', level: 'FAIL', msg: `req.config.json 문제: ${inp.config.error}` })

  // C2 — 리뷰어 CLI 설치.
  if (inp.version.ok)
    checks.push({ id: 'C2', level: 'OK', msg: `리뷰어 CLI 확인: ${inp.version.version ?? '(버전 미상)'}` })
  else
    checks.push({
      id: 'C2',
      level: 'FAIL',
      msg: codexMissingCheckMessage(inp.version.detail),
    })

  // C3 — 로그인. 🔴 `unknown`은 WARN이지 FAIL이 아니다(DEC-3).
  //    auth probe는 승인 무결성 게이트가 아니라 **진단**이고, codex가 출력 문자열을 바꾸면 unknown이
  //    대량 발생한다. FAIL로 두면 진단이 곧 오탐 경보가 된다. 실제 미인증이면 리뷰 호출이 스스로 fail-closed 한다.
  if (inp.auth.state === 'logged-in')
    checks.push({ id: 'C3', level: 'OK', msg: `리뷰어 로그인 확인${inp.auth.detail ? `: ${inp.auth.detail}` : ''}` })
  else if (inp.auth.state === 'logged-out')
    checks.push({
      id: 'C3',
      level: 'FAIL',
      msg: '리뷰어에 로그인돼 있지 않습니다 — 리뷰 호출이 실패하고 그 시도가 리뷰 예산까지 차감합니다. `npx commitgate setup`(대화형) 또는 `codex login` 으로 로그인하세요.',
    })
  else
    checks.push({
      id: 'C3',
      level: 'WARN',
      msg: `로그인 상태를 판정할 수 없습니다(${inp.auth.reason}${inp.auth.detail ? `: ${inp.auth.detail}` : ''}). 리뷰를 막지는 않습니다 — 미인증이면 리뷰 호출이 스스로 실패합니다.`,
    })

  // C4 — 모델·추론강도 핀. C1이 실패했으면 값을 알 수 없으므로 **점검 불요**로 남긴다(같은 원인을 두 번 세지 않는다).
  if (!inp.config.ok) {
    checks.push({ id: 'C4', level: 'OK', msg: '모델·추론강도 점검 불요(C1 실패로 설정을 읽을 수 없음)' })
  } else {
    const unpinned: string[] = []
    if (inp.config.cfg.reviewModel === null) unpinned.push('reviewModel')
    if (inp.config.cfg.reviewReasoningEffort === null) unpinned.push('reviewReasoningEffort')
    if (unpinned.length === 0)
      checks.push({
        id: 'C4',
        level: 'OK',
        msg: `리뷰 모델·추론강도 고정: ${inp.config.cfg.reviewModel} / ${inp.config.cfg.reviewReasoningEffort}`,
      })
    else
      checks.push({
        id: 'C4',
        level: 'WARN',
        msg: `${unpinned.join(', ')} 이(가) 비어 있어 codex 전역 설정을 상속합니다 — 리뷰 비용과 재현성이 고정되지 않습니다. \`npx commitgate setup\` 으로 지정할 수 있습니다.`,
      })
  }

  const summary = {
    ok: checks.filter((c) => c.level === 'OK').length,
    warn: checks.filter((c) => c.level === 'WARN').length,
    fail: checks.filter((c) => c.level === 'FAIL').length,
  }
  return { ok: summary.fail === 0, checks, summary }
}

/** 사람용 렌더링. `--json`과 **같은 report에서 파생**한다(두 출력이 갈라지지 않는다 — DEC-5). */
export function renderHuman(report: CheckReport): string {
  const lines = report.checks.map((c) => `[${c.level}] ${c.id}: ${c.msg}`)
  lines.push(
    report.ok
      ? `PASS — OK ${report.summary.ok} · WARN ${report.summary.warn}`
      : `FAIL — OK ${report.summary.ok} · WARN ${report.summary.warn} · FAIL ${report.summary.fail}`,
  )
  return lines.join('\n')
}

/** 기계용 렌더링(DEC-5). 사람용 줄을 **섞지 않는다** — 파이프 소비자가 파싱에 실패한다. */
export function renderJson(report: CheckReport): string {
  return JSON.stringify(report, null, 2)
}

export interface Opts {
  dir: string
  json: boolean
}

/** `-h/--help` 신호(오류가 아니다). */
export class HelpRequested extends Error {
  constructor() {
    super('help')
    this.name = 'HelpRequested'
  }
}

/**
 * 인자 파싱(fail-closed): 값 누락·알 수 없는 옵션은 즉시 throw.
 *
 * 🔴 **값 자리에 온 옵션을 값으로 삼키지 않는다**(phase-1 r01 P1). `--dir --json`처럼 값을 빠뜨리면
 *    `--json`이 경로로 소비되어 **JSON 모드가 켜지지 않은 채 존재하지 않는 `<cwd>/--json`을 진단**하고,
 *    codex가 정상인 환경에서는 그것이 **exit 0으로 성공**한다 — 잘못된 호출이 조용히 통과하는 fail-closed 우회다.
 *    그래서 다음 토큰이 없거나 `-`로 시작하면 오류로 본다.
 */
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

/**
 * 설정 로드 — **throw를 진단으로 흡수**한다(DEC-6). 그대로 두면 가장 흔한 진단 대상(깨진 설정)이
 * 스택트레이스로 죽어 `check` 자체가 무용해진다.
 *
 * 🔴 root는 `--dir`(기본 cwd)를 **명시**한다. `resolveRoot`의 package-root fallback에 기대면
 *    설정이 없는 소비자 repo에서 **패키지 자신**을 진단할 수 있다(`config.ts:203-210`).
 */
export function loadConfigResult(dir: string): ConfigResult {
  try {
    return { ok: true, cfg: loadConfig({ root: dir }) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export function collectInputs(dir: string, probes = createReviewerProbes()): CheckInputs {
  return { config: loadConfigResult(dir), version: probes.version(), auth: probes.auth() }
}

export function printHelp(): void {
  console.log(`commitgate check — 설정·리뷰어 가용성 진단(비대화형·읽기 전용)

사용법:
  npx commitgate check [--dir <대상repo>] [--json]

옵션:
  --dir <path>   대상 repo 루트(기본: 현재 디렉터리)
  --json         기계용 JSON 출력(사람용 줄을 섞지 않습니다)
  -h, --help     도움말

점검 항목:
  C1  req.config.json 파싱·스키마
  C2  리뷰어 CLI(codex) 설치
  C3  리뷰어 로그인 (판정 불가 = WARN — 리뷰를 막지 않습니다)
  C4  리뷰 모델·추론강도 고정 여부

exit: FAIL이 하나라도 있으면 1, 아니면 0.

하지 않는 일:
  질문 · 파일 쓰기 · 자동 수정 · 로그인 실행(대화형이라 \`commitgate setup\` 소관) ·
  게이트 배선(이 명령은 어디서도 spawn되지 않습니다).
`)
}

/**
 * 🔴 이 `runCli`는 `lib/cli-boundary`의 `makeRunCli`를 **일부러 쓰지 않는다**(REQ-2026-105 DEC-4).
 *    `HelpRequested`는 오류가 아니라 **제어 흐름**이다 — 잡아서 도움말을 찍고 **정상 종료**한다.
 *    공용 경계의 계약은 "예외 → 한 줄 + exit 1"이고, 여기에 예외 클래스·핸들러를 파라미터로 뚫으면
 *    그 계약이 "예외 → 경우에 따라 정상 종료"로 약해진다. 호출자 3개를 위해 공용 계약을 넓히지 않는다.
 *    (`isEntrypoint`는 별개 관심사라 아래에서 공유한다.)
 */
export function runCli(argv: string[]): void {
  try {
    const opts = parseArgs(argv)
    const report = runChecks(collectInputs(opts.dir))
    console.log(opts.json ? renderJson(report) : renderHuman(report))
    if (!report.ok) process.exitCode = 1
  } catch (err) {
    if (err instanceof HelpRequested) {
      printHelp()
      return
    }
    console.error(`commitgate check: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  }
}

const isMain = isEntrypoint(import.meta.url)
if (isMain) runCli(process.argv.slice(2))
