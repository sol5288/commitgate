import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VERB_MODULES } from '../../bin/dispatch.mjs'
import { STAGE_B_REQ_VERBS, STAGE_B_REQ_SCRIPTS } from '../../bin/init'
import {
  expectedReqScripts,
  missingReqScripts,
  readPackageScripts,
  commandSurfaceGuidance,
  commandSurfaceMessage,
} from '../../scripts/req/lib/command-surface'

/**
 * REQ-2026-161 phase-1 — 설치본 `req:*` **명령 표면** 판정.
 *
 * 🔴 **기대 목록을 이 파일에 복제하지 않는다.** expected 를 SUT 와 같은 방식으로 구성하면 tautology 가
 *    된다(REQ-2026-031 교훈). 그래서 기대값은 `VERB_MODULES`(SSOT)에서 오고, 검사는 "`init` 의
 *    `STAGE_B_REQ_VERBS` 와 **같은 집합**인가"로 한다 — 두 파생이 갈라지면 red 다.
 */

const tmps: string[] = []
afterEach(() => {
  while (tmps.length) rmSync(tmps.pop() as string, { recursive: true, force: true })
})

function tmpRepo(pkg?: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'cg-cmdsurface-'))
  tmps.push(dir)
  mkdirSync(dir, { recursive: true })
  if (pkg !== undefined) writeFileSync(join(dir, 'package.json'), typeof pkg === 'string' ? pkg : JSON.stringify(pkg), 'utf8')
  return dir
}

describe('[command-surface] expectedReqScripts — SSOT 파생(하드코딩 목록 없음)', () => {
  it('키 집합이 init 의 STAGE_B_REQ_VERBS 와 정확히 같다', () => {
    expect(Object.keys(expectedReqScripts())).toEqual([...STAGE_B_REQ_VERBS].sort())
  })

  it('값이 init 의 STAGE_B_REQ_SCRIPTS 와 정확히 같다(주입값이 갈라지면 백필이 엉뚱한 값을 넣는다)', () => {
    expect(expectedReqScripts()).toEqual(STAGE_B_REQ_SCRIPTS)
  })

  it('dispatch 의 req:* verb 를 하나도 빠뜨리지 않는다', () => {
    const fromDispatch = Object.keys(VERB_MODULES).filter((v) => v.startsWith('req:')).sort()
    expect(Object.keys(expectedReqScripts())).toEqual(fromDispatch)
    // 🔴 표면이 비어 있으면 아래 모든 단언이 공허해진다(vacuous oracle 방지).
    expect(fromDispatch.length).toBeGreaterThan(5)
  })

  it('req: 접두가 아닌 verb(uninstall·migrate·sync…)는 포함하지 않는다', () => {
    expect(Object.keys(expectedReqScripts()).every((k) => k.startsWith('req:'))).toBe(true)
    expect(Object.keys(VERB_MODULES).some((v) => !v.startsWith('req:'))).toBe(true) // 제외 대상이 실제로 존재
  })
})

describe('[command-surface] missingReqScripts — 부재만 본다', () => {
  it('전부 있으면 빈 배열', () => {
    expect(missingReqScripts(expectedReqScripts())).toEqual([])
  })

  it('없는 키만, 정렬해서 낸다', () => {
    const full = expectedReqScripts()
    const partial = { ...full }
    delete partial['req:delegate']
    delete partial['req:repolicy']
    expect(missingReqScripts(partial)).toEqual(['req:delegate', 'req:repolicy'])
  })

  it('🔴 값이 사용자 정의여도 부재가 아니다 — 값은 판정 대상이 아니다', () => {
    const custom = Object.fromEntries(Object.keys(expectedReqScripts()).map((k) => [k, 'my-wrapper --x']))
    expect(missingReqScripts(custom)).toEqual([])
  })

  it('🔴 Stage A 형태(tsx scripts/req/*.ts)도 부재가 아니다 — 모드 판정은 D19 의 몫이다', () => {
    const stageA = Object.fromEntries(Object.keys(expectedReqScripts()).map((k) => [k, `tsx scripts/req/${k.slice(4)}.ts`]))
    expect(missingReqScripts(stageA)).toEqual([])
  })

  it('🔴 판정 불가(null·undefined·비객체·배열)는 "부족"이 아니라 빈 배열', () => {
    for (const bad of [null, undefined, 'x', 42, [], ['req:new']]) expect(missingReqScripts(bad)).toEqual([])
  })

  it('scripts 가 비어 있으면 전부 부재로 센다', () => {
    expect(missingReqScripts({})).toEqual(Object.keys(expectedReqScripts()))
  })

  it('무관한 스크립트만 있어도 전부 부재다(다른 키가 부재를 가리지 않는다)', () => {
    expect(missingReqScripts({ build: 'vite build', test: 'vitest' })).toEqual(Object.keys(expectedReqScripts()))
  })
})

describe('[command-surface] readPackageScripts — 입력 획득도 한 곳에서', () => {
  it('scripts 맵을 읽는다(문자열 값만)', () => {
    const dir = tmpRepo({ scripts: { 'req:new': 'commitgate req:new', bad: 1, build: 'vite build' } })
    expect(readPackageScripts(dir)).toEqual({ 'req:new': 'commitgate req:new', build: 'vite build' })
  })

  it('package.json 이 없으면 null(= 판정 불가)', () => {
    expect(readPackageScripts(tmpRepo())).toBeNull()
  })

  it('파싱 실패면 null — throw 하지 않는다(진단이 도구를 깨뜨리면 안 된다)', () => {
    expect(readPackageScripts(tmpRepo('{ not json'))).toBeNull()
  })

  it('scripts 필드가 없거나 비객체면 null', () => {
    expect(readPackageScripts(tmpRepo({ name: 'x' }))).toBeNull()
    expect(readPackageScripts(tmpRepo({ scripts: [] }))).toBeNull()
    expect(readPackageScripts(tmpRepo({ scripts: 'nope' }))).toBeNull()
  })

  it('BOM 이 붙어 있어도 읽는다', () => {
    const dir = tmpRepo('﻿' + JSON.stringify({ scripts: { 'req:new': 'commitgate req:new' } }))
    expect(readPackageScripts(dir)).toEqual({ 'req:new': 'commitgate req:new' })
  })

  it('🔴 읽은 값이 그대로 술어의 입력이 된다 — 두 소비자가 같은 것을 본다', () => {
    const dir = tmpRepo({ scripts: expectedReqScripts() })
    expect(missingReqScripts(readPackageScripts(dir))).toEqual([])
  })
})

describe('[command-surface] 안내 문장 — 세 소비자가 같은 문자열을 쓴다(DEC-4)', () => {
  it('누락 verb 이름과 해소 명령을 모두 담는다', () => {
    const g = commandSurfaceGuidance(['req:delegate', 'req:repolicy'])
    expect(g).toContain('req:delegate')
    expect(g).toContain('req:repolicy')
    expect(g).toContain('npx commitgate sync --apply --scripts')
    expect(g).toContain('2개')
  })

  it('🔴 안내가 "기존 값을 덮지 않는다"를 말한다 — 사용자가 실행 전에 알아야 하는 사실이다', () => {
    expect(commandSurfaceGuidance(['req:delegate'])).toContain('덮지 않습니다')
  })

  it('commandSurfaceMessage: 부족 있으면 안내와 동일, 없으면 일치 사실을 말한다', () => {
    expect(commandSurfaceMessage(['req:delegate'])).toBe(commandSurfaceGuidance(['req:delegate']))
    const ok = commandSurfaceMessage([])
    expect(ok).toContain('일치')
    expect(ok).toContain(String(Object.keys(expectedReqScripts()).length))
    expect(ok).not.toContain('sync --apply --scripts')
  })
})
