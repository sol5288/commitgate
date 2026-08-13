import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  extractQuickstartBlock,
  injectQuickstart,
  quickstartBackfillTargets,
  runQuickstart,
  shippedQuickstartBlock,
  MANAGED_BLOCKS,
  blockRe,
  markerStreamProblems,
  injectManagedBlock,
  renderQuickstartPlan,
} from '../../bin/quickstart'
import { AGENTS_CONTRACT_MARKER, PACKAGE_ROOT } from '../../bin/init'

/**
 * REQ-2026-040 phase-1 — 순수 주입 lib.
 *
 * 관리 블록(마커 사이)만 삽입/치환하고 나머지는 보존. 멱등(재실행=noop). 줄바꿈은 파일 dominant EOL에
 * 맞춘다(REQ-039 교훈 — 혼합 줄바꿈 방지). 테스트 BLOCK은 SUT import가 아닌 리터럴로 고정한다.
 */
const BLOCK = [
  '<!-- commitgate:quickstart -->',
  '## CommitGate — 빠른 시작',
  '',
  '1. 요구를 확인한다.',
  '<!-- /commitgate:quickstart -->',
].join('\n')

// 블록이 갱신된 버전(마커 유지, 본문 상이) — updated 케이스용.
const NEW_BLOCK = BLOCK.replace('1. 요구를 확인한다.', '1. 요구를 확인한다.\n2. req:new 로 티켓.')

/**
 * REQ-2026-136 phase-1 — **관리 블록 집합**과 마커 스트림 안전 판정.
 *
 * 🔴 이 그룹의 헤드라인: **블록별 개수만 세면 교차 중첩을 놓친다.** 두 id 가 각각 "정상 쌍 1회"로
 *    보이는데도 앞 블록을 치환하면 다른 블록의 여는 마커가 지워진다 — 사용자 문서를 삼킬 수 있는 경로다.
 */
describe('[REQ-2026-136] 관리 블록 집합', () => {
  it('Quick Start 와 자율 진행 계약을 담고, 계약 본문은 AGENTS.md 에만 간다', () => {
    expect(MANAGED_BLOCKS.map((b) => b.id)).toEqual(['quickstart', 'autonomy'])
    const autonomy = MANAGED_BLOCKS.find((b) => b.id === 'autonomy')
    expect(autonomy?.targets).toEqual(['AGENTS.md'])
    // 🔴 CLAUDE.md 의 몫은 자립형 Quick Start 다 — 계약 전문을 복제하면 두 벌이 갈라진다.
    expect(autonomy?.targets).not.toContain('CLAUDE.md')
  })

  it('마커는 id 에서 생성된다(블록마다 상수를 늘리지 않는다)', () => {
    expect(blockRe('autonomy').test('<!-- commitgate:autonomy -->x<!-- /commitgate:autonomy -->')).toBe(true)
    expect(blockRe('autonomy').test('<!-- commitgate:quickstart -->x<!-- /commitgate:quickstart -->')).toBe(false)
  })
})

describe('[REQ-2026-136] markerStreamProblems — 문서 전체 스트림', () => {
  const open = (id: string) => `<!-- commitgate:${id} -->`
  const close = (id: string) => `<!-- /commitgate:${id} -->`

  it('정상(순차 두 블록)은 문제 없음', () => {
    const s = [open('quickstart'), 'a', close('quickstart'), '', open('autonomy'), 'b', close('autonomy')].join('\n')
    expect(markerStreamProblems(s)).toEqual([])
  })

  it('블록이 없어도 문제 없음', () => {
    expect(markerStreamProblems('# 제목\n본문\n')).toEqual([])
  })

  /** `commitgate:contract` 는 쌍이 없는 **파일 정체성 마커**다 — 스트림에 넣으면 항상 위반이 된다. */
  it('🔴 계약 정체성 마커는 스트림 대상이 아니다', () => {
    expect(markerStreamProblems('<!-- commitgate:contract -->\n# AGENTS.md\n')).toEqual([])
  })

  it('여는 마커만 있으면 위반', () => {
    expect(markerStreamProblems(`${open('autonomy')}\n본문\n`).join(' ')).toContain('닫히지 않음')
  })

  it('닫는 마커만 있으면 위반', () => {
    expect(markerStreamProblems(`본문\n${close('autonomy')}\n`).join(' ')).toContain('여는 마커가 없음')
  })

  it('같은 블록이 2회면 위반', () => {
    const s = [open('autonomy'), 'a', close('autonomy'), open('autonomy'), 'b', close('autonomy')].join('\n')
    expect(markerStreamProblems(s).join(' ')).toContain('2회 이상')
  })

  it('🔴 중첩은 위반(블록별 개수로는 정상으로 보인다)', () => {
    const s = [open('quickstart'), open('autonomy'), close('autonomy'), close('quickstart')].join('\n')
    expect(markerStreamProblems(s).join(' ')).toContain('중첩')
  })

  /**
   * 🔴 이 REQ 의 핵심 경로(설계 r01 P1). 두 id 모두 여는 1·닫는 1이라 개수 검사로는 통과한다.
   */
  it('🔴 교차는 위반 — 개수 검사로는 두 블록 다 "정상"이다', () => {
    const s = [open('quickstart'), open('autonomy'), close('quickstart'), close('autonomy')].join('\n')
    // 전제: 각 id 의 마커 개수는 정확히 1·1 이다(개수만으로는 못 잡는다는 증명).
    for (const id of ['quickstart', 'autonomy']) {
      expect((s.match(new RegExp(open(id), 'g')) ?? []).length, id).toBe(1)
      expect((s.match(new RegExp(close(id), 'g')) ?? []).length, id).toBe(1)
    }
    expect(markerStreamProblems(s).length).toBeGreaterThan(0)
  })
})

describe('[REQ-2026-136] injectManagedBlock — 임의 id 주입', () => {
  const A_BLOCK = ['<!-- commitgate:autonomy -->', '### 4-1. 자율 진행', '<!-- /commitgate:autonomy -->'].join('\n')

  /** 🔴 계약 절은 문맥 의존 heading 이라 "첫 H1 뒤"에 넣으면 계층이 뒤집힌다 — 파일 끝에 붙인다. */
  it('🔴 부재 시 파일 끝에 붙는다(첫 heading 뒤가 아니다)', () => {
    const src = '# AGENTS.md\n\n## 사용자 절\n내용\n'
    const r = injectManagedBlock(src, 'autonomy', A_BLOCK)
    expect(r.action).toBe('inserted')
    expect(r.content.startsWith(src)).toBe(true)
    expect(r.content.trimEnd().endsWith('<!-- /commitgate:autonomy -->')).toBe(true)
  })

  it('있으면 그 자리에서 치환하고 밖은 보존한다', () => {
    const src = `머리\n${A_BLOCK}\n꼬리\n`
    const updated = A_BLOCK.replace('### 4-1. 자율 진행', '### 4-1. 자율 진행(개정)')
    const r = injectManagedBlock(src, 'autonomy', updated)
    expect(r.action).toBe('updated')
    expect(r.content.startsWith('머리\n')).toBe(true)
    expect(r.content.endsWith('꼬리\n')).toBe(true)
    expect(r.content).toContain('개정')
  })

  it('동일하면 noop(멱등)', () => {
    const src = `머리\n${A_BLOCK}\n꼬리\n`
    expect(injectManagedBlock(src, 'autonomy', A_BLOCK)).toEqual({ content: src, action: 'noop' })
  })

  /** Quick Start 는 기존 계약(첫 H1 뒤)을 유지한다 — 이 REQ 는 그 동작을 바꾸지 않는다. */
  it('quickstart 는 기존 삽입 규칙 그대로다(무회귀)', () => {
    const src = '# 제목\n본문\n'
    expect(injectManagedBlock(src, 'quickstart', BLOCK)).toEqual(injectQuickstart(src, BLOCK))
  })
})

describe('[REQ-2026-040] extractQuickstartBlock', () => {
  it('마커 블록(마커 포함)을 추출한다', () => {
    expect(extractQuickstartBlock(`# 제목\n\n${BLOCK}\n\n본문`)).toBe(BLOCK)
  })
  it('마커가 없으면 null', () => {
    expect(extractQuickstartBlock('# 제목\n본문')).toBeNull()
  })
})

describe('[REQ-2026-040] injectQuickstart', () => {
  it('(a) 마커 없음 + heading → heading 바로 뒤 삽입, 나머지 보존', () => {
    const file = '# 프로젝트 지침\n\n기존 내용\n'
    const r = injectQuickstart(file, BLOCK)
    expect(r.action).toBe('inserted')
    expect(r.insertAt).toBe('after-heading')
    expect(r.content.startsWith('# 프로젝트 지침')).toBe(true)
    expect(extractQuickstartBlock(r.content)).toBe(BLOCK)
    expect(r.content).toContain('기존 내용')
    // heading < 블록 < 기존 내용 순서
    expect(r.content.indexOf('# 프로젝트 지침')).toBeLessThan(r.content.indexOf(BLOCK))
    expect(r.content.indexOf(BLOCK)).toBeLessThan(r.content.indexOf('기존 내용'))
  })

  it('(b) 마커 없음 + heading 없음 → 파일 맨 앞 삽입', () => {
    const file = '제목 없는 기존 지침\n두 번째 줄\n'
    const r = injectQuickstart(file, BLOCK)
    expect(r.action).toBe('inserted')
    expect(r.insertAt).toBe('top')
    expect(r.content.startsWith(BLOCK)).toBe(true)
    expect(r.content.endsWith('제목 없는 기존 지침\n두 번째 줄\n')).toBe(true)
  })

  it('(c) 마커 있고 동일 → noop(내용 불변)', () => {
    const file = `# 제목\n\n${BLOCK}\n\n본문\n`
    const r = injectQuickstart(file, BLOCK)
    expect(r.action).toBe('noop')
    expect(r.content).toBe(file)
  })

  it('(d) 마커 있고 다름 → in-place 치환, 블록 밖 보존', () => {
    const file = `# 제목\n\n${BLOCK}\n\n본문\n`
    const r = injectQuickstart(file, NEW_BLOCK)
    expect(r.action).toBe('updated')
    expect(extractQuickstartBlock(r.content)).toBe(NEW_BLOCK)
    expect(r.content).toContain('# 제목')
    expect(r.content).toContain('본문')
    expect(r.content).not.toContain(BLOCK) // 옛 블록(정확 문자열)은 사라짐
  })

  it('(e) 멱등 — 두 번째 주입은 noop', () => {
    const once = injectQuickstart('# 제목\n\n기존\n', BLOCK)
    const twice = injectQuickstart(once.content, BLOCK)
    expect(twice.action).toBe('noop')
    expect(twice.content).toBe(once.content)
  })

  it('(f) CRLF 파일 → 삽입 블록도 CRLF(고립 LF 없음)', () => {
    const r = injectQuickstart('# 제목\r\n\r\n기존\r\n', BLOCK)
    expect(r.action).toBe('inserted')
    const block = extractQuickstartBlock(r.content) as string
    expect(block.includes('\r\n')).toBe(true)
    expect(/[^\r]\n/.test(block)).toBe(false) // CR 없는 고립 LF가 없어야
  })

  it('(g) 혼합 EOL·LF 우세 → 삽입 블록은 LF (design-r01 P1)', () => {
    // CRLF 1개 + standalone LF 3개 → LF 우세. 한 번 섞인 CRLF로 CRLF 판정하면 안 된다.
    const r = injectQuickstart('# 제목\r\n\n기존 내용\n기존 2\n', BLOCK)
    expect(r.action).toBe('inserted')
    const block = extractQuickstartBlock(r.content) as string
    expect(block.includes('\r\n')).toBe(false) // LF 우세라 삽입 블록도 LF
  })

  it('(h) 코드펜스 안 `# ` 는 heading이 아니다 — 실제 H1 뒤에 삽입 (design-r01 P1)', () => {
    const file = '```bash\n# 설치\nnpm i\n```\n\n# 프로젝트 지침\n\n본문\n'
    const r = injectQuickstart(file, BLOCK)
    expect(r.action).toBe('inserted')
    expect(r.insertAt).toBe('after-heading')
    // 블록은 코드펜스 내부('npm i')·실제 H1 뒤 — 펜스 안이 아니다
    expect(r.content.indexOf('npm i')).toBeLessThan(r.content.indexOf(BLOCK))
    expect(r.content.indexOf('# 프로젝트 지침')).toBeLessThan(r.content.indexOf(BLOCK))
  })

  it('(i) 코드펜스 안의 다른 종류/짧은 펜스는 닫기가 아니다 (design-r02 P1)', () => {
    // ```backtick 펜스 안의 ~~~ 는 코드 내용 — 펜스를 닫지 않는다. 그 안의 `# 설치`는 heading 아님.
    const file = '```bash\n~~~\n# 설치\n```\n\n# 실제 제목\n\n본문\n'
    const r = injectQuickstart(file, BLOCK)
    expect(r.action).toBe('inserted')
    expect(r.insertAt).toBe('after-heading')
    expect(r.content.indexOf('# 실제 제목')).toBeLessThan(r.content.indexOf(BLOCK))
    expect(r.content.indexOf('# 설치')).toBeLessThan(r.content.indexOf(BLOCK)) // 펜스 안 내용은 블록보다 앞
  })

  it('(j) backtick 펜스 info string에 backtick 있으면 유효 opening 아님 → 뒤 H1에 삽입 (design-r03 P1)', () => {
    // ```sh `x` — info에 backtick → CommonMark상 펜스 열기가 아니다. 다음 `# 실제 제목`이 첫 H1.
    const file = '```sh `x`\n# 실제 제목\n```\n본문\n'
    const r = injectQuickstart(file, BLOCK)
    expect(r.action).toBe('inserted')
    expect(r.insertAt).toBe('after-heading')
    expect(r.content.indexOf('# 실제 제목')).toBeLessThan(r.content.indexOf(BLOCK))
  })

  it('(k) opening보다 짧은 같은-문자 펜스는 닫기 아니다 (design-r02 관찰)', () => {
    // ````(4) 펜스 안의 ```(3)은 짧아서 닫기 아님 → 그 안 `# 안쪽`은 heading 아님. 진짜 H1은 그 뒤.
    const file = '````\n```\n# 안쪽\n````\n\n# 진짜\n본문\n'
    const r = injectQuickstart(file, BLOCK)
    expect(r.action).toBe('inserted')
    expect(r.insertAt).toBe('after-heading')
    expect(r.content.indexOf('# 진짜')).toBeLessThan(r.content.indexOf(BLOCK))
    expect(r.content.indexOf('# 안쪽')).toBeLessThan(r.content.indexOf(BLOCK))
  })
})

// ─────────────── phase-2: verb + quickstartBackfillTargets 통합 (temp repo) ───────────────

function tmpRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cg-qs-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  // REQ-2026-049: repo-local identity. 인라인 `-c`는 그 호출에만 적용돼 **피시험 코드의 커밋**을 보호하지 못한다.
  execFileSync('git', ['config', 'user.email', 't@t.t'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 't'], { cwd: dir })
  return dir
}
function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
}
const SHIPPED = shippedQuickstartBlock() // 실제 배포되는 Quick Start 블록
const MARK = 'commitgate:quickstart'

/** REQ-2026-101: 진단이 반환하는 rel 목록(사유 무시) — 기존 단언을 그대로 옮기기 위한 보조. */
const rels = (dir: string): string[] => (quickstartBackfillTargets(dir) ?? []).map((t) => t.rel)

describe('[REQ-2026-040] quickstartBackfillTargets — 부재 탐지(무회귀)', () => {
  it('CLAUDE.md 블록 없음 → 목록에, 있음 → 제외', () => {
    const dir = tmpRepo()
    try {
      writeFileSync(join(dir, 'CLAUDE.md'), '# 지침\n내용\n')
      expect(rels(dir)).toContain('CLAUDE.md')
      writeFileSync(join(dir, 'CLAUDE.md'), `# 지침\n\n${SHIPPED}\n\n내용\n`)
      expect(rels(dir)).not.toContain('CLAUDE.md')
    } finally {
      cleanup(dir)
    }
  })

  it('AGENTS.md는 계약 마커가 있을 때만 **주입** 대상(마커 없으면 미접촉이되 진단에는 남는다)', () => {
    const dir = tmpRepo()
    try {
      writeFileSync(join(dir, 'AGENTS.md'), '# 일반 지침\n계약 아님\n') // 마커 없음 → 미접촉
      /**
       * 🔴 REQ-2026-136 DEC-4c: 진단에서 **빼지 않는다**. 예전에는 목록에서 아예 빠져 `--apply` 후
       *    "아무 일도 없었다"만 보이고 doctor 도 OK였다 — 사용자는 무엇을 해야 하는지 영영 몰랐다.
       *    파일은 그대로 두되(자동 수정 금지) 사유는 말한다.
       */
      const t = (quickstartBackfillTargets(dir) ?? []).find((x) => x.rel === 'AGENTS.md')
      expect(t?.action).toBe('unmanaged')
      expect(t?.reason ?? '').toContain('계약 마커 없음')
      writeFileSync(join(dir, 'AGENTS.md'), `${AGENTS_CONTRACT_MARKER}\n# 계약\n`) // 마커 有·블록 無
      expect(rels(dir)).toContain('AGENTS.md')
    } finally {
      cleanup(dir)
    }
  })

  it('부재 파일은 목록에 없다', () => {
    const dir = tmpRepo()
    try {
      expect(rels(dir)).toEqual([])
    } finally {
      cleanup(dir)
    }
  })
})

describe('[REQ-2026-040] runQuickstart (verb)', () => {
  it('plan(기본)은 쓰지 않고, --apply가 CLAUDE.md에 블록 주입·나머지 보존', () => {
    const dir = tmpRepo()
    try {
      writeFileSync(join(dir, 'CLAUDE.md'), '# 내 지침\n\n소중한 내용\n')
      const plan = runQuickstart({ dir, apply: false })
      expect(plan.files.find((f) => f.rel === 'CLAUDE.md')?.action).toBe('insert')
      expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).not.toContain(MARK) // dry-run은 안 씀
      runQuickstart({ dir, apply: true })
      const after = readFileSync(join(dir, 'CLAUDE.md'), 'utf8')
      expect(after).toContain(MARK)
      expect(after).toContain('소중한 내용') // 블록 밖 보존
      expect(after.startsWith('# 내 지침')).toBe(true)
    } finally {
      cleanup(dir)
    }
  })

  /**
   * 🔴 REQ-2026-136 phase-1 r01 P1 — 판정 함수를 만들어 두고 **plan 에 연결하지 않으면** 보호가
   *    실재하지 않는다. 교차 중첩 파일에서 블록 치환은 다른 블록의 마커와 그 사이 **사용자 내용을
   *    함께 덮어쓴다.** 그래서 실 파일이 **바이트 그대로**임을 본다.
   */
  describe('[REQ-2026-136] 마커가 손상된 파일에는 쓰지 않는다', () => {
    const broken = (body: string): string => `${AGENTS_CONTRACT_MARKER}\n# AGENTS.md\n\n${body}\n소중한 사용자 절\n`
    const cases: Array<[string, string]> = [
      [
        '교차',
        [
          '<!-- commitgate:quickstart -->',
          '옛 본문',
          '<!-- commitgate:autonomy -->',
          '계약',
          '<!-- /commitgate:quickstart -->',
          '<!-- /commitgate:autonomy -->',
        ].join('\n'),
      ],
      ['중첩', ['<!-- commitgate:quickstart -->', '<!-- commitgate:autonomy -->', 'x', '<!-- /commitgate:autonomy -->', '<!-- /commitgate:quickstart -->'].join('\n')],
      ['반쪽(여는 마커만)', '<!-- commitgate:quickstart -->\n옛 본문'],
      ['중복', ['<!-- commitgate:quickstart -->', 'a', '<!-- /commitgate:quickstart -->', '<!-- commitgate:quickstart -->', 'b', '<!-- /commitgate:quickstart -->'].join('\n')],
    ]

    for (const [name, body] of cases) {
      it(`🔴 ${name} — --apply 해도 파일이 바이트 그대로다`, () => {
        const dir = tmpRepo()
        try {
          const before = broken(body)
          writeFileSync(join(dir, 'AGENTS.md'), before)
          const plan = runQuickstart({ dir, apply: true })
          const f = plan.files.find((x) => x.rel === 'AGENTS.md')
          expect(f?.action, name).toBe('skip')
          expect(f?.reason ?? '', name).toContain('손상')
          expect(plan.writes.some((w) => w.rel === 'AGENTS.md'), name).toBe(false)
          // 🔴 오라클의 핵심: 실제 파일이 한 바이트도 바뀌지 않았다.
          expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), name).toBe(before)
        } finally {
          cleanup(dir)
        }
      })
    }

    /**
     * 🔴 DEC-4a 핵심 경로: 두 블록이 **모두 없는** 파일에 적용하면 **둘 다** 들어가야 한다.
     *    각 블록을 원본 기준으로 계획해 따로 쓰면 마지막 쓰기만 남아 한 블록을 잃는다.
     */
    it('🔴 두 블록이 모두 없던 AGENTS.md — 둘 다 들어가고 사용자 문장이 보존되며 재실행은 noop', () => {
      const dir = tmpRepo()
      try {
        const userLine = '## 우리 팀 규칙\n\n소중한 내용 — 한 글자도 바뀌면 안 된다\n'
        writeFileSync(join(dir, 'AGENTS.md'), `${AGENTS_CONTRACT_MARKER}\n# AGENTS.md\n\n${userLine}`)
        runQuickstart({ dir, apply: true })
        const after = readFileSync(join(dir, 'AGENTS.md'), 'utf8')

        // ① 두 블록이 모두 있다.
        for (const id of ['quickstart', 'autonomy']) {
          expect(after, id).toContain(`<!-- commitgate:${id} -->`)
          expect(after, id).toContain(`<!-- /commitgate:${id} -->`)
        }
        // ② 블록 밖 사용자 문장이 그대로다.
        expect(after).toContain('소중한 내용 — 한 글자도 바뀌면 안 된다')
        // ③ 결과 파일의 마커 스트림이 정상이다(우리가 만든 파일이 스스로 unsafe면 안 된다).
        expect(markerStreamProblems(after)).toEqual([])

        // ④ 재실행 멱등 — 쓰기 0건이고 내용 불변.
        const plan2 = runQuickstart({ dir, apply: true })
        expect(plan2.writes).toEqual([])
        expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toBe(after)
      } finally {
        cleanup(dir)
      }
    })

    /** 🔴 계약 마커가 없으면 쓰지 않되 **조용하지도 않다** — 사용자는 무엇을 해야 하는지 들어야 한다. */
    it('🔴 계약 마커 없는 AGENTS.md — 쓰기 0건 + 실재하는 사본을 가리키는 안내', () => {
      const dir = tmpRepo()
      try {
        const before = '# 우리 AGENTS\n\n우리 규칙\n'
        writeFileSync(join(dir, 'AGENTS.md'), before)
        writeFileSync(join(dir, 'AGENTS.commitgate.md'), '계약 사본\n')
        const plan = runQuickstart({ dir, apply: true })
        const f = plan.files.find((x) => x.rel === 'AGENTS.md')
        expect(f?.action).toBe('skip')
        expect(f?.reason ?? '').toContain('AGENTS.commitgate.md')
        expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toBe(before)
      } finally {
        cleanup(dir)
      }
    })

    /** 사본이 없으면 그것을 얻는 복구 경로를 말한다(열 수 없는 파일을 가리키지 않는다). */
    it('사본이 없으면 init 재실행 복구 경로를 안내한다', () => {
      const dir = tmpRepo()
      try {
        writeFileSync(join(dir, 'AGENTS.md'), '# 우리 AGENTS\n')
        const plan = runQuickstart({ dir, apply: true })
        expect(plan.files.find((x) => x.rel === 'AGENTS.md')?.reason ?? '').toContain('commitgate init')
      } finally {
        cleanup(dir)
      }
    })

    /**
     * 🔴 phase-2 r01 P1: 판정을 블록 단위로 만들어 두고 **출력에 쓰지 않으면** 그 정보는 없는 것과 같다.
     *    "quickstart는 최신인데 autonomy만 없다"는 정상 상태에서 사용자가 무엇이 삽입되는지 알아야 한다.
     */
    it('🔴 계획 출력이 어느 블록이 바뀌는지 말한다', () => {
      const dir = tmpRepo()
      try {
        // quickstart 는 이미 최신(shipped 그대로)이고 autonomy 만 없는 상태를 만든다.
        const qs = shippedQuickstartBlock()
        writeFileSync(join(dir, 'AGENTS.md'), `${AGENTS_CONTRACT_MARKER}\n# AGENTS.md\n\n${qs}\n\n우리 규칙\n`)
        const plan = runQuickstart({ dir, apply: false })
        const f = plan.files.find((x) => x.rel === 'AGENTS.md')
        expect(f?.blocks?.find((b) => b.id === 'quickstart')?.action).toBe('noop')
        expect(f?.blocks?.find((b) => b.id === 'autonomy')?.action).toBe('insert')
        const out = renderQuickstartPlan(plan, false).join('\n')
        expect(out).toContain('autonomy: 없음 → 삽입')
        // 최신 블록은 소음으로 나열하지 않는다.
        expect(out).not.toContain('quickstart: 없음')
      } finally {
        cleanup(dir)
      }
    })

    /** 대조군: 마커가 정상이면 같은 경로가 실제로 쓴다(위 단언이 공허하지 않음을 증명). */
    it('대조군 — 정상 파일은 쓴다', () => {
      const dir = tmpRepo()
      try {
        writeFileSync(join(dir, 'AGENTS.md'), `${AGENTS_CONTRACT_MARKER}\n# AGENTS.md\n\n내용\n`)
        const plan = runQuickstart({ dir, apply: true })
        expect(plan.writes.some((w) => w.rel === 'AGENTS.md')).toBe(true)
      } finally {
        cleanup(dir)
      }
    })
  })

  it('멱등 — --apply 두 번째는 noop(쓰기 0건)', () => {
    const dir = tmpRepo()
    try {
      writeFileSync(join(dir, 'CLAUDE.md'), '# 지침\n내용\n')
      runQuickstart({ dir, apply: true })
      const p2 = runQuickstart({ dir, apply: true })
      expect(p2.files.find((f) => f.rel === 'CLAUDE.md')?.action).toBe('noop')
      expect(p2.writes.length).toBe(0)
    } finally {
      cleanup(dir)
    }
  })

  it('AGENTS.md: 계약 마커 有→주입, 無→skip(미접촉)', () => {
    const withMarker = tmpRepo()
    const noMarker = tmpRepo()
    try {
      writeFileSync(join(withMarker, 'AGENTS.md'), `${AGENTS_CONTRACT_MARKER}\n# 계약\n규칙\n`)
      runQuickstart({ dir: withMarker, apply: true })
      expect(readFileSync(join(withMarker, 'AGENTS.md'), 'utf8')).toContain(MARK)

      writeFileSync(join(noMarker, 'AGENTS.md'), '# 일반 지침\n')
      const plan = runQuickstart({ dir: noMarker, apply: true })
      expect(plan.files.find((f) => f.rel === 'AGENTS.md')?.action).toBe('skip')
      expect(readFileSync(join(noMarker, 'AGENTS.md'), 'utf8')).not.toContain(MARK)
    } finally {
      cleanup(withMarker)
      cleanup(noMarker)
    }
  })

  it('부재 파일은 skip — 생성하지 않는다', () => {
    const dir = tmpRepo()
    try {
      const plan = runQuickstart({ dir, apply: true })
      expect(plan.files.every((f) => f.action === 'skip')).toBe(true)
      expect(existsSync(join(dir, 'CLAUDE.md'))).toBe(false)
      expect(existsSync(join(dir, 'AGENTS.md'))).toBe(false)
    } finally {
      cleanup(dir)
    }
  })

  it('대상이 CommitGate 패키지 자신이면 거부(fail-closed)', () => {
    expect(() => runQuickstart({ dir: PACKAGE_ROOT, apply: false })).toThrow(/패키지 자신/)
  })
})

/**
 * REQ-2026-101 — **드리프트 탐지**. 블록이 있지만 설치된 버전과 다른 상태를 알린다.
 *
 * 🔴 왜 없었나: `injectQuickstart`는 처음부터 낡은 블록을 **치환**했지만(`updated`), 진단
 *    (`missingQuickstartFiles`)은 **마커 부재만** 봤다. 그래서 블록을 개정해도 이미 설치된
 *    소비자는 신호를 못 받았고, 신호가 없으니 아무도 `quickstart --apply`를 실행하지 않았다.
 *    지금까지 블록을 한 번도 개정하지 않아 드러나지 않았을 뿐이다.
 */
describe('[REQ-2026-101] quickstartBackfillTargets — 드리프트 탐지', () => {
  /** shipped 블록의 본문 한 줄을 바꾼 "낡은 블록"(마커는 그대로 유지해야 탐지 축이 성립한다). */
  const STALE = SHIPPED.replace('CommitGate REQ 워크플로로만 처리한다', 'CommitGate 워크플로로 처리한다(옛 문구)')

  it('픽스처 자체 점검 — STALE은 마커를 유지하면서 내용만 다르다', () => {
    expect(STALE).toContain(MARK)          // 부재 탐지로 잡히는 게 아님을 보장
    expect(STALE).not.toBe(SHIPPED)
  })

  it('마커 有 + 내용 다름 → replace(드리프트)로 잡힌다', () => {
    const dir = tmpRepo()
    try {
      writeFileSync(join(dir, 'CLAUDE.md'), `# 지침\n\n${STALE}\n\n내용\n`)
      expect(quickstartBackfillTargets(dir)).toEqual([{ rel: 'CLAUDE.md', blockId: 'quickstart', action: 'replace' }])
    } finally { cleanup(dir) }
  })

  it('마커 有 + 내용 동일 → 대상 아님', () => {
    const dir = tmpRepo()
    try {
      writeFileSync(join(dir, 'CLAUDE.md'), `# 지침\n\n${SHIPPED}\n\n내용\n`)
      expect(quickstartBackfillTargets(dir)).toEqual([])
    } finally { cleanup(dir) }
  })

  it('마커 無 → insert(부재)로 잡힌다 — 두 사유가 구분된다', () => {
    const dir = tmpRepo()
    try {
      writeFileSync(join(dir, 'CLAUDE.md'), '# 지침\n내용\n')
      expect(quickstartBackfillTargets(dir)).toEqual([{ rel: 'CLAUDE.md', blockId: 'quickstart', action: 'insert' }])
    } finally { cleanup(dir) }
  })

  it('계약 마커 없는 AGENTS.md는 드리프트여도 미접촉 — 다만 사유는 진단에 남는다(REQ-2026-136)', () => {
    const dir = tmpRepo()
    try {
      writeFileSync(join(dir, 'AGENTS.md'), `# 일반 지침\n\n${STALE}\n`) // 계약 마커 없음
      const targets = quickstartBackfillTargets(dir) ?? []
      // 🔴 `replace`(도구가 고침)로 잡히면 안 된다 — 이 파일은 건드리지 않는다.
      expect(targets.filter((t) => t.action === 'insert' || t.action === 'replace')).toEqual([])
      expect(targets.find((t) => t.rel === 'AGENTS.md')?.action).toBe('unmanaged')
    } finally { cleanup(dir) }
  })

  /**
   * 🔴 **핵심(DEC-6 ⑥)**: 진단과 적용이 같은 계획기에서 나오므로 정의상 일치해야 한다.
   *    진단이 지목 → `--apply` → 재진단이 **빈 목록**. 이 왕복이 깨지면 사용자는 영원히 WARN을 본다.
   */
  it('진단 ↔ 적용 왕복: 지목된 파일을 --apply가 쓰고, 재진단이 clean해진다', () => {
    const dir = tmpRepo()
    try {
      writeFileSync(join(dir, 'CLAUDE.md'), `# 지침\n\n${STALE}\n\n내용\n`)
      writeFileSync(join(dir, 'AGENTS.md'), `${AGENTS_CONTRACT_MARKER}\n# 계약\n`) // 계약 有·블록 無
      const before = quickstartBackfillTargets(dir) ?? []
      // 🔴 REQ-2026-136: 진단은 **블록 단위**다 — AGENTS.md 는 두 관리 블록을 모두 받는다.
      expect(before.map((t) => `${t.rel}:${t.blockId}:${t.action}`).sort()).toEqual([
        'AGENTS.md:autonomy:insert',
        'AGENTS.md:quickstart:insert',
        'CLAUDE.md:quickstart:replace',
      ])

      runQuickstart({ dir, apply: true })

      expect(quickstartBackfillTargets(dir)).toEqual([])                       // 재진단 clean
      expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toContain(SHIPPED)  // 낡은 블록이 실제로 교체됨
      expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toContain('내용')    // 마커 밖은 보존
    } finally { cleanup(dir) }
  })
})
