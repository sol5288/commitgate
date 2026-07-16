import { describe, it, expect } from 'vitest'
import { writeFileSync, readFileSync, mkdtempSync, readdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv from 'ajv'
import {
  createGitAdapter,
  createCodexReviewerAdapter,
  createFakeReviewerAdapter,
  deriveStrictOutputSchema,
  parseThreadId,
  safeSpawnSync,
  type CodexRunner,
} from '../../scripts/req/lib/adapters'
import { callReviewer } from '../../scripts/req/review-codex'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** 모든 REQ 티켓의 `responses` 아카이브(.json)를 repo-relative 경로로 수집(REQ-2026-018 R3용). */
function listReviewArchives(): string[] {
  const workflowDir = join(REPO_ROOT, 'workflow')
  const out: string[] = []
  for (const ticket of readdirSync(workflowDir)) {
    if (!ticket.startsWith('REQ-')) continue
    const responses = join(workflowDir, ticket, 'responses')
    if (!existsSync(responses)) continue
    for (const f of readdirSync(responses)) {
      if (f.endsWith('.json')) out.push(join('workflow', ticket, 'responses', f))
    }
  }
  return out
}

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
    expect(calls[0]).toEqual(['git', ['status', '--porcelain'], { cwd: '/repo', encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }])
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
  // 원본 검증 스키마(observations는 optional — required에 없음). 어댑터가 이걸 읽어 strict copy를 파생.
  const writeValidationSchema = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'cg-schema-'))
    const p = join(dir, 's.json')
    writeFileSync(
      p,
      JSON.stringify({
        type: 'object',
        additionalProperties: false,
        required: ['status'],
        // findings[].severity 경로는 필수 — 어댑터의 출력 스키마 파생이 이를 P1 전용으로 좁히고,
        // 경로가 없으면 fail-closed로 throw한다(REQ-2026-018 D2·D3).
        properties: {
          status: { type: 'string' },
          observations: { type: 'array' },
          findings: {
            type: 'array',
            items: { type: 'object', properties: { severity: { type: 'string', enum: ['P1', 'P2', 'P3'] } } },
          },
        },
      }),
      'utf8',
    )
    return p
  }
  // --output-schema로 넘어간 파일이 strict(required ⊇ properties 전체)인지 확인.
  const outputSchemaFrom = (args: string[]) => JSON.parse(readFileSync(args[args.indexOf('--output-schema') + 1] as string, 'utf8'))

  it('exec(신규): --sandbox read-only + strict output-schema(파생) + thread.started 파싱 + lastMessage 캡처', () => {
    const schemaPath = writeValidationSchema()
    let seen: { args: string[]; input: string; cwd: string } | null = null
    const run: CodexRunner = (args, input, cwd) => {
      seen = { args, input, cwd }
      const p = args[args.indexOf('--output-last-message') + 1] as string
      writeFileSync(p, '{"status":"STEP_COMPLETE"}') // codex가 쓰는 --output-last-message를 테스트가 대신 기록
      return '{"type":"thread.started","thread_id":"tid-1"}\n{"type":"other"}'
    }
    const r = createCodexReviewerAdapter(run).review({ prompt: 'PROMPT', schemaPath, resumeThreadId: null, cwd: '/repo', model: null, reasoningEffort: null })
    expect(seen!.args).toContain('--sandbox')
    expect(seen!.args).toContain('read-only')
    expect(seen!.args).toContain('--output-schema')
    // 파생 strict: root.required가 properties 전체(observations 포함)를 담아야 함(codex strict mode 400 방지).
    const strict = outputSchemaFrom(seen!.args)
    expect(strict.required).toEqual(expect.arrayContaining(['status', 'observations']))
    // 원본 검증 스키마는 불변(observations optional 유지) — 어댑터가 원본을 덮어쓰지 않음.
    expect(JSON.parse(readFileSync(schemaPath, 'utf8')).required).toEqual(['status'])
    expect(seen!.input).toBe('PROMPT')
    expect(seen!.cwd).toBe('/repo')
    expect(r.threadId).toBe('tid-1')
    expect(r.lastMessage).toBe('{"status":"STEP_COMPLETE"}')
  })

  it('[R9] resume: exec resume <tid> + -c sandbox_mode="read-only"(read-only 강제) + strict output-schema + threadId=resumeThreadId', () => {
    const schemaPath = writeValidationSchema()
    let captured: string[] = []
    const run: CodexRunner = (args) => {
      captured = args
      const p = args[args.indexOf('--output-last-message') + 1] as string
      writeFileSync(p, 'RESP')
      return '' // resume은 thread.started 없음
    }
    const r = createCodexReviewerAdapter(run).review({ prompt: 'P', schemaPath, resumeThreadId: 'tid-existing', cwd: '/r', model: null, reasoningEffort: null })
    expect(captured.slice(0, 3)).toEqual(['exec', 'resume', 'tid-existing'])
    // R9(REQ-2026-006): resume은 --sandbox 플래그를 거부하므로 read-only를 -c sandbox_mode config override로 강제(spike 검증).
    expect(captured).not.toContain('--sandbox') // 플래그 형태는 여전히 미사용(resume이 거부)
    const ci = captured.indexOf('-c')
    expect(ci).toBeGreaterThanOrEqual(0)
    expect(captured[ci + 1]).toBe('sandbox_mode="read-only"')
    expect(outputSchemaFrom(captured).required).toEqual(expect.arrayContaining(['status', 'observations']))
    expect(r.threadId).toBe('tid-existing')
    expect(r.lastMessage).toBe('RESP')
  })

  it('codex 미설치/실패 → review가 그대로 throw(fail-closed, D-017-4/7)', () => {
    const schemaPath = writeValidationSchema() // 어댑터가 원본 스키마를 읽으므로 실제 파일 필요(런너 도달 전 파일오류 방지)
    const rv = createCodexReviewerAdapter(() => {
      throw new Error('codex ENOENT')
    })
    expect(() => rv.review({ prompt: 'P', schemaPath, resumeThreadId: null, cwd: '/r', model: null, reasoningEffort: null })).toThrow(/codex ENOENT/)
  })

  /** findings[].severity 경로를 갖춘 최소 합성 스키마(REQ-2026-018 이후 파생의 전제). */
  const synthSchema = (extra: Record<string, unknown> = {}) => ({
    type: 'object',
    additionalProperties: false,
    required: ['a', 'b'],
    properties: {
      a: { type: 'string' },
      b: { type: 'string' },
      observations: { type: 'array' },
      findings: {
        type: 'array',
        items: {
          type: 'object',
          properties: { severity: { type: 'string', enum: ['P1', 'P2', 'P3'] } },
        },
      },
      ...extra,
    },
  })

  it('[REQ-005] deriveStrictOutputSchema: root.required = properties 전체 키(strict), 나머지 불변', () => {
    const original = JSON.stringify(synthSchema())
    const strict = JSON.parse(deriveStrictOutputSchema(original))
    expect(strict.required.sort()).toEqual(['a', 'b', 'findings', 'observations'])
    expect(strict.additionalProperties).toBe(false)
    expect(Object.keys(strict.properties).sort()).toEqual(['a', 'b', 'findings', 'observations'])
    // 순수 함수 — 입력 문자열의 원본 required는 그대로(부수효과 없음, 어댑터가 파일 원본을 덮어쓰지 않음)
    expect(JSON.parse(original).required).toEqual(['a', 'b'])
  })

  // ── REQ-2026-018: findings=P1만 차단 ──
  it('[REQ-018 R1] 파생 출력 스키마의 findings[].severity.enum이 ["P1"]로 좁혀진다 — 리뷰어가 P2를 낼 수 없다', () => {
    const schemaText = readFileSync(join(REPO_ROOT, 'workflow/machine.schema.json'), 'utf8')
    const strict = JSON.parse(deriveStrictOutputSchema(schemaText))
    expect(strict.properties.findings.items.properties.severity.enum).toEqual(['P1'])
    // 순수 함수 — 원본 문자열은 불변(SSOT 파일을 덮어쓰지 않는다)
    expect(JSON.parse(schemaText).properties.findings.items.properties.severity.enum).toEqual(['P1', 'P2', 'P3'])
  })

  it('[REQ-018 R2] machine.schema.json의 severity.description이 P1 정의 4요소를 모두 명시한다', () => {
    const schema = JSON.parse(readFileSync(join(REPO_ROOT, 'workflow/machine.schema.json'), 'utf8'))
    const desc: string = schema.properties.findings.items.properties.severity.description ?? ''
    expect(desc.length).toBeGreaterThan(0)
    // (a) 카테고리 한정 — 이게 빠지면 "정상 경로에서 재현되는 개선"이 전부 P1이 되어 억제가 무너진다.
    for (const anchor of ['requirement violation', 'data loss', 'security', 'monetary', 'fail-closed bypass']) {
      expect(desc.toLowerCase()).toContain(anchor.toLowerCase())
    }
    // (b) 정상 경로 요건
    expect(desc.toLowerCase()).toContain('normal path')
    // (c) 재현 증거 필수
    expect(desc.toLowerCase()).toContain('reproduction path')
    expect(desc.toLowerCase()).toContain('failure scenario')
    // (d) 배제 규칙 — 카테고리 밖이면 정상 경로 재현이어도 P1이 아니고 observations로.
    expect(desc.toLowerCase()).toContain('exclusion rule')
    expect(desc.toLowerCase()).toContain('observations')
  })

  it('[REQ-018 R3] 검증 SSOT의 enum은 P1|P2|P3 유지 — 기존 P2/P3 아카이브가 전부 검증을 통과한다', () => {
    const schema = JSON.parse(readFileSync(join(REPO_ROOT, 'workflow/machine.schema.json'), 'utf8'))
    expect(schema.properties.findings.items.properties.severity.enum).toEqual(['P1', 'P2', 'P3'])

    const archives = listReviewArchives()
    expect(archives.length).toBeGreaterThan(0)

    const ajv = new Ajv({ allErrors: true, strict: false })
    const validate = ajv.compile(schema)
    const severities = new Set<string>()
    const invalid: string[] = []
    for (const rel of archives) {
      const doc = JSON.parse(readFileSync(join(REPO_ROOT, rel), 'utf8'))
      for (const f of doc.findings ?? []) severities.add(f.severity)
      if (!validate(doc)) invalid.push(`${rel}: ${ajv.errorsText(validate.errors)}`)
    }
    expect(invalid).toEqual([])
    // 이 회귀가 실효적이려면 아카이브 집합에 P2/P3가 실제로 있어야 한다(0건이면 하위호환을 고정하지 못한다).
    expect(severities).toContain('P2')
    expect(severities).toContain('P3')
  })

  it('[REQ-018 D3] severity 경로가 없는 스키마는 조용히 통과하지 않고 throw한다(fail-closed)', () => {
    const noFindings = JSON.stringify({ type: 'object', properties: { a: { type: 'string' } } })
    expect(() => deriveStrictOutputSchema(noFindings)).toThrow(/severity/)
    // findings는 있으나 severity.enum이 없는 파손 스키마도 동일하게 차단.
    const brokenSeverity = JSON.stringify({
      type: 'object',
      properties: { findings: { type: 'array', items: { type: 'object', properties: { severity: { type: 'string' } } } } },
    })
    expect(() => deriveStrictOutputSchema(brokenSeverity)).toThrow(/severity/)
  })

  // ── REQ-2026-013 P1: 리뷰 모델·추론강도 -c 주입 ──
  const captureArgs = (): { run: CodexRunner; get: () => string[] } => {
    let captured: string[] = []
    const run: CodexRunner = (args) => {
      captured = args
      const p = args[args.indexOf('--output-last-message') + 1] as string
      writeFileSync(p, '{"status":"STEP_COMPLETE"}')
      return '{"type":"thread.started","thread_id":"t"}'
    }
    return { run, get: () => captured }
  }
  /** args에서 `-c <value>` 쌍의 value가 존재하고 바로 앞이 `-c`인지. */
  const hasCPair = (args: string[], value: string): boolean => {
    const i = args.indexOf(value)
    return i > 0 && args[i - 1] === '-c'
  }

  it('[P1] exec: model·effort override가 `-c` 쌍으로 주입', () => {
    const c = captureArgs()
    createCodexReviewerAdapter(c.run).review({
      prompt: 'P', schemaPath: writeValidationSchema(), resumeThreadId: null, cwd: '/r',
      model: 'gpt-5.6-terra', reasoningEffort: 'high',
    })
    expect(hasCPair(c.get(), 'model="gpt-5.6-terra"')).toBe(true)
    expect(hasCPair(c.get(), 'model_reasoning_effort="high"')).toBe(true)
  })

  it('[P1] resume: model·effort override 주입 + 기존 sandbox_mode `-c` 유지', () => {
    const c = captureArgs()
    createCodexReviewerAdapter(c.run).review({
      prompt: 'P', schemaPath: writeValidationSchema(), resumeThreadId: 'tid', cwd: '/r',
      model: 'gpt-5.6-terra', reasoningEffort: 'high',
    })
    const a = c.get()
    expect(a.slice(0, 3)).toEqual(['exec', 'resume', 'tid'])
    expect(hasCPair(a, 'sandbox_mode="read-only"')).toBe(true) // read-only 강제 유지(R9)
    expect(hasCPair(a, 'model="gpt-5.6-terra"')).toBe(true)
    expect(hasCPair(a, 'model_reasoning_effort="high"')).toBe(true)
  })

  it('[P1] null override는 해당 `-c`를 생략(전역 상속)', () => {
    const c = captureArgs()
    createCodexReviewerAdapter(c.run).review({
      prompt: 'P', schemaPath: writeValidationSchema(), resumeThreadId: null, cwd: '/r',
      model: null, reasoningEffort: null,
    })
    const a = c.get()
    expect(a.some((x) => x.startsWith('model='))).toBe(false)
    expect(a.some((x) => x.startsWith('model_reasoning_effort='))).toBe(false)
  })

  it('[P1] 부분 override(model만): effort `-c`는 없음', () => {
    const c = captureArgs()
    createCodexReviewerAdapter(c.run).review({
      prompt: 'P', schemaPath: writeValidationSchema(), resumeThreadId: null, cwd: '/r',
      model: 'gpt-5.6-terra', reasoningEffort: null,
    })
    const a = c.get()
    expect(hasCPair(a, 'model="gpt-5.6-terra"')).toBe(true)
    expect(a.some((x) => x.startsWith('model_reasoning_effort='))).toBe(false)
  })
})

// ───────────────────────────────────────── FakeReviewerAdapter ──
describe('Phase 3 — FakeReviewerAdapter(createFakeReviewerAdapter)', () => {
  it('canned 응답 반환 + 받은 요청 기록', () => {
    const rv = createFakeReviewerAdapter({ rawStdout: 'R', lastMessage: 'L', threadId: 'T' })
    const r = rv.review({ prompt: 'P', schemaPath: '/s', resumeThreadId: 'rt', cwd: '/c', model: null, reasoningEffort: null })
    expect(r).toEqual({ rawStdout: 'R', lastMessage: 'L', threadId: 'T' })
    expect(rv.requests).toHaveLength(1)
    expect(rv.requests[0]).toEqual({ prompt: 'P', schemaPath: '/s', resumeThreadId: 'rt', cwd: '/c', model: null, reasoningEffort: null })
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
    const { threadId } = callReviewer(rv, { prompt: 'P', schemaPath: '/s', resumeThreadId: null, cwd: dir, respPath, model: null, reasoningEffort: null })
    expect(threadId).toBe('tid-1')
    expect(readFileSync(respPath, 'utf8')).toBe('{"status":"STEP_COMPLETE"}')
    expect(rv.requests[0]).toEqual({ prompt: 'P', schemaPath: '/s', resumeThreadId: null, cwd: dir, model: null, reasoningEffort: null })
  })

  it('threadId 없으면(exec에서 thread.started 누락) fail-closed throw', () => {
    const dir = mkdtempSync(join(tmpdir(), 'req-cr-'))
    const rv = createFakeReviewerAdapter({ rawStdout: '', lastMessage: 'X', threadId: null })
    expect(() =>
      callReviewer(rv, { prompt: 'P', schemaPath: '/s', resumeThreadId: null, cwd: dir, respPath: join(dir, 'r.json'), model: null, reasoningEffort: null }),
    ).toThrow(/thread_id/)
  })
})
