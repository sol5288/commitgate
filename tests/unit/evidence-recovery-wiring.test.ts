/**
 * REQ-2026-142 phase-3 — D10 배선·멱등 실행.
 *
 * 🔴 이 스위트의 존재 이유: **배선 끊김은 순수 테스트가 못 잡는다**(이 저장소가 REQ-083·097·099 에서
 *    세 번 실증했고, 이 REQ 구현 중에도 `recoveryAllowlist` 를 계산해 놓고 `DoctorInputs` 에 안 넣은
 *    상태가 tsc 를 통과했다 — optional 필드라서). 그래서 ① 실제 D10 술어를 구동하고 ② 소스에서 배선을
 *    구조적으로 고정한다.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { findUnstagedOrUntracked } from '../../scripts/req/review-codex'
import { parseStatusZ } from '../../scripts/req/lib/porcelain'
import { executeEvidenceRecovery, type RecoveryPlan } from '../../scripts/req/lib/evidence-recovery'

const T = 'workflow/REQ-2026-142'
const ARCHIVE = `${T}/responses/phase-phase-1-x-r02-approved.json`
const MANIFEST = `${T}/responses/approvals.jsonl`
const STATE = `${T}/state.json`

/** `git status -z` 형식 그대로 만든다(NUL 구분) — 파서를 우회하지 않는다. */
const status = (...pairs: [string, string][]): ReturnType<typeof parseStatusZ> =>
  parseStatusZ(pairs.map(([xy, p]) => `${xy} ${p}`).join('\0') + '\0')

describe('D10 — 복구 allowlist 가 없을 때(정상 경로)', () => {
  it('🔴 인자를 주지 않으면 판정이 이 REQ 이전과 동일하다 — 매니페스트 수정은 여전히 차단', () => {
    const e = status([' M', MANIFEST])
    expect(findUnstagedOrUntracked(e, [], T)).toHaveLength(1)
    expect(findUnstagedOrUntracked(e, [], T, undefined)).toHaveLength(1)
    expect(findUnstagedOrUntracked(e, [], T, [])).toHaveLength(1)
  })

  it('🔴 staged 매니페스트도 차단(인덱스 여부와 무관 — 실측된 교착의 정확한 모양)', () => {
    expect(findUnstagedOrUntracked(status(['M ', MANIFEST]), [], T)).toHaveLength(1)
  })

  it('🔴 tracked 아카이브 수정도 차단', () => {
    expect(findUnstagedOrUntracked(status([' M', ARCHIVE]), [], T)).toHaveLength(1)
  })

  it('소스 파일 dirty 도 차단', () => {
    expect(findUnstagedOrUntracked(status([' M', 'scripts/req/req-commit.ts']), [], T)).toHaveLength(1)
  })
})

describe('D10 — 복구 allowlist 가 있을 때', () => {
  const allow = [ARCHIVE, MANIFEST, `${T}/responses/review-ledger.jsonl`, STATE]

  it('🔴 목록 안의 증거 파일은 통과한다(교착 해소)', () => {
    const e = status([' M', MANIFEST], [' M', ARCHIVE], [' M', STATE])
    expect(findUnstagedOrUntracked(e, [], T, allow)).toHaveLength(0)
  })

  it('staged 든 unstaged 든 untracked 든 통과한다', () => {
    for (const xy of ['M ', ' M', '??'] as const)
      expect(findUnstagedOrUntracked(status([xy, MANIFEST]), [], T, allow)).toHaveLength(0)
  })

  it('🔴 목록 밖은 하나도 통과하지 못한다 — 소스 파일', () => {
    const e = status([' M', MANIFEST], [' M', 'scripts/req/req-commit.ts'])
    const dirty = findUnstagedOrUntracked(e, [], T, allow)
    expect(dirty.map((d) => d.path)).toEqual(['scripts/req/req-commit.ts'])
  })

  it('🔴 목록 밖은 하나도 통과하지 못한다 — 같은 티켓의 무관 아카이브(주입 구멍)', () => {
    const alien = `${T}/responses/phase-phase-1-x-r99-approved.json`
    expect(findUnstagedOrUntracked(status([' M', alien]), [], T, allow)).toHaveLength(1)
  })

  it('🔴 다른 티켓의 같은 이름 파일은 통과하지 못한다(정확 경로 매칭)', () => {
    const other = 'workflow/REQ-2026-999/responses/approvals.jsonl'
    expect(findUnstagedOrUntracked(status([' M', other]), [], T, allow)).toHaveLength(1)
  })

  it('🔴 rename 은 src·dest 둘 다 목록에 있어야 통과한다', () => {
    const outside = parseStatusZ(`R  ${MANIFEST}\0scripts/req/x.ts\0`)
    expect(findUnstagedOrUntracked(outside, [], T, allow).length).toBeGreaterThan(0)
  })
})

describe('executeEvidenceRecovery — 어느 것을 부를지만 정한다', () => {
  const ready = (resumeFrom: 'evidence' | 'consume' | 'checkpoint'): Extract<RecoveryPlan, { kind: 'ready' }> => ({
    kind: 'ready',
    resumeFrom,
    allowlist: [STATE],
    detail: '',
  })

  it('evidence·consume → finalize 를 부른다(같은 멱등 함수로 수렴)', () => {
    for (const stage of ['evidence', 'consume'] as const) {
      let called = 0
      const r = executeEvidenceRecovery(ready(stage), {
        finalizeEvidenceAndConsume: () => void called++,
        commitStateCheckpoint: () => {
          throw new Error('불려선 안 된다')
        },
      })
      expect(called).toBe(1)
      expect(r.resumeFrom).toBe(stage)
    }
  })

  it('checkpoint → checkpoint 만 부른다', () => {
    let called = 0
    const r = executeEvidenceRecovery(ready('checkpoint'), {
      finalizeEvidenceAndConsume: () => {
        throw new Error('불려선 안 된다')
      },
      commitStateCheckpoint: () => {
        called++
        return true
      },
    })
    expect(called).toBe(1)
    expect(r.checkpointCommitted).toBe(true)
  })

  it('🔴 checkpoint 재실행이 커밋할 게 없으면 no-op 성공(멱등)', () => {
    const r = executeEvidenceRecovery(ready('checkpoint'), {
      finalizeEvidenceAndConsume: () => {
        throw new Error('불려선 안 된다')
      },
      commitStateCheckpoint: () => false,
    })
    expect(r.checkpointCommitted).toBe(false)
  })
})

describe('🔴 배선 가드', () => {
  const doctor = readFileSync(join(process.cwd(), 'scripts/req/req-doctor.ts'), 'utf8')
  const commit = readFileSync(join(process.cwd(), 'scripts/req/req-commit.ts'), 'utf8')

  it('D10 이 recoveryAllowlist 를 실제로 받는다', () => {
    expect(doctor).toMatch(/findUnstagedOrUntracked\(inp\.statusEntries, inp\.scratch, inp\.ticketRel, inp\.recoveryAllowlist\)/)
  })

  it('🔴 계산한 목록이 DoctorInputs 로 전달된다(계산만 하고 안 넣는 끊김 방지)', () => {
    // tsc 는 optional 필드라 이 누락을 잡지 못한다 — 구현 중 실제로 이 상태였다.
    const i = doctor.indexOf('const inp: DoctorInputs = {')
    const j = doctor.indexOf('\n  }', i)
    expect(doctor.slice(i, j)).toMatch(/\brecoveryAllowlist,/)
  })

  it('🔴 allowlist 는 plan 이 ready 일 때만 채워진다 — 플래그만으로 열리지 않는다', () => {
    expect(doctor).toMatch(/if \(plan\.kind === 'ready'\) \{\s*\n\s*recoveryAllowlist = plan\.allowlist/)
  })

  it('🔴 plan 계산 자체가 finalize 게이트 안에 있다', () => {
    const i = doctor.indexOf('let recoveryAllowlist')
    const j = doctor.indexOf('planEvidenceRecovery(')
    expect(i).toBeGreaterThan(0)
    expect(doctor.slice(i, j)).toMatch(/if \(finalize\) \{/)
  })

  it('🔴 두 호출부가 같은 조립 함수를 쓴다(사실이 갈라지지 않는다)', () => {
    expect(doctor).toMatch(/buildRecoveryFacts\(/)
    expect(commit).toMatch(/buildRecoveryFacts\(/)
  })

  it('🔴 모듈 호출부는 req-doctor·req-commit 둘뿐이다(예외가 넓어지지 않는다)', () => {
    const files = ['req-next.ts', 'req-new.ts', 'review-codex.ts', 'req-close.ts', 'req-delegate.ts']
    for (const f of files) {
      const src = readFileSync(join(process.cwd(), 'scripts/req', f), 'utf8')
      expect(src.includes('evidence-recovery')).toBe(false)
    }
  })

  it('checkpoint 재개는 evidence finalize 를 부르지 않는다(어댑터가 던진다)', () => {
    expect(commit).toMatch(/checkpoint 재개에서 evidence finalize 가 호출됐다/)
  })
})
