import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 기본 reviewer persona의 **정책 존재 계약** (REQ-2026-050 phase-1).
 *
 * 왜 존재 검증인가: 소비자 저장소 실측에서 design 리뷰가 수렴하지 않아 티켓 3건이 연속 폐기됐고
 * (리뷰 20회·48.2분·산출물 0), 폐기 사유는 "한 티켓이 네 개의 독립 계약을 동시에 지고 있어"였다.
 * `02-plan.md`는 이미 design 프롬프트에 전문 포함되므로 원인은 입력 부재가 아니라 **심사 기준 부재**다.
 * 그 기준이 배포되는 기본 persona에 실제로 실려 있는지를 회귀로 잠근다.
 *
 * ⚠️ **기대값은 이 파일 안의 리터럴이다.** persona 본문이나 SUT 상수를 import해 기대값을 만들면
 *    tautology가 된다(문구가 통째로 사라져도 그린). 문구를 바꾸려면 이 테스트도 함께 바꿔야 한다 —
 *    그 마찰이 곧 "정책이 조용히 증발하지 않는다"는 보장이다.
 *
 * ⚠️ 이 테스트는 **스캐너가 아니다.** 리뷰어가 그 기준을 실제로 적용했는지는 검증할 수 없고,
 *    검증하려 들지도 않는다(REQ-2026-044 DEC-7과 같은 취지 — 정적 스캐너 대신 존재 검증).
 */
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const PERSONA_ABS = resolve(PACKAGE_ROOT, 'workflow/review-persona.md')

function persona(): string {
  return readFileSync(PERSONA_ABS, 'utf8')
}

/** 개행 정규화 — autocrlf 환경에서 Write는 LF, Edit는 CRLF로 갈린다(REQ-2026-042 교훈). */
function normalized(): string {
  return persona().replace(/\r\n/g, '\n')
}

describe('review-persona: kit 관리 마커', () => {
  it('첫 줄이 kit 관리 마커다', () => {
    expect(normalized().split('\n')[0]).toBe('<!-- commitgate:persona v1 -->')
  })

  it('마커는 markdown 주석이라 프롬프트 의미를 바꾸지 않는다(닫힌 주석)', () => {
    const first = normalized().split('\n')[0] ?? ''
    expect(first.startsWith('<!--')).toBe(true)
    expect(first.endsWith('-->')).toBe(true)
  })
})

describe('review-persona: design phase 분해 점검 기준', () => {
  it('REVIEW_KIND: design 절이 존재한다', () => {
    expect(normalized()).toContain('### REVIEW_KIND: design')
  })

  it('phase 분해 3항목이 design 점검 목록에 있다', () => {
    const body = normalized()
    // 각 항목의 **판별 문구**만 확인한다(전문 일치가 아니라) — 표현을 다듬을 여지는 남기되
    // 개념이 사라지면 실패한다.
    expect(body).toContain('책임 계약·입력·산출물·선행 phase·독립 검증 명령')
    expect(body).toContain('독립 커밋·독립 리뷰')
    expect(body).toContain('숨은 결합')
  })

  it('분해 3항목이 design 절 안에 있다(phase 절이나 문서 말미가 아니라)', () => {
    const body = normalized()
    const designAt = body.indexOf('### REVIEW_KIND: design')
    const phaseAt = body.indexOf('### REVIEW_KIND: phase')
    expect(designAt).toBeGreaterThan(-1)
    expect(phaseAt).toBeGreaterThan(designAt)
    const designSection = body.slice(designAt, phaseAt)
    expect(designSection).toContain('책임 계약·입력·산출물·선행 phase·독립 검증 명령')
    expect(designSection).toContain('독립 커밋·독립 리뷰')
    expect(designSection).toContain('숨은 결합')
  })
})

describe('review-persona: 분해 관점이 P1을 넓히지 않는다', () => {
  it('P1 정의 절은 그대로 있다', () => {
    expect(normalized()).toContain('## P1 정의 (차단의 유일한 기준)')
  })

  it('분해 관점이 P1 확대가 아님을 명시한다', () => {
    const body = normalized()
    expect(body).toContain('분해 관점은 탐색의 하한이지 P1 기준의 확대가 아니다')
  })

  it('분해 지적을 차단으로 쓰려면 정상 경로 재현을 요구한다', () => {
    const body = normalized()
    expect(body).toContain('그 분해로 진행했을 때 정상 경로에서 무엇이 깨지는지')
  })

  it('결합 과다 판단 자체는 차단이 아니라 observations이고 종결은 사람 결정임을 명시한다', () => {
    const body = normalized()
    expect(body).toContain('종결·재분할은 사람의 결정이다')
  })

  it('안전장치 문구가 분해 항목 뒤에 온다(항목만 남고 제약이 잘려나가지 않게)', () => {
    const body = normalized()
    const itemAt = body.indexOf('책임 계약·입력·산출물·선행 phase·독립 검증 명령')
    const guardAt = body.indexOf('분해 관점은 탐색의 하한이지 P1 기준의 확대가 아니다')
    expect(itemAt).toBeGreaterThan(-1)
    expect(guardAt).toBeGreaterThan(itemAt)
  })
})

describe('review-persona: 로더 계약을 깨지 않는다', () => {
  it('비어 있지 않다(loadReviewPersona의 fail-closed 조건)', () => {
    expect(persona().trim().length).toBeGreaterThan(0)
  })
})
