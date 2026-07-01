import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import {
  assembleReviewPrompt,
  captureGitBinding,
  captureDesignBinding,
  designDocPaths,
  readDesignDocsFromIndex,
  validateVerdict,
  loadState,
  validateResponseStructure,
  applyVerdict,
  processResponse,
  writeState,
  parseThreadId,
  parseArgs,
  resolvePhaseTarget,
  findUnstagedOrUntracked,
  archiveBaseName,
  archiveFileName,
  nextArchiveRound,
  isArchiveFileName,
  isAllowedResponsesScratch,
  archiveDecision,
  MACHINE_SCHEMA_VERSION,
  MACHINE_SCHEMA_PATH,
  type Verdict,
  type WorkflowState,
} from '../../scripts/req/review-codex'

// Phase 2 config 배선: designDocPaths·validateResponseStructure가 config 파생값을 명시 인자로 받음.
// 기존 호출을 **명시 기본값**(현재 동작)으로 갱신 — behavior-preserving. (config override 동작은 req-config.test 담당)
const DEFAULT_DESIGN_DOCS = { requirement: '00-requirement.md', design: '01-design.md', plan: '02-plan.md' }

describe('req:review-codex — 조립(assembleReviewPrompt)', () => {
  it('handoff·Review Context·REVIEW_BASE_SHA·request·staged diff를 순서대로 조립한다', () => {
    const p = assembleReviewPrompt({
      handoff: 'HANDOFF',
      reviewContext: {
        branch: 'feat/x',
        reviewBaseSha: 'abc123',
        reviewTree: 'TREE9',
        phase: 'REVIEW_REQUEST',
        previousResult: 'none',
      },
      reviewBaseSha: 'abc123',
      requestBody: 'REQUEST BODY',
      stagedDiff: 'diff --git a b',
    })
    expect(p).toContain('# Review Context')
    expect(p).toContain('- review_tree: TREE9')
    expect(p).toContain('- previous_codex_result: none')
    // 순서: handoff < Review Context < REVIEW_BASE_SHA < request < diff
    expect(p.indexOf('HANDOFF')).toBeLessThan(p.indexOf('# Review Context'))
    expect(p.indexOf('# Review Context')).toBeLessThan(p.indexOf('REVIEW_BASE_SHA: abc123'))
    expect(p.indexOf('REVIEW_BASE_SHA: abc123')).toBeLessThan(p.indexOf('REQUEST BODY'))
    expect(p.indexOf('REQUEST BODY')).toBeLessThan(p.indexOf('diff --git a b'))
  })

  it('handoff·reviewContext가 없으면 생략하고 REVIEW_BASE_SHA로 시작한다', () => {
    const p = assembleReviewPrompt({ reviewBaseSha: 'x', requestBody: 'R', stagedDiff: '' })
    expect(p.startsWith('---\nREVIEW_BASE_SHA: x')).toBe(true)
  })

  it('빈 request 본문은 fail-closed로 거부한다', () => {
    expect(() => assembleReviewPrompt({ reviewBaseSha: 'x', requestBody: '   ', stagedDiff: '' })).toThrow()
  })

  it('reviewBaseSha 누락 시 거부한다', () => {
    // @ts-expect-error reviewBaseSha 누락 케이스 의도적 테스트
    expect(() => assembleReviewPrompt({ requestBody: 'R', stagedDiff: '' })).toThrow()
  })

  it('기본 kind=phase: REVIEW_KIND phase + staged diff 권위 아티팩트', () => {
    const p = assembleReviewPrompt({ reviewBaseSha: 'x', requestBody: 'R', stagedDiff: 'diff --git a b' })
    expect(p).toContain('REVIEW_KIND: phase')
    expect(p).toContain('staged diff')
    expect(p).toContain('diff --git a b')
    expect(p).not.toContain('## 01-design.md')
  })

  it('kind=design: 설계 문서 00/01/02를 권위 아티팩트로, REVIEW_KIND design (staged diff 미사용)', () => {
    const p = assembleReviewPrompt({
      reviewBaseSha: 'x',
      requestBody: 'R',
      reviewKind: 'design',
      designDocs: { requirement: 'REQ-BODY', design: 'DESIGN-BODY', plan: 'PLAN-BODY' },
    })
    expect(p).toContain('REVIEW_KIND: design')
    expect(p).toContain('## 00-requirement.md')
    expect(p).toContain('REQ-BODY')
    expect(p).toContain('## 01-design.md')
    expect(p).toContain('DESIGN-BODY')
    expect(p).toContain('## 02-plan.md')
    expect(p).toContain('PLAN-BODY')
    expect(p).not.toContain('staged diff')
  })

  it('kind=design인데 designDocs 누락 → fail-closed throw', () => {
    expect(() => assembleReviewPrompt({ reviewBaseSha: 'x', requestBody: 'R', reviewKind: 'design' })).toThrow()
  })
})

describe('req:review-codex — git 바인딩(captureGitBinding)', () => {
  it('diff 텍스트가 아니라 staged tree OID(write-tree)를 바인딩한다 (§8.4)', () => {
    const calls: string[] = []
    const fakeGit = (args: string[]) => {
      calls.push(args.join(' '))
      return args[0] === 'rev-parse' ? 'SHA' : 'TREE'
    }
    const r = captureGitBinding(fakeGit)
    expect(r).toEqual({ reviewBaseSha: 'SHA', reviewTree: 'TREE' })
    expect(calls).toContain('rev-parse HEAD')
    expect(calls).toContain('write-tree')
    expect(calls.some((c) => c.includes('diff'))).toBe(false)
  })
})

describe('req:review-codex — design 경로/바인딩(designDocPaths·captureDesignBinding)', () => {
  it('designDocPaths: 티켓 디렉터리를 00/01/02로 정규화(백슬래시·후행 슬래시 제거)', () => {
    const want = [
      'workflow/REQ-1/00-requirement.md',
      'workflow/REQ-1/01-design.md',
      'workflow/REQ-1/02-plan.md',
    ]
    expect(designDocPaths('workflow/REQ-1', DEFAULT_DESIGN_DOCS)).toEqual(want)
    expect(designDocPaths('workflow\\REQ-1\\', DEFAULT_DESIGN_DOCS)).toEqual(want)
  })

  it('[P2] designDocPaths: config designDocs override(파일명 주입)', () => {
    const dd = { requirement: 'req.md', design: 'design.md', plan: 'plan.md' }
    expect(designDocPaths('workflow/REQ-1', dd)).toEqual([
      'workflow/REQ-1/req.md',
      'workflow/REQ-1/design.md',
      'workflow/REQ-1/plan.md',
    ])
  })

  it('captureDesignBinding: ls-files -s 3엔트리 → 정렬 후 sha256, 정확한 args로 호출', () => {
    const lines = [
      '100644 ccc0000000000000000000000000000000000000 0\tworkflow/REQ-1/02-plan.md',
      '100644 aaa0000000000000000000000000000000000000 0\tworkflow/REQ-1/00-requirement.md',
      '100644 bbb0000000000000000000000000000000000000 0\tworkflow/REQ-1/01-design.md',
    ]
    let calledArgs: string[] = []
    const r = captureDesignBinding('workflow/REQ-1', (args) => {
      calledArgs = args
      return lines.join('\n')
    })
    expect(calledArgs.slice(0, 3)).toEqual(['ls-files', '-s', '--'])
    expect(calledArgs.slice(3)).toEqual([
      'workflow/REQ-1/00-requirement.md',
      'workflow/REQ-1/01-design.md',
      'workflow/REQ-1/02-plan.md',
    ])
    const expected = createHash('sha256').update([...lines].sort().join('\n')).digest('hex')
    expect(r.designHash).toBe(expected)
    expect(r.paths).toHaveLength(3)
  })

  it('captureDesignBinding: 입력 라인 순서가 달라도 같은 해시(정렬)', () => {
    const lines = [
      '100644 a 0\tworkflow/REQ-1/00-requirement.md',
      '100644 b 0\tworkflow/REQ-1/01-design.md',
      '100644 c 0\tworkflow/REQ-1/02-plan.md',
    ]
    const h1 = captureDesignBinding('workflow/REQ-1', () => lines.join('\n')).designHash
    const h2 = captureDesignBinding('workflow/REQ-1', () => [...lines].reverse().join('\n')).designHash
    expect(h1).toBe(h2)
  })

  it('captureDesignBinding: 추적 엔트리<3이면 fail-closed throw(미승인 취급)', () => {
    const two = ['100644 a 0\tworkflow/REQ-1/00-requirement.md', '100644 b 0\tworkflow/REQ-1/01-design.md']
    expect(() => captureDesignBinding('workflow/REQ-1', () => two.join('\n'))).toThrow(/fail-closed/)
  })

  it('[Codex P2] readDesignDocsFromIndex: git show :<path>로 인덱스 본문 읽기(리뷰 대상=바인딩 대상)', () => {
    const calls: string[] = []
    const r = readDesignDocsFromIndex('workflow/REQ-1', (args) => {
      calls.push(args.join(' '))
      return `BODY(${args[1]})`
    })
    expect(calls).toEqual([
      'show :workflow/REQ-1/00-requirement.md',
      'show :workflow/REQ-1/01-design.md',
      'show :workflow/REQ-1/02-plan.md',
    ])
    expect(r).toEqual({
      requirement: 'BODY(:workflow/REQ-1/00-requirement.md)',
      design: 'BODY(:workflow/REQ-1/01-design.md)',
      plan: 'BODY(:workflow/REQ-1/02-plan.md)',
    })
  })

  it('[Codex P2] readDesignDocsFromIndex: 인덱스에 없는 문서는 어느 파일인지 명확한 에러(fail-closed)', () => {
    const fakeGit = (args: string[]) => {
      if (args[1] === ':workflow/REQ-1/01-design.md') throw new Error('fatal: path ... does not exist')
      return 'BODY'
    }
    expect(() => readDesignDocsFromIndex('workflow/REQ-1', fakeGit)).toThrow(/01-design\.md/)
  })
})

describe('req:review-codex — CLI 파싱(parseArgs)', () => {
  it('기본 kind=phase', () => {
    expect(parseArgs(['2026-001']).kind).toBe('phase')
    expect(parseArgs(['2026-001']).reqId).toBe('2026-001')
  })
  it('--kind design 파싱', () => {
    const o = parseArgs(['--kind', 'design', '2026-001', '--run'])
    expect(o.kind).toBe('design')
    expect(o.run).toBe(true)
    expect(o.reqId).toBe('2026-001')
  })
  it('--kind 오타는 fail-closed throw', () => {
    expect(() => parseArgs(['--kind', 'desing', '2026-001'])).toThrow(/--kind/)
  })
  it('--kind 값 누락은 throw', () => {
    expect(() => parseArgs(['2026-001', '--kind'])).toThrow(/--kind/)
  })
  it('기본 phase=null', () => {
    expect(parseArgs(['2026-001']).phase).toBe(null)
  })
  it('--phase <id> 파싱', () => {
    const o = parseArgs(['--kind', 'phase', '--phase', 'phase-4-kind-phase', '2026-003'])
    expect(o.kind).toBe('phase')
    expect(o.phase).toBe('phase-4-kind-phase')
  })
  it('--phase 값 누락은 throw', () => {
    expect(() => parseArgs(['--phase'])).toThrow(/--phase/)
  })
  it('[P2] --root 수용(config 탐색 루트 주입)', () => {
    expect(parseArgs(['2026-001', '--root', '/some/dir']).root).toBe('/some/dir')
    expect(parseArgs(['2026-001']).root).toBe(null)
  })
  it('[P2] --root 값 누락은 throw', () => {
    expect(() => parseArgs(['2026-001', '--root'])).toThrow(/--root/)
  })
})

describe('req:review-codex — phase 대상 해소(resolvePhaseTarget)', () => {
  const withPhases = (phases: { id: string; approved: boolean }[]): WorkflowState =>
    ({ id: 'REQ', phase: 'IMPLEMENT', phases }) as WorkflowState
  it('kind=design → 대상 없음(ok, phaseId=null)', () => {
    expect(resolvePhaseTarget(withPhases([{ id: 'p1', approved: false }]), 'design', null)).toEqual({
      ok: true,
      phaseId: null,
    })
  })
  it('phases[] 비어있음(레거시) → ok, phaseId=null(하위호환)', () => {
    expect(resolvePhaseTarget(withPhases([]), 'phase', null)).toEqual({ ok: true, phaseId: null })
  })
  it('phases[] 있는데 --phase 누락 → FAIL(대상 모호)', () => {
    expect(resolvePhaseTarget(withPhases([{ id: 'p1', approved: false }]), 'phase', null).ok).toBe(false)
  })
  it('존재하지 않는 --phase id → FAIL', () => {
    expect(
      resolvePhaseTarget(withPhases([{ id: 'phase-1-schema', approved: true }]), 'phase', 'phase-9').ok,
    ).toBe(false)
  })
  it('근접 id(부분일치)도 exact match로 FAIL', () => {
    expect(
      resolvePhaseTarget(withPhases([{ id: 'phase-1-schema', approved: true }]), 'phase', 'phase-1').ok,
    ).toBe(false)
  })
  it('일치 id → ok, phaseId 반환', () => {
    expect(
      resolvePhaseTarget(withPhases([{ id: 'phase-4-kind-phase', approved: false }]), 'phase', 'phase-4-kind-phase'),
    ).toEqual({ ok: true, phaseId: 'phase-4-kind-phase' })
  })
  it('이미 승인된 phase 재지정도 허용(멱등)', () => {
    expect(
      resolvePhaseTarget(withPhases([{ id: 'phase-1-schema', approved: true }]), 'phase', 'phase-1-schema'),
    ).toEqual({ ok: true, phaseId: 'phase-1-schema' })
  })
  it('[Codex P2] malformed 비-빈 phases[](유효 id 없음) + --phase 누락 → FAIL(레거시 강등 금지)', () => {
    const state = { id: 'REQ', phase: 'IMPLEMENT', phases: [{ weird: 1 }] } as unknown as WorkflowState
    expect(resolvePhaseTarget(state, 'phase', null).ok).toBe(false)
  })
  it('[Codex P2] malformed 비-빈 phases[] + 알 수 없는 --phase → FAIL', () => {
    const state = { id: 'REQ', phase: 'IMPLEMENT', phases: [{ weird: 1 }] } as unknown as WorkflowState
    expect(resolvePhaseTarget(state, 'phase', 'p1').ok).toBe(false)
  })
})

describe('req:review-codex — 응답 도메인 검증(validateVerdict)', () => {
  const ok: Verdict = {
    machine_schema_version: MACHINE_SCHEMA_VERSION,
    review_base_sha: 'abc',
    status: 'STEP_COMPLETE',
    commit_approved: 'yes',
    merge_ready: 'no',
    risk_level: 'LOW',
    review_kind: 'phase',
    findings: [],
    next_action: '',
  }

  it('정상 verdict는 통과', () => {
    expect(validateVerdict(ok, { reviewBaseSha: 'abc' })).toEqual({ ok: true, errors: [] })
  })

  it('review_kind 누락 → 실패', () => {
    const { review_kind: _omit, ...noKind } = ok
    const r = validateVerdict(noKind, { reviewBaseSha: 'abc' })
    expect(r.ok).toBe(false)
    expect(r.errors.join()).toContain('review_kind')
  })

  it('review_kind 오타 → 실패', () => {
    const r = validateVerdict({ ...ok, review_kind: 'desing' }, { reviewBaseSha: 'abc' })
    expect(r.ok).toBe(false)
    expect(r.errors.join()).toContain('review_kind')
  })

  it('NEEDS_FIX인데 findings=[] → 실패', () => {
    const r = validateVerdict(
      { ...ok, status: 'NEEDS_FIX', commit_approved: 'no', findings: [], next_action: '코드 수정' },
      { reviewBaseSha: 'abc' },
    )
    expect(r.ok).toBe(false)
    expect(r.errors.join()).toContain('findings')
  })

  it('NEEDS_FIX인데 next_action 공백 → 실패', () => {
    const r = validateVerdict(
      {
        ...ok,
        status: 'NEEDS_FIX',
        commit_approved: 'no',
        findings: [{ severity: 'P1', detail: 'x', file: null }],
        next_action: '   ',
      },
      { reviewBaseSha: 'abc' },
    )
    expect(r.ok).toBe(false)
    expect(r.errors.join()).toContain('next_action')
  })

  it('[Codex P2] NEEDS_FIX인데 next_action이 비-문자열(파손) → throw 없이 실패(fail-closed)', () => {
    const malformed = {
      ...ok,
      status: 'NEEDS_FIX',
      commit_approved: 'no',
      findings: [{ severity: 'P1', detail: 'x', file: null }],
      next_action: 1 as unknown as string,
    }
    let r: { ok: boolean; errors: string[] } | undefined
    expect(() => {
      r = validateVerdict(malformed, { reviewBaseSha: 'abc' })
    }).not.toThrow()
    expect(r?.ok).toBe(false)
    expect(r?.errors.join()).toContain('next_action')
  })

  it('NEEDS_FIX + findings·next_action actionable → 통과', () => {
    const r = validateVerdict(
      {
        ...ok,
        status: 'NEEDS_FIX',
        commit_approved: 'no',
        findings: [{ severity: 'P2', detail: 'review_kind 검증 누락', file: 'scripts/req/review-codex.ts' }],
        next_action: 'validateVerdict에 review_kind enum 검사를 추가하라.',
      },
      { reviewBaseSha: 'abc' },
    )
    expect(r).toEqual({ ok: true, errors: [] })
  })

  it('1.0 verdict는 fail-closed로 거부(버전 불일치)', () => {
    const legacy: Verdict = {
      machine_schema_version: '1.0',
      review_base_sha: 'abc',
      status: 'STEP_COMPLETE',
      commit_approved: 'yes',
      merge_ready: 'no',
      risk_level: 'LOW',
    }
    const r = validateVerdict(legacy, { reviewBaseSha: 'abc' })
    expect(r.ok).toBe(false)
    expect(r.errors.join()).toContain('machine_schema_version')
  })

  it('schema 버전 불일치는 실패', () => {
    const r = validateVerdict({ ...ok, machine_schema_version: '0.9' })
    expect(r.ok).toBe(false)
    expect(r.errors.join()).toContain('machine_schema_version')
  })

  it('모순: status=NEEDS_FIX 인데 commit_approved=yes → 실패', () => {
    const r = validateVerdict({ ...ok, status: 'NEEDS_FIX', commit_approved: 'yes' })
    expect(r.ok).toBe(false)
    expect(r.errors.join()).toContain('모순')
  })

  it('모순: merge_ready=yes 인데 status≠COMPLETE → 실패', () => {
    const r = validateVerdict({ ...ok, merge_ready: 'yes', status: 'STEP_COMPLETE' })
    expect(r.ok).toBe(false)
  })

  it('review_base_sha 불일치(state 바인딩) → 실패', () => {
    const r = validateVerdict(ok, { reviewBaseSha: 'different' })
    expect(r.ok).toBe(false)
    expect(r.errors.join()).toContain('review_base_sha 불일치')
  })

  it('enum 밖 값 → 실패', () => {
    const r = validateVerdict({ ...ok, status: 'BANANA' })
    expect(r.ok).toBe(false)
  })
})

describe('req:review-codex — state.json 로드(loadState)', () => {
  let dir: string | null = null
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = null
  })

  it('state.json 부재 시 명확한 에러(자동 생성 안 함)', () => {
    dir = mkdtempSync(join(tmpdir(), 'req-state-'))
    expect(() => loadState(dir as string)).toThrow(/state\.json 없음/)
  })

  it('파손된 JSON은 명확한 에러', () => {
    dir = mkdtempSync(join(tmpdir(), 'req-state-'))
    writeFileSync(join(dir, 'state.json'), '{ not json', 'utf8')
    expect(() => loadState(dir as string)).toThrow(/파싱 실패/)
  })

  it('필수 필드(id, phase) 누락 시 에러', () => {
    dir = mkdtempSync(join(tmpdir(), 'req-state-'))
    writeFileSync(join(dir, 'state.json'), JSON.stringify({ id: 'X' }), 'utf8')
    expect(() => loadState(dir as string)).toThrow(/필수 필드/)
  })

  it('정상 state는 객체를 반환', () => {
    dir = mkdtempSync(join(tmpdir(), 'req-state-'))
    writeFileSync(join(dir, 'state.json'), JSON.stringify({ id: 'REQ-2026-001', phase: 'REVIEW_REQUEST' }), 'utf8')
    const s = loadState(dir as string)
    expect(s.id).toBe('REQ-2026-001')
    expect(s.phase).toBe('REVIEW_REQUEST')
  })
})

describe('req:review-codex — 응답 구조검증(validateResponseStructure, AJV)', () => {
  const good = {
    machine_schema_version: '1.1',
    review_base_sha: 'abc',
    status: 'STEP_COMPLETE',
    commit_approved: 'yes',
    merge_ready: 'no',
    risk_level: 'LOW',
    review_kind: 'phase',
    findings: [],
    next_action: '',
  }
  // Phase 2: schemaPath는 명시 주입(default 제거). 명시 기본값 MACHINE_SCHEMA_PATH 전달 = 현재 동작 보존.
  const vrs = (o: unknown) => validateResponseStructure(o, MACHINE_SCHEMA_PATH)
  it('정본 스키마(1.1)에 부합하면 ok', () => {
    expect(vrs(good).ok).toBe(true)
  })
  it('findings 항목이 있는 NEEDS_FIX도 ok', () => {
    const v = {
      ...good,
      status: 'NEEDS_FIX',
      commit_approved: 'no',
      findings: [{ severity: 'P1', detail: 'x', file: 'a.ts' }, { severity: 'P3', detail: 'y', file: null }],
      next_action: '수정하라',
    }
    expect(vrs(v).ok).toBe(true)
  })
  it('enum 밖 값은 거부', () => {
    expect(vrs({ ...good, status: 'BANANA' }).ok).toBe(false)
  })
  it('machine_schema_version 누락은 거부(required)', () => {
    const { machine_schema_version: _omit, ...rest } = good
    expect(vrs(rest).ok).toBe(false)
  })
  it('1.0 버전은 거부(enum [1.1])', () => {
    expect(vrs({ ...good, machine_schema_version: '1.0' }).ok).toBe(false)
  })
  it('review_kind 누락은 거부(required)', () => {
    const { review_kind: _omit, ...rest } = good
    expect(vrs(rest).ok).toBe(false)
  })
  it('next_action 누락은 거부(required)', () => {
    const { next_action: _omit, ...rest } = good
    expect(vrs(rest).ok).toBe(false)
  })
  it('findings 누락은 거부(required)', () => {
    const { findings: _omit, ...rest } = good
    expect(vrs(rest).ok).toBe(false)
  })
  it('findings item severity 오타는 거부(enum [P1,P2,P3])', () => {
    const v = { ...good, findings: [{ severity: 'P0', detail: 'x', file: null }] }
    expect(vrs(v).ok).toBe(false)
  })
  it('findings item 필수필드(file) 누락은 거부', () => {
    const v = { ...good, findings: [{ severity: 'P1', detail: 'x' }] }
    expect(vrs(v).ok).toBe(false)
  })
  it('findings item 정의 외 필드는 거부(additionalProperties:false)', () => {
    const v = { ...good, findings: [{ severity: 'P1', detail: 'x', file: null, line: 5 }] }
    expect(vrs(v).ok).toBe(false)
  })
  it('정의 외 필드는 거부(additionalProperties:false)', () => {
    expect(vrs({ ...good, extra: 1 }).ok).toBe(false)
  })
})

describe('req:review-codex — 승인 반영(applyVerdict)', () => {
  const binding = { reviewBaseSha: 'SHA', reviewTree: 'TREE' }
  const base = { id: 'REQ-2026-001', phase: 'IMPLEMENT' }
  it('commit_approved=yes & STEP_COMPLETE → 승인(commit_allowed, approved_diff_hash=tree)', () => {
    const r = applyVerdict({ base, binding, verdict: { commit_approved: 'yes', status: 'STEP_COMPLETE' } })
    expect(r.commit_allowed).toBe(true)
    expect(r.approved_diff_hash).toBe('TREE')
  })
  it('NEEDS_FIX → 미승인', () => {
    const r = applyVerdict({ base, binding, verdict: { commit_approved: 'no', status: 'NEEDS_FIX' } })
    expect(r.commit_allowed).toBe(false)
    expect(r.approved_diff_hash).toBe(null)
  })

  it('[Phase2] kind=design 승인 → design_approved/_hash만(commit_allowed·approved_diff_hash 미설정)', () => {
    const r = applyVerdict({
      base,
      binding,
      kind: 'design',
      designHash: 'DHASH',
      verdict: { review_kind: 'design', commit_approved: 'yes', status: 'STEP_COMPLETE' },
    })
    expect(r.design_approved).toBe(true)
    expect(r.design_approved_hash).toBe('DHASH')
    expect(r.commit_allowed).toBeUndefined()
    expect(r.approved_diff_hash).toBeUndefined()
  })

  it('[Phase2] kind=design 미승인 → design_approved=false·_hash=null(fail-closed)', () => {
    const r = applyVerdict({
      base,
      binding,
      kind: 'design',
      designHash: 'DHASH',
      verdict: { review_kind: 'design', commit_approved: 'no', status: 'NEEDS_FIX' },
    })
    expect(r.design_approved).toBe(false)
    expect(r.design_approved_hash).toBe(null)
  })

  it('[Codex P3] kind=design 승인 가능하지만 designHash 누락 → 미승인(approved=true/hash=null 금지)', () => {
    const r = applyVerdict({
      base,
      binding,
      kind: 'design',
      verdict: { review_kind: 'design', commit_approved: 'yes', status: 'STEP_COMPLETE' },
    })
    expect(r.design_approved).toBe(false)
    expect(r.design_approved_hash).toBe(null)
  })

  it('[Phase2] 교차 비간섭: design 승인은 base의 phase 필드(commit_allowed·approved_diff_hash) 보존', () => {
    const r = applyVerdict({
      base: { ...base, commit_allowed: true, approved_diff_hash: 'PREV' },
      binding,
      kind: 'design',
      designHash: 'DHASH',
      verdict: { review_kind: 'design', commit_approved: 'yes', status: 'STEP_COMPLETE' },
    })
    expect(r.commit_allowed).toBe(true)
    expect(r.approved_diff_hash).toBe('PREV')
    expect(r.design_approved).toBe(true)
  })

  it('[Phase2] 교차 비간섭: phase 승인은 base의 design_approved 보존', () => {
    const r = applyVerdict({
      base: { ...base, design_approved: true, design_approved_hash: 'DH' },
      binding,
      kind: 'phase',
      verdict: { review_kind: 'phase', commit_approved: 'yes', status: 'STEP_COMPLETE' },
    })
    expect(r.commit_allowed).toBe(true)
    expect(r.design_approved).toBe(true)
    expect(r.design_approved_hash).toBe('DH')
  })

  it('[Phase4] phase 승인 + phaseId → 해당 phase만 approved=true·current_phase=id', () => {
    const r = applyVerdict({
      base: { ...base, phases: [{ id: 'p1', approved: false }, { id: 'p2', approved: false }] },
      binding,
      kind: 'phase',
      phaseId: 'p1',
      verdict: { review_kind: 'phase', commit_approved: 'yes', status: 'STEP_COMPLETE' },
    })
    expect(r.commit_allowed).toBe(true)
    expect(r.approved_diff_hash).toBe('TREE')
    expect(r.current_phase).toBe('p1')
    expect(r.phases).toEqual([{ id: 'p1', approved: true }, { id: 'p2', approved: false }])
  })

  it('[Phase4] phase 미승인 + phaseId → phases/current_phase 미변경', () => {
    const r = applyVerdict({
      base: { ...base, phases: [{ id: 'p1', approved: false }] },
      binding,
      kind: 'phase',
      phaseId: 'p1',
      verdict: { review_kind: 'phase', commit_approved: 'no', status: 'NEEDS_FIX' },
    })
    expect(r.commit_allowed).toBe(false)
    expect(r.phases).toEqual([{ id: 'p1', approved: false }])
    expect(r.current_phase).toBeUndefined()
  })

  it('[Phase4] 이미 승인된 phase 재승인(멱등) — 다른 phase 불변', () => {
    const r = applyVerdict({
      base: { ...base, phases: [{ id: 'p1', approved: true }, { id: 'p2', approved: false }] },
      binding,
      kind: 'phase',
      phaseId: 'p1',
      verdict: { review_kind: 'phase', commit_approved: 'yes', status: 'STEP_COMPLETE' },
    })
    expect(r.phases).toEqual([{ id: 'p1', approved: true }, { id: 'p2', approved: false }])
    expect(r.current_phase).toBe('p1')
  })

  it('[Phase4] 레거시(phaseId 없음) phase 승인 → phases/current_phase 미변경(하위호환)', () => {
    const r = applyVerdict({
      base,
      binding,
      kind: 'phase',
      verdict: { review_kind: 'phase', commit_approved: 'yes', status: 'STEP_COMPLETE' },
    })
    expect(r.commit_allowed).toBe(true)
    expect(r.current_phase).toBeUndefined()
    expect(r.phases).toBeUndefined()
  })

  it('[Codex P3] phase 승인 시 계약 외(malformed) 형제 항목도 보존(드롭 안 함)', () => {
    const r = applyVerdict({
      base: { ...base, phases: [{ id: 'p1', approved: false }, { weird: 1 }] } as unknown as WorkflowState,
      binding,
      kind: 'phase',
      phaseId: 'p1',
      verdict: { review_kind: 'phase', commit_approved: 'yes', status: 'STEP_COMPLETE' },
    })
    expect(r.phases).toEqual([{ id: 'p1', approved: true }, { weird: 1 }])
    expect(r.current_phase).toBe('p1')
  })
})

describe('req:review-codex — 응답 처리(processResponse) fail-closed', () => {
  let dir: string | null = null
  const binding = { reviewBaseSha: 'BASE_SHA', reviewTree: 'TREE_OID' }
  const state = { id: 'REQ-2026-001', phase: 'IMPLEMENT' }
  const writeResp = (d: string, obj: unknown) =>
    writeFileSync(join(d, 'codex-response.json'), JSON.stringify(obj), 'utf8')
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = null
  })

  it('부합·승인가능 → ok, 승인 부여 + 바인딩 기록', () => {
    dir = mkdtempSync(join(tmpdir(), 'req-resp-'))
    writeResp(dir, {
      machine_schema_version: '1.1',
      review_base_sha: 'BASE_SHA',
      status: 'STEP_COMPLETE',
      commit_approved: 'yes',
      merge_ready: 'no',
      risk_level: 'LOW',
      review_kind: 'phase',
      findings: [],
      next_action: '',
    })
    const r = processResponse({ ticketDir: dir, state, binding, threadId: 'TID' })
    expect(r.ok).toBe(true)
    expect(r.nextState.commit_allowed).toBe(true)
    expect(r.nextState.approved_diff_hash).toBe('TREE_OID')
    expect(r.nextState.codex_thread_id).toBe('TID')
    expect(r.nextState.review_base_sha).toBe('BASE_SHA')
    expect(r.nextState.review_diff_hash).toBe('TREE_OID')
  })

  it('모순(commit=yes+NEEDS_FIX) → ok=false, 승인 미부여(fail-closed)', () => {
    dir = mkdtempSync(join(tmpdir(), 'req-resp-'))
    writeResp(dir, {
      machine_schema_version: '1.1',
      review_base_sha: 'BASE_SHA',
      status: 'NEEDS_FIX',
      commit_approved: 'yes',
      merge_ready: 'no',
      risk_level: 'HIGH',
      review_kind: 'phase',
      findings: [{ severity: 'P1', detail: '교차필드 모순', file: null }],
      next_action: 'status를 NEEDS_FIX로 두려면 commit_approved=no여야 한다.',
    })
    const r = processResponse({ ticketDir: dir, state, binding, threadId: 'TID' })
    expect(r.ok).toBe(false)
    expect(r.nextState.commit_allowed).toBe(false)
    expect(r.nextState.approved_diff_hash).toBe(null)
  })

  it('review_base_sha 불일치 → ok=false(바인딩 보호)', () => {
    dir = mkdtempSync(join(tmpdir(), 'req-resp-'))
    writeResp(dir, {
      machine_schema_version: '1.1',
      review_base_sha: 'WRONG',
      status: 'STEP_COMPLETE',
      commit_approved: 'yes',
      merge_ready: 'no',
      risk_level: 'LOW',
      review_kind: 'phase',
      findings: [],
      next_action: '',
    })
    const r = processResponse({ ticketDir: dir, state, binding, threadId: 'TID' })
    expect(r.ok).toBe(false)
    expect(r.nextState.commit_allowed).toBe(false)
  })

  it('[Codex P2] 파손된 NEEDS_FIX(next_action 비-문자열) → throw 없이 fail-closed', () => {
    dir = mkdtempSync(join(tmpdir(), 'req-resp-'))
    writeResp(dir, {
      machine_schema_version: '1.1',
      review_base_sha: 'BASE_SHA',
      status: 'NEEDS_FIX',
      commit_approved: 'no',
      merge_ready: 'no',
      risk_level: 'HIGH',
      review_kind: 'phase',
      findings: [{ severity: 'P1', detail: 'x', file: null }],
      next_action: 1,
    })
    let r: ReturnType<typeof processResponse> | undefined
    expect(() => {
      r = processResponse({ ticketDir: dir as string, state, binding, threadId: 'TID' })
    }).not.toThrow()
    expect(r?.ok).toBe(false)
    expect(r?.nextState.commit_allowed).toBe(false)
    expect(r?.nextState.approved_diff_hash).toBe(null)
  })

  it('codex-response.json 부재 → throw', () => {
    dir = mkdtempSync(join(tmpdir(), 'req-resp-'))
    expect(() =>
      processResponse({ ticketDir: dir as string, state, binding, threadId: 'TID' }),
    ).toThrow(/codex-response\.json 없음/)
  })

  it('[Phase2] kind=design 승인 응답 → design_approved/_hash, phase 바인딩 필드 미설정', () => {
    dir = mkdtempSync(join(tmpdir(), 'req-resp-'))
    writeResp(dir, {
      machine_schema_version: '1.1',
      review_base_sha: 'BASE_SHA',
      status: 'STEP_COMPLETE',
      commit_approved: 'yes',
      merge_ready: 'no',
      risk_level: 'LOW',
      review_kind: 'design',
      findings: [],
      next_action: '',
    })
    const r = processResponse({ ticketDir: dir, state, binding, threadId: 'TID', kind: 'design', designHash: 'DHASH' })
    expect(r.ok).toBe(true)
    expect(r.nextState.design_approved).toBe(true)
    expect(r.nextState.design_approved_hash).toBe('DHASH')
    expect(r.nextState.codex_thread_id).toBe('TID')
    expect(r.nextState.commit_allowed).toBeUndefined()
    expect(r.nextState.review_diff_hash).toBeUndefined()
  })

  it('[Codex P3] kind=design 승인 응답이지만 designHash 누락 → ok=false, design 미승인(fail-closed)', () => {
    dir = mkdtempSync(join(tmpdir(), 'req-resp-'))
    writeResp(dir, {
      machine_schema_version: '1.1',
      review_base_sha: 'BASE_SHA',
      status: 'STEP_COMPLETE',
      commit_approved: 'yes',
      merge_ready: 'no',
      risk_level: 'LOW',
      review_kind: 'design',
      findings: [],
      next_action: '',
    })
    const r = processResponse({ ticketDir: dir, state, binding, threadId: 'TID', kind: 'design' })
    expect(r.ok).toBe(false)
    expect(r.errors.join()).toContain('designHash')
    expect(r.nextState.design_approved).toBe(false)
    expect(r.nextState.design_approved_hash).toBe(null)
  })

  it('[Phase2] expectedKind 불일치(design 요청 ↔ phase 응답) → ok=false, design 미승인(fail-closed)', () => {
    dir = mkdtempSync(join(tmpdir(), 'req-resp-'))
    writeResp(dir, {
      machine_schema_version: '1.1',
      review_base_sha: 'BASE_SHA',
      status: 'STEP_COMPLETE',
      commit_approved: 'yes',
      merge_ready: 'no',
      risk_level: 'LOW',
      review_kind: 'phase',
      findings: [],
      next_action: '',
    })
    const r = processResponse({ ticketDir: dir, state, binding, threadId: 'TID', kind: 'design', designHash: 'DHASH' })
    expect(r.ok).toBe(false)
    expect(r.errors.join()).toContain('review_kind 불일치')
    expect(r.nextState.design_approved).toBe(false)
    expect(r.nextState.design_approved_hash).toBe(null)
  })

  it('[Phase2] expectedKind 불일치(phase 요청 ↔ design 응답) → ok=false, phase 미승인', () => {
    dir = mkdtempSync(join(tmpdir(), 'req-resp-'))
    writeResp(dir, {
      machine_schema_version: '1.1',
      review_base_sha: 'BASE_SHA',
      status: 'STEP_COMPLETE',
      commit_approved: 'yes',
      merge_ready: 'no',
      risk_level: 'LOW',
      review_kind: 'design',
      findings: [],
      next_action: '',
    })
    const r = processResponse({ ticketDir: dir, state, binding, threadId: 'TID', kind: 'phase' })
    expect(r.ok).toBe(false)
    expect(r.nextState.commit_allowed).toBe(false)
  })

  it('[Phase2] 교차 비간섭: design 리뷰 실패가 base의 phase 승인(commit_allowed) 미변경', () => {
    dir = mkdtempSync(join(tmpdir(), 'req-resp-'))
    writeResp(dir, {
      machine_schema_version: '1.1',
      review_base_sha: 'BASE_SHA',
      status: 'NEEDS_FIX',
      commit_approved: 'no',
      merge_ready: 'no',
      risk_level: 'HIGH',
      review_kind: 'phase',
      findings: [{ severity: 'P1', detail: 'x', file: null }],
      next_action: '고쳐라',
    })
    const r = processResponse({
      ticketDir: dir,
      state: { ...state, commit_allowed: true, approved_diff_hash: 'PREV' },
      binding,
      threadId: 'TID',
      kind: 'design',
      designHash: 'DHASH',
    })
    expect(r.ok).toBe(false)
    expect(r.nextState.design_approved).toBe(false)
    expect(r.nextState.commit_allowed).toBe(true)
    expect(r.nextState.approved_diff_hash).toBe('PREV')
  })

  const approvingPhase = {
    machine_schema_version: '1.1',
    review_base_sha: 'BASE_SHA',
    status: 'STEP_COMPLETE',
    commit_approved: 'yes',
    merge_ready: 'no',
    risk_level: 'LOW',
    review_kind: 'phase',
    findings: [],
    next_action: '',
  }

  it('[Phase4] tracked phase 승인 + designValid=true → phases[id].approved·current_phase·commit_allowed', () => {
    dir = mkdtempSync(join(tmpdir(), 'req-resp-'))
    writeResp(dir, approvingPhase)
    const r = processResponse({
      ticketDir: dir,
      state: { ...state, phases: [{ id: 'p1', approved: false }] },
      binding,
      threadId: 'TID',
      kind: 'phase',
      phaseId: 'p1',
      designValid: true,
    })
    expect(r.ok).toBe(true)
    expect(r.nextState.commit_allowed).toBe(true)
    expect(r.nextState.current_phase).toBe('p1')
    expect(r.nextState.phases).toEqual([{ id: 'p1', approved: true }])
  })

  it('[Phase4] tracked phase인데 designValid=false → ok=false, phase 미승인(D13 전제)', () => {
    dir = mkdtempSync(join(tmpdir(), 'req-resp-'))
    writeResp(dir, approvingPhase)
    const r = processResponse({
      ticketDir: dir,
      state: { ...state, phases: [{ id: 'p1', approved: false }] },
      binding,
      threadId: 'TID',
      kind: 'phase',
      phaseId: 'p1',
      designValid: false,
    })
    expect(r.ok).toBe(false)
    expect(r.errors.join()).toContain('design 승인')
    expect(r.nextState.commit_allowed).toBe(false)
    expect(r.nextState.phases).toEqual([{ id: 'p1', approved: false }])
  })

  it('[Phase4] tracked phase에 review_kind=design 응답 오염 → kindMismatch fail-closed', () => {
    dir = mkdtempSync(join(tmpdir(), 'req-resp-'))
    writeResp(dir, { ...approvingPhase, review_kind: 'design' })
    const r = processResponse({
      ticketDir: dir,
      state: { ...state, phases: [{ id: 'p1', approved: false }] },
      binding,
      threadId: 'TID',
      kind: 'phase',
      phaseId: 'p1',
      designValid: true,
    })
    expect(r.ok).toBe(false)
    expect(r.nextState.commit_allowed).toBe(false)
    expect(r.nextState.phases).toEqual([{ id: 'p1', approved: false }])
  })

  it('[Phase4] 레거시(phaseId 없음) phase 승인 → designValid 불요, 기존 동작', () => {
    dir = mkdtempSync(join(tmpdir(), 'req-resp-'))
    writeResp(dir, approvingPhase)
    const r = processResponse({ ticketDir: dir, state, binding, threadId: 'TID', kind: 'phase' })
    expect(r.ok).toBe(true)
    expect(r.nextState.commit_allowed).toBe(true)
    expect(r.nextState.current_phase).toBeUndefined()
  })
})

describe('req:review-codex — state 기록(writeState)', () => {
  let dir: string | null = null
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = null
  })
  it('BOM 없이 기록하고 loadState로 라운드트립', () => {
    dir = mkdtempSync(join(tmpdir(), 'req-write-'))
    writeState(dir, { id: 'REQ-2026-001', phase: 'IMPLEMENT', commit_allowed: false })
    const raw = readFileSync(join(dir, 'state.json'), 'utf8')
    expect(raw.charCodeAt(0)).not.toBe(0xfeff) // BOM 없음
    const s = loadState(dir as string)
    expect(s.id).toBe('REQ-2026-001')
  })
})

describe('req:review-codex — thread_id 파싱(parseThreadId)', () => {
  it('thread.started 이벤트에서 thread_id 추출', () => {
    const jsonl = ['{"type":"thread.started","thread_id":"019eeb6b-1234"}', '{"type":"turn.started"}'].join('\n')
    expect(parseThreadId(jsonl)).toBe('019eeb6b-1234')
  })
  it('thread.started 없으면 null', () => {
    expect(parseThreadId('{"type":"turn.started"}')).toBe(null)
  })
  it('비-JSON 라인은 무시하고 탐색', () => {
    expect(parseThreadId('noise line\n{"type":"thread.started","thread_id":"X"}\n')).toBe('X')
  })
})

describe('req:review-codex — 리뷰용 클린 검사(findUnstagedOrUntracked, exact path)', () => {
  const allow = ['workflow/REQ-1/codex-response.json', 'workflow/REQ-1/.review-preview.txt']
  it('현재 티켓 산출물 + staged-only면 클린([])', () => {
    const lines = ['M  scripts/x.ts', '?? workflow/REQ-1/codex-response.json', '?? workflow/REQ-1/.review-preview.txt']
    expect(findUnstagedOrUntracked(lines, allow)).toEqual([])
  })
  it('unstaged(worktree dirty)는 감지', () => {
    expect(findUnstagedOrUntracked([' M scripts/x.ts'], allow)).toEqual([' M scripts/x.ts'])
  })
  it('untracked(비-스크래치)는 감지', () => {
    expect(findUnstagedOrUntracked(['?? src/new.ts'], allow)).toEqual(['?? src/new.ts'])
  })
  it('staged+unstaged(MM)는 감지(worktree dirty)', () => {
    expect(findUnstagedOrUntracked(['MM scripts/x.ts'], allow)).toEqual(['MM scripts/x.ts'])
  })
  it('[Codex P1-1] 호출 전부터 dirty였던 파일도 절대검사로 감지', () => {
    const dirty = [' M scripts/req/review-codex.ts']
    expect(findUnstagedOrUntracked(dirty, allow)).toEqual(dirty)
  })
  it('[Codex P1-2] 다른 티켓의 동명 산출물은 감지(exact path — substring 오인 방지)', () => {
    const other = ['?? workflow/REQ-2/codex-response.json']
    expect(findUnstagedOrUntracked(other, allow)).toEqual(other)
  })
  it('[Codex P1-2] 확장자 변형(.bak/.ts)·다른 디렉터리는 감지', () => {
    const lines = ['?? workflow/REQ-1/codex-response.json.bak', ' M src/codex-response.json.ts']
    expect(findUnstagedOrUntracked(lines, allow)).toEqual(lines)
  })
  it('[4C e2e] state.json이 허용목록(현재 티켓)이면 제외(review 후 unstaged 통과)', () => {
    const allowWithState = [...allow, 'workflow/REQ-1/state.json']
    expect(findUnstagedOrUntracked([' M workflow/REQ-1/state.json'], allowWithState)).toEqual([])
  })
})

// ───────────────────────────────────────────────── [REQ-016 A1] evidence ──
describe('[A1] 아카이브 파일명/round (deterministic)', () => {
  it('archiveBaseName: design은 phaseId 무시하고 design, phase는 phaseId(없으면 phase)', () => {
    expect(archiveBaseName('design', null)).toBe('design')
    expect(archiveBaseName('design', 'phase-A')).toBe('design')
    expect(archiveBaseName('phase', 'phase-A')).toBe('phase-A')
    expect(archiveBaseName('phase', null)).toBe('phase')
  })
  it('archiveFileName: r 두자리 zero-pad + status', () => {
    expect(archiveFileName('design', 1, 'needs-fix')).toBe('design-r01-needs-fix.json')
    expect(archiveFileName('phase-A', 3, 'approved')).toBe('phase-A-r03-approved.json')
  })
  it('nextArchiveRound: 같은 입력=같은 결과, needs-fix+approved 시퀀스 공유', () => {
    expect(nextArchiveRound([], 'design')).toBe(1)
    expect(nextArchiveRound(['design-r01-needs-fix.json'], 'design')).toBe(2)
    expect(
      nextArchiveRound(['design-r01-needs-fix.json', 'design-r02-approved.json'], 'design'),
    ).toBe(3)
    // 멱등: 동일 입력 반복 호출 동일 결과
    expect(nextArchiveRound(['phase-A-r01-needs-fix.json', 'phase-A-r02-needs-fix.json'], 'phase-A')).toBe(3)
  })
  it('nextArchiveRound: design/phase target은 round namespace 분리', () => {
    const files = ['design-r05-approved.json']
    expect(nextArchiveRound(files, 'phase-A')).toBe(1) // design 라운드는 phase-A에 영향 없음
    expect(nextArchiveRound(files, 'design')).toBe(6)
  })
  it('isArchiveFileName: 아카이브 패턴만 true(approvals.jsonl/codex-response.json 등 false)', () => {
    expect(isArchiveFileName('design-r01-needs-fix.json')).toBe(true)
    expect(isArchiveFileName('phase-A-r03-approved.json')).toBe(true)
    expect(isArchiveFileName('approvals.jsonl')).toBe(false)
    expect(isArchiveFileName('codex-response.json')).toBe(false)
    expect(isArchiveFileName('design-r1-approved.json')).toBe(false) // r 한자리 거부
  })
})

describe('[A1] 스크래치 매처(isAllowedResponsesScratch) — status code 기준', () => {
  const T = 'workflow/REQ-2026-016'
  it('현재 티켓 responses/ 하위 untracked 아카이브 → 허용', () => {
    expect(isAllowedResponsesScratch(`?? ${T}/responses/design-r01-needs-fix.json`, T)).toBe(true)
    expect(isAllowedResponsesScratch(`?? ${T}/responses/phase-A-r03-approved.json`, T)).toBe(true)
  })
  it('approvals.jsonl(untracked)는 스크래치 아님 → FAIL', () => {
    expect(isAllowedResponsesScratch(`?? ${T}/responses/approvals.jsonl`, T)).toBe(false)
  })
  it('tracked evidence 수정/삭제/리네임 → FAIL', () => {
    expect(isAllowedResponsesScratch(` M ${T}/responses/design-r01-approved.json`, T)).toBe(false)
    expect(isAllowedResponsesScratch(`D  ${T}/responses/design-r01-approved.json`, T)).toBe(false)
    expect(isAllowedResponsesScratch(`R  ${T}/responses/design-r01-approved.json -> ${T}/responses/x.json`, T)).toBe(false)
  })
  it('다른 티켓/현재 티켓 밖 패턴 → FAIL', () => {
    expect(isAllowedResponsesScratch(`?? workflow/REQ-2026-999/responses/design-r01-approved.json`, T)).toBe(false)
    expect(isAllowedResponsesScratch(`?? ${T}/responses/sub/design-r01-approved.json`, T)).toBe(false)
  })
})

describe('[A1] processResponse — 승인 증거 핀(kind 격리 / NEEDS_FIX 분리)', () => {
  const dirs: string[] = []
  const mkTicket = (verdict: unknown): string => {
    const dir = mkdtempSync(join(tmpdir(), 'req-a1-'))
    dirs.push(dir)
    writeFileSync(join(dir, 'codex-response.json'), JSON.stringify(verdict), 'utf8')
    return dir
  }
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true })
  })

  const phaseApproved = {
    machine_schema_version: '1.1', review_base_sha: 'BASE', status: 'COMPLETE',
    commit_approved: 'yes', merge_ready: 'yes', risk_level: 'LOW', review_kind: 'phase',
    findings: [], next_action: 'done',
  }
  const designApproved = { ...phaseApproved, review_kind: 'design' }
  const phaseNeedsFix = {
    machine_schema_version: '1.1', review_base_sha: 'BASE', status: 'NEEDS_FIX',
    commit_approved: 'no', merge_ready: 'no', risk_level: 'LOW', review_kind: 'phase',
    findings: [{ severity: 'P2', detail: 'x', file: null }], next_action: 'fix',
  }
  const state: WorkflowState = { id: 'REQ-2026-016', phase: 'PHASE-A', branch: 'feat/req-2026-016-x' }
  const binding = { reviewBaseSha: 'BASE', reviewTree: 'TREE9' }

  it('phase 승인 → approval_evidence(approved_tree===reviewTree), design_approval_evidence 미오염', () => {
    const dir = mkTicket(phaseApproved)
    const r = processResponse({
      ticketDir: dir, state, binding, threadId: 'TID', kind: 'phase', phaseId: null,
      archive: { path: 'workflow/REQ-2026-016/responses/phase-r01-approved.json', sha256: 'SHA' },
      approvedAt: 'AT',
    } as Parameters<typeof processResponse>[0])
    expect(r.ok).toBe(true)
    expect(r.nextState.commit_allowed).toBe(true)
    expect(r.nextState.approval_evidence).toEqual({
      response_path: 'workflow/REQ-2026-016/responses/phase-r01-approved.json',
      response_sha256: 'SHA', review_kind: 'phase', phase_id: null, review_base_sha: 'BASE',
      approved_tree: 'TREE9', codex_thread_id: 'TID', machine_schema_version: '1.1',
      status: 'COMPLETE', commit_approved: 'yes', approved_at: 'AT',
    })
    expect(r.nextState.design_approval_evidence).toBeUndefined()
  })

  it('design 승인 → design_approval_evidence(design_hash===designApprovedHash), approval_evidence 미오염', () => {
    const dir = mkTicket(designApproved)
    const r = processResponse({
      ticketDir: dir, state, binding, threadId: 'TID2', kind: 'design', designHash: 'DHASH',
      archive: { path: 'workflow/REQ-2026-016/responses/design-r02-approved.json', sha256: 'SHA2' },
      approvedAt: 'AT2',
    } as Parameters<typeof processResponse>[0])
    expect(r.ok).toBe(true)
    expect(r.nextState.design_approved).toBe(true)
    expect(r.nextState.design_approved_hash).toBe('DHASH')
    expect(r.nextState.design_approval_evidence).toEqual({
      response_path: 'workflow/REQ-2026-016/responses/design-r02-approved.json',
      response_sha256: 'SHA2', review_kind: 'design', phase_id: null, review_base_sha: 'BASE',
      design_hash: 'DHASH', codex_thread_id: 'TID2', machine_schema_version: '1.1',
      status: 'COMPLETE', commit_approved: 'yes', approved_at: 'AT2',
    })
    expect(r.nextState.approval_evidence).toBeUndefined()
  })

  it('NEEDS_FIX → archive는 별도 생성 대상이나 approval_evidence는 미생성·commit_allowed false·approved hash 미갱신', () => {
    const dir = mkTicket(phaseNeedsFix)
    const r = processResponse({
      ticketDir: dir, state, binding, threadId: 'TID3', kind: 'phase', phaseId: null,
      archive: { path: 'workflow/REQ-2026-016/responses/phase-r01-needs-fix.json', sha256: 'SHA3' },
      approvedAt: 'AT3',
    } as Parameters<typeof processResponse>[0])
    expect(r.nextState.approval_evidence).toBeUndefined()
    expect(r.nextState.design_approval_evidence).toBeUndefined()
    expect(r.nextState.commit_allowed).toBe(false)
    expect(r.nextState.approved_diff_hash ?? null).toBe(null)
    // needs-fix도 아카이브 파일명 계산 대상(내구 보존 — R4 P2-1)
    expect(archiveFileName(archiveBaseName('phase', null), 1, 'needs-fix')).toBe('phase-r01-needs-fix.json')
  })

  // [A1-P2-1] 같은 kind의 stale evidence는 매 처리 시작 시 제거, fresh archive일 때만 재부착. 반대 kind는 보존.
  const OLD_PHASE_EV = {
    response_path: 'workflow/REQ-2026-016/responses/phase-A1-evidence-mechanism-r01-approved.json',
    response_sha256: 'OLDP', review_kind: 'phase', phase_id: 'phase-A1-evidence-mechanism',
    review_base_sha: 'OLD', approved_tree: 'OLDTREE', codex_thread_id: 'OLDTID',
    machine_schema_version: '1.1', status: 'COMPLETE', commit_approved: 'yes', approved_at: 'OLD',
  }
  const OLD_DESIGN_EV = {
    response_path: 'workflow/REQ-2026-016/responses/design-r02-approved.json',
    response_sha256: 'OLDD', review_kind: 'design', phase_id: null,
    review_base_sha: 'OLD', design_hash: 'OLDDH', codex_thread_id: 'OLDTID',
    machine_schema_version: '1.1', status: 'COMPLETE', commit_approved: 'yes', approved_at: 'OLD',
  }

  it('[A1-P2-1] phase NEEDS_FIX → 기존 approval_evidence 제거, design_approval_evidence 보존', () => {
    const dir = mkTicket(phaseNeedsFix)
    const r = processResponse({
      ticketDir: dir,
      state: { ...state, approval_evidence: OLD_PHASE_EV, design_approval_evidence: OLD_DESIGN_EV },
      binding, threadId: 'T', kind: 'phase', phaseId: null,
      archive: { path: 'workflow/REQ-2026-016/responses/phase-r01-needs-fix.json', sha256: 'S' },
      approvedAt: 'A',
    } as Parameters<typeof processResponse>[0])
    expect(r.nextState.commit_allowed).toBe(false)
    expect(r.nextState.approval_evidence).toBeUndefined() // stale 제거
    expect(r.nextState.design_approval_evidence).toEqual(OLD_DESIGN_EV) // 반대 kind 보존
  })

  it('[A1-P2-1] archive 생략 phase 승인 → 기존 approval_evidence 미재사용(제거), commit_allowed는 승인 로직대로', () => {
    const dir = mkTicket(phaseApproved)
    const r = processResponse({
      ticketDir: dir,
      state: { ...state, approval_evidence: OLD_PHASE_EV },
      binding, threadId: 'T', kind: 'phase', phaseId: null,
      approvedAt: 'A', // archive 생략
    } as Parameters<typeof processResponse>[0])
    expect(r.nextState.commit_allowed).toBe(true)
    expect(r.nextState.approval_evidence).toBeUndefined() // archive 없으면 옛 증거 재사용 금지
  })

  it('[A1-P2-1] archive 생략 design 승인 → 기존 design_approval_evidence 제거, approval_evidence 보존', () => {
    const dir = mkTicket(designApproved)
    const r = processResponse({
      ticketDir: dir,
      state: { ...state, design_approval_evidence: OLD_DESIGN_EV, approval_evidence: OLD_PHASE_EV },
      binding, threadId: 'T', kind: 'design', designHash: 'DHASH',
      approvedAt: 'A', // archive 생략
    } as Parameters<typeof processResponse>[0])
    expect(r.nextState.design_approved).toBe(true)
    expect(r.nextState.design_approval_evidence).toBeUndefined() // archive 없으면 옛 증거 재사용 금지
    expect(r.nextState.approval_evidence).toEqual(OLD_PHASE_EV) // 반대 kind 보존
  })
})

// ───────────────────────────── [A2-fix2] rename/copy 가드 + archiveDecision ──
describe('[A2-fix2] findUnstagedOrUntracked — responses/ rename·copy 주입 차단', () => {
  const T = 'workflow/REQ-2026-016'
  const arch = `${T}/responses/phase-A1-evidence-mechanism-r01-approved.json`
  it('외부→responses/ rename 주입 → flag', () => {
    const l = `R  outside.json -> ${arch}`
    expect(findUnstagedOrUntracked([l], [], T)).toEqual([l])
  })
  it('responses/→외부 rename → flag', () => {
    const l = `R  ${arch} -> outside.json`
    expect(findUnstagedOrUntracked([l], [], T)).toEqual([l])
  })
  it('외부→responses/ copy 주입 → flag', () => {
    const l = `C  outside.json -> ${arch}`
    expect(findUnstagedOrUntracked([l], [], T)).toEqual([l])
  })
  it('정상 untracked 아카이브는 계속 허용(회귀 가드)', () => {
    expect(findUnstagedOrUntracked([`?? ${arch}`], [], T)).toEqual([])
  })
  it('collapsed responses/ 디렉터리 라인은 허용 안 함(개별 파일=--untracked-files=all 필요)', () => {
    const dir = `?? ${T}/responses/`
    expect(findUnstagedOrUntracked([dir], [], T)).toEqual([dir])
  })
})

describe('[A2-fix2] archiveDecision — 검증된 result로 suffix 결정', () => {
  const ns = (over: Partial<WorkflowState>): WorkflowState => ({ id: 'X', phase: 'P', ...over } as WorkflowState)
  it('result.ok=false(무효/kind 불일치) → null(아카이브 안 함)', () => {
    expect(archiveDecision({ ok: false, nextState: ns({ commit_allowed: true }) }, 'phase')).toBe(null)
    expect(archiveDecision({ ok: false, nextState: ns({ design_approved: true }) }, 'design')).toBe(null)
  })
  it('valid NEEDS_FIX(승인 아님) → needs-fix', () => {
    expect(archiveDecision({ ok: true, nextState: ns({ commit_allowed: false }) }, 'phase')).toBe('needs-fix')
    expect(archiveDecision({ ok: true, nextState: ns({ design_approved: false }) }, 'design')).toBe('needs-fix')
  })
  it('valid 승인 → approved', () => {
    expect(archiveDecision({ ok: true, nextState: ns({ commit_allowed: true }) }, 'phase')).toBe('approved')
    expect(archiveDecision({ ok: true, nextState: ns({ design_approved: true }) }, 'design')).toBe('approved')
  })
})
