import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * REQ-2026-042 phase-2 — 랜딩 README 링크·안전문구 가드 (설계 D5-b·D5-c).
 *
 * ⚠️ 상대 링크·앵커의 **정본 검사는 remark-validate-links**다(`npm run docs:lint`). 여기서는 그 도구가
 *    external로 보고 검사하지 **않는** 두 축만 좁게 고정한다:
 *    (b) README→docs **절대 blob URL** 형식·대상 존재, (c) 안전 4문구 **존재+위치**.
 *    REQ-041이 미수렴한 손수 slug/anchor oracle은 재도입하지 않는다(경계가 좁아 nitpick 없음).
 */
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (rel: string): string => readFileSync(join(PACKAGE_ROOT, rel), 'utf8').replace(/\r\n/g, '\n')

/** docs/는 npm tarball에 없어 README는 docs를 이 **절대** prefix로만 링크해야 npm 페이지에서도 해소된다. */
const BLOB_PREFIX = 'https://github.com/sol5288/commitgate/blob/main/docs/'

describe('[REQ-2026-042] 랜딩 README — docs 절대 URL (D5-b)', () => {
  // phase-3에서 'README.en.md' 추가.
  const LANDINGS = ['README.md'] as const

  it.each(LANDINGS)('%s: docs 링크가 정확한 GitHub blob URL이고 대상 파일이 실재한다', (rel) => {
    const md = read(rel)
    const names = [...md.matchAll(/https:\/\/github\.com\/sol5288\/commitgate\/blob\/main\/docs\/([a-z0-9-]+)\.md/g)].map(
      (m) => m[1] as string,
    )
    expect(names.length, `${rel}: docs 허브 링크가 있어야 한다`).toBeGreaterThan(0)
    for (const name of names) {
      expect(existsSync(join(PACKAGE_ROOT, 'docs', `${name}.md`)), `${rel}: docs/${name}.md 가 존재해야 한다`).toBe(true)
    }
  })

  it.each(LANDINGS)('%s: 비정규 owner/repo/branch docs URL·docs로 가는 상대 링크가 없다', (rel) => {
    const md = read(rel)
    // github.com … /docs/….md 형태는 **전부** canonical prefix로 시작해야 한다(fork·다른 branch 금지).
    const ghDocs = [...md.matchAll(/https?:\/\/github\.com\/[^\s)]*\/docs\/[^\s)]*\.md/g)].map((m) => m[0])
    const bad = ghDocs.filter((u) => !u.startsWith(BLOB_PREFIX))
    expect(bad, `${rel}: 비정규 owner/repo/branch docs URL`).toEqual([])
    // docs/*.md 로 가는 **상대** 링크는 npm README 페이지에서 깨진다(docs/는 tarball 미포함) → 금지.
    const relDocs = [...md.matchAll(/\]\(([^)]+)\)/g)]
      .map((m) => m[1] as string)
      .filter((t) => !/^https?:/.test(t) && /(^|\/)docs\/[^)]*\.md/.test(t))
    expect(relDocs, `${rel}: docs로 가는 상대 링크는 절대 blob URL이어야 한다`).toEqual([])
  })
})

/** 각 needle은 README.md에 **바이트 그대로** 있어야 한다 — 이 테스트가 안전문구의 정본이다. */
const HEADING = '## 3분 시작'
const SAFETY_KO = [
  { id: '① 리뷰 없인 커밋 불가', needle: 'Codex 리뷰 승인 없이는 커밋되지 않습니다' },
  { id: '② staged diff 외부 전송', needle: 'staged diff 전문을 외부(Codex·OpenAI)로 전송합니다' },
  { id: '③ git hook 없음(우회 가능)', needle: 'git hook을 설치하지 않습니다' },
  { id: '④ 애매하면 fail-closed', needle: '애매하면 막습니다(fail-closed)' },
] as const

describe('[REQ-2026-042] 랜딩 README — 안전 4문구 존재+위치 (D5-c)', () => {
  // phase-3에서 README.en.md(영문 4문구) 추가.
  it('README.md(한): 4문구가 모두 있고 각 첫 등장이 "3분 시작"보다 앞이다', () => {
    const lines = read('README.md').split('\n')
    const headingLine = lines.findIndex((l) => l.trim() === HEADING)
    expect(headingLine, `"${HEADING}" 헤딩이 있어야 한다`).toBeGreaterThanOrEqual(0)
    for (const { id, needle } of SAFETY_KO) {
      const first = lines.findIndex((l) => l.includes(needle))
      expect(first, `${id}: "${needle}" 문구가 있어야 한다`).toBeGreaterThanOrEqual(0)
      expect(first, `${id}: 안전문구는 "3분 시작" 헤딩보다 앞이어야 한다`).toBeLessThan(headingLine)
    }
  })
})
