import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { D_CHECK_IDS, runChecks, type DoctorInputs } from '../../scripts/req/req-doctor'
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
]

/** 검사 대상: 저장소 루트의 README 2종 + `docs/*.md` 전부. */
function docFiles(root: string): string[] {
  const docs = readdirSync(join(root, 'docs'))
    .filter((f) => f.endsWith('.md'))
    .map((f) => join('docs', f))
  return ['README.md', 'README.en.md', ...docs]
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

  for (const claim of STALE_CLAIMS) {
    it(`"${claim.text.slice(0, 40)}…" 가 없다 — ${claim.why}`, () => {
      const hits = files.filter((f) => readFileSync(join(ROOT, f), 'utf8').includes(claim.text))
      expect(hits).toEqual([])
    })
  }
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
