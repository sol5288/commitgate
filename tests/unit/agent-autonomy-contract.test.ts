import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CONFIG_SCHEMA } from '../../scripts/req/lib/config'

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

/**
 * REQ-2026-159 — **계약이 `stopGate: "auto"` 를 정확히 말한다.**
 *
 * 🔴 왜 필요한가: 0.23.0 의 배포 계약은 `phase`/`req`/`merge` 만 열거하고 "통합 승인은 어느 값에서도
 *    필요하다"고 적었다. 도구는 `auto` + 유효 위임에서 다시 묻지 않는데, **설치 프로젝트로 복사되는
 *    계약**이 반대로 말하고 있었다 — 도구가 맞아도 계약이 틀리면 에이전트는 계약을 따른다.
 *
 * 🔴 **열거를 손으로 적지 않는다.** `CONFIG_SCHEMA` 의 `stopGate` enum 에서 파생한다 —
 *    축이 늘면 자동으로 red 다(REQ-2026-158 의 교훈: 가드 범위가 결함 범위보다 좁으면 또 샌다).
 */
describe('[REQ-2026-159] 계약이 stopGate 전체를 말한다', () => {
  const stopGateValues = (): string[] => {
    const props = (CONFIG_SCHEMA as unknown as { properties?: Record<string, { enum?: string[] }> }).properties
    const en = props?.stopGate?.enum
    expect(Array.isArray(en), 'CONFIG_SCHEMA 에 stopGate enum 이 없다').toBe(true)
    return en as string[]
  }

  it('🔴 전제 고정 — stopGate 는 네 값이다', () => {
    expect(stopGateValues().sort()).toEqual(['auto', 'merge', 'phase', 'req'])
  })

  /**
   * 🔴 **범위를 열거 문장 하나로 좁힌다.** 처음에는 `정지 지점은` 부터 관리 블록까지를 잘라 봤는데,
   *    그 구간에는 바로 아래 "통합 승인" 항목의 `auto` 도 들어 있어서 **열거에서 `auto` 를 지워도
   *    가드가 통과했다**(변이 검사가 잡아 준 것이다). 가드의 적용 범위가 검사 대상보다 넓으면
   *    무관한 등장이 오라클을 대신 만족시킨다.
   */
  it('🔴 정지 지점 열거가 enum 전체를 덮는다', () => {
    const md = template()
    const from = md.indexOf('정지 지점은')
    expect(from, '정지 지점 항목을 찾지 못했다').toBeGreaterThan(-1)
    // 다음 최상위 항목(`- **`)까지가 이 항목의 본문이다.
    const to = md.indexOf('\n- **', from)
    const item = md.slice(from, to === -1 ? undefined : to)
    expect(item, '항목 경계를 잘못 잡았다').not.toContain('통합(main 병합) 승인')
    for (const v of stopGateValues()) expect(item, `정지 지점 열거에 \`${v}\` 가 없다`).toContain(`\`${v}\``)
  })

  it('🔴 auto 의 통합 승인 규칙을 양쪽 다 적는다 — 멈추는 경우와 멈추지 않는 경우', () => {
    const md = template()
    expect(md, '위임이 없으면 merge 처럼 멈춘다는 것').toContain('유효한 사전 위임이 없으면 `merge`와 똑같이 멈춘다')
    expect(md, '위임이 있으면 다시 묻지 않는다는 것').toContain('유효한 위임이 있으면 사람이 다시')
  })

  /** 🔴 안심시키는 문장이 잃는 것을 감추면 안 된다 — `auto` 에서도 멈추는 조건을 전부 적는다. */
  it('🔴 auto 에서도 멈추는 조건을 적는다', () => {
    const md = template()
    for (const w of ['HIGH 위험', 'hardCap', 'BLOCKED', '위임 범위 밖', '만료·철회'])
      expect(md, `auto 에서도 멈추는 조건: ${w}`).toContain(w)
  })

  /** 🔴 관리 블록 예외표 #1 도 같은 사실을 말해야 한다 — 여기만 옛말이면 에이전트는 여기를 읽는다. */
  it('🔴 자율 진행 예외표가 auto + 유효 위임의 예외를 말한다', () => {
    const md = template()
    const block = md.slice(md.indexOf('<!-- commitgate:autonomy -->'), md.indexOf('<!-- /commitgate:autonomy -->'))
    expect(block, '관리 블록을 찾지 못했다').toContain('통제점표')
    expect(block).toContain('stopGate: "auto"')
    expect(block, 'tag·publish·release 는 위임 대상이 아니라는 것').toContain('위임 대상이 아니다')
  })

  /** 🔴 두 축을 섞지 않는다(REQ-2026-158 DEC-3) — 비용 축은 이름으로 구별해 적는다. */
  it('🔴 비용 축(reviewBudget.onSoftLimit)을 이름으로 구별해 적는다', () => {
    const md = template()
    expect(md).toContain('reviewBudget.onSoftLimit')
    expect(md, '어느 축도 hardCap 을 해제하지 않는다').toContain('`hardCap`을 해제하지 않는다')
  })
})

/**
 * REQ-2026-160 — **계약이 "열리는 것 하나 / 열리지 않는 것 전부"를 구분한다.**
 *
 * 🔴 열리는 쪽만 검사하면 **절반만 지킨다**. 다음 사람이 "대화형이면 되는구나"로 읽고 다른 거부까지
 *    열어 주는 것이 이 REQ 가 막으려는 보안 결함이다.
 */
describe('[REQ-2026-160] 계약이 대화형 예외의 경계를 말한다', () => {
  it('🔴 열리는 경우: 통합 대상을 브랜치 이름에서 확정할 수 없을 때만', () => {
    const md = template()
    expect(md).toContain('통합 대상을 브랜치 이름에서 확정할 수 없으면')
    expect(md, '이 경우에만 이라는 한정').toContain('이 경우에**만**')
  })

  it('🔴 열리지 않는 경우를 **전부** 적는다', () => {
    const md = template()
    // 🔴 목록을 손으로 세지 않는다 — 이 사유들은 `DENY_REASONS` 등록부에서 온다.
    for (const w of ['위임 부재', '만료', '철회', '이미 소비', 'trunk 이동', 'source 불일치', '위임 범위 밖', 'HIGH 미위임', 'hardCap', 'BLOCKED'])
      expect(md, `사람 확인으로도 열리지 않는 사유: ${w}`).toContain(w)
    expect(md, '"사람 확인으로도 열리지 않는다"는 단정').toContain('사람 확인으로도 열리지 않는다')
  })

  it('🔴 이 경로는 push 하지 않는다는 것도 적는다(권한이 없다)', () => {
    expect(template()).toContain('push 도 하지 않는다')
  })
})
