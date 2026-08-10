import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCodexReviewerAdapter, assertNotTestEnv } from '../../scripts/req/lib/adapters'
import { createGhCiAdapter } from '../../bin/verify-range'
import { createGhCiRunAdapter } from '../../scripts/req/lib/github-ci-run'

/**
 * REQ-2026-130(0.22 REQ F) — 외부 호출 kill switch.
 *
 * 테스트 환경(COMMITGATE_TEST=1 — setup이 설정·자식 프로세스에 env 상속)에서 production 어댑터의
 * **기본(실제) spawn 경로**는 호출 즉시 실패한다. fake spawn 주입은 테스트 seam이라 막지 않는다.
 * 이 파일은 그 가드가 실재함을 고정한다 — 가드를 지우면 여기가 먼저 깨진다(변이 검사의 상시화).
 */

describe('COMMITGATE_TEST kill switch', () => {
  it('setup이 테스트 환경을 표시한다(자식 프로세스로 env 상속되는 값)', () => {
    expect(process.env.COMMITGATE_TEST).toBe('1')
  })

  it('assertNotTestEnv — 테스트 환경에서 throw', () => {
    expect(() => assertNotTestEnv('codex')).toThrow('COMMITGATE_TEST')
  })

  it('실제 codex 어댑터의 review()는 spawn 이전에 실패한다(실호출 0)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cg-ks-'))
    // 실제 배포 스키마를 쓴다 — strict 파생(스키마 전처리)까지 통과한 뒤 spawn 직전에 가드가 서는지 본다.
    const schemaPath = join(__dirname, '..', '..', 'workflow', 'machine.schema.json')
    const adapter = createCodexReviewerAdapter()
    expect(() => adapter.review({ prompt: 'x', model: null, reasoningEffort: null, schemaPath, cwd: dir })).toThrow(
      'COMMITGATE_TEST',
    )
  })

  it('실제 gh 조회 어댑터(check)는 spawn 이전에 실패한다', () => {
    expect(() => createGhCiAdapter('.').check('a'.repeat(40))).toThrow('COMMITGATE_TEST')
  })

  it('실제 gh 실행 어댑터는 dispatch/listRuns/getRun/remoteBranchSha 전부 즉시 실패한다', async () => {
    const port = createGhCiRunAdapter('.')
    await expect(port.dispatch('ci.yml', 'main')).rejects.toThrow('COMMITGATE_TEST')
    await expect(port.listRuns('ci.yml', 'main', 't')).rejects.toThrow('COMMITGATE_TEST')
    await expect(port.getRun(1)).rejects.toThrow('COMMITGATE_TEST')
    await expect(port.remoteBranchSha('main')).rejects.toThrow('COMMITGATE_TEST')
  })

  it('네트워크(fetch)는 테스트에서 즉시 실패한다', () => {
    expect(() => globalThis.fetch('https://example.com')).toThrow('네트워크 호출')
  })
})
