import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * REQ-2026-131 — **에이전트 자율 진행 계약**이 배포 템플릿에 살아 있는지.
 *
 * 🔴 왜 필요한가: 도구 쪽 정지 지점은 `stopGate` 하나가 지배하도록 정리됐지만(REQ-2026-071·128·129),
 *    끊김의 나머지 절반은 **에이전트 계층**이었다. 계약이 "`AWAIT_HUMAN`이면 멈춘다"만 말하고
 *    "`RUN`일 때 물어봐도 되는가"를 말하지 않아, 같은 설정에서 세션마다 다르게 끊겼다.
 *
 * 🔴 이 파일의 오라클은 **문구 존재**다. 그래서 오라클이 죽지 않았는지(문구가 사라졌는데 통과하지
 *    않는지)를 **변이 검사**로 함께 증명한다 — 고정 문자열 가드는 스스로 죽었다고 말하지 않는다.
 */

const ROOT = join(import.meta.dirname, '..', '..')
const TEMPLATE_REL = 'AGENTS.template.md'
const template = (): string => readFileSync(join(ROOT, TEMPLATE_REL), 'utf8')

/**
 * 계약의 핵심 문장들. 🔴 **1회만 등장하는 문자열**로 고른다 — 여러 곳에 있으면 한 곳을 지워도
 * 가드가 통과해 변이 검사가 무력해진다.
 */
const RULES = {
  자율진행: '`RUN`·`AGENT`·`DONE`에서 사용자에게 묻는 것은 계약 위반이다',
  권장안기록: '권장안을 택하고 그 근거를 `01-design.md`에 남긴 뒤',
  행위판정: '**예외는 `kind`가 아니라 _행위_로 판정한다.**',
  위조금지: '`user_commit_confirmed`를 대신 만들지 않는다',
  stopGate종속: '`stopGate: "phase"`에서는 이 자율 규칙을 적용하지 않는다',
  범위경계: '**`00-requirement.md`를 고쳐야 하는가.** 고쳐야 하면 범위 변경이다',
} as const

describe('[REQ-2026-131] 자율 진행 계약이 배포 템플릿에 있다', () => {
  it('핵심 규칙 문장이 모두 있다', () => {
    const text = template()
    for (const [name, needle] of Object.entries(RULES)) expect(text, `누락: ${name}`).toContain(needle)
  })

  /**
   * 🔴 오라클 자기 검증(변이 검사). 각 문장을 지운 사본에서 검사가 **실패**해야 한다.
   *    실패하지 않으면 그 needle 은 다른 곳에도 있어 가드 역할을 못 한다는 뜻이다.
   */
  it('🔴 문장을 지우면 검사가 실패한다(가드가 살아 있다)', () => {
    const text = template()
    for (const [name, needle] of Object.entries(RULES)) {
      const mutated = text.replace(needle, '')
      expect(mutated, `${name}: 지웠는데도 남아 있다 — needle 이 유일하지 않다`).not.toContain(needle)
      expect(mutated.length, `${name}: 치환이 아무것도 바꾸지 않았다`).toBeLessThan(text.length)
    }
  })

  /**
   * 🔴 예외 목록이 통제점을 삼키지 않았는지. 자율 규칙이 예외를 잃으면 안전 속성이 조용히 약해진다 —
   *    "새 절 추가"가 계약을 약화시킨 전례(REQ-2026-073)를 반복하지 않는다.
   */
  it('🔴 예외 목록에 9개 항목의 핵심 표지가 모두 있다', () => {
    const text = template()
    for (const marker of [
      '통제점표(`I1`/`I2`/`B1` · `R1`/`R2`/`R3`)',
      'HIGH commit 실행 직전(= `req:confirm` 지점)',
      'destructive 작업(reset/clean/force push)',
      '설계 범위 변경 또는 비목표 추가',
      'Codex 리뷰 `BLOCKED`(exit 2)',
      '필수 전제 미충족',
      '`req:next`가 낸 `AWAIT_HUMAN`·`BLOCKED`',
      '사람 전용 명령(`commitgate setup`)',
      '`req:rebind` · `delivery seal`/`approve`/`reopen`',
    ])
      expect(text, `예외 누락: ${marker}`).toContain(marker)
  })

  /**
   * 🔴 자기모순 금지: 자율 절을 넣으면서 기존 통제점 계약을 약화시키지 않았는가.
   *    통제점표의 승인 문장 셋과 "승인은 이월되지 않는다"가 그대로 있어야 한다.
   */
  it('🔴 통제점 계약이 그대로 남아 있다(자율 절이 약화시키지 않았다)', () => {
    const text = template()
    for (const keep of [
      '`feature branch push + PR 생성 승인`',
      '`검증 결과 확인 후 PR merge 승인`',
      '`branch protection bypass를 사용한 direct push 승인`',
      '한 통제점의 승인은 다음 통제점으로 **이월되지 않는다**',
    ])
      expect(text, `통제점 계약 손상: ${keep}`).toContain(keep)
  })

  /**
   * 🔴 `req:confirm`은 **통제점**이지 사람 전용 명령이 아니다. 사람 전용 표에 그것이 들어가면
   *    에이전트는 `req:next`가 지시한 명령을 실행해도 되는지 또 판단하게 된다 — 이 REQ가 없애려는
   *    비결정성이다. 표에는 `setup` 하나만 있어야 한다.
   */
  it('🔴 사람 전용 명령 표에는 setup 하나뿐이다', () => {
    const text = template()
    const section = text.slice(text.indexOf('## 사람 전용 명령'), text.indexOf('## 사람에게 보고해야 할 때'))
    expect(section).toContain('npx commitgate setup')
    expect(section, '통제점 명령이 사람 전용 표에 들어갔다').not.toContain('req:confirm')
  })
})
