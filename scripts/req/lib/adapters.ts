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
import { existsSync, readFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// ──────────────────────────────────────────────────────────── Git ──

/** git 호출 경계(D-017-3). exec(args) = trim된 stdout, 실패 시 throw(fail-closed). */
export interface GitAdapter {
  exec(args: string[]): string
}

/** GitAdapter default 구현의 내부 실행자(주입 가능 — 테스트). encoding:'utf8'이라 string 반환. */
export type GitRunner = (file: string, args: string[], opts: { cwd: string; encoding: 'utf8' }) => string
const defaultGitRunner: GitRunner = (file, args, opts) => execFileSync(file, args, opts)

/**
 * default GitAdapter — `execFileSync('git', args, {cwd: root, encoding:'utf8'})` 후 **trailing 공백만 제거**.
 * ⚠️ `.trim()`이 아니라 `.replace(/\s+$/, '')` — `git status --porcelain`의 **선행 공백(XY 코드)**을 보존(behavior-preserving).
 */
export function createGitAdapter(root: string, run: GitRunner = defaultGitRunner): GitAdapter {
  return { exec: (args) => run('git', args, { cwd: root, encoding: 'utf8' }).replace(/\s+$/, '') }
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
  // Windows에서 codex는 .cmd 래퍼 → execFileSync는 shell 필요(Node 보안 변경). 프롬프트는 stdin(input)으로 전달(shell 파싱 영향 없음).
  execFileSync('codex', args, { cwd, input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: true })

/**
 * default ReviewerAdapter(codex CLI). exec(신규)/resume(thread_id) 분기 + `--output-last-message`(임시파일) 캡처 + thread 파싱.
 * - resume은 `--sandbox` 미수용(0차 실측) → 생략(정책 상속). exec은 `--sandbox read-only`.
 * - threadId: resume이면 resumeThreadId, exec이면 parseThreadId(stdout)(없으면 null → 호출처가 fail-closed).
 * - codex 미설치/실패 → runner가 throw(그대로 전파, fail-closed).
 */
export function createCodexReviewerAdapter(run: CodexRunner = defaultCodexRunner): ReviewerAdapter {
  return {
    review({ prompt, schemaPath, resumeThreadId, cwd }) {
      const lastPath = join(mkdtempSync(join(tmpdir(), 'req-codex-')), 'last.json')
      const args = resumeThreadId
        ? ['exec', 'resume', resumeThreadId, '--json', '--output-schema', schemaPath, '--output-last-message', lastPath, '-']
        : ['exec', '--json', '--sandbox', 'read-only', '--output-schema', schemaPath, '--output-last-message', lastPath, '-']
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
