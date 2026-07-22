import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { packageRoot } from '../../scripts/req/lib/config'
import {
  archiveBaseName,
  isValidIsoInstant,
  isConfinedArchivePath,
  buildManifestEntry,
  validateManifest,
} from '../../scripts/req/lib/evidence'

/**
 * REQ-2026-048 phase-1 — `lib/evidence.ts`의 **leaf 불변식**을 고정한다.
 *
 * 🔴 이 파일이 `review-codex`·`req-doctor`·`req-commit` 에서 **값(런타임) import**를 하면
 *    `review-codex → lib/evidence → review-codex` 런타임 순환이 되살아난다. 그 순환이 바로
 *    design evidence 내구화를 승인 경로에 흡수하지 못하게 막던 구조적 원인이다.
 *    타입 전용(`import type`)은 컴파일 시 소거되므로 허용한다.
 *
 * 오라클은 **소스 텍스트**다 — 번들러/런타임이 순환을 조용히 견디는 경우에도 의도 위반을 잡아야 한다.
 */
const EVIDENCE_SRC = join(packageRoot(), 'scripts', 'req', 'lib', 'evidence.ts')

/** 소스에서 `import`/`export ... from` 구문을 (typeOnly, 모듈경로)로 뽑는다. */
function moduleEdges(src: string): { typeOnly: boolean; from: string }[] {
  const out: { typeOnly: boolean; from: string }[] = []
  const re = /^\s*(?:import|export)\s+(type\s+)?([^'"]*?)\s*from\s*['"]([^'"]+)['"]/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    // `import { type A, type B } from` 처럼 절 내부에만 type이 붙은 경우도 타입 전용으로 본다.
    const clause = m[2] ?? ''
    const namedOnlyTypes = /^\{[^}]*\}$/.test(clause.trim()) && !/\{\s*[A-Za-z_$][^}]*?\}/.test(clause.replace(/type\s+[A-Za-z_$][\w$]*/g, ''))
    out.push({ typeOnly: Boolean(m[1]) || namedOnlyTypes, from: m[3] ?? '' })
  }
  return out
}

describe('[REQ-2026-048] lib/evidence.ts — leaf 불변식', () => {
  const src = readFileSync(EVIDENCE_SRC, 'utf8')
  const edges = moduleEdges(src)

  it('상위 모듈(review-codex·req-doctor·req-commit)에서 런타임 import를 하지 않는다', () => {
    const forbidden = ['review-codex', 'req-doctor', 'req-commit']
    const runtimeViolations = edges.filter((e) => !e.typeOnly && forbidden.some((f) => e.from.includes(f)))
    expect(
      runtimeViolations.map((e) => e.from),
      'lib/evidence.ts 는 leaf 여야 한다 — 상위 모듈의 값 import는 review-codex↔req-commit 순환을 되살린다',
    ).toEqual([])
  })

  it('런타임 import 대상은 leaf(lib/*)로만 제한된다', () => {
    const runtime = edges.filter((e) => !e.typeOnly).map((e) => e.from)
    for (const from of runtime) {
      expect(from.startsWith('./') || from.startsWith('node:'), `예상 외 런타임 의존: ${from}`).toBe(true)
      expect(from.includes('../'), `상위 디렉터리 런타임 의존 금지: ${from}`).toBe(false)
    }
  })

  it('상위 모듈 참조는 타입 전용으로만 존재한다(있다면)', () => {
    const upper = edges.filter((e) => e.from.includes('../review-codex'))
    for (const e of upper) expect(e.typeOnly, `../review-codex 참조는 import type 이어야 한다: ${e.from}`).toBe(true)
  })
})

/**
 * 이동이 **동작을 바꾸지 않았다**는 최소 확인. 상세 동작 계약은 기존 `req-commit.test.ts`가 그대로 검증하며
 * (re-export 덕에 무수정 그린), 여기서는 새 경로로도 같은 결과가 나오는지만 본다.
 */
describe('[REQ-2026-048] 이동한 술어 — 새 경로에서 동작 동일', () => {
  it('archiveBaseName: design은 phaseId 무시, phase는 phaseId(없으면 phase)', () => {
    expect(archiveBaseName('design', 'phase-A')).toBe('design')
    expect(archiveBaseName('phase', 'phase-A')).toBe('phase-A')
    expect(archiveBaseName('phase', null)).toBe('phase')
  })

  it('isValidIsoInstant: 형식 + 달력 유효성 둘 다', () => {
    expect(isValidIsoInstant('2026-07-22T04:05:06Z')).toBe(true)
    expect(isValidIsoInstant('2026-99-99T99:99:99Z')).toBe(false)
    expect(isValidIsoInstant('nope')).toBe(false)
  })

  it('isConfinedArchivePath: 현재 티켓 responses/ 직계 아카이브만', () => {
    const t = 'workflow/REQ-2026-001'
    expect(isConfinedArchivePath(`${t}/responses/design-r01-approved.json`, t)).toBe(true)
    expect(isConfinedArchivePath(`${t}/responses/approvals.jsonl`, t)).toBe(false)
    expect(isConfinedArchivePath(`${t}/responses/../../escape-r01-approved.json`, t)).toBe(false)
    expect(isConfinedArchivePath(`workflow/REQ-2026-002/responses/design-r01-approved.json`, t)).toBe(false)
    expect(isConfinedArchivePath(`${t}/responses/design-r01-approved.json`, undefined)).toBe(false)
  })

  it('buildManifestEntry/validateManifest: design 행이 왕복 검증을 통과한다', () => {
    const t = 'workflow/REQ-2026-001'
    const sha = 'a'.repeat(64)
    const oid = 'b'.repeat(40)
    const entry = buildManifestEntry(
      {
        review_kind: 'design',
        phase_id: null,
        response_path: `${t}/responses/design-r01-approved.json`,
        response_sha256: sha,
        review_base_sha: oid,
        design_hash: sha,
        approved_at: '2026-07-22T00:00:00.000Z',
      } as Parameters<typeof buildManifestEntry>[0],
      { consumedAt: '2026-07-22T00:00:01.000Z', consumedByCommitSha: oid, userCommitConfirmed: null },
    )
    expect(entry.kind).toBe('design')
    expect(validateManifest(`${JSON.stringify(entry)}\n`, { ticketRel: t, validPhaseIds: [] })).toEqual([])
  })
})
