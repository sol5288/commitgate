import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { D_CHECK_IDS, runChecks, type DoctorInputs } from '../../scripts/req/req-doctor'
import { STOP_GATE_HIGH_NOTICE } from '../../bin/setup'
// 🔴 고지의 값↔의미 매핑을 **실제 정지 규칙**에 결속하기 위해 정본 판정 함수를 그대로 쓴다(사본 금지).
import { userConfirmGate } from '../../scripts/req/req-commit'
import type { WorkflowState } from '../../scripts/req/review-codex'

/**
 * REQ-2026-073 phase-1 — **알려진 거짓 보장이 문서로 되돌아오지 않는다**.
 *
 * REQ-2026-071은 "HIGH 위험 티켓은 정책과 무관하게 매 phase 확인"이라는 백스톱을 **의도적으로
 * 제거**하고, 확인을 `stopGate`가 정한 한 지점으로 옮겼다. 그런데 문서 5곳이 그 백스톱을 계속
 * 보장한다고 썼다 — 같은 파일 안에서 앞뒤가 모순인 곳도 있었다.
 *
 * 🔴 **이 테스트가 하는 일과 하지 않는 일**(DEC-3):
 *  - 한다: 아래 **고정 문장**이 문서에 다시 나타나면 실패한다.
 *  - 하지 않는다: 문서가 코드와 일치하는지 **일반적으로** 판정하지 않는다. 같은 거짓말을
 *    다른 표현으로 쓰면 이 테스트는 통과한다 — 그건 사람 리뷰의 몫이다.
 *
 * 왜 이 범위인가: REQ-2026-044에서 "문서 정적 스캐너"를 설계했다가 오라클을 명세하지 못해
 * 설계 리뷰 5라운드 미수렴 → 폐기했다. 일반 판정을 노리면 바닥없는 nitpick이 된다.
 * 여기서는 판정이 기계적이고, 실패하면 무엇을 고칠지 명확하다.
 *
 * 🔴 **항목을 추가할 때의 규칙**(REQ-2026-104): 등재할 문자열은 **정정문에도 남기지 않는다.**
 *    부분 문자열 검사기는 "주장"과 "철회를 설명하려고 옛 문구를 인용한 것"을 구별하지 못한다 —
 *    정정문이 옛 표현을 축자 인용하면 그 순간 가드가 스스로 실패한다. 인용부호 구간을 예외 처리하는
 *    파서를 만드는 대신(그게 위에서 폐기한 그 길이다) **정정문을 풀어 쓴다.**
 *    실제 사례: REQ-2026-103의 resume 항목을 등재하려다 `06`·`gaps`·`CHANGELOG`의 정정문 3곳이
 *    옛 문구를 인용하고 있어 먼저 풀어 썼다.
 */

/** 되살아나면 안 되는 문장(한/영). 부분 문자열로 검사한다 — 문장부호·줄바꿈에 취약하지 않게. */
export const STALE_CLAIMS: readonly { text: string; why: string }[] = [
  {
    text: '어느 값에서도 매 phase 확인',
    why: 'REQ-071이 제거한 HIGH 백스톱 (configuration.md)',
  },
  {
    text: '정책과 무관하게 매 phase 확인',
    why: 'REQ-071이 제거한 HIGH 백스톱 (workflow.md)',
  },
  {
    text: '기본값은 매 phase 커밋 전에',
    why: 'stopGate 기본값은 이제 req 다 (workflow.md)',
  },
  {
    text: 'HIGH-risk tickets stop at every phase under any value',
    why: 'the HIGH backstop REQ-071 removed (configuration.en.md)',
  },
  {
    text: 'HIGH-risk tickets still stop at every phase',
    why: 'the HIGH backstop REQ-071 removed (workflow.en.md)',
  },
  {
    text: 'By default the loop stops at `AWAIT_HUMAN` before every phase commit',
    why: 'the stopGate default is now req (workflow.en.md)',
  },
  {
    text: 'it would livelock on HIGH',
    why: 'no longer the reason there is no "all" value (configuration.en.md)',
  },
  /**
   * 🔴 이 두 건은 **이 REQ가 쓰다가 리뷰에서 걸린 문장**이다(phase-3 r01 P1).
   *    "커밋·통합되지 않는다"는 커밋 단위 보장으로 읽히는데, 기본값 `req`에서 HIGH 티켓의
   *    중간 phase는 Codex 승인만으로 커밋된다 — 고치려던 것과 **같은 종류의 과잉 약속**이었다.
   */
  {
    text: '사람 확인 없이 커밋·통합되지 않습니다',
    why: '커밋 단위 보장으로 읽히는 과잉 약속 — 확인은 stopGate 지점에서만 요구된다',
  },
  {
    text: 'never committed or integrated without a human confirmation',
    why: 'reads as a per-commit guarantee — confirmation is required only at the stopGate point',
  },
  /**
   * 🔴 REQ-2026-100 — `docs/development.md`가 "전체 스위트를 돌리고 **게이트 판정도 이것을 본다**"고
   *    적고 있었다. 사실이 아니다: `req:doctor`·`req:commit` 어디에도 테스트를 실행하는 코드가 없고
   *    `req.config.json`에 테스트 설정도 없다. 게이트를 테스트 검증자로 오해하게 만드는 문장이라
   *    REQ-2026-073이 정리한 것과 **같은 결함 class**다.
   *    (같은 문장 뒤쪽의 "변경분만 돌리지 않는다"는 **참이며 유지**한다 — 실측이 그 근거를 강화했다.)
   */
  {
    text: '게이트 판정도 이것을 봅니다',
    why: '게이트는 테스트를 실행하지 않는다 (development.md · REQ-2026-100)',
  },
  {
    text: 'that is what the gate judges',
    why: 'the gate does not run tests (development.en.md · REQ-2026-100)',
  },
  /**
   * 🔴 REQ-2026-103 — `docs/ssot-design/06`·`gaps-and-decisions.md` G-06이 **도달 불가였던 resume
   *    코드**를 "향후 opt-in용으로 보존"이라 서술했다. 호출부가 `isResume = false` 상수라 실행될 수
   *    없는 경로였는데, 문서만 보면 켜기만 하면 되는 기능처럼 읽혔다. REQ-103이 배선을 제거하고
   *    서술을 정정했다. 재리뷰는 stateless가 확정 동작이며(REQ-2026-045 운영정책), resume은 부활해도
   *    게이트 정책부터 새로 설계한다 — 옛 argv 복원이 아니다.
   *
   *    ko 전용 항목이다: 이 서술은 `docs/ssot-design/`(ko)에만 있었고, 없던 문장을 영문으로 만들어
   *    등재하면 **영원히 발화하지 않는 항목**이 늘 뿐이다.
   */
  {
    text: '향후 opt-in용',
    why: 'resume은 도달 불가 코드였다 — "켜면 되는 보존 코드"가 아니다 (ssot-design 06·G-06 · REQ-2026-103)',
  },
  /**
   * 🔴 REQ-2026-112 — **표현 변형**이다. 위의 두 항목(`어느 값에서도 매 phase 확인`·
   *    `정책과 무관하게 매 phase 확인`)과 같은 주장인데 문장이 달라 부분 문자열 검사를 빠져나갔다.
   *    `docs/ssot-design/04`는 이미 `docs/**` 검사 범위 **안**이었는데도 통과했다 —
   *    **범위를 넓히는 것만으로는 부족하다**는 실증이다.
   */
  {
    text: '정책과 무관하게 유지',
    why: 'REQ-071이 제거한 HIGH 백스톱의 표현 변형 (ssot-design 04 · REQ-2026-112)',
  },
]

/**
 * 재귀 `.md` 수집 대상 디렉터리.
 *
 * 🔴 REQ-2026-104: 예전에는 비재귀(`readdirSync(docs)`)여서 `docs/ssot-design/` 18파일(285KB)이
 *    통째로 무가드였다 — `.md` 필터가 디렉터리 엔트리를 걸러내 하위가 아예 열리지 않았다.
 * 🔴 REQ-2026-112: `templates/`·`skills/`를 추가했다. **소비자에게 배포되는 지침**인데 검사 밖이었다.
 */
const SCAN_DIRS = ['docs', 'templates', 'skills'] as const

/**
 * 개별 파일 대상.
 *
 * 🔴 REQ-2026-112: `AGENTS.template.md`는 `init`이 소비자 `AGENTS.md`로 **복사**하는 계약 템플릿인데
 *    검사 밖이었다 — 폐기된 주장이 가장 널리 배포되는 경로가 무가드였던 셈이다.
 * 🔴 `workflow/`를 **글로브로 넣지 않는다.** `workflow/**`면 REQ 티켓 문서까지 잡혀,
 *    폐기 문구를 인용해 정정을 설명하는 설계 문서를 쓸 수 없게 된다.
 */
const SCAN_FILES = ['README.md', 'README.en.md', 'AGENTS.template.md', join('workflow', 'review-persona.md')] as const

/**
 * **코드 표면**(REQ-2026-112). 폐기된 주장이 남아 있던 코드 파일을 **손으로 적은 목록**으로 검사한다.
 *
 * 🔴 `**\/*.ts` 글로브가 아닌 이유: 그러면 폐기 문구를 설명하는 정정문·주석까지 걸려 **정정 자체가
 *    불가능**해진다(REQ-2026-104가 겪은 함정). 목록은 "실제로 폐기 주장이 있던 곳"으로 한정한다.
 */
const CODE_SURFACES = [join('bin', 'setup.ts'), join('scripts', 'req', 'lib', 'config.ts')] as const

/**
 * 폐기 문구를 **담는 것이 정상인** 자리. 검사 대상에 들어오면 안 된다.
 * 대상 목록이 나중에 글로브로 넓어지면 여기 있는 것들이 걸려 정정·기록이 막힌다.
 */
const SCAN_EXCLUDED = [
  join('tests', 'unit', 'docs-stale-claims.test.ts'), // 가드 자신 — 등재 목록이 여기 있다
  'CHANGELOG.md', // 역사 기록. 그 시점의 사실을 적은 것은 거짓이 아니다
] as const
/** 티켓 문서는 정정을 설명하려면 옛 문구를 인용해야 한다. */
const EXCLUDED_PREFIX = join('workflow', 'REQ-')

function docFiles(root: string): string[] {
  const out: string[] = [...SCAN_FILES]
  for (const d of SCAN_DIRS) {
    for (const f of readdirSync(join(root, d), { recursive: true })) {
      const rel = String(f)
      if (rel.endsWith('.md')) out.push(join(d, rel))
    }
  }
  out.push(...CODE_SURFACES)
  return out
}

const ROOT = join(__dirname, '..', '..')

describe('[REQ-2026-073] 알려진 거짓 보장이 문서에 없다', () => {
  const files = docFiles(ROOT)

  /** 대상이 실제로 잡혔는지부터 확인한다 — 0개 파일을 검사하고 통과하면 오라클이 아니다. */
  it('검사 대상 문서가 존재한다', () => {
    expect(files.length).toBeGreaterThan(10)
    expect(files).toContain('README.md')
    expect(files).toContain(join('docs', 'workflow.md'))
    expect(files).toContain(join('docs', 'configuration.en.md'))
  })

  /**
   * 🔴 REQ-2026-104: **범위 자체를 단언한다.** 위 검사는 `length > 10`이라 재귀가 사라져도
   *    (최상위만 21개) 통과한다 — 즉 무가드로 되돌아가는 것을 못 잡는다. 하위 디렉터리 파일이
   *    실제로 목록에 있는지 직접 본다.
   */
  it('🔴 docs/ 하위 디렉터리도 검사 대상이다(재귀 회귀 방지)', () => {
    const nested = files.filter((f) => f.startsWith(join('docs', 'ssot-design')))
    expect(nested.length).toBeGreaterThan(10) // 현재 18파일
    expect(nested).toContain(join('docs', 'ssot-design', 'gaps-and-decisions.md'))
  })

  /**
   * 🔴 REQ-2026-112 (AC-3) — **배포되는 지침 표면**이 검사 대상에 실제로 들어 있다.
   *
   * 왜 필요한가: REQ-2026-073이 폐기 주장을 정정할 때 대상이 `README`+`docs/`뿐이어서,
   * `AGENTS.template.md`(소비자 `AGENTS.md`로 복사됨)에 같은 주장이 그대로 남았다.
   * 가장 널리 배포되는 지침이 무가드였다.
   */
  it('🔴 배포되는 지침 파일이 검사 대상이다(AGENTS 템플릿·templates·skills·persona)', () => {
    expect(files).toContain('AGENTS.template.md')
    expect(files).toContain(join('workflow', 'review-persona.md'))
    expect(files).toContain(join('templates', 'CLAUDE.template.md'))
    expect(files.some((f) => f.startsWith(join('skills', '')) && f.endsWith('.md'))).toBe(true)
  })

  /**
   * 🔴 REQ-2026-112 (AC-1b) — **코드 표면**도 검사 대상이다.
   *
   * 왜 필요한가: 설계 리뷰가 지적한 공백이다. 배포 문서와 사용자 노출 상수만 검사하면
   * `config.ts`의 주석 3곳과 `setup.ts`의 근거 주석을 옛 주장 그대로 남겨도 전부 통과한다.
   */
  it('🔴 코드 표면(setup·config)이 검사 대상이다', () => {
    for (const rel of CODE_SURFACES) expect(files).toContain(rel)
  })

  /**
   * 🔴 REQ-2026-112 (AC-3) — 폐기 문구를 **담는 것이 정상인** 자리는 검사 대상에 없다.
   *
   * 대상이 나중에 글로브로 넓어지면 가드 자신·CHANGELOG·티켓 문서가 걸려
   * **정정을 설명하는 글 자체가 불가능**해진다. 그 회귀를 여기서 막는다.
   */
  it('🔴 제외돼야 할 자리가 검사 대상에 없다(글로브 확장 회귀 방지)', () => {
    const leaked = files.filter(
      (f) => (SCAN_EXCLUDED as readonly string[]).includes(f) || f.startsWith(EXCLUDED_PREFIX),
    )
    expect(leaked).toEqual([])
  })

  for (const claim of STALE_CLAIMS) {
    it(`"${claim.text.slice(0, 40)}…" 가 없다 — ${claim.why}`, () => {
      const hits = files.filter((f) => readFileSync(join(ROOT, f), 'utf8').includes(claim.text))
      expect(hits).toEqual([])
    })
  }
})

/**
 * REQ-2026-112 (AC-2) — **사용자에게 보여주는 문구**는 상수를 직접 검사한다.
 *
 * 🔴 왜 파일 스캔이 아니라 import인가: 대상이 정확하고, 상수 이름이 바뀌거나 사라지면
 *    **컴파일이 깨져** 조용한 무효화가 불가능하다. 파일 스캔은 같은 파일의 주석까지 걸려
 *    정정문을 막는다(그래서 코드 표면 검사는 별도 축으로 두고, 여기서는 값 자체를 본다).
 *
 * 이 문구는 사용자가 `stopGate` 값을 **고르는 순간** 화면에 뜬다(`hintFor`). 설정 화면이 실제
 * 동작보다 강한 약속을 하면 사용자는 보호받는다고 믿는 자리에서 보호받지 못한다.
 */
describe('[REQ-2026-112] setup 고지 문구 ↔ 실제 정지 규칙', () => {
  it('🔴 폐기된 주장을 담지 않는다', () => {
    for (const claim of STALE_CLAIMS)
      expect(STOP_GATE_HIGH_NOTICE, `고지에 폐기 문구: ${claim.why}`).not.toContain(claim.text)
  })

  /**
   * 🔴 **값↔의미 매핑을 실제 게이트 동작에 결속한다**(phase-1 리뷰 r01 P1).
   *
   * 단어 존재만 보면 `phase`와 `req`의 설명을 **서로 바꿔 놓아도** 통과한다. 그러면 사용자는
   * 정반대를 안내받는다. 그래서 먼저 `userConfirmGate`로 **진짜 규칙**을 확인하고,
   * 고지의 각 절이 그 규칙과 같은 말을 하는지 본다.
   *
   * 이렇게 두면 나중에 `userConfirmGate`가 바뀔 때 이 테스트가 **고지도 바꿔야 한다고 알려준다**.
   */
  describe('값↔의미 매핑이 userConfirmGate와 일치한다', () => {
    const high = { id: 'REQ-TEST', risk_level: 'HIGH' } as WorkflowState
    /** 고지에서 `<값>:` 절을 꺼낸다. 없으면 실패 — 문장 구조가 깨진 것도 결함이다. */
    const seg = (v: string): string => {
      const found = STOP_GATE_HIGH_NOTICE.split('·')
        .map((s) => s.trim())
        .find((s) => s.includes(`${v}:`))
      if (!found) throw new Error(`고지에 '${v}:' 절이 없다 — 실제 값: ${STOP_GATE_HIGH_NOTICE}`)
      return found
    }

    it('phase — 매 커밋에서 멈춘다', () => {
      expect(userConfirmGate(high, 'phase', false).blocked).toBe(true) // 진짜 규칙
      expect(seg('phase')).toContain('매 phase') // 고지가 같은 말을 하는가
    })

    it('req — 중간 phase는 안 멈추고 REQ를 끝내는 커밋에서 멈춘다', () => {
      expect(userConfirmGate(high, 'req', false).blocked).toBe(false)
      expect(userConfirmGate(high, 'req', true).blocked).toBe(true)
      expect(seg('req')).toContain('REQ를 끝내는')
    })

    it('merge — 커밋에서는 멈추지 않는다', () => {
      expect(userConfirmGate(high, 'merge', true).blocked).toBe(false)
      expect(seg('merge')).toContain('멈추지 않')
    })

    /**
     * 이 절은 **참이므로 유지**한다 — 커밋에서 안 멈춰도 통합 승인은 남는다.
     *
     * 🔴 **단어 존재만 보지 않는다**(phase-1 리뷰 r02 P1). `통합`이 있는지만 확인하면
     *    마지막 절을 `…필요하지 않습니다`로 뒤집어도 통과한다 — 사용자는 정반대를 안내받는데
     *    게이트는 조용하다. 그래서 **긍정 의미를 단언하고 부정형을 금지**한다.
     */
    it('통합 승인이 어느 값에서도 **필요하다**고 말한다(부정형 금지)', () => {
      const tail = STOP_GATE_HIGH_NOTICE.split('·')
        .map((s) => s.trim())
        .find((s) => s.includes('통합'))
      if (!tail) throw new Error(`고지에 통합 승인 절이 없다 — 실제 값: ${STOP_GATE_HIGH_NOTICE}`)
      expect(tail).toContain('어느 값에서도 필요')
      // '필요하지 않'·'필요 없'·'불필요' 어느 형태로도 뒤집을 수 없다.
      expect(tail).not.toMatch(/필요\s*(하지\s*않|없)|불필요/)
    })
  })
})

/**
 * REQ-2026-099 — **D-체크 정본 표가 구현보다 뒤처지지 않는다.**
 *
 * 🔴 배경: `07 §3`은 D-체크 정본 표라고 스스로 선언하는데, REQ-2026-014(D19 신설) 이후 8개 REQ가
 *    D20~D27을 추가하는 동안 아무도 그 표로 돌아오지 않아 "구현된 검사는 13개뿐이다"라는 거짓이
 *    남아 있었다. 사람의 성실성에 기대는 구조라 반복된다.
 *
 * 🔴 **권위는 `D_CHECK_IDS` 등록부다**(관찰이 아니다). 설계 두 차례가 관찰에서 권위를 구했다가
 *    반려됐다 — 소스 정규식은 `const id = 'D28'`을 못 뽑고, 런타임 관찰은 그 변형에서 발화하지
 *    않는 검사를 못 본다. 등록부 등재는 **타입이 강제**하므로(`Check.id: CheckId`) 관찰의 사각지대가
 *    없다. 여기서는 그 등록부와 문서를 대조한다.
 *
 * 🔴 **이 테스트가 하지 않는 것**: 표 행의 *내용*(검사 이름·FAIL 조건 서술)이 정확한지는 판정하지
 *    않는다. 오라클은 "id 집합이 같은가" 하나뿐이다 — REQ-2026-044가 일반 문서 스캐너를 설계했다가
 *    오라클을 명세하지 못해 폐기한 전례를 반복하지 않는다.
 */
describe('[REQ-2026-099] D-체크 정본 표 ↔ 등록부', () => {
  const DOC_REL = join('docs', 'ssot-design', '07-business-rules-and-state-machines.md')
  /** §3 표의 행 머리(`| **Dnn** |`)에서 id를 뽑는다. */
  const docIds = (): Set<string> => {
    const text = readFileSync(join(ROOT, DOC_REL), 'utf8')
    return new Set([...text.matchAll(/^\|\s*\*\*(D\d+[a-z]?)\*\*\s*\|/gm)].map((m) => m[1] as string))
  }
  const only = (a: Set<string>, b: Set<string>): string[] =>
    [...a].filter((x) => !b.has(x)).sort((x, y) => Number(x.slice(1)) - Number(y.slice(1)))

  it('오라클 자체가 살아 있다 — 표에서 id를 실제로 뽑는다', () => {
    // 정규식이 아무것도 못 뽑는데 "일치"로 통과하는 것을 막는다(빈 집합끼리는 항상 같다).
    expect(docIds().size).toBeGreaterThan(10)
    expect(D_CHECK_IDS.length).toBeGreaterThan(10)
  })

  it('문서 표에 등록부의 모든 D-체크가 있다(새 검사를 문서에 안 적으면 실패)', () => {
    expect(only(new Set<string>(D_CHECK_IDS), docIds())).toEqual([])
  })

  it('문서 표에 유령 행이 없다(제거된 검사가 문서에 남으면 실패)', () => {
    expect(only(docIds(), new Set<string>(D_CHECK_IDS))).toEqual([])
  })

  /**
   * 보조(DEC-3c) — 등록부에만 있고 **어떤 입력에서도 발화하지 않는** 죽은 항목을 드러낸다.
   * 발화 조건이 넓어져 이 변형들로 못 덮게 되면 결과는 **실패**다(조용한 통과가 아니다) —
   * 그때는 변형을 늘려야 한다.
   */
  it('등록부의 모든 D-체크가 실제로 발화한다(죽은 항목 탐지)', () => {
    const base: DoctorInputs = {
      state: { id: 'REQ-2026-001', branch: 'feat/req-2026-001-x', commit_allowed: false } as WorkflowState,
      currentBranch: 'feat/req-2026-001-x',
      branchExists: true,
      branchPrefix: 'feat/req-',
      stagedTree: 'TREE',
      statusEntries: [],
      scratch: [],
      responseVerdict: null,
      responseStructureOk: false,
      designApproved: false,
      designApprovedHash: null,
      currentDesignHash: null,
      ticketDocs: [],
      ticketRel: 'workflow/REQ-2026-001',
    }
    const variants: DoctorInputs[] = [
      base,
      { ...base, state: { ...base.state, commit_allowed: true, approved_diff_hash: 'TREE' } as WorkflowState },
      { ...base, designApproved: true, designApprovedHash: 'H', currentDesignHash: 'H' },
      { ...base, granularityMaxFiles: 1, statusEntries: [{ index: 'M', worktree: ' ', path: 'a.ts' }] },
    ]
    const runtime = new Set<string>()
    for (const v of variants) for (const c of runChecks(v)) runtime.add(c.id)
    expect(only(new Set<string>(D_CHECK_IDS), runtime)).toEqual([])
  })
})
