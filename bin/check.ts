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
import { resolve, join } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { loadConfig, packageRoot, DEFAULTS, type ResolvedConfig } from '../scripts/req/lib/config'
import { collectInstallSignals } from '../scripts/req/lib/setup-gate'
import { createGitAdapter } from '../scripts/req/lib/adapters'
import { planSync } from './sync'
// 🔴 명령 표면 판정·입력 획득·안내 문장의 **정본**(REQ-2026-161 DEC-1/DEC-4). D33과 같은 것을 쓴다.
import { missingReqScripts, readPackageScripts, commandSurfaceMessage } from '../scripts/req/lib/command-surface'
// 🔴 REQ-2026-165: 업그레이드 축 판정. `check` 는 티켓 없이 도는 유일한 명령이라 **8축 전부**를 여기서 낸다
//    (`req:doctor` 는 REQ id 를 요구해 업그레이드 직후엔 쓸 수 없다).
import {
  evaluateUpgradeAxes,
  countByKind,
  unprotectedRepoRootScratch,
  type AxisReport,
  type UpgradeStatusInput,
} from '../scripts/req/lib/upgrade-status'
import { UPGRADE_CANONICAL_DOC } from '../scripts/req/lib/upgrade-axes'

/**
 * 🔴 **소비자 repo 에서 도달 가능한** 정본 표 주소(phase-3 r01 P1).
 *
 * `docs/` 는 npm 패키지에 **넣지 않는다**(설계 DEC-5 — 설치 사본이 stale 해질 새 축을 만들지 않는다).
 * 그래서 repo-상대 경로(`docs/upgrade.md`)를 그대로 찍으면 **소비자 프로젝트에는 없는 파일**을
 * 가리킨다 — 이 REQ 가 고치려는 "안내가 도달하지 않는다" 를 스스로 재현하는 셈이다. URL 로 낸다.
 *
 * 🔴 README(패키지에 동봉됨)가 같은 URL 을 담는지 **테스트가 대조**한다 — 주소가 갈라지지 않게.
 */
export const UPGRADE_DOC_URL = `https://github.com/sol5288/commitgate/blob/main/${UPGRADE_CANONICAL_DOC.ko}`
import { quickstartBackfillTargets } from './quickstart'
// 🔴 폐기 주장 목록·매칭 로직의 **정본**을 그대로 쓴다. 사본을 만들면 한쪽만 갱신돼 조용히 거짓이 된다.
import { retiredClaimsIn, type RetiredClaim } from '../scripts/req/lib/retired-claims'
import { I2_APPROVAL } from '../scripts/req/lib/control-points'
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
  id: 'C1' | 'C2' | 'C3' | 'C4' | 'C5' | 'C6' | 'C7'
  level: CheckLevel
  msg: string
}

/** C5 입력 — 계약 파일 본문(부재는 null). 호출부가 읽어 넘긴다(순수 판정 유지). */
export interface ContractFile {
  rel: string
  content: string | null
}

/**
 * C5가 검사하는 계약 파일. `AGENTS.md`는 사용자 소유이고 `sync`가 **덮어쓰지 않는다** —
 * 그래서 업그레이드해도 옛 계약이 그대로 남는다. 그 사실을 조기에 **알리기만** 한다.
 */
export const CONTRACT_FILES = ['AGENTS.md', 'AGENTS.commitgate.md'] as const

/** 사용자가 실제로 열어볼 수 있는 **정확한** 비교 대상 경로(Stage B 설치 위치). */
export const TEMPLATE_COMPARE_PATH = 'node_modules/commitgate/AGENTS.template.md'

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
  /** 계약 파일 본문(C5). 읽기는 호출부가 한다 — `runChecks`는 순수하게 유지한다. */
  contracts: ContractFile[]
  /**
   * C6 입력 — 대상 repo `package.json`의 `scripts` 맵(REQ-2026-161).
   *
   * 🔴 읽기는 `lib/command-surface`의 `readPackageScripts` **하나**가 한다(설계 DEC-1). 소비자가 각자
   *    읽으면 부재·파싱실패·비객체 처리가 갈라져 C6와 D33이 다른 판정을 낸다.
   * `null` = 읽지 못함(= 판정 불가). `undefined` = 미수집(2-arg/legacy 테스트 리터럴 무손상).
   *
   * 🔴 값 타입이 `unknown`인 것이 중요하다 — 존재 판정은 `init`의 `k in scripts`와 같아야 하고,
   *    문자열로 좁히면 `"req:new": null` 같은 키가 **부재로 읽혀** 진단과 백필이 갈라진다(phase-2 r02 P1).
   */
  packageScripts?: Record<string, unknown> | null
  /**
   * C6 dogfood skip — 패키지 루트와 대상 루트가 **다른가**(= 실제 소비 설치본인가).
   *
   * 🔴 **skip이 없으면 이 저장소 자신이 WARN이 된다**(설계 r01 P1). 여기 `package.json`의 `req:*`는
   *    5개(Stage A 형태)뿐인데 `VERB_MODULES`의 `req:*`는 12개다. `req:doctor`의 D20/D21/D22가 쓰는
   *    것과 **같은 기준**이다.
   * `undefined` = 미계산 → 점검 불요.
   */
  packageRootDiffers?: boolean
  /**
   * C7 입력 — 업그레이드 축 판정 결과(REQ-2026-165).
   *
   * 🔴 판정은 `lib/upgrade-status` 가 **순수하게** 하고, 파일·git 접근은 `collectUpgradeStatusInput` 이
   *    한다. `runChecks` 는 지금처럼 순수하게 남는다.
   * `undefined` = 미수집 → 점검 불요.
   */
  upgradeAxes?: AxisReport[]
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

  // C5 — 업그레이드 소비자의 **오래된 계약 문서**(0.22.0 최종 보완).
  //
  // 🔴 WARN이지 FAIL이 아니다. 문서가 낡았다는 이유로 기존 소비자의 작업·커밋을 막으면 안 된다 —
  //    이 진단의 목적은 차단이 아니라 **업그레이드 직후 눈에 띄게 하는 것**이다.
  // 🔴 check는 어떤 파일도 쓰지 않는다. AGENTS.md는 사용자 소유이고 프로젝트 고유 내용이 섞여 있어
  //    자동 교체는 그 내용을 지운다. 그래서 **수동 병합을 안내**한다.
  const contractHits: { rel: string; claims: RetiredClaim[] }[] = []
  for (const f of inp.contracts) {
    if (f.content === null) continue // 파일 부재는 점검 불요다(설치 형태에 따라 정상)
    const claims = retiredClaimsIn(f.content)
    if (claims.length > 0) contractHits.push({ rel: f.rel, claims })
  }
  if (contractHits.length === 0) {
    checks.push({ id: 'C5', level: 'OK', msg: '계약 문서에 폐기된 CommitGate 서술 없음(AGENTS.md · AGENTS.commitgate.md)' })
  } else {
    // 🔴 **찾은 문장을 그대로 보여준다.** 사유(why)만 내면 사용자는 자기 파일 어디를 고쳐야 하는지
    //    모른다 — 검색 가능한 원문(text)이 있어야 실행 가능한 안내다.
    // 🔴 CLI 출력이므로 Markdown 강조(`**`)를 쓰지 않는다. 터미널에는 기호가 그대로 보인다.
    const found = contractHits
      .flatMap((h) => h.claims.map((c) => `  - ${h.rel}: "${c.text}"\n      → ${c.why}`))
      .join('\n')
    checks.push({
      id: 'C5',
      level: 'WARN',
      msg:
        '기존 계약 문서에 폐기된 CommitGate 서술이 있습니다(도구는 파일을 고치지 않습니다):\n' +
        `${found}\n` +
        '  현재 정책: CommitGate는 GitHub CI를 자동으로 실행하지 않고, CI green을 통합·릴리즈의 전제로 강제하지 않습니다\n' +
        `             (명시 요청 시에만 workflow_dispatch). I2 정본 승인 문장: "${I2_APPROVAL}"\n` +
        '             주의: 저장소 자체 워크플로는 push·tag·PR로 자동 실행될 수 있습니다 — 실제 트리거는 .github/workflows/*.yml 에서 확인하십시오.\n' +
        `  조치: ${TEMPLATE_COMPARE_PATH} 와 비교해 CommitGate 계약 부분만 수동으로 병합하십시오\n` +
        '        (프로젝트 고유 내용이 지워질 수 있어 자동 교체하지 않습니다).',
    })
  }

  // C6 — 설치본의 `req:*` **명령 표면**이 설치된 패키지보다 좁은가(REQ-2026-161).
  //
  // 🔴 WARN이지 FAIL이 아니다. 스크립트 하나가 없다고 기존 작업을 막으면 REQ-2026-087이 되돌린
  //    실수의 반복이다. 이 진단의 목적은 차단이 아니라 **업그레이드 직후 눈에 띄게 하는 것**이다.
  // 🔴 판정은 D33과 **같은 술어**를 쓴다(`missingReqScripts`) — 두 표면이 갈라지지 않는다.
  if (inp.packageRootDiffers === false)
    checks.push({ id: 'C6', level: 'OK', msg: 'req:* 명령 표면 점검 불요(dev repo/dogfood — packageRoot === 대상 root)' })
  else if (inp.packageRootDiffers === undefined || inp.packageScripts === undefined)
    checks.push({ id: 'C6', level: 'OK', msg: 'req:* 명령 표면 점검 불요(미계산)' })
  else if (inp.packageScripts === null)
    // 🔴 읽지 못한 것을 "부족"으로 말하지 않는다 — C1 실패 시 C4가 취하는 것과 같은 규율.
    checks.push({ id: 'C6', level: 'OK', msg: 'req:* 명령 표면 점검 불요(package.json 의 scripts 를 읽지 못함)' })
  else {
    const missing = missingReqScripts(inp.packageScripts)
    checks.push({
      id: 'C6',
      level: missing.length === 0 ? 'OK' : 'WARN',
      msg: commandSurfaceMessage(missing),
    })
  }

  // C7 — 업그레이드 축 전체(REQ-2026-165).
  //
  // 🔴 **축마다 항목 id 를 만들지 않는다.** 항목 id 는 에이전트가 소비하는 안정 계약이고(기존 테스트가
  //    순서를 고정한다), 축은 등록부에서 늘어난다 — id 를 축에 묶으면 축을 늘릴 때마다 소비자 계약이 깨진다.
  // 🔴 **WARN 상한.** 업그레이드가 안 끝났다는 이유로 exit 1 이 되면 CI·에이전트가 죽는다.
  // 🔴 `unknown`(판정 불가)은 조치로 세지 않는다 — 모르는 것을 결함으로 말하지 않는다.
  if (inp.upgradeAxes === undefined) {
    checks.push({ id: 'C7', level: 'OK', msg: '업그레이드 축 점검 불요(미계산)' })
  } else {
    const n = countByKind(inp.upgradeAxes)
    const lines = inp.upgradeAxes
      .filter((r) => r.state.kind !== 'ok')
      .map((r) => `  - ${r.axis.id.padEnd(20)}: ${r.state.detail}${r.state.kind === 'action' ? ` → ${r.axis.remedy}` : ''}`)
    const head = `업그레이드 축 ${inp.upgradeAxes.length}개 — 조치 ${n.action} · 정상 ${n.ok} · 사람 확인 ${n.manual} · 판정 불가 ${n.unknown}`
    checks.push({
      id: 'C7',
      level: n.action > 0 ? 'WARN' : 'OK',
      msg:
        lines.length === 0
          ? head
          : [head, ...lines, `  전체 표: ${UPGRADE_DOC_URL}`].join('\n'),
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

/** 계약 파일 **읽기 전용** 수집(C5). 없으면 content=null — 쓰기·생성은 하지 않는다. */
export function collectContracts(dir: string): ContractFile[] {
  return CONTRACT_FILES.map((rel) => {
    const abs = join(dir, rel)
    return { rel, content: existsSync(abs) ? readFileSync(abs, 'utf8') : null }
  })
}


/**
 * 🔴 repo-root 런타임 스크래치 경로. **정본은 `req:doctor` 의 D22 배열**이고 여기는 사본이다 —
 *    `DOCTOR_RUN_LOG_REL`(req-doctor)·`REVIEW_CALL_LOG_REL`(review-codex)을 import 하면 `check` 가
 *    그 두 모듈의 그래프를 통째로 끌어온다(설계 DEC-4 가 금한 것). 대신 **테스트가 정본과 대조**해
 *    드리프트를 red 로 만든다 — 축이 늘면 양쪽을 함께 늘려야 한다.
 */
export const CHECK_SCRATCH_PATHS: readonly string[] = ['workflow/.review-calls.jsonl', 'workflow/.doctor-runs.jsonl']

/**
 * 업그레이드 축 판정 입력을 모은다(IO). 판정 자체는 `evaluateUpgradeAxes`(순수)가 한다 — 설계 DEC-2.
 *
 * 🔴 **하나라도 실패해서 죽지 않는다.** 진단이 도구를 깨뜨리면 안 되므로, 못 읽은 축은 값을 비워
 *    `unknown` 으로 흐르게 둔다("부족"이 아니다).
 */
export function collectUpgradeStatusInput(dir: string): UpgradeStatusInput {
  const root = resolve(dir)
  const cfgRes = loadConfigResult(root)
  const cfg = cfgRes.ok ? cfgRes.cfg : null
  const git = createGitAdapter(root)

  const sha = (abs: string): string | null => {
    try {
      return createHash('sha256').update(readFileSync(abs)).digest('hex')
    } catch {
      return null
    }
  }
  const safe = <T,>(f: () => T): T | undefined => {
    try {
      return f()
    } catch {
      return undefined
    }
  }

  return {
    packageRootDiffers: packageRoot() !== root,
    // 🔴 자산 축의 전제(REQ-2026-166 DEC-1). `setup-gate` 의 술어를 **그대로** 부른다 — 재구현하면
    //    `req:doctor` D24 와 갈라져 "doctor 는 설치로 보는데 check 는 아니라는" 상태가 생긴다.
    installSignals: safe(() => collectInstallSignals(root, cfg?.ticketRoot ?? DEFAULTS.ticketRoot)) ?? null,
    packageScripts: readPackageScripts(root),
    packagedSchemaSha: sha(join(packageRoot(), 'workflow', 'machine.schema.json')),
    vendoredSchemaSha: cfg ? sha(cfg.schemaPathAbs) : null,
    schemaPathIsDefault: cfg ? cfg.schemaPathAbs === resolve(root, DEFAULTS.schemaPath) : undefined,
    unprotectedScratch: safe(() => unprotectedRepoRootScratch(CHECK_SCRATCH_PATHS, (a) => git.exec(a))),
    quickstartBackfill: safe(() => quickstartBackfillTargets(root)),
    personaState: cfg ? personaStateOf(root, cfg) : undefined,
    contractClaimFiles: collectContracts(root)
      .filter((f) => f.content !== null && retiredClaimsIn(f.content).length > 0)
      .map((f) => f.rel),
  }
}

/**
 * persona 축 상태. 🔴 `sync` 의 자산 판정을 **재구현하지 않는다** — 같은 규칙(기본 경로 여부·존재·내용
 * 일치)을 `planSync` 결과에서 읽는다.
 */
function personaStateOf(root: string, cfg: ResolvedConfig): UpgradeStatusInput['personaState'] {
  try {
    const plan = planSync(root, cfg, true)
    const p = plan.assets.find((a) => a.axis === 'persona')
    if (!p) return null
    if (p.status === 'unmanaged-custom' || p.status === 'unmanaged-null') return 'unmanaged'
    if (p.status === 'new') return 'missing'
    if (p.status === 'in-sync') return 'in-sync'
    return 'differs'
  } catch {
    return null
  }
}

export function collectInputs(dir: string, probes = createReviewerProbes()): CheckInputs {
  return {
    config: loadConfigResult(dir),
    version: probes.version(),
    auth: probes.auth(),
    contracts: collectContracts(dir),
    // 🔴 C6 입력 수집(REQ-2026-161). 읽기는 `readPackageScripts` 하나가 하고, 판정은 `runChecks`가 한다.
    packageScripts: readPackageScripts(dir),
    packageRootDiffers: packageRoot() !== resolve(dir),
    // REQ-2026-165: 8축 전부. `req:doctor` 는 REQ id 를 요구해 업그레이드 직후엔 쓸 수 없다.
    upgradeAxes: evaluateUpgradeAxes(collectUpgradeStatusInput(dir)),
  }
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
  C5  계약 문서(AGENTS.md · AGENTS.commitgate.md)의 폐기된 CommitGate 서술
      (업그레이드 후 남은 옛 계약 = WARN — 커밋을 막지 않습니다. 수동 병합 안내만 합니다)
  C6  package.json 의 req:* 명령 표면이 설치된 패키지보다 좁은가
      (업그레이드로 늘어난 verb 가 설치본에 없음 = WARN — 커밋을 막지 않습니다.
       \`sync --apply --scripts\` 로 없는 키만 채우도록 안내만 합니다.
       dev repo/dogfood(packageRoot === 대상 root)에서는 점검하지 않습니다)

  C7  업그레이드 축 8종의 현재 상태(자산·명령 표면·관리 블록·persona·설치 형태·계약 문구·caret 범위)
      조치가 필요한 축은 그 명령과 함께 냅니다 = WARN — 커밋을 막지 않습니다.
      🔴 티켓 없이 도는 유일한 명령이라 여기서 전부 봅니다(req:doctor 는 REQ id 를 요구합니다).
      업그레이드 후에는 이 항목이 시키는 대로만 하면 됩니다.

exit: FAIL이 하나라도 있으면 1, 아니면 0. (C5 · C6 · C7 WARN 은 exit 0 입니다)

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
