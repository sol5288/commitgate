/**
 * req 워크플로 어댑터 모듈 (REQ-2026-017 Phase 3, portability kit).
 *
 * 목적: git·codex(reviewer) 호출을 **얇은 경계 인터페이스**로 추상화 — plumbing 로직·승인 바인딩은 불변.
 *   - GitAdapter: 모든 git 호출을 단일 경계로(default = execFileSync('git', …, {cwd: root})). 비-git VCS는 후속 확장 여지.
 *   - ReviewerAdapter: codex 호출(exec/resume + thread 파싱 + --output-last-message)을 단일 경계로. 테스트는 FakeReviewerAdapter로 live codex 없이 검증.
 *
 * 안전(fail-closed): codex 미설치/실패는 default 구현이 그대로 throw(silent 금지, D-017-4·D-017-7).
 * 본 모듈은 req 스크립트에 의존하지 않는 leaf(순환 의존 금지) — parseThreadId도 여기로 이동(codex CLI 전용 로직).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import spawn from 'cross-spawn'

// ─────────────────────────────────────────────── 안전 spawn (P1) ──

/** safeSpawnSync 옵션(필요분만). stdio 미지정 = 'pipe'(stdout 반환). */
export interface SafeSpawnOptions {
  cwd?: string
  input?: string
  stdio?: 'pipe' | 'inherit'
  maxBuffer?: number
}

/**
 * 크로스플랫폼 **안전** 동기 spawn. cross-spawn으로 **shell 없이** 실행한다.
 * - 인자의 shell 메타문자(`& | < > ^ " ' 백틱 $ ; ( ) ! %` 등)가 별도 명령으로 해석되지 않는다(명령 주입 차단).
 * - 공백 포함 경로도 올바르게 전달된다(shell:true는 인용을 안 해 깨졌음).
 * - Windows의 `.cmd` 래퍼(codex·npm·pnpm·yarn)도 안전하게 해소한다(과거 `shell:true`가 필요했던 이유를 대체).
 * 실패(spawn 오류·exit≠0)면 throw(fail-closed — 기존 execFileSync 의미 보존).
 */
export function safeSpawnSync(file: string, args: readonly string[], opts: SafeSpawnOptions = {}): string {
  const res = spawn.sync(file, args as string[], {
    cwd: opts.cwd,
    input: opts.input,
    stdio: opts.stdio ?? 'pipe',
    maxBuffer: opts.maxBuffer ?? 64 * 1024 * 1024,
  })
  if (res.error) throw res.error
  if (res.status !== 0) {
    const err = res.stderr ? res.stderr.toString('utf8') : ''
    throw new Error(`명령 실패(exit=${res.status ?? 'null'}): ${file}\n${err}`.trim())
  }
  return res.stdout ? res.stdout.toString('utf8') : ''
}

/**
 * `safeSpawnSync`의 **exit code 보존** 변형 (REQ-2026-050 D5).
 *
 * `safeSpawnSync`는 non-zero를 전부 실패로 보고 throw한다. 그러나 **non-zero가 정상 신호**인 명령이 있다 —
 * `git diff --no-index`는 두 파일 내용이 다르면 exit **1**을 낸다(정상 결과이지 오류가 아니다).
 * 그런 명령에 `safeSpawnSync`를 쓰면 정상 결과를 오류로 오판한다.
 *
 * 🔴 **새 spawn 경로를 만드는 것이 아니다.** shell 없는 `cross-spawn` 단일 경로(주입 차단 경계)를 그대로
 *    재사용하고, 달라지는 것은 **exit code 해석을 호출자에게 넘긴다**는 것뿐이다. 어떤 code가 정상인지는
 *    명령마다 다르므로 여기서 정책을 갖지 않는다.
 *
 * spawn 자체의 실패(`res.error` — 예: git 부재 ENOENT)는 여기서도 throw한다. 그건 code 해석의 문제가 아니다.
 */
export function safeSpawnSyncStatus(
  file: string,
  args: readonly string[],
  opts: SafeSpawnOptions = {},
): { status: number | null; stdout: string; stderr: string } {
  const res = spawn.sync(file, args as string[], {
    cwd: opts.cwd,
    input: opts.input,
    stdio: opts.stdio ?? 'pipe',
    maxBuffer: opts.maxBuffer ?? 64 * 1024 * 1024,
  })
  if (res.error) throw res.error
  return {
    status: res.status,
    stdout: res.stdout ? res.stdout.toString('utf8') : '',
    stderr: res.stderr ? res.stderr.toString('utf8') : '',
  }
}

// ──────────────────────────────────────────────────────────── Git ──

/** git 호출 경계(D-017-3). exec(args) = trim된 stdout, 실패 시 throw(fail-closed). */
export interface GitAdapter {
  exec(args: string[]): string
}

/** GitAdapter default 구현의 내부 실행자(주입 가능 — 테스트). encoding:'utf8'이라 string 반환. */
export type GitRunner = (file: string, args: string[], opts: { cwd: string; encoding: 'utf8'; maxBuffer: number }) => string
const defaultGitRunner: GitRunner = (file, args, opts) => execFileSync(file, args, opts)

/**
 * **부재가 정상인 조회** 전용 runner — git의 stderr를 버린다 (REQ-2026-058 F-5).
 *
 * `git show HEAD:<path>` 류는 "아직 커밋되지 않음"이 **정상 상태**이고 호출부가 `catch → null`로 처리한다.
 * 그런데 `execFileSync`는 기본적으로 자식 stderr를 부모로 흘리므로, 정상 경로에서
 * `fatal: path '…' does not exist in 'HEAD'`가 사용자 화면에 뜬다 — 실패로 오해된다(Nuxt 소비자 감사 실측).
 *
 * 🔴 **전역으로 쓰지 말 것.** 진짜 오류(권한·손상·잠금)의 진단까지 사라진다. `bin/init.ts`의
 *    `assertGitWorkTree`가 probe 전용 quiet runner를 쓰는 것과 같은 좁은 용도다.
 * ⚠️ 판정은 바뀌지 않는다 — 실패는 여전히 throw이고 호출부의 `catch`가 부재로 해석한다.
 */
export const quietGitRunner: GitRunner = (file, args, opts) =>
  execFileSync(file, args, { ...opts, stdio: ['ignore', 'pipe', 'ignore'] })

/** git stdout 상한 — codex 경로(safeSpawnSync)와 동일 64 MiB. 큰 staged diff/status에서 Node 기본 1 MiB의 ENOBUFS throw 방지. */
const GIT_MAX_BUFFER = 64 * 1024 * 1024

/**
 * default GitAdapter — `execFileSync('git', args, {cwd: root, encoding:'utf8', maxBuffer})` 후 **trailing 공백만 제거**.
 * ⚠️ `.trim()`이 아니라 `.replace(/\s+$/, '')` — `git status --porcelain`의 **선행 공백(XY 코드)**을 보존(behavior-preserving).
 * maxBuffer=64MiB: `git diff --cached`/`git show :<path>`가 1 MiB 기본 상한을 넘겨 codex 호출 전에 하드 실패하는 것 방지.
 */
export function createGitAdapter(root: string, run: GitRunner = defaultGitRunner): GitAdapter {
  return { exec: (args) => run('git', args, { cwd: root, encoding: 'utf8', maxBuffer: GIT_MAX_BUFFER }).replace(/\s+$/, '') }
}

// ──────────────────────────────────── Reviewer 가용성 probe (REQ-2026-060) ──

/**
 * 리뷰어 CLI 로그인 상태(설계 DEC-9). **3분류**다 — `unknown`을 `logged-out`에 합치면 출력 포맷이 바뀐 날
 * 잘못된 단정을 하게 된다.
 */
export type ReviewerAuthState = 'logged-in' | 'logged-out' | 'unknown'

/** 판정 원인(메시지 sniffing 대신 타입). */
export type AuthProbeReason = 'ok' | 'not-installed' | 'probe-failed' | 'unrecognized-output'

export interface AuthProbeResult {
  state: ReviewerAuthState
  reason: AuthProbeReason
  /** 사람이 읽을 진단(원본 출력의 첫 줄 등). */
  detail: string
}

export interface VersionProbeResult {
  ok: boolean
  /** 예: `codex-cli 0.144.1`. 실패면 null. */
  version: string | null
  detail: string
}

/**
 * codex 미설치를 말하는 **모든 런타임 표면**이 함께 주는 다음 명령(REQ-2026-083 DEC-2).
 *
 * 🔴 왜 상수인가: 표면마다 문자열을 따로 쓰면 새 표면이 생길 때 또 빠진다. REQ-2026-082가 `--help`만
 *    고치고 `installGuidance`·`setup`·`check`를 놓친 것이 정확히 그 실패다. 표기(`npm i -g` vs
 *    `npm install -g`)도 여기 한 곳에서 정한다.
 *
 * 🔴 왜 "새 터미널"까지 적는가: Windows 에서 전역 설치 직후 `codex` 를 못 찾는 것은 PATH 갱신 문제인데,
 *    이때 사용자는 **설치가 실패했다고 오해**한다. 설치 명령만 주면 같은 자리에서 두 번 막힌다.
 */
export const CODEX_INSTALL_HINT = '설치: npm i -g @openai/codex  (설치 후 새 터미널에서 codex --version)'

/**
 * codex 를 실행할 수 없을 때 각 표면이 내는 메시지 빌더.
 *
 * 🔴 `tests/unit/codex-missing-guidance.test.ts` 가 이 함수들을 한 배열로 모아 **전부**
 *    `CODEX_INSTALL_HINT` 를 포함하는지 검사한다. 새 표면을 추가하면 빌더를 여기 만들고 그 배열에도 등록한다.
 */
export function codexMissingSetupMessage(detail: string): string {
  return `codex CLI 를 실행할 수 없습니다(${detail}). 설치·PATH 를 확인한 뒤 다시 실행하세요 — 설정을 저장하지 않았습니다.\n${CODEX_INSTALL_HINT}`
}

/** `check` C2 실패 메시지. 읽기 전용 진단이므로 **차단이 아니라 사실**만 말한다. */
export function codexMissingCheckMessage(detail: string): string {
  return `리뷰어 CLI(codex)를 실행할 수 없습니다(${detail}). 이 상태에서는 리뷰가 실패합니다. ${CODEX_INSTALL_HINT}`
}

/** `init` 설치 후 안내의 codex 확인 줄. 아직 막히지 않은 시점이라 **예방 안내**다. */
export function codexMissingInstallGuidanceLine(): string {
  return `codex --version   # 리뷰 실호출 전제 — 없으면 ${CODEX_INSTALL_HINT}`
}

/** "로그인 안 됨" 신호. **긍정 패턴보다 먼저** 본다 — `Not logged in`은 `logged in`을 포함한다. */
const LOGGED_OUT_RE = /not\s+logged\s+in|logged\s+out|not\s+authenticated|please\s+(run\s+)?.*login/i
/** "로그인 됨" 신호. 실측: `Logged in using ChatGPT`(exit 0, **stdout**). */
const LOGGED_IN_RE = /logged\s+in/i

/**
 * `codex login status` 출력 → 상태(순수·테스트 가능, 설계 DEC-9).
 *
 * 🔴 **stdout과 stderr를 함께 본다.** 이 저장소는 "stderr만 읽는데 codex는 에러를 stdout에 쓴다"로 이미
 *    데인 적이 있다. 실측에서도 결과는 stdout이었다.
 * 🔴 **exit code 단독으로 판정하지 않는다.** 로그아웃 상태의 exit code를 실측하지 못했기 때문이다
 *    (로그아웃할 수 없었다). 그래서 텍스트를 먼저 보고, 알아볼 수 없으면 `unknown`으로 남긴다.
 */
export function classifyAuthOutput(status: number | null, stdout: string, stderr: string): AuthProbeResult {
  const text = `${stdout}\n${stderr}`
  const detail = (stdout.trim() || stderr.trim()).split('\n')[0]?.trim() ?? ''
  if (LOGGED_OUT_RE.test(text)) return { state: 'logged-out', reason: 'ok', detail }
  if (LOGGED_IN_RE.test(text)) return { state: 'logged-in', reason: 'ok', detail }
  // 텍스트를 알아볼 수 없다. non-zero면 probe 자체가 실패했을 가능성이 크지만, 어느 쪽이든 **단정하지 않는다**.
  return {
    state: 'unknown',
    reason: status === 0 ? 'unrecognized-output' : 'probe-failed',
    detail: detail || `exit=${status ?? 'null'}`,
  }
}

/** 리뷰어 CLI 가용성·인증 probe 묶음. spawn 주입으로 테스트 가능. */
export interface ReviewerProbes {
  version(): VersionProbeResult
  auth(): AuthProbeResult
  /**
   * 🔴 **대화형 로그인**(설계 DEC-8). `stdio:'inherit'`로 사용자에게 터미널을 그대로 넘긴다.
   *
   * ⚠️ **맨 `codex login`만 실행한다.** `--with-api-key`/`--with-access-token`은 **쓰지 않는다** —
   *    그 변형만이 비밀값을 stdin으로 받으며, commitgate가 이를 파이프하면 자격증명이 이 프로세스를
   *    통과해 에러 메시지·로그로 샐 표면이 생긴다. 브라우저 OAuth는 값이 이 프로세스를 지나가지 않는다.
   */
  login(): { status: number | null }
}

export function createReviewerProbes(spawnStatus: StatusSpawn = safeSpawnSyncStatus, bin = 'codex'): ReviewerProbes {
  return {
    version() {
      try {
        const r = spawnStatus(bin, ['--version'])
        const version = (r.stdout.trim() || r.stderr.trim()).split('\n')[0]?.trim() || null
        if (r.status !== 0) return { ok: false, version: null, detail: `exit=${r.status ?? 'null'}` }
        return { ok: true, version, detail: version ?? '' }
      } catch (err) {
        // spawn 자체 실패(ENOENT 등) = 미설치.
        return { ok: false, version: null, detail: err instanceof Error ? err.message : String(err) }
      }
    },
    auth() {
      let r: { status: number | null; stdout: string; stderr: string }
      try {
        r = spawnStatus(bin, ['login', 'status'])
      } catch (err) {
        return { state: 'unknown', reason: 'not-installed', detail: err instanceof Error ? err.message : String(err) }
      }
      return classifyAuthOutput(r.status, r.stdout, r.stderr)
    },
    login() {
      // stdio:'inherit' — 출력을 캡처하지 않고 사용자 터미널로 그대로 흘린다(브라우저 플로우 대기).
      const r = spawnStatus(bin, ['login'], { stdio: 'inherit' })
      return { status: r.status }
    },
  }
}

// ─────────────────────────────────────────────── Reviewer (codex) ──

export interface ReviewRequest {
  prompt: string
  schemaPath: string
  resumeThreadId: string | null
  cwd: string
  /** REQ-2026-013 P1: codex `-c model=` override. null = 생략(전역 상속). */
  model: string | null
  /** REQ-2026-013 P1: codex `-c model_reasoning_effort=` override. null = 생략. */
  reasoningEffort: string | null
}
export interface ReviewResult {
  rawStdout: string
  lastMessage: string
  threadId: string | null
}
/** codex 리뷰 경계(D-017-4). default=codex CLI, 테스트=FakeReviewerAdapter. */
export interface ReviewerAdapter {
  review(req: ReviewRequest): ReviewResult
}

/** `codex exec --json` JSONL에서 thread.started.thread_id 추출(0차 실측). 없으면 null. (review-codex에서 이동) */
export function parseThreadId(jsonl: string): string | null {
  for (const line of jsonl.split('\n')) {
    const t = line.trim()
    if (!t) continue
    try {
      const ev = JSON.parse(t) as { type?: string; thread_id?: string }
      if (ev.type === 'thread.started' && typeof ev.thread_id === 'string') return ev.thread_id
    } catch {
      // JSONL 외 라인 무시
    }
  }
  return null
}

/**
 * 리뷰 호출 실패의 **타입된 분류**(REQ-2026-054·DEC-C1). 예산 환불·lifecycle 판정이 메시지 문자열 sniffing이
 * 아니라 이 타입으로 결정된다.
 * - `pre-dispatch`: reviewer subprocess가 **기동조차 못 함**(spawn 실패·ENOENT). 청구 불가 → 환불 대상.
 * - `dispatched`: subprocess는 떴으나 사용 가능한 결과 없음(non-zero exit·thread_id 없음). 청구 가능성 → 차감.
 */
export class ReviewCallError extends Error {
  readonly dispatchPhase: 'pre-dispatch' | 'dispatched'
  constructor(dispatchPhase: 'pre-dispatch' | 'dispatched', message: string) {
    super(message)
    this.name = 'ReviewCallError'
    this.dispatchPhase = dispatchPhase
  }
}

/** codex 실행자(주입 가능 — 테스트). stdout 반환, 실패 시 throw(`ReviewCallError`로 dispatch 단계 분류). */
export type CodexRunner = (args: string[], input: string, cwd: string) => string

/** status 보존 spawn 함수 타입(주입 seam — `safeSpawnSyncStatus` 서명). */
export type StatusSpawn = (file: string, args: readonly string[], opts?: SafeSpawnOptions) => { status: number | null; stdout: string; stderr: string }

/**
 * codex 러너 팩토리(REQ-2026-054·DEC-C1). spawn을 주입해 분류 로직을 테스트 가능하게 한다.
 * - spawn 자체 실패(`res.error` throw — ENOENT 등): subprocess 미기동 = `pre-dispatch`(청구 불가·환불 대상).
 * - `res.status !== 0`(subprocess는 떴고 non-zero — usage limit 등 모델 부분 실행 가능): `dispatched`(차감).
 */
export function makeCodexRunner(spawn: StatusSpawn): CodexRunner {
  return (args, input, cwd) => {
    // shell 없이 안전 실행(cross-spawn). 프롬프트는 stdin(input). 과거 `shell:true`의 명령 주입/공백 경로 결함 방지.
    let res: { status: number | null; stdout: string; stderr: string }
    try {
      res = spawn('codex', args, { cwd, input, maxBuffer: 64 * 1024 * 1024 })
    } catch (err) {
      throw new ReviewCallError('pre-dispatch', `codex 실행(spawn) 실패 — subprocess 미기동: ${err instanceof Error ? err.message : String(err)}`)
    }
    if (res.status !== 0)
      throw new ReviewCallError('dispatched', `codex 종료 코드 ${res.status ?? 'null'}: ${res.stderr.trim()}`.trim())
    return res.stdout
  }
}

const defaultCodexRunner: CodexRunner = makeCodexRunner(safeSpawnSyncStatus)

/** unknown → 평범한 객체(배열·null 제외). 스키마 경로 탐색용. */
function asPlainObject(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/**
 * 출력 스키마의 `findings[].severity`를 **P1만** 허용하도록 좁힌다(REQ-2026-018 D2).
 *
 * **왜 출력 스키마에서만 강제하는가(D1)**: 검증 SSOT(`machine.schema.json`)의 enum을 P1로 좁히면 P2/P3를 담은
 * **기존 archive가 전부 invalid**가 된다(하위호환 파괴). 반면 목표는 "리뷰어가 P2를 findings에 **낼 수 없게**"이므로
 * 리뷰어가 실제로 보는 출력 스키마 한 곳만 좁히면 충분하다. 그러면 비차단 지적은 `observations`로 갈 수밖에 없고,
 * `classifyReview`의 "findings 있으면 차단"은 고칠 필요 없이 그대로 옳아진다.
 *
 * **왜 조용히 건너뛰지 않고 throw하는가(D3)**: 건너뛰면 P2가 다시 차단 채널로 들어오는 **정책 구멍**이 열리는데,
 * 그 구멍은 스키마가 깨진 순간에만 열려 아무도 눈치채지 못한다. throw는 리뷰 실패 = 승인 불가 = fail-closed.
 * `machine_schema_version`이 `1.1`로 고정된 MANAGED 파일이므로 정상 경로에서 이 throw는 발생하지 않는다.
 */
function narrowFindingsSeverityToP1(schema: Record<string, unknown>): void {
  const properties = asPlainObject(schema.properties)
  const findings = asPlainObject(properties?.findings)
  const items = asPlainObject(findings?.items)
  const itemProps = asPlainObject(items?.properties)
  const severity = asPlainObject(itemProps?.severity)
  if (!severity || !Array.isArray(severity.enum)) {
    throw new Error(
      '출력 스키마 파생 실패: `properties.findings.items.properties.severity.enum` 경로가 없음 — ' +
        'findings를 P1 전용(차단)으로 강제할 수 없어 중단합니다(REQ-2026-018 D3, fail-closed).',
    )
  }
  severity.enum = ['P1']
}

/**
 * 출력 스키마에서 `deprecated: true`로 표시된 root property를 **탈락**시킨다(REQ-2026-084 DEC-2).
 *
 * **왜 SSOT가 아니라 copy에서 지우는가**: root가 `additionalProperties: false`이므로 SSOT에서 property 정의를
 * 지우면 그 필드를 담은 **기존 archive가 전부 구조 부적합**이 된다(D17/D9가 archive를 재검증한다).
 * `narrowFindingsSeverityToP1`과 동일한 구조적 이유이며 해법도 같다 — SSOT는 보존하고 copy만 좁힌다.
 *
 * **왜 `required` 재구성보다 먼저인가**: strict copy의 root `required`는 `Object.keys(properties)`로
 * 재구성되므로, 여기서 먼저 지우지 않으면 deprecated 필드가 **다시 required로 부활**해 리뷰어가 계속 방출한다.
 *
 * **왜 throw하지 않는가**: `narrowFindingsSeverityToP1`의 throw는 "P2가 차단 채널로 새는 정책 구멍"을 막는
 * fail-closed다. 여기서 지울 것이 없다는 건 요청 계약에 deprecated 필드가 애초에 없다는 뜻이라 구멍이 아니다.
 */
function dropDeprecatedProperties(schema: Record<string, unknown>): void {
  const properties = asPlainObject(schema.properties)
  if (!properties) return
  for (const key of Object.keys(properties)) {
    if (asPlainObject(properties[key])?.deprecated === true) delete properties[key]
  }
}

/**
 * Codex `--output-schema`용 **strict copy** 파생(REQ-2026-005 + REQ-2026-018 + REQ-2026-084). 원본 스키마
 * (`workflow/machine.schema.json`)는 **검증 SSOT로 불변**이고, codex 호출 직전에만 아래 세 가지를 적용한 copy를 파생한다.
 * 응답/archive 검증은 계속 원본으로 한다.
 *
 * 1. **`deprecated: true` root property 제거**(REQ-2026-084) — 더 이상 요청하지 않는 필드를 요청 계약에서 뺀다.
 *    **반드시 2번보다 먼저** — 뒤에 오면 `required` 재구성이 되살린다. 상세 근거는 `dropDeprecatedProperties` 참조.
 * 2. **root `required` = `properties` 전체 키**(REQ-2026-005) — OpenAI structured-outputs strict mode는 root required가
 *    properties의 모든 키를 포함해야 한다. optional 필드(예: observations)가 있으면 400 invalid_json_schema.
 *    중첩 객체(findings/observations items)는 이미 모든 필드 required + additionalProperties:false라 root만 확장하면 충분.
 * 3. **`findings[].severity` = `["P1"]`**(REQ-2026-018) — 차단 채널에 P2/P3가 들어오지 못하게 구조적으로 막는다.
 *    상세 근거는 `narrowFindingsSeverityToP1` 참조.
 */
export function deriveStrictOutputSchema(schemaText: string): string {
  const schema = JSON.parse(schemaText) as { properties?: Record<string, unknown>; required?: string[]; [k: string]: unknown }
  dropDeprecatedProperties(schema) // 🔴 required 재구성 **전**(REQ-2026-084 DEC-2)
  if (schema && typeof schema === 'object' && schema.properties && typeof schema.properties === 'object') {
    schema.required = Object.keys(schema.properties)
  }
  narrowFindingsSeverityToP1(schema)
  return JSON.stringify(schema)
}

/**
 * default ReviewerAdapter(codex CLI). exec(신규)/resume(thread_id) 분기 + `--output-last-message`(임시파일) 캡처 + thread 파싱.
 * - **read-only 리뷰어 강제(양 라운드, REQ-2026-006/R9)**: exec은 `--sandbox read-only`. resume은 `-s/--sandbox` 플래그를 **거부**하므로
 *   (`error: unexpected argument '--sandbox'` — spike 확인) `-c sandbox_mode="read-only"` **config override**로 read-only를 강제한다.
 *   행동 검증: resume(무 override)은 실제 write 성공(sandbox drop=갭 실재), resume(override)은 write가 `Access is denied`로 차단(enforced).
 *   `-c`가 향후 CLI에서 거부되면 resume 자체가 실패=fail-closed(리뷰 미승인).
 * - `--output-schema`에는 원본이 아니라 **strict 파생 copy**를 넘긴다(codex strict mode 400 방지, REQ-2026-005). 원본은 검증 SSOT.
 * - threadId: resume이면 resumeThreadId, exec이면 parseThreadId(stdout)(없으면 null → 호출처가 fail-closed).
 * - codex 미설치/실패 → runner가 throw(그대로 전파, fail-closed).
 */
export function createCodexReviewerAdapter(run: CodexRunner = defaultCodexRunner): ReviewerAdapter {
  return {
    review({ prompt, schemaPath, resumeThreadId, cwd, model, reasoningEffort }) {
      const tmpDir = mkdtempSync(join(tmpdir(), 'req-codex-'))
      const lastPath = join(tmpDir, 'last.json')
      // 원본(검증 SSOT)을 읽어 strict copy 파생 → temp에 기록 → --output-schema로 전달(archive 검증엔 원본 사용).
      const outputSchemaPath = join(tmpDir, 'output-schema.json')
      writeFileSync(outputSchemaPath, deriveStrictOutputSchema(readFileSync(schemaPath, 'utf8')), 'utf8')
      // REQ-2026-013 P1: 리뷰 모델·추론강도 override(D2·D2-1). null이면 생략(전역 상속).
      // 값은 TOML 문자열 리터럴(`sandbox_mode="read-only"`와 동형). 주입 안전은 스키마 제약(model=slug 패턴·effort=enum)이
      // `"`·개행을 입력단에서 차단하므로 조립부 escaping 불필요 — 이 안전은 config.ts CONFIG_SCHEMA에 의존한다.
      const overrideArgs: string[] = []
      if (model) overrideArgs.push('-c', `model="${model}"`)
      if (reasoningEffort) overrideArgs.push('-c', `model_reasoning_effort="${reasoningEffort}"`)
      // exec·resume 양쪽에 동일 주입(codex `-c`는 두 서브커맨드 모두 받음 — 실측).
      const args = resumeThreadId
        ? ['exec', 'resume', resumeThreadId, '-c', 'sandbox_mode="read-only"', ...overrideArgs, '--json', '--output-schema', outputSchemaPath, '--output-last-message', lastPath, '-']
        : ['exec', ...overrideArgs, '--json', '--sandbox', 'read-only', '--output-schema', outputSchemaPath, '--output-last-message', lastPath, '-']
      const rawStdout = run(args, prompt, cwd)
      const threadId = resumeThreadId ?? parseThreadId(rawStdout)
      const lastMessage = existsSync(lastPath) ? readFileSync(lastPath, 'utf8') : ''
      return { rawStdout, lastMessage, threadId }
    },
  }
}

/** 테스트 전용 ReviewerAdapter — canned 응답 반환 + 받은 요청 기록(live codex 없이 review-codex 플로 검증, 수용기준 #4). */
export function createFakeReviewerAdapter(
  result: ReviewResult,
  opts: {
    /**
     * REQ-2026-052: `true`(기본)면 응답의 `review_base_sha`를 **프롬프트의 `REVIEW_BASE_SHA`로 덮어쓴다**.
     * pre-call 원장 커밋이 HEAD를 옮겨 실제 approval base가 테스트 setup 시점의 head와 달라지므로, 고정
     * canned 응답의 base가 stale해진다. 프롬프트 base를 echo하면 near-e2e가 그 커밋을 신경 쓰지 않아도 된다.
     * base 불일치(invalid)를 **의도적으로** 테스트하려면 `echoPromptBase:false`로 끈다.
     */
    echoPromptBase?: boolean
  } = {},
): ReviewerAdapter & { requests: ReviewRequest[] } {
  const requests: ReviewRequest[] = []
  const echo = opts.echoPromptBase !== false
  return {
    requests,
    review(req: ReviewRequest): ReviewResult {
      requests.push(req)
      if (!echo) return result
      // 프롬프트에서 `REVIEW_BASE_SHA: <sha>` 추출.
      const m = /^REVIEW_BASE_SHA:\s*([0-9a-f]{7,64})\s*$/m.exec(req.prompt)
      if (!m) return result
      let parsed: unknown
      try {
        parsed = JSON.parse(result.lastMessage)
      } catch {
        return result // JSON이 아니면 손대지 않는다.
      }
      if (!parsed || typeof parsed !== 'object' || !('review_base_sha' in parsed)) return result
      const patched = { ...(parsed as Record<string, unknown>), review_base_sha: m[1] }
      return { ...result, lastMessage: JSON.stringify(patched) }
    },
  }
}
