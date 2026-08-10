import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { syncGuidanceViolations, SYNC_GITIGNORE_PATTERN } from '../../scripts/req/lib/sync-guidance'

/**
 * REQ-2026-125 phase-1 — **gitignore 백필 안내는 실제로 백필되는 명령이어야 한다.**
 *
 * `sync`의 기본은 dry-run(쓰기 0건)이다. 0.21.0은 `--apply` 없는 백필 안내를 실제로 배포했다
 * (`bin/verify-range.ts` 런타임 경고 · CHANGELOG 업그레이드 안내). 소비자가 경고를 복사-실행하면
 * 아무것도 바뀌지 않고 같은 경고를 다시 본다. 이 가드는 그 재등장을 잡는다.
 *
 * 규칙(줄 단위): `sync --gitignore`를 포함하는 줄은 같은 줄에 `--apply`도 포함해야 한다.
 *  - 정당한 표기 통과: `sync --gitignore [--apply]`(과거 CHANGELOG) · `sync --apply --gitignore`.
 *  - 🔴 일반 문서 스캐너로 키우지 말 것(REQ-2026-044 폐기 전례) — 규칙 하나·패턴 하나.
 *
 * 대상(설계 DEC-1): bin/scripts의 .ts · docs 재귀 .md · README 양언어 · templates 전체 · CHANGELOG.
 * 제외: workflow/(티켓 감사 기록) · tests/(위반 문자열을 fixture로 쓴다) · 규칙 정본 모듈 자신.
 */

const ROOT = join(__dirname, '..', '..')

/** 규칙 정본 — 패턴 문자열 상수를 담는 것이 역할이므로 검사 대상에서 뺀다(retired-claims 전례). */
const SCAN_EXCLUDED = [join('scripts', 'req', 'lib', 'sync-guidance.ts')] as const

function collect(dir: string, ext: string | null): string[] {
  const out: string[] = []
  for (const f of readdirSync(join(ROOT, dir), { recursive: true, withFileTypes: true })) {
    if (!f.isFile()) continue
    const rel = join(dir, join(String(f.parentPath ?? f.path).slice(join(ROOT, dir).length + 1) || '.', f.name))
    if (ext !== null && !rel.endsWith(ext)) continue
    out.push(rel)
  }
  return out
}

function scanTargets(): string[] {
  const files = [
    ...collect('bin', '.ts'),
    ...collect('scripts', '.ts'),
    ...collect('docs', '.md'),
    ...collect('templates', null),
    'README.md',
    'README.en.md',
    'CHANGELOG.md',
  ]
  return files.filter((f) => !SCAN_EXCLUDED.some((x) => f === x))
}

describe('[REQ-2026-125] sync 백필 안내 가드', () => {
  it('규칙: --apply 없는 백필 안내를 검출한다', () => {
    expect(syncGuidanceViolations(['npx commitgate sync --gitignore 로 백필'])).toEqual([1])
    expect(syncGuidanceViolations(['a', 'b `sync --gitignore`'])).toEqual([2])
  })

  it('규칙: 같은 줄에 --apply가 있으면 통과한다(순서·표기 무관)', () => {
    expect(syncGuidanceViolations(['npx commitgate sync --apply --gitignore'])).toEqual([])
    expect(syncGuidanceViolations(['`commitgate sync --gitignore [--apply]`는 누락 행만 추가'])).toEqual([])
    expect(syncGuidanceViolations(['sync --gitignore --apply'])).toEqual([])
  })

  it('규칙: 패턴이 없는 줄은 무관하다', () => {
    expect(syncGuidanceViolations(['sync --apply', 'commitgate sync', ''])).toEqual([])
  })

  it('실제 트리: 안내 표면에 위반 0건', () => {
    const violations: string[] = []
    for (const rel of scanTargets()) {
      const text = readFileSync(join(ROOT, rel), 'utf8')
      if (!text.includes(SYNC_GITIGNORE_PATTERN)) continue
      for (const line of syncGuidanceViolations(text.split(/\r?\n/)))
        violations.push(`${rel}:${line}`)
    }
    expect(violations, `--apply 없는 백필 안내(복사-실행하면 dry-run만 수행): ${violations.join(', ')}`).toEqual([])
  })
})
