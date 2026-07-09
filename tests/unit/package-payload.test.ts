import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * publish payload 위생 **보조 가드** (REQ-2026-009).
 *
 * ⚠️ 이 테스트는 exit 판정의 정본이 아니다. 정본은 `npm pack --dry-run --json`이 반환하는
 *    실제 payload 파일 목록을 스캔하는 것이고, 그건 phase exit 증거로 별도 실행한다.
 *    여기서는 npm을 실행하지 않고 `package.json`의 `files` 집합을 온디스크로 해소해
 *    **전 플랫폼 CI에서 빠르고 결정적으로 회귀를 잡는다**(npm 캐시·네트워크 무의존).
 *
 * 목적: 공개 npm 패키지 소스에 무관한 사설 프로젝트의 이름·경로가 실리지 않게 한다.
 */
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** payload에 있어선 안 되는 문자열(대소문자 무시). REQ-2026-009 PM 지시 최소 집합. */
const FORBIDDEN = ['palm-kiosk', 'palm-kiosk-app', '../palm-kiosk', 'project-memory/ai-handoff.md'] as const

/** npm이 `files`와 무관하게 항상 포함하는 파일(대략) — 스캔 대상에 함께 넣는다. */
const ALWAYS_INCLUDED = ['package.json', 'README.md', 'README.en.md', 'LICENSE']

/**
 * 텍스트 여부는 **확장자가 아니라 내용**으로 판정한다(phase R1 P3).
 * 확장자 화이트리스트는 `req.config.json.sample`(.sample)·`LICENSE`(확장자 없음)처럼
 * payload에 실리는 텍스트 파일을 조용히 건너뛰어 가드에 구멍을 낸다.
 * NUL 바이트가 있으면 바이너리로 보고 스캔에서 제외한다.
 */
function readTextOrNull(abs: string): string | null {
  const buf = readFileSync(abs)
  if (buf.includes(0)) return null // 바이너리
  return buf.toString('utf8')
}

function walkFiles(abs: string): string[] {
  if (!existsSync(abs)) return []
  if (!statSync(abs).isDirectory()) return [abs]
  const out: string[] = []
  for (const entry of readdirSync(abs)) out.push(...walkFiles(join(abs, entry)))
  return out
}

/** package.json의 `files` + 항상 포함되는 파일 → 절대경로 목록. */
function payloadFiles(): string[] {
  const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')) as { files?: string[] }
  const entries = [...(pkg.files ?? []), ...ALWAYS_INCLUDED]
  const seen = new Set<string>()
  for (const e of entries) for (const f of walkFiles(join(PACKAGE_ROOT, e))) seen.add(f)
  return [...seen].sort()
}

describe('[payload] 공개 패키지에 사설 프로젝트 참조가 없다', () => {
  const files = payloadFiles()

  it('payload 파일 목록이 비어 있지 않다(스캔이 공회전하지 않음을 보장)', () => {
    // 가드가 빈 집합을 훑고 통과해버리는 위양성 방지.
    expect(files.length).toBeGreaterThan(10)
    expect(files.some((f) => f.endsWith('config.ts'))).toBe(true)
    expect(files.some((f) => f.endsWith('review-codex.ts'))).toBe(true)
    // phase R1 P3: 확장자 없는/비표준 확장자 텍스트 파일도 스캔 대상에 들어와야 한다.
    expect(files.some((f) => f.endsWith('LICENSE'))).toBe(true)
    expect(files.some((f) => f.endsWith('req.config.json.sample'))).toBe(true)
  })

  /**
   * REQ-2026-010 phase-1a — tarball 축(`files[]`) 가드.
   * 설치 축(`KIT_COPY_RELPATHS`)은 `init.test.ts`가 따로 지킨다. **두 축은 다르다**:
   * 하나만 갱신하면 tarball엔 있는데 대상 repo엔 안 깔리거나(또는 그 반대) 한다.
   */
  it('persona 파일이 tarball payload에 실린다', () => {
    const rels = files.map((f) => relative(PACKAGE_ROOT, f).replace(/\\/g, '/'))
    expect(rels).toContain('workflow/review-persona.md')
  })

  it('열거된 payload 파일 중 텍스트는 전부 스캔된다(건너뛴 텍스트 0개)', () => {
    const skipped = files.filter((f) => readTextOrNull(f) === null)
    // 현재 payload는 전부 텍스트다. 바이너리가 생기면 여기서 드러난다.
    expect(skipped.map((f) => relative(PACKAGE_ROOT, f).replace(/\\/g, '/'))).toEqual([])
  })

  it.each(FORBIDDEN)('금지 문자열 "%s" 이 payload에 0건', (needle) => {
    const hits: string[] = []
    for (const abs of files) {
      const text = readTextOrNull(abs)
      if (text === null) continue // 바이너리
      text.split('\n').forEach((line, i) => {
        if (line.toLowerCase().includes(needle.toLowerCase()))
          hits.push(`${relative(PACKAGE_ROOT, abs).replace(/\\/g, '/')}:${i + 1}: ${line.trim()}`)
      })
    }
    expect(hits).toEqual([])
  })

  it('스캔이 실제로 파일을 읽는다(대조군 — 위양성 통과 방지)', () => {
    let control = 0
    for (const abs of files) {
      const text = readTextOrNull(abs)
      if (text !== null && text.toLowerCase().includes('handoffpath')) control++
    }
    expect(control).toBeGreaterThan(0)
  })

  it('DEFAULTS.handoffPath 기본값이 payload 소스에서 null이다', () => {
    const src = readFileSync(join(PACKAGE_ROOT, 'scripts', 'req', 'lib', 'config.ts'), 'utf8')
    expect(src).toMatch(/handoffPath:\s*null as string \| null/)
  })
})
