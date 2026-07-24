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

/** codex 실행자(주입 가능 — 테스트). stdout 반환, 실패 시 throw. */
export type CodexRunner = (args: string[], input: string, cwd: string) => string
const defaultCodexRunner: CodexRunner = (args, input, cwd) =>
  // shell 없이 안전 실행(safeSpawnSync/cross-spawn). 프롬프트는 stdin(input)으로 전달.
  // ⚠️ 과거 `shell:true`는 args(schemaPath·resumeThreadId 등)의 메타문자로 **명령 주입**이 가능했고 공백 경로도 깨졌음 — P1 수정.
  safeSpawnSync('codex', args, { cwd, input, maxBuffer: 64 * 1024 * 1024 })

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
 * Codex `--output-schema`용 **strict copy** 파생(REQ-2026-005 + REQ-2026-018). 원본 스키마
 * (`workflow/machine.schema.json`)는 **검증 SSOT로 불변**이고, codex 호출 직전에만 아래 두 가지를 적용한 copy를 파생한다.
 * 응답/archive 검증은 계속 원본으로 한다.
 *
 * 1. **root `required` = `properties` 전체 키**(REQ-2026-005) — OpenAI structured-outputs strict mode는 root required가
 *    properties의 모든 키를 포함해야 한다. optional 필드(예: observations)가 있으면 400 invalid_json_schema.
 *    중첩 객체(findings/observations items)는 이미 모든 필드 required + additionalProperties:false라 root만 확장하면 충분.
 * 2. **`findings[].severity` = `["P1"]`**(REQ-2026-018) — 차단 채널에 P2/P3가 들어오지 못하게 구조적으로 막는다.
 *    상세 근거는 `narrowFindingsSeverityToP1` 참조.
 */
export function deriveStrictOutputSchema(schemaText: string): string {
  const schema = JSON.parse(schemaText) as { properties?: Record<string, unknown>; required?: string[]; [k: string]: unknown }
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
export function createFakeReviewerAdapter(result: ReviewResult): ReviewerAdapter & { requests: ReviewRequest[] } {
  const requests: ReviewRequest[] = []
  return {
    requests,
    review(req: ReviewRequest): ReviewResult {
      requests.push(req)
      return result
    },
  }
}
