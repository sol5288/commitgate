/**
 * 병합 충돌 마커 가드(REQ-2026-123) — 추적 텍스트 파일에 충돌 마커가 남은 채 커밋되는 것을 잡는다.
 *
 * 실사고: 2026-08-10 통합에서 충돌 해소 스크립트가 CRLF 때문에 조용히 실패해 마커가 남은
 * CHANGELOG가 main에 push됐다 — 당시 전체 스위트는 그린이었다(아무 검사도 이걸 보지 않았다).
 *
 * 🔴 검사 패턴은 **동적 구성**이다 — 리터럴로 쓰면 이 파일 자신이 걸린다(설계 DEC-1).
 * 🔴 변이 검증은 **실제 수집·스캔 경로**(hermetic git repo)를 통과한다 — 순수 주입만으로는
 *    수집·읽기 회귀가 잡히지 않는다(설계 r01 P1·DEC-3).
 */
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, openSync, readSync, closeSync, statSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** 마커(줄 시작): `<<<<<<< `·`>>>>>>> `. 단독 `=======`는 setext 헤딩 오탐원이라 제외(설계 DEC-1·R2). */
const MARKERS = ['<'.repeat(7) + ' ', '>'.repeat(7) + ' ']

/** 제외 경로: 감사 아카이브(과거 응답 본문은 편집 금지·마커 서술 가능 — 설계 DEC-2). */
const EXCLUDED_RE = /^workflow\/REQ-[^/]+\/responses\//

/** git 휴리스틱: 선두 8,000바이트에 NUL이 있으면 바이너리(설계 DEC-2 — 확장자 목록 금지). */
function isBinary(absPath: string): boolean {
  const size = Math.min(8000, statSync(absPath).size)
  if (size === 0) return false
  const buf = Buffer.alloc(size)
  const fd = openSync(absPath, 'r')
  try {
    readSync(fd, buf, 0, size, 0)
  } finally {
    closeSync(fd)
  }
  return buf.includes(0)
}

export interface MarkerHit {
  rel: string
  line: number
  kind: string
}

/** 수집(git ls-files) → 제외 → 스니핑 → 스캔 — 실검사·변이 검증이 **같은 경로**를 쓴다(DEC-3). */
function collectAndScan(repoRoot: string): MarkerHit[] {
  const rels = execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0')
    .filter((r) => r !== '' && !EXCLUDED_RE.test(r))
  const hits: MarkerHit[] = []
  for (const rel of rels) {
    const abs = join(repoRoot, ...rel.split('/'))
    let binary: boolean
    try {
      binary = isBinary(abs)
    } catch {
      continue // 추적됐지만 워킹트리에 없음(드묾) — 이 가드의 관심사가 아니다.
    }
    if (binary) continue
    const lines = readFileSync(abs, 'utf8').split(/\r?\n/)
    lines.forEach((l, i) => {
      for (const m of MARKERS) if (l.startsWith(m)) hits.push({ rel, line: i + 1, kind: m.trim() })
    })
  }
  return hits
}

const PROJECT_ROOT = join(__dirname, '..', '..')

describe('[REQ-2026-123] 충돌 마커 가드', () => {
  it('🔴 이 저장소의 추적 텍스트 파일에 충돌 마커가 없다(완료 기준 2)', () => {
    const hits = collectAndScan(PROJECT_ROOT)
    expect(hits, hits.map((h) => `${h.rel}:${h.line} (${h.kind})`).join('\n')).toEqual([])
  })

  it('🔴 변이(실경로): hermetic repo의 마커·바이너리·제외·untracked·단독 등호가 표대로 판정된다(완료 기준 1·3)', () => {
    const repo = mkdtempSync(join(tmpdir(), 'cg-marker-'))
    const git = (args: string[]): string =>
      execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: repo, encoding: 'utf8' })
    try {
      git(['init', '-q'])
      // ① 마커 파일(두 종) — 검출돼야 한다.
      writeFileSync(join(repo, 'a.md'), `제목\n${MARKERS[0]}HEAD\n본문\n${MARKERS[1]}branch\n`)
      // ② NUL 포함 + 첫 줄 마커(임의 확장자) — 바이너리 스킵.
      writeFileSync(join(repo, 'input.dat'), Buffer.concat([Buffer.from(`${MARKERS[0]}binary\n`), Buffer.from([0, 1, 2])]))
      // ③ 제외 경로(감사 아카이브)의 마커 — 미검출.
      mkdirSync(join(repo, 'workflow', 'REQ-2026-001', 'responses'), { recursive: true })
      writeFileSync(join(repo, 'workflow', 'REQ-2026-001', 'responses', 'x.json'), `${MARKERS[0]}quoted\n`)
      // ④ 단독 ======= (setext 밑줄) — 미검출.
      writeFileSync(join(repo, 'heading.md'), `제목\n${'='.repeat(7)}\n`)
      git(['add', '-A'])
      git(['commit', '-qm', 'fixture'])
      // ⑤ untracked 마커 파일 — 수집 경계 밖(미검출).
      writeFileSync(join(repo, 'untracked.md'), `${MARKERS[1]}loose\n`)

      const hits = collectAndScan(repo)
      expect(hits).toEqual([
        { rel: 'a.md', line: 2, kind: MARKERS[0]!.trim() },
        { rel: 'a.md', line: 4, kind: MARKERS[1]!.trim() },
      ])
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  })
})
