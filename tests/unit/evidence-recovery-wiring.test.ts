/**
 * REQ-2026-142 phase-3 — D10 배선·멱등 실행.
 *
 * 🔴 이 스위트의 존재 이유: **배선 끊김은 순수 테스트가 못 잡는다**(이 저장소가 REQ-083·097·099 에서
 *    세 번 실증했고, 이 REQ 구현 중에도 `recoveryAllowlist` 를 계산해 놓고 `DoctorInputs` 에 안 넣은
 *    상태가 tsc 를 통과했다 — optional 필드라서). 그래서 ① 실제 D10 술어를 구동하고 ② 소스에서 배선을
 *    구조적으로 고정한다.
 */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { buildPinnedInventory } from '../../scripts/req/lib/evidence'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { packageRoot } from '../../scripts/req/lib/config'
import { buildRecoveryFacts, planEvidenceRecovery } from '../../scripts/req/lib/evidence-recovery'
import { findUnstagedOrUntracked } from '../../scripts/req/review-codex'
import { parseStatusZ, STATUS_Z_ARGS } from '../../scripts/req/lib/porcelain'
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

describe('[REQ-2026-150] 🔴 배선 가드 — 두 호출부가 HEAD^ 를 함께 읽는다', () => {
  const read = (p: string): string => readFileSync(join(process.cwd(), p), 'utf8')

  it('doctor·commit 둘 다 parentText 를 주입한다', () => {
    // 한쪽만 주면 doctor 통과·commit 거부 교착이 생긴다(REQ-2026-142 와 같은 이유).
    for (const f of ['scripts/req/req-doctor.ts', 'scripts/req/req-commit.ts'])
      expect(read(f), f).toMatch(/parentText:\s*\(rel\)\s*=>/)
  })

  it('🔴 판정 입력에 워킹 state 내용이 들어가지 않는다', () => {
    const src = read('scripts/req/lib/evidence-recovery.ts')
    // 워킹 state 는 `dirtyPaths`(범위)로만 들어온다 — 내용을 읽는 필드가 없어야 한다.
    expect(src).toContain('headStateText')
    expect(src).not.toMatch(/workingStateText|workingState:/)
  })

  it('🔴 동일성 키 계산에 시각이 없다', () => {
    const src = read('scripts/req/lib/evidence-recovery.ts')
    const i = src.indexOf('function consumedKey(')
    const j = src.indexOf('\n}', i)
    expect(src.slice(i, j)).not.toContain('approval_consumed_at')
  })
})

/**
 * 🔴 REQ-2026-150 phase-1 r01 P1: 순수 판정과 소스 가드만으로는 **배선 전체가 도는지** 못 본다.
 *    실제 crash window 를 git 으로 만들고 `req:commit --finalize --run` 한 번으로 수렴하는지 본다.
 */
describe('[REQ-2026-150] 🔴 실 git e2e — crash window 가 한 번에 수렴한다', () => {
  const gitOf = (repo: string) => (args: string[]): string =>
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: repo, encoding: 'utf8' })

  /** 실제 저장소에서 사실을 조립해 판정한다(HEAD·HEAD^ 를 진짜로 읽는다). */
  const runRecovery = (repo: string, ticketRel: string) => {
    const git = gitOf(repo)
    const show = (rev: string, rel: string): string | null => {
      try {
        return execFileSync('git', ['show', `${rev}:${rel}`], { cwd: repo, encoding: 'utf8' })
      } catch {
        return null
      }
    }
    return planEvidenceRecovery(
      buildRecoveryFacts({
        ticketRel,
        state: JSON.parse(readFileSync(join(repo, ticketRel, 'state.json'), 'utf8')) as Record<string, unknown>,
        headText: (rel) => show('HEAD', rel),
        parentText: (rel) => show('HEAD^', rel),
        dirtyPaths: () =>
          git(['status', '--porcelain'])
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter(Boolean)
            .map((l) => l.slice(2).trim()),
        revParse: (rev) => {
          try {
            return git(['rev-parse', rev]).trim()
          } catch {
            return null
          }
        },
        fileSha: () => null,
        hashUtf8: (v) => v,
      }),
    )
  }

  /** evidence-finalize 는 커밋됐고 소비 state 만 미커밋인 상태를 만든다. */
  const crashWindow = (): { repo: string; ticket: string } => {
    const repo = mkdtempSync(join(tmpdir(), 'req150-'))
    const git = gitOf(repo)
    git(['init', '-q'])
    git(['config', 'user.email', 't@t.t'])
    git(['config', 'user.name', 't'])
    writeFileSync(join(repo, 'package.json'), '{"name":"x","version":"0.0.0"}')
    mkdirSync(join(repo, 'workflow'), { recursive: true })
    writeFileSync(
      join(repo, 'workflow', 'machine.schema.json'),
      readFileSync(join(packageRoot(), 'workflow', 'machine.schema.json'), 'utf8'),
    )
    writeFileSync(join(repo, 'req.config.json'), JSON.stringify({ packageManager: 'npm', reviewPersonaPath: null }))
    const ticket = join(repo, 'workflow', 'REQ-2026-001')
    mkdirSync(join(ticket, 'responses'), { recursive: true })
    // ① 소비 **전** state 를 커밋(직전 checkpoint)
    const before = { id: 'REQ-2026-001', branch: 'feat/req-2026-001-x', phases: [], consumed_approvals: [] }
    writeFileSync(join(ticket, 'state.json'), JSON.stringify(before, null, 2) + '\n')
    git(['add', '-A'])
    git(['commit', '-qm', 'baseline'])
    const sourceSha = git(['rev-parse', 'HEAD']).trim()
    // ② evidence-finalize 커밋 — approvals.jsonl 에 소비 행 추가(state.json 은 커밋 안 함)
    writeFileSync(
      join(ticket, 'responses', 'approvals.jsonl'),
      JSON.stringify({
        kind: 'phase',
        phase_id: 'phase-1-x',
        response_path: 'workflow/REQ-2026-001/responses/phase-phase-1-x-r01-approved.json',
        response_sha256: 'a'.repeat(64),
        review_base_sha: 'b'.repeat(40),
        approved_tree: 'c'.repeat(40),
        approved_at: '2026-08-14T00:00:00Z',
        consumed_at: '2026-08-14T00:01:00Z',
        consumed_by_commit_sha: sourceSha,
        user_commit_confirmed: null,
      }) + '\n',
    )
    git(['add', '--', 'workflow/REQ-2026-001/responses/approvals.jsonl'])
    git(['commit', '-qm', 'chore(REQ-2026-001): evidence-finalize'])
    // ③ 소비 state write — **커밋하지 않는다**(여기서 중단)
    writeFileSync(
      join(ticket, 'state.json'),
      JSON.stringify(
        {
          ...before,
          consumed_approvals: [
            { approved_tree: 'c'.repeat(40), phase_id: 'phase-1-x', consumed_by_commit_sha: sourceSha, approval_consumed_at: '2026-08-14T00:01:00Z' },
          ],
        },
        null,
        2,
      ) + '\n',
    )
    return { repo, ticket }
  }

  it('🔴 --finalize --run 한 번으로 checkpoint 가 커밋되고 트리가 clean 해진다', () => {
    const { repo, ticket } = crashWindow()
    const git = gitOf(repo)
    expect(git(['status', '--porcelain']).trim()).not.toBe('') // 중단 상태
    const before = Number(git(['rev-list', '--count', 'HEAD']).trim())

    /**
     * 🔴 `main()` 은 doctor 를 `npm` 으로 spawn 해 임시 저장소에서 돌지 않는다. 그래서 **그 아래
     *    전체 흐름**을 실제 git 으로 돈다: HEAD·HEAD^ 읽기 → 판정 → checkpoint 커밋.
     *    (D10 예외 자체는 위 allowlist 스위트가 따로 고정한다.)
     */
    const plan = runRecovery(repo, 'workflow/REQ-2026-001')
    expect(plan.kind).toBe('ready')
    if (plan.kind !== 'ready') return
    expect(plan.resumeFrom).toBe('checkpoint')
    expect(plan.allowlist).toEqual(['workflow/REQ-2026-001/state.json'])
    /**
     * 🔴 리뷰어가 지목한 회귀를 **정확히** 겨냥한다: "doctor 에서 `recoveryAllowlist` 가 D10 입력으로
     *    전달되지 않으면 정상 crash window 에서 실제 명령이 막힌다".
     *
     * `main()` 전체는 `runDoctor` 가 대상 저장소의 `npm run req:doctor` 를 spawn 하고 그 안에서
     * D11(브랜치)·D13(design) 등 **모든** D-체크가 도는데, 합성 티켓은 그것들을 만족시킬 수 없다.
     * 그래서 **실제 git 상태**로 D10 술어를 직접 구동해 같은 실패 모드를 잡는다.
     */
    const entries = parseStatusZ(execFileSync('git', [...STATUS_Z_ARGS], { cwd: repo, encoding: 'utf8' }))
    // allowlist 없이는 막힌다(= 이 REQ 이전 동작).
    expect(findUnstagedOrUntracked(entries, [], 'workflow/REQ-2026-001').length).toBeGreaterThan(0)
    // 🔴 plan 이 낸 allowlist 를 주면 통과한다 — doctor 가 이 값을 안 넘기면 실제 명령이 막힌다.
    expect(findUnstagedOrUntracked(entries, [], 'workflow/REQ-2026-001', plan.allowlist)).toHaveLength(0)

    executeEvidenceRecovery(plan, {
      finalizeEvidenceAndConsume: () => {
        throw new Error('checkpoint 재개에서 불려선 안 된다')
      },
      commitStateCheckpoint: () => {
        git(['add', '--', 'workflow/REQ-2026-001/state.json'])
        git(['commit', '-qm', 'chore(REQ-2026-001): state checkpoint(소비 상태)'])
        return true
      },
    })

    // 🔴 한 번에 수렴: checkpoint 커밋이 생기고 워킹트리가 깨끗해진다.
    expect(Number(git(['rev-list', '--count', 'HEAD']).trim())).toBe(before + 1)
    expect(git(['status', '--porcelain']).trim()).toBe('')
    expect(readFileSync(join(ticket, 'state.json'), 'utf8')).toContain('consumed_by_commit_sha')
    rmSync(repo, { recursive: true, force: true })
  })

  it('🔴 완료된 티켓의 임의 state 수정은 거부된다(같은 진입점)', () => {
    const { repo, ticket } = crashWindow()
    const git = gitOf(repo)
    // checkpoint 까지 커밋해 **완료** 상태로 만든다.
    git(['add', '--', 'workflow/REQ-2026-001/state.json'])
    git(['commit', '-qm', 'chore(REQ-2026-001): state checkpoint'])
    // 그 뒤 임의 필드만 고친다.
    const st = JSON.parse(readFileSync(join(ticket, 'state.json'), 'utf8')) as Record<string, unknown>
    st.injected = 'arbitrary'
    writeFileSync(join(ticket, 'state.json'), JSON.stringify(st, null, 2) + '\n')

    const plan = runRecovery(repo, 'workflow/REQ-2026-001')
    // 🔴 HEAD 가 checkpoint 커밋이라 판별자 A 가 막는다 — 복구가 열리지 않는다.
    expect(plan.kind).toBe('blocked')
    if (plan.kind === 'blocked') expect(plan.reason).toBe('not-a-recovery')
    // 🔴 임의 변경은 여전히 미커밋이다(D10 이 종전처럼 차단한다).
    expect(git(['status', '--porcelain']).trim()).not.toBe('')
    rmSync(repo, { recursive: true, force: true })
  })
})

/**
 * 🔴 REQ-2026-150 phase-1 r03 P1: **실제 `req:commit --finalize --run` 을 한 번 돈다.**
 *
 * 앞 스위트는 `planEvidenceRecovery` 를 직접 부르고 checkpoint 도 수동 어댑터로 커밋해
 * `main()` 과 `runDoctor` spawn 을 건너뛰었다 — doctor 가 allowlist 를 D10 에 안 넘기는 회귀가
 * 생겨도 통과했다. 여기서는 **엔트리포인트 하나만** 부른다.
 *
 * fixture 는 `req:doctor` 스크립트를 이 저장소의 tsx 로 연결해 **진짜 doctor 서브프로세스**가 돈다.
 */
describe('[REQ-2026-150] 🔴 전 CLI e2e — req:commit --finalize --run 한 번', () => {
  const gitOf2 = (repo: string) => (args: string[]): string =>
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: repo, encoding: 'utf8' })

  const fullFixture = (): { repo: string; ticket: string; sourceSha: string } => {
    const repo = mkdtempSync(join(tmpdir(), 'req150cli-'))
    const git = gitOf2(repo)
    git(['init', '-q'])
    git(['config', 'user.email', 't@t.t'])
    git(['config', 'user.name', 't'])
    const tsx = join(packageRoot(), 'node_modules', 'tsx', 'dist', 'cli.mjs').split('\\').join('/')
    const doctorTs = join(packageRoot(), 'scripts', 'req', 'req-doctor.ts').split('\\').join('/')
    writeFileSync(
      join(repo, 'package.json'),
      JSON.stringify({ name: 'x', version: '0.0.0', scripts: { 'req:doctor': `node ${tsx} ${doctorTs}` } }),
    )
    mkdirSync(join(repo, 'workflow', 'REQ-2026-001', 'responses'), { recursive: true })
    writeFileSync(
      join(repo, 'workflow', 'machine.schema.json'),
      readFileSync(join(packageRoot(), 'workflow', 'machine.schema.json'), 'utf8'),
    )
    writeFileSync(join(repo, 'workflow', '.gitignore'), '/.review-calls.jsonl\n/.doctor-runs.jsonl\n')
    writeFileSync(join(repo, 'req.config.json'), JSON.stringify({ packageManager: 'npm', reviewPersonaPath: null }))
    const ticket = join(repo, 'workflow', 'REQ-2026-001')
    const before = { id: 'REQ-2026-001', branch: 'feat/req-2026-001-x', phases: [], consumed_approvals: [] }
    writeFileSync(join(ticket, 'state.json'), `${JSON.stringify(before, null, 2)}\n`)
    git(['add', '-A'])
    git(['commit', '-qm', 'baseline'])
    git(['checkout', '-qb', 'feat/req-2026-001-x'])
    const sourceSha = git(['rev-parse', 'HEAD']).trim()
    // evidence-finalize 커밋(소비 행 추가) — state.json 은 커밋하지 않는다.
    writeFileSync(
      join(ticket, 'responses', 'approvals.jsonl'),
      JSON.stringify({
        kind: 'phase',
        phase_id: null,
        response_path: 'workflow/REQ-2026-001/responses/phase--r01-approved.json',
        response_sha256: 'a'.repeat(64),
        review_base_sha: 'b'.repeat(40),
        approved_tree: 'c'.repeat(40),
        approved_at: '2026-08-14T00:00:00Z',
        consumed_at: '2026-08-14T00:01:00Z',
        consumed_by_commit_sha: sourceSha,
        user_commit_confirmed: null,
      }) + '\n',
    )
    git(['add', '--', 'workflow/REQ-2026-001/responses/approvals.jsonl'])
    git(['commit', '-qm', 'chore(REQ-2026-001): evidence-finalize'])
    // 소비 state write — 커밋하지 않는다(여기서 중단).
    writeFileSync(
      join(ticket, 'state.json'),
      JSON.stringify(
        {
          ...before,
          consumed_approvals: [
            { approved_tree: 'c'.repeat(64), phase_id: null, consumed_by_commit_sha: sourceSha, approval_consumed_at: '2026-08-14T00:01:00Z' },
          ],
        },
        null,
        2,
      ) + '\n',
    )
    return { repo, ticket, sourceSha }
  }

  it('🔴 crash window 가 명령 한 번으로 checkpoint 커밋 + clean tree 로 수렴한다', () => {
    const { repo } = fullFixture()
    const git = gitOf2(repo)
    const before = Number(git(['rev-list', '--count', 'HEAD']).trim())
    expect(git(['status', '--porcelain']).trim()).not.toBe('')

    const res = spawnSync(process.execPath, [
      join(packageRoot(), 'node_modules', 'tsx', 'dist', 'cli.mjs'),
      join(packageRoot(), 'scripts', 'req', 'req-commit.ts'),
      '2026-001', '--finalize', '--run', '--root', repo,
    ], { cwd: repo, encoding: 'utf8' })

    expect(res.status, `${res.stdout}
${res.stderr}`).toBe(0)
    expect(Number(git(['rev-list', '--count', 'HEAD']).trim())).toBe(before + 1)
    expect(git(['status', '--porcelain']).trim()).toBe('')
    rmSync(repo, { recursive: true, force: true })
  }, 60_000)

  it('🔴 완료된 티켓의 임의 state 수정은 실제 명령에서 거부된다', () => {
    const { repo, ticket } = fullFixture()
    const git = gitOf2(repo)
    git(['add', '--', 'workflow/REQ-2026-001/state.json'])
    git(['commit', '-qm', 'chore(REQ-2026-001): state checkpoint'])
    const st = JSON.parse(readFileSync(join(ticket, 'state.json'), 'utf8')) as Record<string, unknown>
    st.injected = 'arbitrary'
    writeFileSync(join(ticket, 'state.json'), `${JSON.stringify(st, null, 2)}\n`)
    const before = Number(git(['rev-list', '--count', 'HEAD']).trim())

    const res = spawnSync(process.execPath, [
      join(packageRoot(), 'node_modules', 'tsx', 'dist', 'cli.mjs'),
      join(packageRoot(), 'scripts', 'req', 'req-commit.ts'),
      '2026-001', '--finalize', '--run', '--root', repo,
    ], { cwd: repo, encoding: 'utf8' })

    expect(res.status).not.toBe(0)
    // 🔴 임의 변경이 커밋되지 않았다.
    expect(Number(git(['rev-list', '--count', 'HEAD']).trim())).toBe(before)
    expect(git(['status', '--porcelain']).trim()).not.toBe('')
    rmSync(repo, { recursive: true, force: true })
  }, 60_000)
})

/**
 * 🔴 REQ-2026-151 phase-2 — **결속이 있는** 실 CLI e2e.
 *
 * 위 REQ-2026-150 e2e 의 매니페스트 행에는 `consumed_state_sha256` 이 없다 = 판별자 D 를 건너뛴다.
 * 그래서 그 스위트만으로는 D 가 죽어 있어도 전부 통과한다. 여기서는 결속이 **있는** crash window 를
 * 만들어 ① 손대지 않으면 한 번에 수렴하고 ② `state.json` 을 고치면 **거부**되는 것을 실제 명령으로 본다.
 */
describe('[REQ-2026-151] 🔴 실 CLI e2e — 결속된 checkpoint 복구', () => {
  const gitOf3 = (repo: string) => (args: string[]): string =>
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: repo, encoding: 'utf8' })

  const boundFixture = (): { repo: string; ticket: string } => {
    const repo = mkdtempSync(join(tmpdir(), 'req151bind-'))
    const git = gitOf3(repo)
    git(['init', '-q'])
    git(['config', 'user.email', 't@t.t'])
    git(['config', 'user.name', 't'])
    const tsx = join(packageRoot(), 'node_modules', 'tsx', 'dist', 'cli.mjs').split('\\').join('/')
    const doctorTs = join(packageRoot(), 'scripts', 'req', 'req-doctor.ts').split('\\').join('/')
    writeFileSync(
      join(repo, 'package.json'),
      JSON.stringify({ name: 'x', version: '0.0.0', scripts: { 'req:doctor': `node ${tsx} ${doctorTs}` } }),
    )
    mkdirSync(join(repo, 'workflow', 'REQ-2026-001', 'responses'), { recursive: true })
    writeFileSync(
      join(repo, 'workflow', 'machine.schema.json'),
      readFileSync(join(packageRoot(), 'workflow', 'machine.schema.json'), 'utf8'),
    )
    writeFileSync(join(repo, 'workflow', '.gitignore'), '/.review-calls.jsonl\n/.doctor-runs.jsonl\n')
    writeFileSync(join(repo, 'req.config.json'), JSON.stringify({ packageManager: 'npm', reviewPersonaPath: null }))
    const ticket = join(repo, 'workflow', 'REQ-2026-001')
    const before = { id: 'REQ-2026-001', branch: 'feat/req-2026-001-x', phases: [], consumed_approvals: [] }
    writeFileSync(join(ticket, 'state.json'), `${JSON.stringify(before, null, 2)}\n`)
    git(['add', '-A'])
    git(['commit', '-qm', 'baseline'])
    git(['checkout', '-qb', 'feat/req-2026-001-x'])
    const sourceSha = git(['rev-parse', 'HEAD']).trim()

    // 🔴 소비 state 바이트를 먼저 정하고 **그 해시**를 매니페스트에 박는다 — 도구가 하는 결속과 같다.
    const consumedText = `${JSON.stringify(
      {
        ...before,
        consumed_approvals: [
          {
            approved_tree: 'c'.repeat(64),
            phase_id: null,
            consumed_by_commit_sha: sourceSha,
            approval_consumed_at: '2026-08-14T00:01:00Z',
          },
        ],
      },
      null,
      2,
    )}\n`
    writeFileSync(
      join(ticket, 'responses', 'approvals.jsonl'),
      `${JSON.stringify({
        kind: 'phase',
        phase_id: null,
        response_path: 'workflow/REQ-2026-001/responses/phase--r01-approved.json',
        response_sha256: 'a'.repeat(64),
        review_base_sha: 'b'.repeat(40),
        approved_tree: 'c'.repeat(40),
        approved_at: '2026-08-14T00:00:00Z',
        consumed_at: '2026-08-14T00:01:00Z',
        consumed_by_commit_sha: sourceSha,
        user_commit_confirmed: null,
        consumed_state_sha256: createHash('sha256').update(consumedText, 'utf8').digest('hex'),
      })}\n`,
    )
    git(['add', '--', 'workflow/REQ-2026-001/responses/approvals.jsonl'])
    git(['commit', '-qm', 'chore(REQ-2026-001): evidence-finalize'])
    writeFileSync(join(ticket, 'state.json'), consumedText)
    return { repo, ticket }
  }


  const finalize = (repo: string) =>
    spawnSync(
      process.execPath,
      [
        join(packageRoot(), 'node_modules', 'tsx', 'dist', 'cli.mjs'),
        join(packageRoot(), 'scripts', 'req', 'req-commit.ts'),
        '2026-001', '--finalize', '--run', '--root', repo,
      ],
      { cwd: repo, encoding: 'utf8' },
    )

  it('🔴 손대지 않은 소비 state 는 명령 한 번으로 수렴한다(무회귀 — 첫 오라클)', () => {
    const { repo } = boundFixture()
    const git = gitOf3(repo)
    const before = Number(git(['rev-list', '--count', 'HEAD']).trim())

    const res = finalize(repo)

    expect(res.status, `${res.stdout}${res.stderr}`).toBe(0)
    expect(Number(git(['rev-list', '--count', 'HEAD']).trim())).toBe(before + 1)
    expect(git(['status', '--porcelain']).trim()).toBe('')
    rmSync(repo, { recursive: true, force: true })
  }, 60_000)

  it('🔴 복구가 커밋한 state 가 결속과 여전히 일치한다 — 재실행이 수렴한다', () => {
    /**
     * 🔴 멱등 skip 경로가 `consumed_at` 을 새로 잡으면 여기서 red 다: 복구가 **다른 바이트**를
     *    커밋해 다음 `--finalize` 가 영영 `state-mismatch` 로 거부된다.
     */
    const { repo, ticket } = boundFixture()
    const git = gitOf3(repo)
    const bound = (JSON.parse(readFileSync(join(ticket, 'responses', 'approvals.jsonl'), 'utf8').trim()) as {
      consumed_state_sha256: string
    }).consumed_state_sha256

    expect(finalize(repo).status).toBe(0)

    const committed = git(['show', 'HEAD:workflow/REQ-2026-001/state.json'])
    expect(createHash('sha256').update(committed, 'utf8').digest('hex')).toBe(bound)
    rmSync(repo, { recursive: true, force: true })
  }, 60_000)

  /** 🔴 crash window 안에서 무엇을 고치든 거부된다 — 계획서가 나열한 다섯 가지. */
  for (const [label, mutate] of [
    ['임의 필드 추가', (s: Record<string, unknown>) => void (s.injected = 'arbitrary')],
    ['risk_level', (s: Record<string, unknown>) => void (s.risk_level = 'LOW')],
    ['policy_snapshot', (s: Record<string, unknown>) => void (s.policy_snapshot = { stop_gate: 'auto' })],
    ['phases', (s: Record<string, unknown>) => void (s.phases = ['phase-9-injected'])],
    ['user_commit_confirmed', (s: Record<string, unknown>) => void (s.user_commit_confirmed = '2026-08-14T00:00:00Z')],
  ] as [string, (s: Record<string, unknown>) => void][]) {
    it(`🔴 ${label} 을 고치면 거부된다 — 임의 변경이 checkpoint 에 실리지 않는다`, () => {
      const { repo, ticket } = boundFixture()
      const git = gitOf3(repo)
      const st = JSON.parse(readFileSync(join(ticket, 'state.json'), 'utf8')) as Record<string, unknown>
      mutate(st)
      writeFileSync(join(ticket, 'state.json'), `${JSON.stringify(st, null, 2)}\n`)
      const before = Number(git(['rev-list', '--count', 'HEAD']).trim())

      const res = finalize(repo)

      expect(res.status).not.toBe(0)
      expect(`${res.stdout}${res.stderr}`).toContain('워킹 state.json 이 도구가 만든 소비 state 와 다릅니다')
      expect(Number(git(['rev-list', '--count', 'HEAD']).trim())).toBe(before)
      expect(git(['status', '--porcelain']).trim()).not.toBe('')
      rmSync(repo, { recursive: true, force: true })
    }, 60_000)
  }
})

describe('[REQ-2026-151] 🔴 배선·계약 가드', () => {
  const read = (p: string): string => readFileSync(join(process.cwd(), p), 'utf8')

  it('🔴 해시는 serializeState 정본으로 계산한다 — checkpoint 바이트 대조와 같은 함수', () => {
    // 다른 직렬화를 쓰면 정상 crash window 가 영원히 state-mismatch 로 거부된다.
    expect(read('scripts/req/req-commit.ts')).toMatch(
      /createHash\('sha256'\)\s*\.update\(serializeState\([A-Za-z]+\), 'utf8'\)\s*\.digest\('hex'\)/,
    )
  })

  it('🔴 consumeState 를 두 번 부르지 않는다 — 해시와 writeState 가 같은 객체를 쓴다', () => {
    // 두 번 부르면 `consumed_at` 이 갈려 바이트가 달라진다(설계 r01 관찰).
    const src = read('scripts/req/req-commit.ts')
    const i = src.indexOf('export function finalizeEvidenceAndConsume')
    const j = src.indexOf('\nexport function ', i + 10)
    const body = src.slice(i, j === -1 ? undefined : j)
    // 🔴 등장은 둘이지만 **한 실행에서는 하나만** 돈다: 정상 경로의 대입과 멱등 skip 경로의 `??` 대체.
    //    `??` 대체를 지우고 세면 정확히 1이어야 한다 — 정상 경로가 두 번 부르면 여기서 red 다.
    expect(body).toMatch(/consumedForCheckpoint\s*\?\?\s*consumeState\(/)
    const withoutFallback = body.replace(/consumedForCheckpoint\s*\?\?\s*consumeState\(/g, '')
    expect((withoutFallback.match(/consumeState\(/g) ?? []).length).toBe(1)
    // 그리고 그 객체가 그대로 디스크로 간다.
    expect(body).toMatch(/writeState\(ctx\.ticketDir, consumed\)/)
  })

  it('🔴 consumed_at 은 한 번만 정해진다 — 멱등 skip 은 HEAD 행의 시각을 다시 쓴다', () => {
    const src = read('scripts/req/req-commit.ts')
    expect(src).toMatch(/consumedAtOfRow\(/)
    expect(src).toMatch(/const consumedAt =/)
  })

  it('🔴 매니페스트 새 키는 선택이다 — 검증기 키 목록에 등록돼 있다', () => {
    expect(read('scripts/req/lib/evidence.ts')).toMatch(/'consumed_state_sha256',/)
  })
})

/**
 * 🔴 REQ-2026-152 DEC-4 — **`resumeFrom: 'consume'` 실 CLI e2e.**
 *
 * 지금까지의 e2e 는 승인 핀이 없어(`ev === null`) 전부 checkpoint 분기로 갔고, 그 분기는
 * `finalizeEvidenceAndConsume` 을 **아예 부르지 않는다**. 그래서 `consumedAtOfRow` 를 `new Date()` 로
 * 되돌리는 변이가 잡히지 않았다(REQ-2026-151 이 "도달 불가일 수 있다"고 잘못 판단한 이유다).
 *
 * 여기서는 **핀이 살아 있고 HEAD 에 소비 행이 이미 있는** 창을 만든다 = evidence 커밋 직후·
 * `writeState` 전에 죽은 상태. 그 경로가 `already` 분기를 지나며 `consumedAtOfRow` 를 쓴다.
 */
describe('[REQ-2026-152] 🔴 실 CLI e2e — resumeFrom: consume', () => {
  const g = (repo: string) => (args: string[]): string =>
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: repo, encoding: 'utf8' })
  const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex')

  const consumeWindow = (): { repo: string; ticket: string } => {
    const repo = mkdtempSync(join(tmpdir(), 'req152c-'))
    const git = g(repo)
    git(['init', '-q'])
    git(['config', 'user.email', 't@t.t'])
    git(['config', 'user.name', 't'])
    const tsx = join(packageRoot(), 'node_modules', 'tsx', 'dist', 'cli.mjs').split('\\').join('/')
    const doctorTs = join(packageRoot(), 'scripts', 'req', 'req-doctor.ts').split('\\').join('/')
    writeFileSync(
      join(repo, 'package.json'),
      JSON.stringify({ name: 'x', version: '0.0.0', scripts: { 'req:doctor': `node ${tsx} ${doctorTs}` } }),
    )
    mkdirSync(join(repo, 'workflow', 'REQ-2026-001', 'responses'), { recursive: true })
    writeFileSync(
      join(repo, 'workflow', 'machine.schema.json'),
      readFileSync(join(packageRoot(), 'workflow', 'machine.schema.json'), 'utf8'),
    )
    writeFileSync(join(repo, 'workflow', '.gitignore'), '/.review-calls.jsonl\n/.doctor-runs.jsonl\n')
    writeFileSync(join(repo, 'req.config.json'), JSON.stringify({ packageManager: 'npm', reviewPersonaPath: null }))
    const ticket = join(repo, 'workflow', 'REQ-2026-001')

    // 승인 응답 아카이브 — 인벤토리가 이 바이트에 결속된다.
    // 🔴 아카이브 이름은 `<phaseId>-rNN-approved.json` 이다(매니페스트 검증이 강제).
    const respRel = 'workflow/REQ-2026-001/responses/phase-1-x-r01-approved.json'
    // 🔴 D6 이 commit_allowed=true 를 **응답으로 재검증**한다 — 유효한 verdict 여야 한다.
    const reviewBase = 'b'.repeat(40)
    const respBody = JSON.stringify({
      machine_schema_version: '1.1',
      review_base_sha: reviewBase,
      status: 'COMPLETE',
      commit_approved: 'yes',
      merge_ready: 'no',
      risk_level: 'LOW',
      review_kind: 'phase',
      findings: [],
      next_action: '',
    })
    writeFileSync(join(repo, respRel), respBody)
    const respSha = sha256(respBody)
    writeFileSync(join(ticket, 'codex-response.json'), respBody) // 🔴 티켓 루트다(responses/ 아님)
    const inv = buildPinnedInventory([{ response_path: respRel, sha256: respSha }], 'phase', 'phase-1-x', respRel, sha256)

    const skeleton = {
      id: 'REQ-2026-001',
      branch: 'feat/req-2026-001-x',
      current_phase: 'phase-1-x',
      phases: [{ id: 'phase-1-x', title: 'x', status: 'pending' }],
      consumed_approvals: [],
    }
    writeFileSync(join(ticket, 'state.json'), `${JSON.stringify(skeleton, null, 2)}\n`)
    writeFileSync(join(repo, 'code.ts'), 'export const a = 1\n')
    git(['add', '-A'])
    git(['commit', '-qm', 'baseline'])
    git(['checkout', '-qb', 'feat/req-2026-001-x'])
    // source 커밋 — 승인 tree 가 이것이어야 한다.
    writeFileSync(join(repo, 'code.ts'), 'export const a = 2\n')
    git(['add', '--', 'code.ts'])
    git(['commit', '-qm', 'feat: x'])
    const sourceSha = git(['rev-parse', 'HEAD']).trim()
    const sourceTree = git(['rev-parse', `${sourceSha}^{tree}`]).trim()

    /**
     * 🔴 **핀이 살아 있는** state — `consumeState` 가 아직 돌지 않았다는 뜻이고, 그래서 복구가
     *    checkpoint 가 아니라 `consume` 으로 간다.
     */
    const pinned = {
      ...skeleton,
      commit_allowed: true,
      approved_diff_hash: sourceTree,
      review_base_sha: reviewBase,
      review_diff_hash: sourceTree,
      pending_evidence_for: { source_commit_sha: sourceSha },
      approval_evidence: {
        response_path: respRel,
        response_sha256: respSha,
        review_kind: 'phase',
        phase_id: 'phase-1-x',
        review_base_sha: reviewBase,
        approved_tree: sourceTree,
        codex_thread_id: 't',
        machine_schema_version: '1',
        status: 'APPROVED',
        commit_approved: 'yes',
        approved_at: '2026-08-14T00:00:00Z',
        archive_inventory: inv,
      },
    }
    writeFileSync(join(ticket, 'state.json'), `${JSON.stringify(pinned, null, 2)}\n`)

    // evidence-finalize 커밋: 소비 행 + 결속. state.json 은 **커밋하지 않는다**(여기서 죽었다).
    const consumedAt = '2026-08-14T00:01:00Z'
    /**
     * 🔴 REQ-2026-154(결함 5): **기대 state 를 손으로, 키 순서까지 정확히** 만든다.
     *
     * 전에는 `skeleton` 기반이라 `review_base_sha`·`review_diff_hash` 가 빠졌고, fixture 의 결속값이
     * **실제 커밋되는 state 와 달랐다**(실측 `bc4eacbc…` ≠ `521ee556…`). 그런데도 e2e 는
     * `approval_consumed_at` 만 봐서 green 이었다 — 경로는 타지만 결속을 증명하지 못했다.
     *
     * 🔴 `consumeState` 를 불러 만들지 않는다 — SUT 로 기대값을 만들면 동어반복이다.
     *    키 순서는 JS 스프레드 규칙(기존 키는 자리 유지·새 키는 뒤)에서 나오고,
     *    `serializeState` 는 `JSON.stringify(…, null, 2)` 라 **삽입 순서를 그대로 쓴다**.
     */
    const consumedState = `${JSON.stringify(
      {
        id: 'REQ-2026-001',
        branch: 'feat/req-2026-001-x',
        current_phase: 'phase-1-x',
        phases: [{ id: 'phase-1-x', title: 'x', status: 'pending' }],
        consumed_approvals: [
          {
            approved_tree: sourceTree,
            phase_id: 'phase-1-x',
            consumed_by_commit_sha: sourceSha,
            approval_consumed_at: consumedAt,
          },
        ],
        commit_allowed: false,
        approved_diff_hash: null,
        review_base_sha: reviewBase,
        review_diff_hash: sourceTree,
        user_commit_confirmed: null,
      },
      null,
      2,
    )}\n`
    writeFileSync(
      join(ticket, 'responses', 'approvals.jsonl'),
      `${JSON.stringify({
        kind: 'phase',
        phase_id: 'phase-1-x',
        response_path: respRel,
        response_sha256: respSha,
        review_base_sha: reviewBase,
        approved_tree: sourceTree,
        approved_at: '2026-08-14T00:00:00Z',
        consumed_at: consumedAt,
        consumed_by_commit_sha: sourceSha,
        user_commit_confirmed: null,
        archive_inventory: inv.items,
        consumed_state_sha256: sha256(consumedState),
      })}\n`,
    )
    git(['add', '--', 'workflow/REQ-2026-001/responses/approvals.jsonl'])
    git(['commit', '-qm', 'chore(REQ-2026-001): evidence-finalize'])
    return { repo, ticket }
  }

  const finalize = (repo: string) =>
    spawnSync(
      process.execPath,
      [
        join(packageRoot(), 'node_modules', 'tsx', 'dist', 'cli.mjs'),
        join(packageRoot(), 'scripts', 'req', 'req-commit.ts'),
        '2026-001', '--finalize', '--run', '--root', repo,
      ],
      { cwd: repo, encoding: 'utf8' },
    )

  it('🔴 consume 창이 한 번에 수렴하고, 소비 시각을 HEAD 행에서 재사용한다', () => {
    const { repo } = consumeWindow()
    const git = g(repo)

    const res = finalize(repo)

    expect(res.status, `${res.stdout}${res.stderr}`).toBe(0)
    expect(git(['status', '--porcelain']).trim()).toBe('')

    /**
     * 🔴 **이것이 `consumedAtOfRow` 의 진짜 오라클이다.** 멱등 skip 경로가 `new Date()` 를 쓰면 소비
     *    시각이 **지금**이 되어 아래 리터럴과 달라진다. 그러면 복구가 결속과 다른 바이트를 커밋하고,
     *    이후 모든 복구가 `state-mismatch` 로 영구 차단된다.
     *
     * 🔴 기대값은 **테스트 안의 리터럴**이다 — SUT 로 만들면 동어반복이 된다(이 저장소가 REQ-B 에서
     *    실제로 저지른 실수).
     */
    const committed = JSON.parse(git(['show', 'HEAD:workflow/REQ-2026-001/state.json'])) as {
      consumed_approvals: { approval_consumed_at: string }[]
    }
    expect(committed.consumed_approvals).toHaveLength(1)
    expect(committed.consumed_approvals[0]!.approval_consumed_at).toBe('2026-08-14T00:01:00Z')

    /**
     * 🔴 REQ-2026-154(결함 5): **커밋된 state 가 매니페스트 결속과 바이트로 같다.**
     *    이 assert 가 없어서 결속값이 틀린 fixture 로도 green 이었다 — 테스트가 통과했다는 사실이
     *    증명이 아니었다.
     */
    const bound = (
      JSON.parse(readFileSync(join(repo, 'workflow/REQ-2026-001/responses/approvals.jsonl'), 'utf8').trim()) as {
        consumed_state_sha256: string
      }
    ).consumed_state_sha256
    expect(sha256(git(['show', 'HEAD:workflow/REQ-2026-001/state.json']))).toBe(bound)
    rmSync(repo, { recursive: true, force: true })
  }, 60_000)

  /**
   * 🔴 이 e2e 가 발화시키는 것은 **DEC-2**(매니페스트 형식 검증)다 — `finalizeEvidenceAndConsume` 이
   *    HEAD 매니페스트를 읽을 때 무결성 검사가 먼저 잡는다. DEC-3 의 `malformed` 분기는 승인 핀이
   *    없는 checkpoint 창에서 발화하며, `evidence-recovery.test.ts` 가 직접 구동한다.
   */
  it('🔴 형식 불량 결속은 실 CLI 에서 거부된다 — 레거시로 강등되지 않는다(DEC-2 경로)', () => {
    const { repo, ticket } = consumeWindow()
    const git = g(repo)
    const mf = join(ticket, 'responses', 'approvals.jsonl')
    const row = JSON.parse(readFileSync(mf, 'utf8').trim()) as Record<string, unknown>
    row.consumed_state_sha256 = null
    writeFileSync(mf, `${JSON.stringify(row)}\n`)
    git(['add', '--', 'workflow/REQ-2026-001/responses/approvals.jsonl'])
    git(['commit', '-qm', 'chore(REQ-2026-001): tamper'])

    const res = finalize(repo)

    expect(res.status).not.toBe(0)
    rmSync(repo, { recursive: true, force: true })
  }, 60_000)

  /**
   * 🔴 REQ-2026-154 phase-1 — consume 경로의 결속 대조.
   *
   * 판별자 D 는 checkpoint 분기에만 있었다. `resumeFrom: 'consume'` 은 그 판정을 지나지 않으므로,
   * 복구 창 안에서 state 가 바뀌면(구버전 `req:repolicy --run` 이 checkpoint 커밋) 대조 없이 다른
   * 바이트를 쓰고, 그 결과가 다음 복구를 `state-mismatch` 로 **영구 차단**했다.
   */
  describe('[REQ-2026-154] 🔴 실 CLI e2e — consume 경로의 결속 대조', () => {
    const g2 = (repo: string) => (args: string[]): string =>
      execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: repo, encoding: 'utf8' })
    const h = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex')

    /** consumeWindow 위에 "복구 창 안에서 state 를 바꿔 checkpoint 커밋"을 얹는다(= 구버전 repolicy). */
    const divergedWindow = (): { repo: string; ticket: string; goodSha: string } => {
      const { repo, ticket } = consumeWindow()
      const git = g2(repo)
      const goodSha = git(['rev-parse', 'HEAD']).trim()
      const st = JSON.parse(readFileSync(join(ticket, 'state.json'), 'utf8')) as Record<string, unknown>
      st.policy_snapshot = { stop_gate: 'auto', adopted: [] }
      writeFileSync(join(ticket, 'state.json'), `${JSON.stringify(st, null, 2)}\n`)
      git(['add', '--', 'workflow/REQ-2026-001/state.json'])
      git(['commit', '-qm', 'chore(REQ-2026-001): state checkpoint — 정지 정책 채택'])
      return { repo, ticket, goodSha }
    }

    it('🔴 결속이 깨진 채로 write 하지 않는다 — 거부하고 워킹 state 를 바꾸지 않는다', () => {
      const { repo, ticket } = divergedWindow()
      const git = g2(repo)
      const before = readFileSync(join(ticket, 'state.json'), 'utf8')
      const count = Number(git(['rev-list', '--count', 'HEAD']).trim())

      const res = finalize(repo)

      expect(res.status).not.toBe(0)
      expect(`${res.stdout}${res.stderr}`).toContain('소비 state 가 커밋된 증거의 결속과 다릅니다')
      // 🔴 write 전에 막았다 — 워킹 state 도 커밋도 그대로다.
      expect(readFileSync(join(ticket, 'state.json'), 'utf8')).toBe(before)
      expect(Number(git(['rev-list', '--count', 'HEAD']).trim())).toBe(count)
      rmSync(repo, { recursive: true, force: true })
    }, 60_000)

    /**
     * 🔴 **되돌릴 명령을 지어내지 않는다**(설계 r01 P1 → 실측으로 재기각).
     *
     * 승인 시점 state 는 커밋되지 않는다 — `git log -- <ticket>/state.json` 에는 티켓 생성·
     * design-finalize·**소비** checkpoint 만 있다(이 저장소 실측). 그러므로 도구는 되돌릴 바이트를
     * 알 수 없고, 후보를 훑는 코드를 넣었다면 **죽은 코드**였다.
     */
    it('🔴 되돌릴 명령을 지어내지 않고, 왜 못 만드는지 말한다', () => {
      const { repo } = divergedWindow()
      const res = finalize(repo)
      const msg = `${res.stdout}${res.stderr}`

      expect(msg).not.toContain('git checkout')
      expect(msg).toContain('아무것도 쓰지 않았습니다')
      expect(msg).toContain('되돌린 뒤')
      // 🔴 못 만드는 **이유**를 말한다 — 사람이 다음 판단을 할 수 있어야 한다.
      expect(msg).toContain('승인 시점 state 는 커밋되지 않아')
      rmSync(repo, { recursive: true, force: true })
    }, 60_000)

    it('🔴 사람이 그 변경을 되돌리면 다음 finalize 가 성공한다 — 교착이 아니다', () => {
      const { repo, ticket } = divergedWindow()
      const git = g2(repo)
      expect(finalize(repo).status).not.toBe(0)

      // 사람이 한 일(정책 채택)을 되돌린다 — 무엇을 했는지 아는 것은 사람뿐이다.
      const st = JSON.parse(readFileSync(join(ticket, 'state.json'), 'utf8')) as Record<string, unknown>
      delete st.policy_snapshot
      writeFileSync(join(ticket, 'state.json'), `${JSON.stringify(st, null, 2)}\n`)

      const res = finalize(repo)
      expect(res.status, `${res.stdout}${res.stderr}`).toBe(0)
      expect(git(['status', '--porcelain']).trim()).toBe('')
      const bound = (
        JSON.parse(readFileSync(join(ticket, 'responses', 'approvals.jsonl'), 'utf8').trim()) as {
          consumed_state_sha256: string
        }
      ).consumed_state_sha256
      expect(h(git(['show', 'HEAD:workflow/REQ-2026-001/state.json']))).toBe(bound)
      rmSync(repo, { recursive: true, force: true })
    }, 90_000)

    it('🔴 대문자 결속도 정상 복구된다 — 받아 놓고 비교에서 막지 않는다', () => {
      const { repo, ticket } = consumeWindow()
      const git = g2(repo)
      const mf = join(ticket, 'responses', 'approvals.jsonl')
      const row = JSON.parse(readFileSync(mf, 'utf8').trim()) as { consumed_state_sha256: string }
      const upper = row.consumed_state_sha256.toUpperCase()
      writeFileSync(mf, `${JSON.stringify({ ...row, consumed_state_sha256: upper })}\n`)
      git(['add', '--', 'workflow/REQ-2026-001/responses/approvals.jsonl'])
      git(['commit', '-qm', 'chore(REQ-2026-001): uppercase'])

      const res = finalize(repo)

      expect(res.status, `${res.stdout}${res.stderr}`).toBe(0)
      expect(git(['status', '--porcelain']).trim()).toBe('')
      rmSync(repo, { recursive: true, force: true })
    }, 60_000)
  })

  describe('[REQ-2026-154] 🔴 소스 가드 — 대조 위치', () => {
    const src = readFileSync(join(process.cwd(), 'scripts/req/req-commit.ts'), 'utf8')

    it('🔴 대조가 writeState **앞**에 있다 — 쓰고 나서 알면 워킹 state 가 이미 오염된다', () => {
      const i = src.search(/if \(already\) \{\s*[\r\n]+\s*const binding = consumedStateShaFor\(/)
      const j = src.indexOf('writeState(ctx.ticketDir, consumed)')
      expect(i).toBeGreaterThan(0)
      expect(i).toBeLessThan(j)
    })

    it('🔴 정상 경로(!already)에는 대조를 넣지 않는다 — 자기 자신을 비교하는 동어반복 금지', () => {
      expect(src).toMatch(/if \(already\) \{\s*[\r\n]+\s*const binding = consumedStateShaFor\(/)
    })

    it('🔴 되돌릴 후보를 훑는 코드가 없다 — 실측으로 죽은 코드임을 확인했다', () => {
      expect(src).not.toMatch(/BINDING_RECOVERY_SCAN/)
      const i = src.indexOf('function stateBindingMismatchProblem')
      const j = src.indexOf('\nexport function ', i)
      expect(src.slice(i, j === -1 ? undefined : j)).not.toContain('git checkout')
    })
  })

})
