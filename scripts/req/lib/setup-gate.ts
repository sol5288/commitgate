/**
 * setup 완료 게이트 (REQ-2026-062).
 *
 * 목적: `commitgate setup`을 거치지 않은 **신규 설치**가 워크플로 명령으로 바로 들어가는 것을 막는다.
 * 그 상태에서는 리뷰 모델·추론강도가 확인되지 않았고 codex 로그인도 안 됐을 수 있는데, 그 실패는 첫 리뷰
 * 호출에서야 드러나며 `dispatched`로 분류되어 **리뷰 예산까지 차감한다**(`adapters.ts`).
 *
 * 🔴 **기존 설치본을 벽돌로 만들지 않는다**(grandfather). 업그레이드 직후 진행 중이던 티켓이 있는 사용자가
 *    커밋도 리뷰도 못 하는 상태가 되면 안 된다 — 그 상황에서는 setup을 실행해도 `req.config.json`이 dirty해져
 *    상황이 더 나빠진다(추적 파일이라 clean-tree 게이트에 걸린다).
 *
 * 🔴 **이 모듈은 로그인 상태를 확인하지 않는다.** 마커는 커밋되는 파일에 있으므로 "이 프로젝트의 설정이
 *    끝났다"는 **팀 공유 사실**이고, 로그인은 개발자별이라 마커가 팀원의 인증을 보증하지 않는다.
 *    호출 시점 인증 확인은 별도 REQ(리뷰 preflight) 소관이다.
 *
 * 순수 판정(`setupGateVerdict`)과 IO 수집(`collectGateFacts`)을 분리한다 — `req-doctor`의 `checks(inp)`와 같은 관례.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { safeSpawnSyncStatus, type StatusSpawn } from './adapters'
import { stripBom } from './config'

/** `AGENTS.md`가 CommitGate 계약인지 판별하는 마커(`bin/init.ts`의 상수와 같은 문자열). */
const AGENTS_CONTRACT_MARKER = '<!-- commitgate:contract -->'

/** 게이트가 보는 사실(모두 호출부가 수집). */
export interface GateFacts {
  /** `req.config.json`의 `setup` 마커가 있는가. 파싱 실패는 `false`(있다고 단정하지 않는다). */
  hasMarker: boolean
  /** `state.id`가 디렉터리명과 일치하는 **유효** 티켓 수. 빈 디렉터리·껍데기는 세지 않는다. */
  validTickets: number
  /** CommitGate 설치를 식별하는 신호(사람이 읽는 라벨). */
  installSignals: string[]
}

export type GateVerdict =
  | { kind: 'pass'; reason: 'marker' | 'grandfathered'; evidence: string[] }
  | { kind: 'block'; message: string; evidence: string[] }

/** grandfather에 필요한 최소 설치 신호 수(설계 DEC-5). */
export const MIN_INSTALL_SIGNALS = 2

/**
 * 차단 메시지(설계 DEC-7).
 *
 * 🔴 **"실행하라"가 아니라 "요청하라"**다. `setup`은 대화형 전용 = 사람 전용 명령이므로
 *    (`AGENTS.md`의 "사람 전용 명령" 절), 에이전트가 이 메시지를 읽고 실행하면 비-TTY로 즉시 실패한다.
 */
export function blockMessage(evidence: string[]): string {
  return [
    'setup을 아직 마치지 않았습니다 — 워크플로 명령을 진행할 수 없습니다.',
    '',
    '  · 사용자가 터미널에서 직접 실행해야 합니다:  npx commitgate setup',
    '  · 에이전트(Claude/Codex)는 이 명령을 실행하지 않습니다 — 사용자에게 실행을 요청하세요.',
    '  · setup은 리뷰 모델·추론강도를 확인하고 codex 로그인까지 마칩니다.',
    '',
    `  판정 근거: ${evidence.length ? evidence.join(' · ') : '(설치 신호 없음)'}`,
    '  진단: npx commitgate check   (이 명령은 막히지 않습니다)',
  ].join('\n')
}

/**
 * 순수 판정(설계 DEC-4·DEC-5).
 *
 * - 마커가 있으면 통과.
 * - 없어도 **유효 티켓 ≥ 1 이고 설치 신호 ≥ 2**면 grandfather 통과 — 기존 설치본이다.
 * - 그 외(신규 설치)는 차단.
 *
 * 🔴 **`workflow/REQ-*` 디렉터리 하나만으로 통과시키지 않는다.** 복사된 과거 산출물이나 빈 디렉터리만으로
 *    신규 프로젝트가 **영구 grandfather**가 되기 때문이다. 그래서 티켓은 `state.id` 일치까지 확인하고,
 *    설치 신호를 복수로 요구한다.
 * 🔴 **판정 근거를 pass/block 양쪽에 담는다** — 근거가 안 보이면 오판을 아무도 못 잡는다.
 */
export function setupGateVerdict(facts: GateFacts): GateVerdict {
  const evidence = [
    `마커=${facts.hasMarker ? '있음' : '없음'}`,
    `유효티켓=${facts.validTickets}`,
    `설치신호=${facts.installSignals.length ? facts.installSignals.join('/') : '없음'}`,
  ]
  if (facts.hasMarker) return { kind: 'pass', reason: 'marker', evidence }
  if (facts.validTickets >= 1 && facts.installSignals.length >= MIN_INSTALL_SIGNALS)
    return { kind: 'pass', reason: 'grandfathered', evidence }
  return { kind: 'block', message: blockMessage(evidence), evidence }
}

/**
 * 게이트 root 해소(설계 DEC-3).
 *
 * 🔴 **`config.ts`의 `resolveRoot`를 쓰지 않는다.** 그건 `req.config.json`을 못 찾으면 **package root로
 *    fallback**하므로(`config.ts:203-210`), 설정이 없는 소비자 repo에서 **CommitGate 패키지 자신**을
 *    진단하게 된다. 더구나 "마커가 없는 상태"를 판정하는 게이트가 그 파일의 존재로 root를 찾으면 순환이다.
 *
 * 순서: ① 명시 root → ② `git rev-parse --show-toplevel` → ③ cwd.
 */
export function resolveGateRoot(
  opts: { root?: string | null; cwd?: string } = {},
  spawn: StatusSpawn = safeSpawnSyncStatus,
): string {
  if (opts.root) return opts.root
  const cwd = opts.cwd ?? process.cwd()
  try {
    const r = spawn('git', ['rev-parse', '--show-toplevel'], { cwd })
    const top = r.stdout.trim()
    if (r.status === 0 && top) return top
  } catch {
    // git 부재·비-git 디렉터리 → cwd로 떨어진다. `req:new`가 어차피 git repo를 요구하므로
    // 게이트가 그보다 먼저 죽을 이유가 없다.
  }
  return cwd
}

/** 티켓 디렉터리명 형식(`REQ-2026-001`). */
const TICKET_DIR_RE = /^REQ-\d{4}-\d{3,}$/

/**
 * 유효 티켓 수 — `state.json`이 파싱되고 `state.id`가 **디렉터리명과 일치**하는 것만 센다.
 * 빈 디렉터리·복사된 껍데기를 배제하는 것이 목적이다(수용기준 4).
 */
export function countValidTickets(root: string, ticketRoot: string): number {
  const dir = join(root, ticketRoot)
  if (!existsSync(dir)) return 0
  let n = 0
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return 0
  }
  for (const name of entries) {
    if (!TICKET_DIR_RE.test(name)) continue
    const statePath = join(dir, name, 'state.json')
    try {
      if (!statSync(join(dir, name)).isDirectory()) continue
      if (!existsSync(statePath)) continue
      const parsed = JSON.parse(stripBom(readFileSync(statePath, 'utf8'))) as { id?: unknown }
      if (parsed && typeof parsed.id === 'string' && parsed.id === name) n++
    } catch {
      // 손상된 티켓은 "유효"로 세지 않는다 — grandfather는 **실제로 쓰던 설치본**에만 준다.
    }
  }
  return n
}

/** CommitGate 설치를 식별하는 신호 수집(설계 DEC-5). 각 항목 1점. */
export function collectInstallSignals(root: string, ticketRoot: string): string[] {
  const signals: string[] = []
  try {
    const pkgPath = join(root, 'package.json')
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(stripBom(readFileSync(pkgPath, 'utf8'))) as { scripts?: Record<string, unknown> }
      if (pkg.scripts && Object.keys(pkg.scripts).some((k) => k.startsWith('req:'))) signals.push('req:* 스크립트')
    }
  } catch {
    // 읽을 수 없으면 신호가 없는 것으로 본다(추정하지 않는다).
  }
  if (existsSync(join(root, 'req.config.json'))) signals.push('req.config.json')
  if (existsSync(join(root, ticketRoot, 'machine.schema.json'))) signals.push('machine.schema.json')
  try {
    const agents = join(root, 'AGENTS.md')
    if (existsSync(agents) && readFileSync(agents, 'utf8').includes(AGENTS_CONTRACT_MARKER))
      signals.push('AGENTS.md 계약 마커')
  } catch {
    // 동일.
  }
  return signals
}

/** 마커 존재 여부 — 파싱 실패는 **`false`**다(있다고 단정하지 않는다 — fail-closed). */
export function hasSetupMarker(root: string): boolean {
  const p = join(root, 'req.config.json')
  if (!existsSync(p)) return false
  try {
    const parsed = JSON.parse(stripBom(readFileSync(p, 'utf8'))) as { setup?: unknown }
    const m = parsed?.setup
    return typeof m === 'object' && m !== null && typeof (m as { completedAt?: unknown }).completedAt === 'string'
  } catch {
    return false
  }
}

/** 사실 수집(IO). `ticketRoot`는 설정에서 오지만, 설정을 못 읽는 상황도 있으므로 기본값을 받는다. */
export function collectGateFacts(root: string, ticketRoot = 'workflow'): GateFacts {
  return {
    hasMarker: hasSetupMarker(root),
    validTickets: countValidTickets(root, ticketRoot),
    installSignals: collectInstallSignals(root, ticketRoot),
  }
}

/**
 * 워크플로 verb의 preflight 진입점. 차단이면 **throw**(fail-closed), 통과면 verdict를 돌려준다.
 * 호출부는 **가장 앞**에서 부른다 — 다른 어떤 IO·판정보다 먼저여야 부분 상태가 남지 않는다.
 */
export function assertSetupComplete(opts: { root?: string | null; cwd?: string; ticketRoot?: string } = {}): GateVerdict {
  const root = resolveGateRoot(opts)
  const verdict = setupGateVerdict(collectGateFacts(root, opts.ticketRoot ?? 'workflow'))
  if (verdict.kind === 'block') throw new Error(verdict.message)
  return verdict
}
