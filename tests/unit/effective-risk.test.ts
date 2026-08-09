/**
 * phase 실효 위험 감지(REQ-2026-119) — 순수 매처 + D31 판정·경계.
 */
import { describe, it, expect } from 'vitest'
import { effectiveRiskHits, DEFAULT_RISK_PATTERNS } from '../../scripts/req/lib/effective-risk'
import { runChecks, type DoctorInputs, type Check } from '../../scripts/req/req-doctor'

describe('effectiveRiskHits — 소문자 부분 문자열 매치(설계 DEC-1)', () => {
  it('일치 패턴별로 count와 대표 경로(≤3)를 낸다', () => {
    const staged = ['src/payment/webhook.ts', 'src/payment/api.ts', 'docs/readme.md']
    const hits = effectiveRiskHits(staged, ['payment', 'webhook', 'nothing'])
    expect(hits).toEqual([
      { pattern: 'payment', count: 2, samples: ['src/payment/webhook.ts', 'src/payment/api.ts'] },
      { pattern: 'webhook', count: 1, samples: ['src/payment/webhook.ts'] },
    ])
  })
  it('대소문자 무관 매치', () => {
    expect(effectiveRiskHits(['SRC/Payment/X.TS'], ['payment'])).toHaveLength(1)
    expect(effectiveRiskHits(['src/x.ts'], ['PAYMENT'])).toHaveLength(0)
  })
  it('samples는 3개 상한(메시지 폭주 방지)', () => {
    const staged = ['a/migration1', 'b/migration2', 'c/migration3', 'd/migration4']
    const hit = effectiveRiskHits(staged, ['migration'])[0]!
    expect(hit.count).toBe(4)
    expect(hit.samples).toHaveLength(3)
  })
  it('빈 패턴은 무시한다(전 경로 일치 오탐 방지)', () => {
    expect(effectiveRiskHits(['anything.ts'], [''])).toHaveLength(0)
  })
  it('기본 목록은 이 저장소의 통상 경로에 오탐하지 않는다(완료 기준 2 — 기본 목록 과대 방지)', () => {
    // 이 저장소에서 실제로 staged되는 대표 경로들 — schema·token·auth류 오탐이 없어야 한다.
    const typicalRepoPaths = [
      'scripts/req/req-doctor.ts',
      'scripts/req/lib/config.ts',
      'workflow/machine.schema.json',
      'workflow/REQ-2026-119/01-design.md',
      'tests/unit/req-doctor.test.ts',
      'docs/ssot-design/07-business-rules-and-state-machines.md',
      'bin/verify-range.ts',
      'CHANGELOG.md',
      '.github/workflows/ci.yml',
    ]
    expect(effectiveRiskHits(typicalRepoPaths, DEFAULT_RISK_PATTERNS)).toEqual([])
  })
  it('기본 목록이 대표 민감 경로를 잡는다', () => {
    for (const p of ['.env.production', 'src/secrets/keys.ts', 'db/migrations/001-add.sql', 'src/pay/payment-webhook.ts']) {
      expect(effectiveRiskHits([p], DEFAULT_RISK_PATTERNS).length, `미감지: ${p}`).toBeGreaterThan(0)
    }
  })
})

describe('D31 — WARN 상한·점검 불요 경계(설계 DEC-3)', () => {
  const base: DoctorInputs = {
    state: { id: 'REQ-2026-999', branch: 'feat/req-2026-999-x', phase: 'IMPLEMENT', commit_allowed: false, risk_level: 'LOW' } as never,
    currentBranch: 'feat/req-2026-999-x',
    branchExists: true,
    branchPrefix: 'feat/req-',
    stagedTree: 'TREE',
    statusEntries: [],
    scratch: ['workflow/REQ-2026-999/codex-response.json'],
    responseVerdict: null,
    responseStructureOk: false,
    designApproved: false,
    designApprovedHash: null,
    currentDesignHash: null,
    ticketDocs: [],
    ticketRel: 'workflow/REQ-2026-999',
  }
  const d31 = (over: Partial<DoctorInputs>): Check => {
    const found = runChecks({ ...base, ...over }).find((c) => c.id === 'D31')
    if (!found) throw new Error('D31 미발화')
    return found
  }

  it('riskHits 미계산(undefined) → OK 점검 불요', () => {
    expect(d31({}).level).toBe('OK')
  })
  it('일치 없음 → OK', () => {
    expect(d31({ riskHits: [] }).level).toBe('OK')
  })
  it('일치 있음 → WARN + 패턴·샘플·티켓 위험도 표기, subjects 없음(경로는 로그 허용 목록 밖)', () => {
    const c = d31({ riskHits: [{ pattern: 'payment', count: 2, samples: ['src/payment/webhook.ts'] }] })
    expect(c.level).toBe('WARN')
    expect(c.msg).toContain('payment')
    expect(c.msg).toContain('src/payment/webhook.ts')
    expect(c.msg).toContain('LOW') // 티켓 위험도와 별개임을 보여준다
    expect(c.subjects).toBeUndefined()
  })
  it('🔴 D31은 어떤 입력에서도 FAIL이 아니다(완료 기준 4 — 침묵 게이트화 방지)', () => {
    const worst = d31({ riskHits: [{ pattern: '.env', count: 99, samples: ['.env'] }] })
    expect(worst.level).toBe('WARN')
    // 코드 수준 고정: D31 push 지점의 level 리터럴이 OK/WARN뿐인 것은 위 두 케이스가 함께 고정한다.
  })
})
