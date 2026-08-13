import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  defersToIntegration,
  isStopGate,
  AUTO_APPROVE_OF,
  loadConfig,
  type StopGate,
} from '../../scripts/req/lib/config'
import { requiredConfirmScope } from '../../scripts/req/lib/evidence'
import { VALUE_NOTES } from '../../bin/setup'
import { userConfirmGate } from '../../scripts/req/req-commit'
import type { WorkflowState } from '../../scripts/req/review-codex'

/**
 * REQ-2026-140 phase-1 — `stopGate: "auto"` 는 **통합 지점을 빼면 `merge` 와 동일**하다(설계 DEC-2).
 *
 * 🔴 이 파일이 고정하는 것은 세 가지다:
 *   ① 등가 — 커밋 게이트·확인 scope·파생 축에서 `auto` 와 `merge` 가 **같은 판정**을 낸다
 *   ② 구조 — `stopGate === 'merge'` 리터럴 비교가 술어 정본 밖에 **남아 있지 않다**(DEC-2a)
 *   ③ 미노출 — `auto` 는 아직 **사용자가 고를 수 없다**(DEC-9)
 *
 * ②가 왜 테스트인가: 값이 늘 때 `Record<StopGate, …>` 와 오버로드는 컴파일 에러로 소비자를 드러내지만
 * **비소진 분기(`=== 'merge'`)는 드러내지 못한다**. 설계 리뷰가 실측으로 8곳을 찾았고, 그 자리에서
 * `auto` 는 조용히 `req` 처럼 동작했을 것이다. 이 저장소는 "배선 끊김은 순수 테스트가 못 잡는다"를
 * 세 번 실증했다(REQ-2026-083·097·099) — 같은 계열의 방어다.
 */

const ROOT = join(__dirname, '..', '..')

describe('[REQ-2026-140] defersToIntegration — 진리표', () => {
  it('merge·auto 만 참이다', () => {
    expect(defersToIntegration('merge')).toBe(true)
    expect(defersToIntegration('auto')).toBe(true)
    expect(defersToIntegration('phase')).toBe(false)
    expect(defersToIntegration('req')).toBe(false)
  })

  it('isStopGate 가 auto 를 유효한 값으로 인정한다(스냅샷 손상 판별의 SSOT)', () => {
    expect(isStopGate('auto')).toBe(true)
    expect(isStopGate('nope')).toBe(false)
  })
})

describe('[REQ-2026-140] auto ≡ merge — 통합 지점을 뺀 모든 판정', () => {
  it('파생 축(AUTO_APPROVE_OF)이 같다', () => {
    expect(AUTO_APPROVE_OF.auto).toBe(AUTO_APPROVE_OF.merge)
  })

  it('확인 scope 가 묶음 소속 두 경우 모두에서 같다', () => {
    for (const inDeliverySet of [true, false]) {
      expect(requiredConfirmScope('auto', { inDeliverySet })).toBe(requiredConfirmScope('merge', { inDeliverySet }))
    }
  })

  /**
   * 🔴 **커밋 게이트 등가**. 여기가 깨지면 `auto` 티켓이 매 phase 멈춘다 —
   *    REQ-2026-134 가 고친 "반쪽 동결"과 같은 종류의 모순이다.
   */
  it('userConfirmGate 가 위험도·완성여부 네 조합에서 같다', () => {
    for (const risk of ['HIGH', 'LOW'] as const) {
      for (const completesReq of [true, false]) {
        const state = { id: 'REQ-TEST', risk_level: risk } as WorkflowState
        expect(
          userConfirmGate(state, 'auto', completesReq).blocked,
          `risk=${risk} completesReq=${completesReq}`,
        ).toBe(userConfirmGate(state, 'merge', completesReq).blocked)
      }
    }
  })
})

/**
 * DEC-2a 구조 가드. `stopGate` 정책 분기를 리터럴로 되돌리면 red 다.
 *
 * 🔴 정본 파일(`lib/config.ts`)만 예외다 — 술어와 `isStopGate` 가 값 리터럴을 쓰는 것이 그 역할이다.
 */
describe('[REQ-2026-140] 구조 가드 — merge 리터럴 비교가 술어 밖에 없다', () => {
  const SSOT = join('scripts', 'req', 'lib', 'config.ts')

  const tsFiles = (rel: string): string[] =>
    readdirSync(join(ROOT, rel), { recursive: true })
      .map(String)
      .filter((f) => f.endsWith('.ts'))
      .map((f) => join(rel, f))

  it('오라클이 살아 있다 — 실제로 파일을 훑는다', () => {
    const files = [...tsFiles(join('scripts', 'req')), ...tsFiles('bin')]
    expect(files.length).toBeGreaterThan(20)
    expect(files).toContain(SSOT)
  })

  /**
   * 🔴 **문맥을 좁힌다.** 처음에는 `[!=]== 'merge'` 를 전부 금지했는데, `'merge'` 는 stopGate 값이자
   *    **커밋 범주**(`DeepCategory`)이기도 하다 — `category === 'merge'` 를 오탐해 무관한 코드를 막았다.
   *    가드가 잡아야 하는 것은 **정지 정책 분기**뿐이므로 좌변 식별자로 한정한다.
   */
  const STOP_GATE_LITERAL = /\b(stopGate|stopGateNow|stop_gate|sg)\s*[!=]==\s*'merge'/

  it("🔴 stopGate 문맥의 `=== 'merge'` 비교가 술어 밖에 없다(정본 제외)", () => {
    const offenders: string[] = []
    for (const rel of [...tsFiles(join('scripts', 'req')), ...tsFiles('bin')]) {
      if (rel === SSOT) continue
      const body = readFileSync(join(ROOT, rel), 'utf8')
      body.split('\n').forEach((line, i) => {
        if (STOP_GATE_LITERAL.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`)
      })
    }
    expect(offenders, 'defersToIntegration() 술어를 쓰세요 — 리터럴 비교는 새 값에서 조용히 틀립니다').toEqual([])
  })

  /** 🔴 가드가 실제로 문다는 증명 — 좁힌 정규식이 진짜 위반을 여전히 잡는가. */
  it('가드 정규식이 stopGate 비교를 잡고 범주 비교는 놓아준다', () => {
    expect(STOP_GATE_LITERAL.test("if (stopGate === 'merge') return")).toBe(true)
    expect(STOP_GATE_LITERAL.test("if (stopGateNow !== 'merge') return")).toBe(true)
    expect(STOP_GATE_LITERAL.test("if (sg === 'merge') return")).toBe(true)
    expect(STOP_GATE_LITERAL.test("if (category === 'merge') continue")).toBe(false)
    expect(STOP_GATE_LITERAL.test("if (review_kind === 'merge') continue")).toBe(false)
  })
})

/**
 * DEC-9 — `auto` 는 **동작이 완성되는 phase 에서만** 노출된다.
 *
 * 🔴 이 describe 는 **의도적으로 뒤집혔다**(phase-5). phase 1~4 동안은 "스키마가 거부한다"가
 *    오라클이었다 — 그 구간의 사용자는 값을 고를 수 없었고, 그래서 "그런 값은 없습니다"라고 적힌
 *    문서가 **여전히 참**이었다. 노출과 문서 정정이 같은 커밋에 들어온 지금, 오라클도 함께 뒤집는다.
 *    (노출만 앞당기면 문서가 거짓이 되고, 문서만 앞당기면 아직 없는 동작을 설명하게 된다.)
 */
describe('[REQ-2026-140 DEC-9] auto 가 노출됐다 — 동작과 문서가 함께 왔을 때만', () => {
  it('스키마 enum 에 auto 가 있다', () => {
    const schema = JSON.parse(readFileSync(join(ROOT, 'workflow', 'req.config.schema.json'), 'utf8')) as {
      properties: { stopGate: { enum: string[] } }
    }
    expect(schema.properties.stopGate.enum).toEqual(['phase', 'req', 'merge', 'auto'])
  })

  it('req.config.json 에 auto 를 써 넣으면 로드된다', () => {
    const root = mkdtempSync(join(tmpdir(), 'cg-auto-expose-'))
    try {
      writeFileSync(join(root, 'req.config.json'), JSON.stringify({ stopGate: 'auto' }))
      expect(loadConfig({ root }).stopGate satisfies StopGate).toBe('auto')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('🔴 enum 밖 값은 여전히 거부한다(노출이 검증을 푼 것이 아니다)', () => {
    const root = mkdtempSync(join(tmpdir(), 'cg-auto-expose-bad-'))
    try {
      writeFileSync(join(root, 'req.config.json'), JSON.stringify({ stopGate: 'always' }))
      expect(() => loadConfig({ root })).toThrow()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('🔴 setup 선택지에 auto 가 있고 설명이 위임 조건을 말한다', () => {
    expect(Object.keys(VALUE_NOTES.stopGate ?? {})).toContain('auto')
    expect(VALUE_NOTES.stopGate?.auto ?? '').toContain('위임')
  })
})
