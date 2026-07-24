import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  serializeCloseProofRow,
  parseCloseProof,
  appendCloseProofRow,
  closeProofRowProblems,
  closeProofRowKey,
  closeProofPath,
  deriveBaseState,
  isReconstructed,
  baseStateBlocksIntake,
  CLOSE_PROOF_KEYS,
  CLOSE_PROOF_BASENAME,
  type CloseProofRow,
  type CloseStateInput,
} from '../../scripts/req/lib/close-proof'

/**
 * close proof 코어(REQ-2026-052 phase-1) — 순수 함수만. fs·git 무의존.
 * ⚠️ 기대값은 이 파일 안 리터럴(tautology 회피). 개행 정규화 필요 없음(직렬화가 LF 고정).
 */

const terminal = (over: Partial<CloseProofRow> = {}): CloseProofRow => ({
  ticket_id: 'REQ-2026-052',
  event: 'series-terminal',
  series_id: 'design:-#1',
  resolution: 'replace',
  phase_inventory: null,
  design_ref: null,
  at: '2026-07-24T05:00:00.000Z',
  reconstructed: false,
  evidence_basis: null,
  ...over,
})

const devComplete = (over: Partial<CloseProofRow> = {}): CloseProofRow => ({
  ticket_id: 'REQ-2026-052',
  event: 'dev-complete',
  series_id: null,
  resolution: null,
  phase_inventory: ['phase-1-a', 'phase-2-b'],
  design_ref: 'd'.repeat(64),
  at: '2026-07-24T05:00:00.000Z',
  reconstructed: false,
  evidence_basis: null,
  ...over,
})

const baseInput = (over: Partial<CloseStateInput> = {}): CloseStateInput => ({
  durabilityRequired: true,
  closeProofRows: [],
  ledgerHasApprovedClose: false,
  committedEvidenceComplete: false,
  evidencedPhaseIds: [],
  committedDesignRef: null,
  ...over,
})

describe('[close-proof] 경로·상수', () => {
  it('responses/ticket-close.jsonl', () => {
    expect(closeProofPath('workflow/REQ-2026-052')).toBe('workflow/REQ-2026-052/responses/ticket-close.jsonl')
    expect(CLOSE_PROOF_BASENAME).toBe('ticket-close.jsonl')
  })
})

describe('[close-proof] ① 직렬화 — 고정 키 순서 + 끝 개행', () => {
  it('키 순서가 고정이다(리터럴 대조)', () => {
    const line = serializeCloseProofRow(devComplete())
    expect(line.endsWith('\n')).toBe(true)
    expect(Object.keys(JSON.parse(line))).toEqual([
      'ticket_id',
      'event',
      'series_id',
      'resolution',
      'phase_inventory',
      'design_ref',
      'at',
      'reconstructed',
      'evidence_basis',
    ])
  })
  it('⑦ 본문(prompt/response)이 들어갈 키가 없다', () => {
    const keys = new Set<string>(CLOSE_PROOF_KEYS)
    for (const forbidden of ['prompt', 'response', 'body', 'text', 'findings', 'detail'])
      expect(keys.has(forbidden)).toBe(false)
  })
})

describe('[close-proof] ② round-trip', () => {
  it('series-terminal round-trip', () => {
    const { rows, problems } = parseCloseProof(serializeCloseProofRow(terminal()))
    expect(problems).toEqual([])
    expect(rows).toEqual([terminal()])
  })
  it('dev-complete round-trip', () => {
    const { rows, problems } = parseCloseProof(serializeCloseProofRow(devComplete()))
    expect(problems).toEqual([])
    expect(rows).toEqual([devComplete()])
  })
})

describe('[close-proof] ③ 멱등 append', () => {
  it('같은 자연키 + 동일 내용 → duplicate · 불변', () => {
    const first = appendCloseProofRow('', devComplete())
    expect(first.outcome).toBe('appended')
    const again = appendCloseProofRow(first.content, devComplete())
    expect(again.outcome).toBe('duplicate')
    expect(again.content).toBe(first.content)
  })
  it('같은 자연키 + 다른 내용 → conflict · 덮지 않음', () => {
    const first = appendCloseProofRow('', terminal({ resolution: 'replace' }))
    const conflict = appendCloseProofRow(first.content, terminal({ resolution: 'human-resolution' }))
    expect(conflict.outcome).toBe('conflict')
    expect(conflict.content).toBe(first.content)
  })
  it('다른 series의 series-terminal은 정상 append', () => {
    const a = appendCloseProofRow('', terminal({ series_id: 'design:-#1' }))
    const b = appendCloseProofRow(a.content, terminal({ series_id: 'phase:p1#1' }))
    expect(b.outcome).toBe('appended')
    expect(parseCloseProof(b.content).rows.length).toBe(2)
  })
})

describe('[close-proof] ④ 손상 fail-closed', () => {
  it('손상된 기존 본문 위에는 append 안 함', () => {
    const r = appendCloseProofRow('{broken', devComplete())
    expect(r.outcome).toBe('conflict')
    expect(r.content).toBe('{broken')
  })
  it('파싱 불가 행을 problems로 드러낸다', () => {
    expect(parseCloseProof(`${serializeCloseProofRow(devComplete())}{x\n`).problems.some((p) => p.includes('line 2'))).toBe(true)
  })
})

describe('[close-proof] ⑤ 키 거부 / 교차필드', () => {
  it('모르는 top-level 키 거부', () => {
    expect(closeProofRowProblems({ ...devComplete(), prompt: 'x' }).join(' ')).toContain('알 수 없는 키: prompt')
  })
  it('dev-complete인데 series_id가 있으면 거부', () => {
    expect(closeProofRowProblems(devComplete({ series_id: 'x' })).join(' ')).toContain('dev-complete인데 series_id')
  })
  it('series-terminal인데 series_id 없으면 거부', () => {
    expect(closeProofRowProblems(terminal({ series_id: '' })).join(' ')).toContain('series_id가 비어 있음')
  })
  it('resolution은 닫힌 집합', () => {
    expect(closeProofRowProblems(terminal({ resolution: 'maybe' as never })).join(' ')).toContain('resolution 부적합')
  })
  it('reconstructed:true인데 근거 없으면 거부(근거 없는 복원 금지)', () => {
    expect(closeProofRowProblems(devComplete({ reconstructed: true, evidence_basis: null })).join(' ')).toContain('근거 없는 복원')
  })
  it('원본(reconstructed:false)인데 evidence_basis 있으면 거부', () => {
    expect(closeProofRowProblems(devComplete({ reconstructed: false, evidence_basis: ['x'] })).join(' ')).toContain('원본 행')
  })
  it('정상 복원 행(reconstructed:true + 근거)은 통과', () => {
    expect(closeProofRowProblems(devComplete({ reconstructed: true, evidence_basis: ['workflow/REQ-2026-052/responses/design-r01-approved.json'] }))).toEqual([])
  })
})

describe('[close-proof] ⑥ 기본 상태 파생 — 배타·완결', () => {
  it('durability marker 없음 → legacy', () => {
    expect(deriveBaseState(baseInput({ durabilityRequired: false }))).toBe('legacy')
  })
  it('series-terminal 행 있음 → series-terminal', () => {
    expect(deriveBaseState(baseInput({ closeProofRows: [terminal()] }))).toBe('series-terminal')
  })
  it('🔴 self-verify: dev-complete 행 + inventory 전 phase 증거 + design_ref 일치 → dev-complete', () => {
    const dc = devComplete({ phase_inventory: ['p1', 'p2'], design_ref: 'DREF' })
    expect(
      deriveBaseState(baseInput({ closeProofRows: [dc], evidencedPhaseIds: ['p1', 'p2', 'other'], committedDesignRef: 'DREF' })),
    ).toBe('dev-complete')
  })
  it('🔴 self-verify: inventory 중 하나라도 증거 없으면 dev-complete 아님(→developing)', () => {
    const dc = devComplete({ phase_inventory: ['p1', 'p2'], design_ref: 'DREF' })
    expect(deriveBaseState(baseInput({ closeProofRows: [dc], evidencedPhaseIds: ['p1'], committedDesignRef: 'DREF' }))).toBe('developing')
  })
  it('🔴 self-verify: design_ref 불일치(재승인 모사)면 dev-complete 아님(→developing)', () => {
    const dc = devComplete({ phase_inventory: ['p1'], design_ref: 'OLD' })
    expect(deriveBaseState(baseInput({ closeProofRows: [dc], evidencedPhaseIds: ['p1'], committedDesignRef: 'NEW' }))).toBe('developing')
  })
  it('🔴 self-verify: committedDesignRef가 null이면 dev-complete 아님', () => {
    const dc = devComplete({ phase_inventory: ['p1'], design_ref: 'DREF' })
    expect(deriveBaseState(baseInput({ closeProofRows: [dc], evidencedPhaseIds: ['p1'], committedDesignRef: null }))).toBe('developing')
  })
  it('원장 approved closed 있으나 HEAD 증거 불완전 → needs-recovery', () => {
    expect(deriveBaseState(baseInput({ ledgerHasApprovedClose: true, committedEvidenceComplete: false }))).toBe('needs-recovery')
  })
  it('그 외(승인 흔적 없음) → developing', () => {
    expect(deriveBaseState(baseInput())).toBe('developing')
  })
  it('opened만 durable(예산 사용·미확정)도 developing으로 떨어진다', () => {
    expect(deriveBaseState(baseInput({ ledgerHasApprovedClose: false }))).toBe('developing')
  })
  it('우선순위: legacy가 다른 신호를 이긴다', () => {
    const dc = devComplete({ phase_inventory: ['p1'], design_ref: 'DREF' })
    expect(deriveBaseState(baseInput({ durabilityRequired: false, closeProofRows: [dc], evidencedPhaseIds: ['p1'], committedDesignRef: 'DREF' }))).toBe('legacy')
  })
  it('우선순위: series-terminal이 dev-complete를 이긴다', () => {
    const dc = devComplete({ phase_inventory: ['p1'], design_ref: 'DREF' })
    expect(deriveBaseState(baseInput({ closeProofRows: [terminal(), dc], evidencedPhaseIds: ['p1'], committedDesignRef: 'DREF' }))).toBe('series-terminal')
  })
  it('dev-complete 행이 없으면 증거 완비여도 dev-complete 아님(developing)', () => {
    expect(deriveBaseState(baseInput({ evidencedPhaseIds: ['p1', 'p2'], committedDesignRef: 'DREF', closeProofRows: [] }))).toBe('developing')
  })
})

describe('[close-proof] dev-complete 스키마 검증(self-verifying 필수 필드)', () => {
  it('dev-complete인데 phase_inventory 없으면 거부', () => {
    expect(closeProofRowProblems({ ...devComplete(), phase_inventory: null }).join(' ')).toContain('phase_inventory가 배열이 아님')
  })
  it('dev-complete인데 design_ref 없으면 거부', () => {
    expect(closeProofRowProblems({ ...devComplete(), design_ref: null }).join(' ')).toContain('design_ref가 비어 있음')
  })
  it('phase_inventory 정렬 안 됨 → 거부', () => {
    expect(closeProofRowProblems({ ...devComplete(), phase_inventory: ['p2', 'p1'] }).join(' ')).toContain('정렬')
  })
  it('phase_inventory 중복 → 거부', () => {
    expect(closeProofRowProblems({ ...devComplete(), phase_inventory: ['p1', 'p1'] }).join(' ')).toContain('중복')
  })
  it('series-terminal인데 phase_inventory 있으면 거부', () => {
    expect(closeProofRowProblems({ ...terminal(), phase_inventory: ['p1'] }).join(' ')).toContain('series-terminal인데 phase_inventory')
  })
  it('정상 dev-complete(정렬·중복없음·design_ref) 통과', () => {
    expect(closeProofRowProblems(devComplete({ phase_inventory: ['a', 'b', 'c'], design_ref: 'x' }))).toEqual([])
  })
})

describe('[close-proof] 오버레이·게이트', () => {
  it('reconstructed 오버레이 — 복원 행 있으면 true', () => {
    expect(isReconstructed([devComplete({ reconstructed: true, evidence_basis: ['x'] })])).toBe(true)
    expect(isReconstructed([devComplete()])).toBe(false)
  })
  it('게이트: developing·needs-recovery 차단 / 나머지 허용', () => {
    expect(baseStateBlocksIntake('developing')).toBe(true)
    expect(baseStateBlocksIntake('needs-recovery')).toBe(true)
    expect(baseStateBlocksIntake('dev-complete')).toBe(false)
    expect(baseStateBlocksIntake('series-terminal')).toBe(false)
    expect(baseStateBlocksIntake('legacy')).toBe(false)
  })
})

describe('[close-proof] 자연키', () => {
  it('series-terminal은 series로, dev-complete은 design_ref로 구분(supersede 키)', () => {
    const sep = String.fromCharCode(31)
    expect(closeProofRowKey(terminal({ series_id: 'a' })).split(sep)).toEqual(['REQ-2026-052', 'series-terminal', 'a'])
    // 🔴 dev-complete은 design_ref로 키잉 — 재승인(design_ref 변경) 시 새 행이 supersede로 append된다.
    expect(closeProofRowKey(devComplete({ design_ref: 'D1' })).split(sep)).toEqual(['REQ-2026-052', 'dev-complete', 'D1'])
    expect(closeProofRowKey(devComplete({ design_ref: 'D2' }))).not.toBe(closeProofRowKey(devComplete({ design_ref: 'D1' })))
  })
  it('🔴 재승인 supersede: 두 design_ref의 dev-complete 행이 공존, verifier가 현재 design_ref 행 선택', () => {
    const d1 = devComplete({ phase_inventory: ['p1'], design_ref: 'D1' })
    const d2 = devComplete({ phase_inventory: ['p1'], design_ref: 'D2' })
    // 두 행 공존(append-only) — 현재 committedDesignRef=D2면 D2 행으로 검증(옛 D1 무시).
    expect(deriveBaseState(baseInput({ closeProofRows: [d1, d2], evidencedPhaseIds: ['p1'], committedDesignRef: 'D2' }))).toBe('dev-complete')
    // committedDesignRef=D1이면 D1 행으로 검증.
    expect(deriveBaseState(baseInput({ closeProofRows: [d1, d2], evidencedPhaseIds: ['p1'], committedDesignRef: 'D1' }))).toBe('dev-complete')
    // 현재 design_ref가 D3(둘 다 아님)면 매칭 행 없음 → developing.
    expect(deriveBaseState(baseInput({ closeProofRows: [d1, d2], evidencedPhaseIds: ['p1'], committedDesignRef: 'D3' }))).toBe('developing')
  })
  it('구분자는 제어문자(가시문자 아님)', () => {
    expect(closeProofRowKey(terminal())).toContain(String.fromCharCode(31))
    expect(closeProofRowKey(terminal())).not.toContain(' ')
  })
})

describe('[close-proof] 소스 위생 — 제어문자 리터럴 없음', () => {
  it('close-proof 모듈 소스에 원시 제어문자가 없다', () => {
    const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts/req/lib/close-proof.ts'), 'utf8')
    const bad = [...src].filter((c) => {
      const n = c.charCodeAt(0)
      return n < 9 || (n >= 11 && n <= 12) || (n >= 14 && n <= 31)
    })
    expect(bad).toEqual([])
  })
})
