import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  awaitCiRun,
  createFakeCiRunPort,
  isGreenConclusion,
  type RunInfo,
} from '../../scripts/req/lib/github-ci-run'
import { loadConfig, GITHUB_CI_TIMEOUT_MINUTES_DEFAULT } from '../../scripts/req/lib/config'

/**
 * REQ-2026-126 phase-1 — CI 실행 포트.
 * 🔴 실제 gh·git·네트워크를 절대 호출하지 않는다 — fake 포트만 쓴다(완료 기준 7).
 */

const HEAD = 'a'.repeat(40)
const OTHER = 'b'.repeat(40)

/** 가상 시계: now는 sleep 누적으로 흐른다. */
function clock(startIso = '2026-08-10T00:00:00.000Z') {
  let t = Date.parse(startIso)
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms
    },
    advance: (ms: number) => {
      t += ms
    },
  }
}

const run = (over: Partial<RunInfo>): RunInfo => ({
  id: 1,
  status: 'completed',
  conclusion: 'success',
  created_at: '2026-08-10T00:00:01.000Z',
  head_sha: HEAD,
  ...over,
})

const baseOpts = (c: ReturnType<typeof clock>) => ({
  workflow: 'ci.yml',
  ref: 'feat/x',
  expectedHeadSha: HEAD,
  timeoutMinutes: 30,
  now: c.now,
  sleep: c.sleep,
  pollIntervalMs: 1000,
})

describe('awaitCiRun — HEAD 결속(설계 r01 P1)', () => {
  it('원격 브랜치 부재 → 실패 + 자동 push 없음 안내', async () => {
    const c = clock()
    const port = createFakeCiRunPort({ remoteSha: null, listBatches: [] })
    const r = await awaitCiRun(port, baseOpts(c))
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('자동 push 하지 않습니다')
    expect(port.calls.some((x) => x.method === 'dispatch')).toBe(false) // dispatch 자체를 안 한다
  })

  it('원격 SHA ≠ 로컬 HEAD → dispatch 없이 실패(미push 커밋 우회 방지)', async () => {
    const c = clock()
    const port = createFakeCiRunPort({ remoteSha: OTHER, listBatches: [] })
    const r = await awaitCiRun(port, baseOpts(c))
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('push')
    expect(port.calls.some((x) => x.method === 'dispatch')).toBe(false)
  })

  it('후보 필터에 head_sha 포함 — 다른 head_sha run은 무시된다', async () => {
    const c = clock()
    const port = createFakeCiRunPort({
      remoteSha: HEAD,
      listBatches: [[run({ id: 7, head_sha: OTHER }), run({ id: 9 })]],
      runStates: [run({ id: 9 })],
    })
    const r = await awaitCiRun(port, baseOpts(c))
    expect(r).toEqual({ ok: true, reason: null, runId: 9, conclusion: 'success' })
  })

  it('완료 판정 직전 head_sha 재확인 — 바뀌었으면 실패', async () => {
    const c = clock()
    const port = createFakeCiRunPort({
      remoteSha: HEAD,
      listBatches: [[run({ id: 9, status: 'queued', conclusion: null })]],
      runStates: [run({ id: 9, head_sha: OTHER })],
    })
    const r = await awaitCiRun(port, baseOpts(c))
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('head_sha')
    expect(r.runId).toBe(9)
  })
})

describe('awaitCiRun — T 기록 순서와 식별(설계 r03 P1)', () => {
  it('호출 순서: (T 기록) → dispatch → listRuns(T) — T는 dispatch 이전 시각이며 모든 조회에 동일', async () => {
    const c = clock()
    const port = createFakeCiRunPort({
      remoteSha: HEAD,
      listBatches: [[], [run({ id: 3, status: 'queued', conclusion: null })]],
      runStates: [run({ id: 3 })],
    })
    const T = new Date(c.now()).toISOString() // remoteBranchSha는 시간을 쓰지 않으므로 시작 시각 == T
    const r = await awaitCiRun(port, baseOpts(c))
    expect(r.ok).toBe(true)
    const seq = port.calls.map((x) => x.method)
    expect(seq.indexOf('dispatch')).toBeGreaterThan(seq.indexOf('remoteBranchSha'))
    expect(seq.indexOf('listRuns')).toBeGreaterThan(seq.indexOf('dispatch'))
    const listCalls = port.calls.filter((x) => x.method === 'listRuns')
    expect(listCalls).toHaveLength(2)
    for (const call of listCalls) expect(call.args[2]).toBe(T) // 동일한 T — 이후 시각으로 갱신하지 않는다
  })

  it('같은 조건 후보 2개 → 가장 이른 것을 고르지 않고 식별 불가 실패(오연결 금지)', async () => {
    const c = clock()
    const port = createFakeCiRunPort({
      remoteSha: HEAD,
      listBatches: [[run({ id: 1 }), run({ id: 2 })]],
    })
    const r = await awaitCiRun(port, baseOpts(c))
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('식별')
    expect(r.runId).toBeNull()
  })

  it('dispatch 실패(workflow_dispatch 미지원 등) → 명확한 실패', async () => {
    const c = clock()
    const port = createFakeCiRunPort({ remoteSha: HEAD, dispatchError: 'HTTP 422', listBatches: [] })
    const r = await awaitCiRun(port, baseOpts(c))
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('workflow_dispatch')
  })
})

describe('awaitCiRun — 단일 시계(설계 r02 P1)', () => {
  it('출현이 늦어도(90초 초과) 마감 안에 완료되면 성공 — 별도 출현 상한이 없다', async () => {
    const c = clock()
    // 200초(200회 폴링) 동안 미출현 → 그 뒤 출현·완료.
    const empty: RunInfo[][] = Array.from({ length: 200 }, () => [])
    const port = createFakeCiRunPort({
      remoteSha: HEAD,
      listBatches: [...empty, [run({ id: 5, status: 'queued', conclusion: null })]],
      runStates: [run({ id: 5 })],
    })
    const r = await awaitCiRun(port, baseOpts(c))
    expect(r).toEqual({ ok: true, reason: null, runId: 5, conclusion: 'success' })
  })

  it('run 미출현인 채 마감 → timeout 실패', async () => {
    const c = clock()
    const port = createFakeCiRunPort({ remoteSha: HEAD, listBatches: [[]] })
    const r = await awaitCiRun(port, { ...baseOpts(c), timeoutMinutes: 1 })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('timeout')
  })

  it('run 미완료인 채 마감 → timeout 실패(runId 보존)', async () => {
    const c = clock()
    const port = createFakeCiRunPort({
      remoteSha: HEAD,
      listBatches: [[run({ id: 8, status: 'in_progress', conclusion: null })]],
      runStates: [run({ id: 8, status: 'in_progress', conclusion: null })],
    })
    const r = await awaitCiRun(port, { ...baseOpts(c), timeoutMinutes: 1 })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('timeout')
    expect(r.runId).toBe(8)
  })

  it('red(failure) → 실패·conclusion 보존(감사 로그 계약)', async () => {
    const c = clock()
    const port = createFakeCiRunPort({
      remoteSha: HEAD,
      listBatches: [[run({ id: 4, status: 'queued', conclusion: null })]],
      runStates: [run({ id: 4, conclusion: 'failure' })],
    })
    const r = await awaitCiRun(port, baseOpts(c))
    expect(r).toEqual({ ok: false, reason: 'run #4 결과: failure', runId: 4, conclusion: 'failure' })
  })

  it('cancelled → 실패', async () => {
    const c = clock()
    const port = createFakeCiRunPort({
      remoteSha: HEAD,
      listBatches: [[run({ id: 4, status: 'queued', conclusion: null })]],
      runStates: [run({ id: 4, conclusion: 'cancelled' })],
    })
    const r = await awaitCiRun(port, baseOpts(c))
    expect(r.ok).toBe(false)
    expect(r.conclusion).toBe('cancelled')
  })
})

describe('isGreenConclusion — 조회 축과 같은 허용값', () => {
  it('success/neutral/skipped만 green', () => {
    expect(isGreenConclusion('success')).toBe(true)
    expect(isGreenConclusion('neutral')).toBe(true)
    expect(isGreenConclusion('skipped')).toBe(true)
    expect(isGreenConclusion('failure')).toBe(false)
    expect(isGreenConclusion(null)).toBe(false)
  })
})

describe('config githubCi 축(설계 DEC-4)', () => {
  function repoWith(config: unknown): string {
    const dir = mkdtempSync(join(tmpdir(), 'cg-cfg-'))
    writeFileSync(join(dir, 'req.config.json'), JSON.stringify(config))
    return dir
  }

  it('미지정 → null(미구성)', () => {
    expect(loadConfig({ root: repoWith({}) }).githubCi).toBeNull()
  })

  it('workflow만 지정 → timeoutMinutes 기본 30', () => {
    const cfg = loadConfig({ root: repoWith({ githubCi: { workflow: 'ci.yml' } }) })
    expect(cfg.githubCi).toEqual({ workflow: 'ci.yml', timeoutMinutes: GITHUB_CI_TIMEOUT_MINUTES_DEFAULT })
  })

  it('timeoutMinutes 지정 보존·범위 밖은 스키마 거부', () => {
    expect(loadConfig({ root: repoWith({ githubCi: { workflow: 'ci.yml', timeoutMinutes: 5 } }) }).githubCi).toEqual({
      workflow: 'ci.yml',
      timeoutMinutes: 5,
    })
    expect(() => loadConfig({ root: repoWith({ githubCi: { workflow: 'ci.yml', timeoutMinutes: 0 } }) })).toThrow('스키마')
    expect(() => loadConfig({ root: repoWith({ githubCi: { workflow: 'ci.yml', timeoutMinutes: 999 } }) })).toThrow('스키마')
  })

  it('workflow 부재·경로 문자·미지 키는 스키마 거부(fail-closed)', () => {
    expect(() => loadConfig({ root: repoWith({ githubCi: {} }) })).toThrow('스키마')
    expect(() => loadConfig({ root: repoWith({ githubCi: { workflow: '../evil.yml' } }) })).toThrow('스키마')
    expect(() => loadConfig({ root: repoWith({ githubCi: { workflow: 'a/b.yml' } }) })).toThrow('스키마')
    expect(() => loadConfig({ root: repoWith({ githubCi: { workflow: 'ci.yml', nope: 1 } }) })).toThrow('스키마')
  })
})
