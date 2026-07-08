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

/**
 * Codex `--output-schema`용 **strict copy** 파생(REQ-2026-005). OpenAI structured-outputs strict mode는
 * root `required`가 `properties`의 **모든 키**를 포함해야 한다 — optional 필드(예: observations)가 있으면 400 invalid_json_schema.
 * 원본 스키마(`workflow/machine.schema.json`)는 **검증 SSOT로 불변**(observations optional → 기존 archive 하위호환)이고,
 * codex 호출 직전에만 root.required를 `properties` 전체로 확장한 copy를 파생한다. 응답/archive 검증은 계속 원본으로 한다.
 * 중첩 객체(findings/observations items)는 이미 모든 필드 required + additionalProperties:false라 root만 확장하면 충분.
 */
export function deriveStrictOutputSchema(schemaText: string): string {
  const schema = JSON.parse(schemaText) as { properties?: Record<string, unknown>; required?: string[]; [k: string]: unknown }
  if (schema && typeof schema === 'object' && schema.properties && typeof schema.properties === 'object') {
    schema.required = Object.keys(schema.properties)
  }
  return JSON.stringify(schema)
}

/**
 * default ReviewerAdapter(codex CLI). exec(신규)/resume(thread_id) 분기 + `--output-last-message`(임시파일) 캡처 + thread 파싱.
 * - resume은 `--sandbox` 미수용(0차 실측) → 생략(정책 상속). exec은 `--sandbox read-only`.
 * - `--output-schema`에는 원본이 아니라 **strict 파생 copy**를 넘긴다(codex strict mode 400 방지, REQ-2026-005). 원본은 검증 SSOT.
 * - threadId: resume이면 resumeThreadId, exec이면 parseThreadId(stdout)(없으면 null → 호출처가 fail-closed).
 * - codex 미설치/실패 → runner가 throw(그대로 전파, fail-closed).
 */
export function createCodexReviewerAdapter(run: CodexRunner = defaultCodexRunner): ReviewerAdapter {
  return {
    review({ prompt, schemaPath, resumeThreadId, cwd }) {
      const tmpDir = mkdtempSync(join(tmpdir(), 'req-codex-'))
      const lastPath = join(tmpDir, 'last.json')
      // 원본(검증 SSOT)을 읽어 strict copy 파생 → temp에 기록 → --output-schema로 전달(archive 검증엔 원본 사용).
      const outputSchemaPath = join(tmpDir, 'output-schema.json')
      writeFileSync(outputSchemaPath, deriveStrictOutputSchema(readFileSync(schemaPath, 'utf8')), 'utf8')
      const args = resumeThreadId
        ? ['exec', 'resume', resumeThreadId, '--json', '--output-schema', outputSchemaPath, '--output-last-message', lastPath, '-']
        : ['exec', '--json', '--sandbox', 'read-only', '--output-schema', outputSchemaPath, '--output-last-message', lastPath, '-']
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
