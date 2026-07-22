import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import spawn from 'cross-spawn'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { IDENTITY_ENV_VARS, scrubIdentityEnv, HERMETIC_GITCONFIG } from '../setup/git-hermetic'

/**
 * REQ-2026-049 phase-1 — 테스트 환경의 **git identity 차단**이 실제로 작동함을 고정한다.
 *
 * 이 파일이 없으면 `tests/setup/git-hermetic.ts`는 "있지만 아무것도 안 하는" 상태가 될 수 있고,
 * 그러면 repo-local identity를 빠뜨린 헬퍼가 개발자 머신의 전역 identity에 가려 **다시 CI에서만 터진다**.
 * 그 회귀가 정확히 `cc1e755`에서 일어난 일이다(macOS 3 성공 / ubuntu·windows 6 실패).
 */
describe('[REQ-2026-049] 테스트 환경 git hermetic', () => {
  it('GIT_CONFIG_GLOBAL·GIT_CONFIG_SYSTEM이 우리 파일을 가리키고 identity를 주지 않는다', () => {
    for (const k of ['GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM'] as const) {
      const p = process.env[k]
      expect(p, `${k}가 설정돼야 한다`).toBeTruthy()
      expect(existsSync(p as string), `${k} 파일이 존재해야 한다`).toBe(true)
      const body = readFileSync(p as string, 'utf8')
      expect(body).toBe(HERMETIC_GITCONFIG)
      // 🔴 identity를 **공급하면** 안 된다 — 자동 추론만 거부한다.
      expect(body).not.toMatch(/user\s*\.?\s*(email|name)\s*=/i)
    }
    expect(process.env.GIT_CONFIG_NOSYSTEM).toBe('1')
  })

  /**
   * 🔴 identity를 **환경에서 공급하지 않는다**는 계약. `GIT_AUTHOR_*`·`EMAIL`이 남아 있으면 repo-local을
   * 빠뜨려도 커밋이 성공해 결함이 다시 가려진다. `EMAIL`은 git이 `user.email` 부재 시 쓰는 공식 폴백이다.
   */
  it('identity 환경변수(GIT_AUTHOR_*/GIT_COMMITTER_*/EMAIL)가 남아 있지 않다', () => {
    for (const k of IDENTITY_ENV_VARS) {
      expect(process.env[k], `${k}는 제거돼야 한다(결함을 가린다)`).toBeUndefined()
    }
  })

  /** 상속된 값이 **원래 설정돼 있어도** 제거됨을 순수 함수로 고정한다(phase-1 리뷰 P1). */
  it('scrubIdentityEnv: 상속된 EMAIL·GIT_AUTHOR_* 를 지우고 무관한 변수는 보존한다', () => {
    const env: NodeJS.ProcessEnv = {
      EMAIL: 'dev@example.test',
      GIT_AUTHOR_NAME: 'dev',
      GIT_AUTHOR_EMAIL: 'dev@example.test',
      GIT_COMMITTER_NAME: 'dev',
      GIT_COMMITTER_EMAIL: 'dev@example.test',
      PATH: '/usr/bin',
      KEEP_ME: 'yes',
    }
    scrubIdentityEnv(env)
    for (const k of IDENTITY_ENV_VARS) expect(env[k], k).toBeUndefined()
    expect(env.PATH).toBe('/usr/bin')
    expect(env.KEEP_ME).toBe('yes')
  })

  /** 🔴 음성 대조: repo-local identity가 **없으면** 커밋이 실패해야 한다. 실패하지 않으면 차단이 무력하다. */
  it('repo-local identity가 없는 저장소는 커밋에 실패한다(차단이 유효함을 증명)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cg-hermetic-'))
    try {
      execFileSync('git', ['init', '-q'], { cwd: dir })
      writeFileSync(join(dir, 'a.txt'), 'a\n')
      execFileSync('git', ['add', 'a.txt'], { cwd: dir })
      const r = spawn.sync('git', ['commit', '-m', 'no identity'], { cwd: dir, encoding: 'utf8', stdio: 'pipe' })
      expect(r.status, `git identity가 새고 있다 — stdout=${r.stdout} stderr=${r.stderr}`).not.toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  /**
   * 🔴 `EMAIL`이 **자식 프로세스 환경에 다시 주입돼도** 커밋이 실패해야 한다.
   * `user.useConfigOnly = true` 가 자동 추론과 환경 폴백을 함께 거부하므로, 환경변수 삭제가 우회되더라도
   * 오라클이 무너지지 않는다(이중 방어).
   */
  it('EMAIL을 자식 환경에 강제로 넣어도 repo-local 없이는 커밋되지 않는다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cg-hermetic-email-'))
    try {
      execFileSync('git', ['init', '-q'], { cwd: dir })
      writeFileSync(join(dir, 'a.txt'), 'a\n')
      execFileSync('git', ['add', 'a.txt'], { cwd: dir })
      const r = spawn.sync('git', ['commit', '-m', 'env EMAIL only'], {
        cwd: dir,
        encoding: 'utf8',
        stdio: 'pipe',
        env: { ...process.env, EMAIL: 'leaked@example.test' },
      })
      expect(r.status, `EMAIL 폴백이 살아 있다 — stdout=${r.stdout} stderr=${r.stderr}`).not.toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  /** 양성 대조: repo-local identity를 주면 정상 커밋된다(차단이 과하지 않음). */
  it('repo-local identity를 설정하면 커밋된다', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cg-hermetic-ok-'))
    try {
      const git = (args: string[]): string => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
      git(['init', '-q'])
      git(['config', 'user.email', 't@t.t'])
      git(['config', 'user.name', 't'])
      writeFileSync(join(dir, 'a.txt'), 'a\n')
      git(['add', 'a.txt'])
      git(['commit', '-q', '-m', 'ok'])
      expect(git(['rev-parse', 'HEAD']).trim()).toMatch(/^[0-9a-f]{40}$/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
