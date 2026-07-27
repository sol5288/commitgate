import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

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
