import { describe, it, expect } from 'vitest'
import { parseArgs, buildConfirm, scopeMeaning, CONFIRM_SCOPES } from '../../scripts/req/req-confirm'
import { userConfirmProblem, REQUIRED_CONFIRM_SCOPE, effectiveConfirmScope } from '../../scripts/req/lib/evidence'
import { resolveDispatch, VERB_MODULES } from '../../bin/dispatch.mjs'
import { STAGE_B_REQ_VERBS, STAGE_B_REQ_SCRIPTS } from '../../bin/init'

/**
 * REQ-2026-071 phase-2 — `req:confirm`.
 *
 * 🔴 이 명령의 존재 이유: 지금까지 HIGH 확인을 넣는 방법은 **`state.json` 손편집**뿐이었고,
 *    그것이 REQ-2026-019 가 폐기된 표면과 같다 — 시각을 사람이 적어 넣으면 **지어낼 수 있다**.
 *    시각을 실제 시계에서 읽는 것이 이 명령의 핵심이며, 주입 seam 은 테스트를 위한 것이지
 *    값을 지어내기 위한 것이 아니다.
 */

describe('[req:confirm] parseArgs — fail-closed', () => {
  it('REQ·scope·method 를 읽는다', () => {
    const o = parseArgs(['2026-071', '--scope', 'req', '--method', '사용자 확인', '--run'])
    expect(o).toEqual({ reqId: '2026-071', scope: 'req', method: '사용자 확인', note: null, root: null, run: true })
  })

  it('🔴 scope enum 밖은 거부한다(조용히 phase 로 읽지 않는다)', () => {
    expect(() => parseArgs(['x', '--scope', 'all'])).toThrow('--scope')
    expect(() => parseArgs(['x', '--scope'])).toThrow('--scope')
  })

  it('알 수 없는 옵션은 조용히 무시하지 않는다', () => {
    expect(() => parseArgs(['x', '--force'])).toThrow('알 수 없는 옵션')
  })

  /** 승인 문장은 `-`로 시작할 수도 있다 — 그 자리에서만 접두 검사를 하지 않는다. */
  it('--method 값은 대시로 시작해도 받는다', () => {
    expect(parseArgs(['x', '--method', '-확인']).method).toBe('-확인')
  })

  it('--root 는 다음 옵션을 값으로 삼키지 않는다', () => {
    expect(() => parseArgs(['x', '--root', '--run'])).toThrow('--root')
  })
})

describe('[req:confirm] buildConfirm — 기록 형식', () => {
  const now = '2026-07-27T01:02:03.000Z'

  it('기존 검증기를 그대로 통과한다', () => {
    for (const scope of CONFIRM_SCOPES) {
      const c = buildConfirm({ scope, method: 'm', note: null, nowIso: now })
      expect(userConfirmProblem(c)).toBeNull()
      expect(effectiveConfirmScope(c)).toBe(scope)
    }
  })

  it('시각은 주입된 값 그대로다(고정 검증)', () => {
    expect(buildConfirm({ scope: 'req', method: 'm', note: null, nowIso: now }).confirmed_at).toBe(now)
  })

  it('note 는 있을 때만 들어간다(없으면 키 자체가 없다)', () => {
    expect(buildConfirm({ scope: 'req', method: 'm', note: null, nowIso: now }).note).toBeUndefined()
    expect(buildConfirm({ scope: 'req', method: 'm', note: 'n', nowIso: now }).note).toBe('n')
  })
})

/**
 * 🔴 넓은 범위는 **아직 없는 변경까지 미리 승인**한다. 그 문장이 없으면 사용자는
 *    "지금 이 변경만 승인했다"고 믿는다 — 이 REQ 가 받아들인 트레이드오프의 고지다.
 */
describe('[req:confirm] scopeMeaning — 넓은 범위의 뜻을 말한다', () => {
  it('phase 는 하나만 승인한다고 말한다', () => {
    expect(scopeMeaning('phase')).toContain('다음 phase는 다시 확인')
  })

  it('🔴 req·delivery 는 "아직 작성되지 않은 변경까지"를 명시한다', () => {
    for (const s of ['req', 'delivery'] as const) {
      expect(scopeMeaning(s)).toContain('미리 승인')
      expect(scopeMeaning(s)).toContain('아직 작성되지 않은 변경')
    }
  })
})

describe('[req:confirm] stopGate ↔ scope 대응표', () => {
  /** 두 축이 갈라지지 않도록 표 하나가 SSOT 다. */
  it('세 값이 1:1로 대응한다', () => {
    expect(REQUIRED_CONFIRM_SCOPE).toEqual({ phase: 'phase', req: 'req', merge: 'delivery' })
  })
})

describe('[req:confirm] verb 등록', () => {
  it('dispatch 가 모듈로 보낸다', () => {
    expect(resolveDispatch(['req:confirm', '2026-071'])).toEqual({
      entry: VERB_MODULES['req:confirm'],
      rest: ['2026-071'],
    })
  })

  /** 🔴 파생이 끊기면 소비자 프로젝트에 `npm run req:confirm` 자체가 없다. */
  it('🔴 Stage B 주입 목록에 따라온다', () => {
    expect(STAGE_B_REQ_VERBS).toContain('req:confirm')
    expect(STAGE_B_REQ_SCRIPTS['req:confirm']).toBe('commitgate req:confirm')
  })
})

/**
 * 🔴 `stopGate` 값과 `scope` 값은 **이름이 다르다**: `merge → delivery`(설계 r04 P1).
 *    `merge`는 "언제 멈추는가"이고 `delivery`는 "무엇을 승인했는가"다 — 승인 대상은 묶음이지 병합 행위가 아니다.
 */
describe('[req:confirm] merge → delivery 대응(양방향)', () => {
  it('🔴 merge 가 요구하는 것은 delivery 다', () => {
    expect(REQUIRED_CONFIRM_SCOPE.merge).toBe('delivery')
  })

  it("🔴 scope 에 'merge' 라는 값은 존재하지 않는다", () => {
    expect(CONFIRM_SCOPES).not.toContain('merge')
  })

  it('🔴 --scope merge 는 기록조차 되지 않는다', () => {
    expect(() => parseArgs(['x', '--scope', 'merge'])).toThrow('--scope')
  })
})
