import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { parseCatFileBatchOutput, readBlobsAtRef } from '../../scripts/req/lib/git-batch'

/** REQ-2026-127 phase-1 — cat-file --batch 프레이밍 파서 + 실 git 배치 읽기. */

function frame(oid: string, body: Buffer): Buffer {
  return Buffer.concat([Buffer.from(`${oid} blob ${body.length}\n`), body, Buffer.from('\n')])
}

describe('parseCatFileBatchOutput — Buffer 프레이밍(순수)', () => {
  const OID = 'a'.repeat(40)

  it('정상 프레임 + missing 행 혼합', () => {
    const b1 = Buffer.from('{"x":1}')
    const out = Buffer.concat([frame(OID, b1), Buffer.from('HEAD:nope.json missing\n')])
    const m = parseCatFileBatchOutput(out, ['HEAD:a.json', 'HEAD:nope.json'])
    expect(m.get('HEAD:a.json')?.toString('utf8')).toBe('{"x":1}')
    expect(m.get('HEAD:nope.json')).toBeNull()
  })

  it('멀티바이트(한글) 본문 — size는 바이트 기준이라 문자열 파싱이면 깨지는 케이스', () => {
    const body = Buffer.from('{"메시지":"한글 본문 확인"}', 'utf8')
    const m = parseCatFileBatchOutput(frame(OID, body), ['HEAD:k.json'])
    expect(m.get('HEAD:k.json')?.toString('utf8')).toBe('{"메시지":"한글 본문 확인"}')
  })

  it('출력 조기 종료·크기 부족 → null(단정 금지)', () => {
    const truncated = frame(OID, Buffer.from('abcdef')).subarray(0, 20)
    const m = parseCatFileBatchOutput(truncated, ['HEAD:a.json', 'HEAD:b.json'])
    expect(m.get('HEAD:a.json')).toBeNull()
    expect(m.get('HEAD:b.json')).toBeNull()
  })

  it('빈 요청 → 빈 결과', () => {
    expect(parseCatFileBatchOutput(Buffer.alloc(0), []).size).toBe(0)
  })
})

describe('readBlobsAtRef — 실 git 1프로세스 배치', () => {
  it('여러 경로(한글 포함)를 한 번에 읽고 missing은 null', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cg-batch-'))
    const g = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
    g('init', '-b', 'main')
    g('config', 'user.email', 't@t')
    g('config', 'user.name', 't')
    const korean = '{"리뷰":"한글 응답 아카이브"}'
    writeFileSync(join(dir, 'a.json'), '{"a":1}')
    writeFileSync(join(dir, 'k.json'), korean)
    g('add', '.')
    g('commit', '-m', 'x')

    const m = readBlobsAtRef(dir, 'HEAD', ['a.json', 'k.json', 'missing.json'])
    expect(m.get('a.json')?.toString('utf8')).toBe('{"a":1}')
    expect(m.get('k.json')?.toString('utf8')).toBe(korean)
    expect(m.get('missing.json')).toBeNull()
    // 심층 검증의 용법 그대로: blob 내용 SHA-256이 재현 가능해야 한다.
    const sha = createHash('sha256').update(m.get('k.json') as Buffer).digest('hex')
    expect(sha).toBe(createHash('sha256').update(Buffer.from(korean, 'utf8')).digest('hex'))
  })
})
