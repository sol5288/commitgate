import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  extractQuickstartBlock,
  injectQuickstart,
  missingQuickstartFiles,
  runQuickstart,
  shippedQuickstartBlock,
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

// ─────────────── phase-2: verb + missingQuickstartFiles 통합 (temp repo) ───────────────

function tmpRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cg-qs-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  return dir
}
function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
}
const SHIPPED = shippedQuickstartBlock() // 실제 배포되는 Quick Start 블록
const MARK = 'commitgate:quickstart'

describe('[REQ-2026-040] missingQuickstartFiles', () => {
  it('CLAUDE.md 블록 없음 → 목록에, 있음 → 제외', () => {
    const dir = tmpRepo()
    try {
      writeFileSync(join(dir, 'CLAUDE.md'), '# 지침\n내용\n')
      expect(missingQuickstartFiles(dir)).toContain('CLAUDE.md')
      writeFileSync(join(dir, 'CLAUDE.md'), `# 지침\n\n${SHIPPED}\n\n내용\n`)
      expect(missingQuickstartFiles(dir)).not.toContain('CLAUDE.md')
    } finally {
      cleanup(dir)
    }
  })

  it('AGENTS.md는 계약 마커가 있을 때만 대상', () => {
    const dir = tmpRepo()
    try {
      writeFileSync(join(dir, 'AGENTS.md'), '# 일반 지침\n계약 아님\n') // 마커 없음 → 미접촉
      expect(missingQuickstartFiles(dir)).not.toContain('AGENTS.md')
      writeFileSync(join(dir, 'AGENTS.md'), `${AGENTS_CONTRACT_MARKER}\n# 계약\n`) // 마커 有·블록 無
      expect(missingQuickstartFiles(dir)).toContain('AGENTS.md')
    } finally {
      cleanup(dir)
    }
  })

  it('부재 파일은 목록에 없다', () => {
    const dir = tmpRepo()
    try {
      expect(missingQuickstartFiles(dir)).toEqual([])
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
