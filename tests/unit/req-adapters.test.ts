import { describe, it, expect } from 'vitest'
import { writeFileSync, readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createGitAdapter,
  createCodexReviewerAdapter,
  createFakeReviewerAdapter,
  parseThreadId,
  safeSpawnSync,
  type CodexRunner,
} from '../../scripts/req/lib/adapters'
import { callReviewer } from '../../scripts/req/review-codex'

// ─────────────────────────────── safeSpawnSync 명령 주입 방어 (P1) ──
describe('[P1] safeSpawnSync — shell 메타문자 인자 주입 차단', () => {
  it('메타문자 인자가 별도 명령으로 실행되지 않고 리터럴로 전달됨(주입 없음)', () => {
    // node -e 스크립트만 실행되고, 뒤 인자는 process.argv로 리터럴 전달 → shell이면 `& echo INJECTED`가 돌지만 안 돌아야.
    const evil = 'x & echo INJECTED | echo PIPED > out.txt'
    const out = safeSpawnSync(process.execPath, ['-e', 'process.stdout.write("SAFE")', evil])
    expect(out).toBe('SAFE')
    expect(out).not.toContain('INJECTED')
    expect(out).not.toContain('PIPED')
  })

  it('메타문자 인자가 argv에 원문 그대로 도착(공백·특수문자 보존)', () => {
    const marker = 'A&B|C;D>E<F^G"H (I) !J% `K$'
    const script = 'process.stdout.write(JSON.stringify(process.argv.slice(1)))'
    const out = safeSpawnSync(process.execPath, ['-e', script, marker])
    expect(JSON.parse(out)).toEqual([marker])
  })

  it('exit≠0이면 throw(fail-closed)', () => {
    expect(() => safeSpawnSync(process.execPath, ['-e', 'process.exit(3)'])).toThrow(/exit=3/)
  })
})

// ─────────────────────────────────────────────────── GitAdapter ──
describe('Phase 3 — GitAdapter(createGitAdapter)', () => {
  it('git을 cwd=root·encoding utf8로 호출하고 trailing 공백만 제거(선행 공백 보존)', () => {
    const calls: Array<[string, string[], unknown]> = []
    const ga = createGitAdapter('/repo', (file, args, opts) => {
      calls.push([file, args, opts])
      return ' M a.ts\n M b.ts\n  ' // 선행 공백(XY 코드) + trailing 공백
    })
    const out = ga.exec(['status', '--porcelain'])
    expect(calls[0]).toEqual(['git', ['status', '--porcelain'], { cwd: '/repo', encoding: 'utf8' }])
    // ⚠️ .trim() 아님 — status --porcelain 선행 공백 보존, trailing만 제거
    expect(out).toBe(' M a.ts\n M b.ts')
  })

  it('exec 실패(non-zero)는 그대로 throw(fail-closed)', () => {
    const ga = createGitAdapter('/repo', () => {
      throw new Error('git failed')
    })
    expect(() => ga.exec(['rev-parse', 'HEAD'])).toThrow(/git failed/)
  })
})

// ─────────────────────────────────────────── ReviewerAdapter(codex) ──
describe('Phase 3 — codex ReviewerAdapter(createCodexReviewerAdapter)', () => {
  it('exec(신규): --sandbox read-only + thread.started 파싱 + lastMessage 캡처', () => {
    let seen: { args: string[]; input: string; cwd: string } | null = null
    const run: CodexRunner = (args, input, cwd) => {
      seen = { args, input, cwd }
      const p = args[args.indexOf('--output-last-message') + 1] as string
      writeFileSync(p, '{"status":"STEP_COMPLETE"}') // codex가 쓰는 --output-last-message를 테스트가 대신 기록
      return '{"type":"thread.started","thread_id":"tid-1"}\n{"type":"other"}'
    }
    const r = createCodexReviewerAdapter(run).review({ prompt: 'PROMPT', schemaPath: '/s.json', resumeThreadId: null, cwd: '/repo' })
    expect(seen!.args).toContain('--sandbox')
    expect(seen!.args).toContain('read-only')
    expect(seen!.args).toContain('--output-schema')
    expect(seen!.input).toBe('PROMPT')
    expect(seen!.cwd).toBe('/repo')
    expect(r.threadId).toBe('tid-1')
    expect(r.lastMessage).toBe('{"status":"STEP_COMPLETE"}')
  })

  it('resume: exec resume <tid> + --sandbox 없음 + threadId=resumeThreadId(stdout 파싱 안 함)', () => {
    let captured: string[] = []
    const run: CodexRunner = (args) => {
      captured = args
      const p = args[args.indexOf('--output-last-message') + 1] as string
      writeFileSync(p, 'RESP')
      return '' // resume은 thread.started 없음
    }
    const r = createCodexReviewerAdapter(run).review({ prompt: 'P', schemaPath: '/s', resumeThreadId: 'tid-existing', cwd: '/r' })
    expect(captured.slice(0, 3)).toEqual(['exec', 'resume', 'tid-existing'])
    expect(captured).not.toContain('--sandbox')
    expect(r.threadId).toBe('tid-existing')
    expect(r.lastMessage).toBe('RESP')
  })

  it('codex 미설치/실패 → review가 그대로 throw(fail-closed, D-017-4/7)', () => {
    const rv = createCodexReviewerAdapter(() => {
      throw new Error('codex ENOENT')
    })
    expect(() => rv.review({ prompt: 'P', schemaPath: '/s', resumeThreadId: null, cwd: '/r' })).toThrow(/codex ENOENT/)
  })
})

// ───────────────────────────────────────── FakeReviewerAdapter ──
describe('Phase 3 — FakeReviewerAdapter(createFakeReviewerAdapter)', () => {
  it('canned 응답 반환 + 받은 요청 기록', () => {
    const rv = createFakeReviewerAdapter({ rawStdout: 'R', lastMessage: 'L', threadId: 'T' })
    const r = rv.review({ prompt: 'P', schemaPath: '/s', resumeThreadId: 'rt', cwd: '/c' })
    expect(r).toEqual({ rawStdout: 'R', lastMessage: 'L', threadId: 'T' })
    expect(rv.requests).toHaveLength(1)
    expect(rv.requests[0]).toEqual({ prompt: 'P', schemaPath: '/s', resumeThreadId: 'rt', cwd: '/c' })
  })
})

// ─────────────────────────────────────────────── parseThreadId ──
describe('Phase 3 — parseThreadId(adapters로 이동)', () => {
  it('thread.started에서 thread_id 추출', () => {
    expect(parseThreadId('{"type":"thread.started","thread_id":"abc"}\n{"x":1}')).toBe('abc')
  })
  it('thread.started 없으면 null, 비-JSONL 라인 무시', () => {
    expect(parseThreadId('plain text\n{"type":"other"}')).toBe(null)
    expect(parseThreadId('')).toBe(null)
  })
})

// ─── callReviewer: review-codex 플로(fake reviewer로 live codex 없이 검증, 수용기준 #4) ──
describe('Phase 3 — callReviewer(review-codex 플로 이음새)', () => {
  it('FakeReviewerAdapter lastMessage를 respPath에 기록 + threadId 반환 + 요청 전달', () => {
    const dir = mkdtempSync(join(tmpdir(), 'req-cr-'))
    const respPath = join(dir, 'codex-response.json')
    const rv = createFakeReviewerAdapter({ rawStdout: '', lastMessage: '{"status":"STEP_COMPLETE"}', threadId: 'tid-1' })
    const { threadId } = callReviewer(rv, { prompt: 'P', schemaPath: '/s', resumeThreadId: null, cwd: dir, respPath })
    expect(threadId).toBe('tid-1')
    expect(readFileSync(respPath, 'utf8')).toBe('{"status":"STEP_COMPLETE"}')
    expect(rv.requests[0]).toEqual({ prompt: 'P', schemaPath: '/s', resumeThreadId: null, cwd: dir })
  })

  it('threadId 없으면(exec에서 thread.started 누락) fail-closed throw', () => {
    const dir = mkdtempSync(join(tmpdir(), 'req-cr-'))
    const rv = createFakeReviewerAdapter({ rawStdout: '', lastMessage: 'X', threadId: null })
    expect(() =>
      callReviewer(rv, { prompt: 'P', schemaPath: '/s', resumeThreadId: null, cwd: dir, respPath: join(dir, 'r.json') }),
    ).toThrow(/thread_id/)
  })
})
