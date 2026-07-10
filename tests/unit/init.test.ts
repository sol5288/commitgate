import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  runInit,
  detectPackageManager,
  runScriptCmd,
  parseArgs,
  crossSpawnBelowFloor,
  classifyPreexistingDirty,
  findIgnoredArtifacts,
  KIT_COPY_RELPATHS,
  KIT_SCHEMA_RELPATHS,
  KIT_AGENT_ENTRYPOINTS,
  KIT_CLAUDE_TEMPLATE_REL,
  KIT_AGENTS_CONTRACT_COPY_REL,
  AGENTS_CONTRACT_MARKER,
  CONTRACT_POINTER_RELPATHS,
  LOCKFILE,
  type InitOptions,
} from '../../bin/init'
import { DEFAULT_REVIEW_PERSONA_RELPATH } from '../../scripts/req/lib/config'

const PACKAGE_ROOT_FOR_TEST = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** repo 전체(.git 제외)의 `경로 → sha256`. "쓰기 0건"을 전수 검증하는 데 쓴다. */
function snapshot(dir: string): Map<string, string> {
  const out = new Map<string, string>()
  const walk = (d: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === '.git') continue
      const abs = join(d, e.name)
      if (e.isDirectory()) walk(abs)
      else out.set(relative(dir, abs).replace(/\\/g, '/'), createHash('sha256').update(readFileSync(abs)).digest('hex'))
    }
  }
  walk(dir)
  return out
}

/** 임시 repo에서 git 실행(user 설정 주입 — `git init`만으론 커밋이 안 된다). */
function gitIn(dir: string, args: string[]): string {
  return execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: dir, encoding: 'utf8' })
}

/**
 * 임시 대상 repo 생성.
 * - withGit: 'real'(기본) = 실제 `git init` / 'fake' = 빈 `.git` 마커만 / 'none' = git 없음
 * - withPkg: package.json 작성 여부(기본 true)
 */
function tmpTarget(opts?: { pkg?: object; lock?: string; withGit?: 'real' | 'fake' | 'none'; withPkg?: boolean }): string {
  const dir = mkdtempSync(join(tmpdir(), 'reqwf-init-'))
  const g = opts?.withGit ?? 'real'
  if (g === 'real') {
    execFileSync('git', ['init', '-q'], { cwd: dir })
  } else if (g === 'fake') {
    mkdirSync(join(dir, '.git'))
  }
  if (opts?.withPkg !== false)
    writeFileSync(join(dir, 'package.json'), JSON.stringify(opts?.pkg ?? { name: 'x', version: '0.0.0' }, null, 2))
  if (opts?.lock) writeFileSync(join(dir, opts.lock), '')
  return dir
}
function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
}
const OPTS = (dir: string, over?: Partial<InitOptions>): InitOptions => ({
  dir,
  force: false,
  dryRun: false,
  strict: false,
  ...over,
})

/**
 * REQ-2026-010 phase-1a — **설치 축과 tarball 축은 다르다** (design R1 P1).
 *
 * `package.json`의 `files[]`는 npm tarball에 무엇이 실리는가이고,
 * `KIT_COPY_RELPATHS`는 **대상 repo에 무엇이 깔리는가**다.
 * phase-1b가 `review-codex`에 persona fail-closed를 켜므로, persona 파일이 설치 축에서
 * 빠지면 신규 설치본의 **모든 리뷰가 멈춘다**. 두 SSOT가 갈라지는 순간 여기서 실패한다.
 */
describe('[init] 설치 축 SSOT (persona)', () => {
  it('KIT_COPY_RELPATHS가 코어 기본 persona 경로를 포함한다', () => {
    expect(KIT_COPY_RELPATHS).toContain(DEFAULT_REVIEW_PERSONA_RELPATH)
  })

  it('KIT_SCHEMA_RELPATHS는 스키마 축으로 남는다(persona 미포함)', () => {
    // uninstall.ts의 "설정된 schemaPath가 init이 깐 스키마인가" 판정이 이 상수에 의존한다.
    // persona를 여기 섞으면 그 판정이 오염된다.
    expect(KIT_SCHEMA_RELPATHS as readonly string[]).not.toContain(DEFAULT_REVIEW_PERSONA_RELPATH)
    expect([...KIT_COPY_RELPATHS]).toEqual(expect.arrayContaining([...KIT_SCHEMA_RELPATHS]))
  })

  it('설치가 persona 파일을 실제로 복사한다', () => {
    const dir = tmpTarget()
    try {
      const r = runInit(OPTS(dir))
      expect(r.copied).toContain(DEFAULT_REVIEW_PERSONA_RELPATH)
      expect(existsSync(join(dir, DEFAULT_REVIEW_PERSONA_RELPATH))).toBe(true)
    } finally {
      cleanup(dir)
    }
  })

  it('dry-run은 persona 파일을 쓰지 않는다', () => {
    const dir = tmpTarget()
    try {
      const r = runInit(OPTS(dir, { dryRun: true }))
      expect(r.copied).toContain(DEFAULT_REVIEW_PERSONA_RELPATH)
      expect(existsSync(join(dir, DEFAULT_REVIEW_PERSONA_RELPATH))).toBe(false)
    } finally {
      cleanup(dir)
    }
  })
})

/**
 * REQ-2026-010 phase-3a — 에이전트 진입점 (D7·D8).
 *
 * 본문 SSOT는 `AGENTS.md`다. 여기 깔리는 것은 **얇은 포인터**이며 계약 본문을 복제하지 않는다.
 * `src !== dest`라 기존 `copyInto`(레이아웃 재현)를 쓸 수 없다 — 명시적 매핑 복사기가 필요하다.
 */
/**
 * REQ-2026-011 phase-2 — 진입점 템플릿은 **pm-중립**이어야 한다 (D1 / DEC-011-1·2).
 *
 * 회귀 경위: `e09c2f3`이 init stdout을 pm-aware로 고친 **다음 날** `f66d45c`가 진입점 템플릿에
 * `npm run …` 리터럴을 새로 넣어 같은 결함 클래스를 재도입했다. `runScriptCmd`에는 단위 테스트가
 * 있었지만 **템플릿 본문을 지키는 테스트가 없어** CI가 잡지 못했다. 이 describe가 그 가드다.
 *
 * 왜 치환 렌더링이 아니라 bare 표기인가(DEC-011-2): `bin/uninstall.ts`가 설치본과 패키지 원본의
 * sha256을 비교해 `removable`/`review`를 판정한다. init이 pm별로 렌더하면 두 바이트열이 영원히
 * 달라져 uninstall이 자기가 깐 진입점을 지우지 못한다. 아래 byte-identity 테스트가 그 계약을 고정한다.
 */
describe('[init] 진입점 템플릿 pm-중립 (REQ-2026-011 D1)', () => {
  /** 패키지매니저 실행 형식이 박힌 명령. 어느 pm으로 렌더해도 다른 pm 프로젝트에선 틀린다. */
  const PM_LITERAL = /npm run req|pnpm req:|yarn req:/
  const TEMPLATE_SRCS = [...KIT_AGENT_ENTRYPOINTS.map((e) => e.src), KIT_CLAUDE_TEMPLATE_REL]
  const INSTALLED = [...KIT_AGENT_ENTRYPOINTS.map((e) => e.dest), 'CLAUDE.md']

  it.each(TEMPLATE_SRCS)('템플릿 원본 %s 에 pm 실행 형식이 박혀 있지 않다', (src) => {
    const body = readFileSync(join(PACKAGE_ROOT_FOR_TEST, src), 'utf8')
    expect(body).not.toMatch(PM_LITERAL)
    expect(body, 'bare 표기로 워크플로 명령을 안내해야 함').toMatch(/req:next/)
  })

  it.each(['pnpm-lock.yaml', 'yarn.lock', 'package-lock.json'])(
    '%s 프로젝트에 설치해도 진입점은 pm 실행 형식을 지시하지 않는다',
    (lock) => {
      const dir = tmpTarget({ lock })
      try {
        runInit(OPTS(dir))
        for (const d of INSTALLED) {
          const body = readFileSync(join(dir, d), 'utf8')
          expect(body, d).not.toMatch(PM_LITERAL)
        }
      } finally {
        cleanup(dir)
      }
    },
  )

  /**
   * DEC-011-2의 핵심 계약: 설치본은 패키지 원본과 **바이트가 같다**.
   * 누군가 치환 렌더링을 도입하면 여기서 깨진다 — uninstall의 `match === 'identical'` 판정이 무너지기 전에.
   */
  it('설치본은 패키지 원본과 byte-identical (uninstall의 sha256 비교 계약)', () => {
    const dir = tmpTarget({ lock: 'pnpm-lock.yaml' })
    try {
      runInit(OPTS(dir))
      for (const { src, dest } of KIT_AGENT_ENTRYPOINTS) {
        expect(readFileSync(join(dir, dest)), `${dest} == ${src}`).toEqual(
          readFileSync(join(PACKAGE_ROOT_FOR_TEST, src)),
        )
      }
      expect(readFileSync(join(dir, 'CLAUDE.md'))).toEqual(
        readFileSync(join(PACKAGE_ROOT_FOR_TEST, KIT_CLAUDE_TEMPLATE_REL)),
      )
    } finally {
      cleanup(dir)
    }
  })

  /** 실행 형식을 지시하지 않는 대신, **어디서 정확한 형식을 얻는지**는 알려 줘야 한다. */
  it.each(TEMPLATE_SRCS)('템플릿 %s 는 정확한 실행 형식의 출처를 안내한다', (src) => {
    const body = readFileSync(join(PACKAGE_ROOT_FOR_TEST, src), 'utf8')
    expect(body).toContain('패키지매니저')
  })
})

describe('[init] 에이전트 진입점 설치', () => {
  const DESTS = ['.claude/skills/commitgate/SKILL.md', '.claude/commands/req.md', '.cursor/rules/commitgate.mdc']

  it('중첩 디렉터리를 만들고 3종 + CLAUDE.md를 설치한다', () => {
    const dir = tmpTarget()
    try {
      const r = runInit(OPTS(dir))
      for (const d of DESTS) {
        expect(r.copied, `copied에 ${d}`).toContain(d)
        expect(existsSync(join(dir, d)), `${d} 실재`).toBe(true)
      }
      expect(r.claudeMdCreated).toBe(true)
      expect(existsSync(join(dir, 'CLAUDE.md'))).toBe(true)
      expect(r.agentEntrypointsSkipped).toBe(false)
    } finally {
      cleanup(dir)
    }
  })

  it('KIT_AGENT_ENTRYPOINTS는 src≠dest이며 src가 패키지에 실재한다', () => {
    for (const { src, dest } of KIT_AGENT_ENTRYPOINTS) {
      expect(src).not.toBe(dest)
      expect(existsSync(join(PACKAGE_ROOT_FOR_TEST, src)), `${src} 실재`).toBe(true)
    }
    expect(existsSync(join(PACKAGE_ROOT_FOR_TEST, KIT_CLAUDE_TEMPLATE_REL))).toBe(true)
  })

  it('포인터는 AGENTS.md를 가리키고 계약 본문을 복제하지 않는다', () => {
    for (const { src } of KIT_AGENT_ENTRYPOINTS) {
      const body = readFileSync(join(PACKAGE_ROOT_FOR_TEST, src), 'utf8')
      expect(body).toContain('AGENTS.md')
      expect(body).toContain(AGENTS_CONTRACT_MARKER)
      // 계약 본문(통제점 표의 승인 문장)은 복제 금지 — drift 부채.
      expect(body).not.toContain('branch protection bypass를 사용한 direct push 승인')
      expect(body).not.toContain('required checks green 확인 후 PR merge 승인')
    }
  })

  /**
   * phase-3a R1 P2 — **복구 지시는 실행 가능해야 한다.**
   *
   * 포인터가 "`AGENTS.template.md`를 참조하라"고 하면 막다른 길이다. 그 파일은 **패키지 안에만** 있고
   * 대상 repo에는 복사되지 않으며, `npx commitgate`는 `node_modules/commitgate/`도 남기지 않는다.
   * 마커가 없을 때 init이 `AGENTS.commitgate.md`를 함께 놓아야 지시가 성립한다.
   */
  it('포인터는 대상 repo에 실재하는 파일(AGENTS.commitgate.md)을 가리킨다', () => {
    const srcs = [...KIT_AGENT_ENTRYPOINTS.map((e) => e.src), KIT_CLAUDE_TEMPLATE_REL]
    for (const src of srcs) {
      const body = readFileSync(join(PACKAGE_ROOT_FOR_TEST, src), 'utf8')
      expect(body, `${src}가 설치되는 사본을 가리켜야 함`).toContain(KIT_AGENTS_CONTRACT_COPY_REL)
      // 대상 repo에 없는 파일을 참조하면 안 된다.
      expect(body, `${src}가 패키지 내부 파일명을 참조하면 안 됨`).not.toContain('AGENTS.template.md')
    }
  })

  it('마커 없는 기존 AGENTS.md → 계약 템플릿 사본을 실제로 설치한다', () => {
    const dir = tmpTarget()
    try {
      writeFileSync(join(dir, 'AGENTS.md'), '# 우리 회사 규칙\n', 'utf8')
      const r = runInit(OPTS(dir))
      expect(r.agentsMarkerMissing).toBe(true)
      expect(r.agentsContractCopyCreated).toBe(true)
      const copyPath = join(dir, KIT_AGENTS_CONTRACT_COPY_REL)
      expect(existsSync(copyPath)).toBe(true)
      // 사본은 패키지의 계약 템플릿과 동일하고 마커를 갖는다.
      expect(readFileSync(copyPath, 'utf8')).toBe(readFileSync(join(PACKAGE_ROOT_FOR_TEST, 'AGENTS.template.md'), 'utf8'))
      expect(readFileSync(copyPath, 'utf8')).toContain(AGENTS_CONTRACT_MARKER)
      // 기존 AGENTS.md는 건드리지 않는다.
      expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toBe('# 우리 회사 규칙\n')
    } finally {
      cleanup(dir)
    }
  })

  it('마커가 있으면 계약 템플릿 사본을 만들지 않는다(잡음 방지)', () => {
    const dir = tmpTarget()
    try {
      writeFileSync(join(dir, 'AGENTS.md'), `${AGENTS_CONTRACT_MARKER}\n# 계약\n`, 'utf8')
      const r = runInit(OPTS(dir))
      expect(r.agentsContractCopyCreated).toBe(false)
      expect(existsSync(join(dir, KIT_AGENTS_CONTRACT_COPY_REL))).toBe(false)
    } finally {
      cleanup(dir)
    }
  })

  it('init이 AGENTS.md를 새로 만들면 사본은 불필요하다', () => {
    const dir = tmpTarget()
    try {
      const r = runInit(OPTS(dir))
      expect(r.agentsCreated).toBe(true)
      expect(r.agentsContractCopyCreated).toBe(false)
      expect(existsSync(join(dir, KIT_AGENTS_CONTRACT_COPY_REL))).toBe(false)
    } finally {
      cleanup(dir)
    }
  })

  it('--no-agent-entrypoints면 마커 경고도 사본도 없다(포인터가 없으므로)', () => {
    const dir = tmpTarget()
    try {
      writeFileSync(join(dir, 'AGENTS.md'), '# 우리 회사 규칙\n', 'utf8')
      const r = runInit(OPTS(dir, { noAgentEntrypoints: true }))
      expect(r.agentsMarkerMissing).toBe(false)
      expect(r.agentsContractCopyCreated).toBe(false)
      expect(existsSync(join(dir, KIT_AGENTS_CONTRACT_COPY_REL))).toBe(false)
    } finally {
      cleanup(dir)
    }
  })

  it('dry-run은 계약 템플릿 사본을 쓰지 않는다', () => {
    const dir = tmpTarget()
    try {
      writeFileSync(join(dir, 'AGENTS.md'), '# 우리 회사 규칙\n', 'utf8')
      const r = runInit(OPTS(dir, { dryRun: true }))
      expect(r.agentsContractCopyCreated).toBe(true) // 계획상 생성
      expect(existsSync(join(dir, KIT_AGENTS_CONTRACT_COPY_REL))).toBe(false) // 실제로는 미기록
    } finally {
      cleanup(dir)
    }
  })

  it('기존 AGENTS.commitgate.md는 --force 없이 덮어쓰지 않는다', () => {
    const dir = tmpTarget()
    try {
      writeFileSync(join(dir, 'AGENTS.md'), '# 우리 회사 규칙\n', 'utf8')
      writeFileSync(join(dir, KIT_AGENTS_CONTRACT_COPY_REL), '내가 편집한 사본\n', 'utf8')
      const r = runInit(OPTS(dir))
      expect(r.agentsContractCopyCreated).toBe(false)
      expect(readFileSync(join(dir, KIT_AGENTS_CONTRACT_COPY_REL), 'utf8')).toBe('내가 편집한 사본\n')
    } finally {
      cleanup(dir)
    }
  })

  it('기존 진입점 파일은 덮어쓰지 않는다(비파괴)', () => {
    const dir = tmpTarget()
    try {
      mkdirSync(join(dir, '.claude', 'commands'), { recursive: true })
      writeFileSync(join(dir, '.claude', 'commands', 'req.md'), '내가 쓴 커맨드\n', 'utf8')
      const r = runInit(OPTS(dir))
      expect(r.skipped).toContain('.claude/commands/req.md')
      expect(readFileSync(join(dir, '.claude', 'commands', 'req.md'), 'utf8')).toBe('내가 쓴 커맨드\n')
    } finally {
      cleanup(dir)
    }
  })

  it('--force면 진입점을 갱신한다', () => {
    const dir = tmpTarget()
    try {
      mkdirSync(join(dir, '.claude', 'commands'), { recursive: true })
      writeFileSync(join(dir, '.claude', 'commands', 'req.md'), 'old\n', 'utf8')
      const r = runInit(OPTS(dir, { force: true }))
      expect(r.copied).toContain('.claude/commands/req.md')
      expect(readFileSync(join(dir, '.claude', 'commands', 'req.md'), 'utf8')).toContain('CommitGate')
    } finally {
      cleanup(dir)
    }
  })

  it('기존 CLAUDE.md는 --force로도 덮어쓰지 않는다(사용자 파일)', () => {
    const dir = tmpTarget()
    try {
      writeFileSync(join(dir, 'CLAUDE.md'), '# 내 프로젝트 지침\n', 'utf8')
      const r = runInit(OPTS(dir, { force: true }))
      expect(r.claudeMdCreated).toBe(false)
      expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toBe('# 내 프로젝트 지침\n')
    } finally {
      cleanup(dir)
    }
  })

  it('--no-agent-entrypoints면 .claude/·.cursor/·CLAUDE.md를 만들지 않는다', () => {
    const dir = tmpTarget()
    try {
      const r = runInit(OPTS(dir, { noAgentEntrypoints: true }))
      expect(r.agentEntrypointsSkipped).toBe(true)
      expect(r.claudeMdCreated).toBe(false)
      for (const d of [...DESTS, 'CLAUDE.md']) expect(existsSync(join(dir, d)), `${d} 미생성`).toBe(false)
      expect(existsSync(join(dir, '.claude'))).toBe(false)
      expect(existsSync(join(dir, '.cursor'))).toBe(false)
      // 코어 설치는 그대로.
      expect(existsSync(join(dir, 'scripts/req/req-new.ts'))).toBe(true)
    } finally {
      cleanup(dir)
    }
  })

  it('dry-run은 진입점을 쓰지 않는다', () => {
    const dir = tmpTarget()
    try {
      const r = runInit(OPTS(dir, { dryRun: true }))
      expect(r.copied).toContain('.cursor/rules/commitgate.mdc')
      for (const d of [...DESTS, 'CLAUDE.md']) expect(existsSync(join(dir, d))).toBe(false)
    } finally {
      cleanup(dir)
    }
  })

  /** design R1 observation — 기존 AGENTS.md가 CommitGate 계약이 아니면 포인터가 엉뚱한 SSOT를 가리킨다. */
  it('기존 AGENTS.md에 마커가 없으면 경고한다(설치는 계속)', () => {
    const dir = tmpTarget()
    try {
      writeFileSync(join(dir, 'AGENTS.md'), '# 우리 회사 규칙\n', 'utf8')
      const r = runInit(OPTS(dir))
      expect(r.agentsCreated).toBe(false)
      expect(r.agentsMarkerMissing).toBe(true)
      expect(existsSync(join(dir, '.claude/commands/req.md'))).toBe(true) // 설치는 계속
      expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toBe('# 우리 회사 규칙\n') // 미변경
    } finally {
      cleanup(dir)
    }
  })

  it('마커가 있는 기존 AGENTS.md면 경고하지 않는다', () => {
    const dir = tmpTarget()
    try {
      writeFileSync(join(dir, 'AGENTS.md'), `${AGENTS_CONTRACT_MARKER}\n# 계약\n`, 'utf8')
      expect(runInit(OPTS(dir)).agentsMarkerMissing).toBe(false)
    } finally {
      cleanup(dir)
    }
  })

  it('init이 만드는 AGENTS.md는 마커를 포함한다', () => {
    const dir = tmpTarget()
    try {
      runInit(OPTS(dir))
      expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toContain(AGENTS_CONTRACT_MARKER)
    } finally {
      cleanup(dir)
    }
  })

  /**
   * preflight→apply 계약: `mkdirSync(recursive)`는 중간 컴포넌트가 파일이면 ENOTDIR로 죽는다.
   * apply 중에 죽으면 앞의 파일들은 이미 복사된 뒤라 **부분 설치**가 된다. 쓰기 전에 막아야 한다.
   */
  it('경로 중간이 파일이면 아무것도 쓰기 전에 throw한다(부분 설치 방지)', () => {
    const dir = tmpTarget()
    try {
      writeFileSync(join(dir, '.claude'), '나는 파일이다\n', 'utf8')
      expect(() => runInit(OPTS(dir))).toThrow(/진입점 설치 불가/)
      // 코어 파일도 쓰이지 않았다(preflight에서 중단).
      expect(existsSync(join(dir, 'scripts/req/req-new.ts'))).toBe(false)
      expect(existsSync(join(dir, 'workflow/machine.schema.json'))).toBe(false)
    } finally {
      cleanup(dir)
    }
  })

  it('--no-agent-entrypoints면 그 preflight를 건너뛴다(.claude가 파일이어도 설치 성공)', () => {
    const dir = tmpTarget()
    try {
      writeFileSync(join(dir, '.claude'), '나는 파일이다\n', 'utf8')
      expect(() => runInit(OPTS(dir, { noAgentEntrypoints: true }))).not.toThrow()
      expect(existsSync(join(dir, 'scripts/req/req-new.ts'))).toBe(true)
    } finally {
      cleanup(dir)
    }
  })
})

describe('[init] 정상 설치', () => {
  it('kit 파일·config·package.json·AGENTS를 설치', () => {
    const dir = tmpTarget()
    try {
      const r = runInit(OPTS(dir))
      expect(existsSync(join(dir, 'scripts/req/req-new.ts'))).toBe(true)
      expect(existsSync(join(dir, 'scripts/req/lib/config.ts'))).toBe(true)
      expect(existsSync(join(dir, 'scripts/req/lib/adapters.ts'))).toBe(true)
      expect(existsSync(join(dir, 'workflow/machine.schema.json'))).toBe(true)
      expect(existsSync(join(dir, 'workflow/req.config.schema.json'))).toBe(true)
      // 티켓 디렉터리는 복사 대상 아님(스키마 2종만)
      expect(r.copied.some((f) => f.startsWith('workflow/REQ-'))).toBe(false)
      // config 시드: handoffPath null(비활성을 config에 명시 기록) + 감지 pm
      expect(r.configAction).toBe('created')
      const cfg = JSON.parse(readFileSync(join(dir, 'req.config.json'), 'utf8'))
      expect(cfg.handoffPath).toBeNull()
      expect(cfg.packageManager).toBe('npm')
      // package.json 패치
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
      expect(pkg.scripts['req:new']).toBe('tsx scripts/req/req-new.ts')
      expect(pkg.scripts['req:commit']).toBe('tsx scripts/req/req-commit.ts')
      // REQ-2026-010 phase-2: req:next가 5번째 주입 스크립트로 추가됐다.
      expect(pkg.scripts['req:next']).toBe('tsx scripts/req/req-next.ts')
      expect(Object.keys(pkg.scripts).sort()).toEqual(
        ['req:commit', 'req:doctor', 'req:new', 'req:next', 'req:review-codex'].sort(),
      )
      expect(pkg.devDependencies.tsx).toBeTruthy()
      expect(pkg.devDependencies.ajv).toBeTruthy()
      expect(pkg.devDependencies['cross-spawn']).toBeTruthy() // 복사된 adapters.ts 안전 spawn 의존(P1)
      // AGENTS 생성
      expect(r.agentsCreated).toBe(true)
      expect(existsSync(join(dir, 'AGENTS.md'))).toBe(true)
    } finally {
      cleanup(dir)
    }
  })
})

describe('[init] 멱등성(재실행)', () => {
  it('두 번째 실행은 kit을 스킵하고 config/AGENTS를 덮어쓰지 않음', () => {
    const dir = tmpTarget()
    try {
      runInit(OPTS(dir))
      const r2 = runInit(OPTS(dir))
      expect(r2.copied.length).toBe(0)
      expect(r2.skipped).toContain('scripts/req/req-new.ts')
      expect(r2.configAction).toBe('unchanged')
      expect(r2.agentsCreated).toBe(false)
      expect(r2.packageJsonAdded.length).toBe(0)
    } finally {
      cleanup(dir)
    }
  })

  it('--force는 기존 kit 파일을 덮어씀', () => {
    const dir = tmpTarget()
    try {
      runInit(OPTS(dir))
      writeFileSync(join(dir, 'scripts/req/req-new.ts'), '// tampered', 'utf8')
      const r = runInit(OPTS(dir, { force: true }))
      expect(r.copied).toContain('scripts/req/req-new.ts')
      expect(readFileSync(join(dir, 'scripts/req/req-new.ts'), 'utf8')).not.toBe('// tampered')
    } finally {
      cleanup(dir)
    }
  })
})

describe('[init] 기존 config 누락키 병합(design R1 P2)', () => {
  it('기존 req.config.json에 handoffPath 없으면 병합, 기존 키는 보존', () => {
    // handoffPath 없는 부분 config → 병합으로 handoffPath:null 추가(비활성을 명시 기록)
    const dir = tmpTarget({ pkg: { name: 'x', scripts: { 'req:new': 'custom' }, devDependencies: { ajv: '^7.0.0' } } })
    try {
      writeFileSync(join(dir, 'req.config.json'), JSON.stringify({ branchPrefix: 'feat/x-' }), 'utf8')
      const r = runInit(OPTS(dir))
      expect(r.configAction).toBe('merged')
      const cfg = JSON.parse(readFileSync(join(dir, 'req.config.json'), 'utf8'))
      expect(cfg.branchPrefix).toBe('feat/x-') // 기존 키 보존
      expect(cfg.handoffPath).toBeNull() // 누락키 추가
      expect(cfg.packageManager).toBe('npm') // 누락키 추가
      // package.json: 기존 키 보존
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
      expect(pkg.scripts['req:new']).toBe('custom')
      expect(pkg.devDependencies.ajv).toBe('^7.0.0')
      expect(pkg.scripts['req:commit']).toBe('tsx scripts/req/req-commit.ts')
    } finally {
      cleanup(dir)
    }
  })

  it('기존 config에 handoffPath 명시값 있으면 유지', () => {
    const dir = tmpTarget()
    try {
      writeFileSync(join(dir, 'req.config.json'), JSON.stringify({ handoffPath: 'keep/me.md', packageManager: 'pnpm' }), 'utf8')
      const r = runInit(OPTS(dir))
      expect(r.configAction).toBe('unchanged')
      const cfg = JSON.parse(readFileSync(join(dir, 'req.config.json'), 'utf8'))
      expect(cfg.handoffPath).toBe('keep/me.md')
      expect(cfg.packageManager).toBe('pnpm')
    } finally {
      cleanup(dir)
    }
  })

  it('기존 config가 malformed면 fail-closed throw + 부분 복사 없음(design R2 P2)', () => {
    const dir = tmpTarget()
    try {
      writeFileSync(join(dir, 'req.config.json'), '{ not json', 'utf8')
      expect(() => runInit(OPTS(dir))).toThrow(/req\.config\.json 파싱 실패/)
      // preflight에서 실패 → kit 파일이 하나도 복사되지 않아야(부분 벤더링 방지)
      expect(existsSync(join(dir, 'scripts/req/req-new.ts'))).toBe(false)
      expect(existsSync(join(dir, 'workflow/machine.schema.json'))).toBe(false)
    } finally {
      cleanup(dir)
    }
  })

  it('package.json이 malformed/비객체면 throw + 부분 복사 없음(design R2 P2)', () => {
    const dir = tmpTarget()
    try {
      writeFileSync(join(dir, 'package.json'), '[1,2,3]', 'utf8') // 배열 = 비객체
      expect(() => runInit(OPTS(dir))).toThrow(/package\.json이 JSON 객체가 아님/)
      expect(existsSync(join(dir, 'scripts/req/req-new.ts'))).toBe(false)
    } finally {
      cleanup(dir)
    }
  })

  it('package.json scripts/devDependencies가 배열이면 throw + 부분 복사 없음(phase R1 P2)', () => {
    for (const bad of [{ name: 'x', scripts: [] }, { name: 'x', devDependencies: [1, 2] }]) {
      const dir = tmpTarget({ pkg: bad })
      try {
        expect(() => runInit(OPTS(dir))).toThrow(/필드가 객체가 아님/)
        expect(existsSync(join(dir, 'scripts/req/req-new.ts'))).toBe(false)
      } finally {
        cleanup(dir)
      }
    }
  })
})

describe('[init] 기존 config 스키마/경로 검증(phase R2 P2)', () => {
  it('schema-invalid 기존 config는 복사 전 throw + 부분 복사 없음', () => {
    const cases = [
      { bogusUnknownKey: 1 }, // additionalProperties:false
      { packageManager: 'bun' }, // enum 위반
      { branchPrefix: '' }, // minLength 위반(D11 무력화 차단)
      { ticketRoot: '../escape' }, // root 밖 탈출
    ]
    for (const bad of cases) {
      const dir = tmpTarget()
      try {
        writeFileSync(join(dir, 'req.config.json'), JSON.stringify(bad), 'utf8')
        expect(() => runInit(OPTS(dir))).toThrow()
        expect(existsSync(join(dir, 'scripts/req/req-new.ts'))).toBe(false)
      } finally {
        cleanup(dir)
      }
    }
  })
})

describe('[init] dry-run', () => {
  it('파일을 쓰지 않고 계획만 반환', () => {
    const dir = tmpTarget()
    try {
      const r = runInit(OPTS(dir, { dryRun: true }))
      expect(r.copied.length).toBeGreaterThan(0)
      expect(r.configAction).toBe('created')
      expect(existsSync(join(dir, 'scripts/req/req-new.ts'))).toBe(false)
      expect(existsSync(join(dir, 'req.config.json'))).toBe(false)
      expect(existsSync(join(dir, 'AGENTS.md'))).toBe(false)
      expect(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).scripts).toBeUndefined()
    } finally {
      cleanup(dir)
    }
  })
})

describe('[init] fail-closed', () => {
  it('git repo 아니면 throw(실제 probe)', () => {
    const dir = tmpTarget({ withGit: 'none' })
    try {
      expect(() => runInit(OPTS(dir))).toThrow(/git repo가 아님/)
    } finally {
      cleanup(dir)
    }
  })

  it('빈 .git 마커만 있는 fake repo도 거부(design R1 P2)', () => {
    const dir = tmpTarget({ withGit: 'fake' })
    try {
      expect(() => runInit(OPTS(dir))).toThrow(/git repo가 아님/)
    } finally {
      cleanup(dir)
    }
  })

  it('package.json 없으면 throw', () => {
    const dir = tmpTarget({ withPkg: false })
    try {
      expect(() => runInit(OPTS(dir))).toThrow(/package\.json 없음/)
    } finally {
      cleanup(dir)
    }
  })

  it('존재하지 않는 디렉터리면 throw', () => {
    expect(() => runInit(OPTS(join(tmpdir(), 'reqwf-nope-does-not-exist-xyz')))).toThrow(/대상 디렉터리가 없음/)
  })
})

describe('[init] BOM 이식성(P3)', () => {
  it('BOM 붙은 package.json도 파싱·패치(PowerShell5 UTF8)', () => {
    const dir = tmpTarget({ withPkg: false })
    try {
      writeFileSync(join(dir, 'package.json'), '﻿' + JSON.stringify({ name: 'x', version: '0.0.0' }), 'utf8')
      expect(() => runInit(OPTS(dir))).not.toThrow()
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) // init은 BOM 없이 재작성
      expect(pkg.scripts['req:new']).toBe('tsx scripts/req/req-new.ts')
    } finally {
      cleanup(dir)
    }
  })
})

describe('[init] packageManager 감지', () => {
  it('pnpm-lock → pnpm, yarn.lock → yarn, package-lock → npm, 없음 → npm', () => {
    for (const [lock, pm] of [
      ['pnpm-lock.yaml', 'pnpm'],
      ['yarn.lock', 'yarn'],
      ['package-lock.json', 'npm'],
    ] as const) {
      const dir = tmpTarget({ lock })
      try {
        expect(detectPackageManager(dir)).toBe(pm)
      } finally {
        cleanup(dir)
      }
    }
    const bare = tmpTarget()
    try {
      expect(detectPackageManager(bare)).toBe('npm')
    } finally {
      cleanup(bare)
    }
  })
})

describe('[#1] cross-spawn 버전 하한 진단', () => {
  const below = (dir: string, pkg: Record<string, unknown>) => crossSpawnBelowFloor(dir, pkg)?.below

  it('[순수] range 판정 매트릭스(설치·lock 없음) — ^7.0.0 오탐 방지', () => {
    const dir = tmpTarget()
    try {
      // 하한(>=7.0.6)으로 절대 해소 불가 → below
      for (const s of ['^6.0.0', '6.x', '~6.1.0', '7.0.1', '7.0.5'])
        expect(below(dir, { devDependencies: { 'cross-spawn': s } })).toBe(true)
      // 하한 이상 해소 가능 → 무경고(오탐 방지: 특히 ^7.0.0·~7.0.1)
      for (const s of ['^7.0.0', '~7.0.1', '>=7.0.6', '^7.0.6', '7.0.9', '^8.0.0', '*'])
        expect(below(dir, { devDependencies: { 'cross-spawn': s } })).toBe(false)
      // 기존 cross-spawn 없음 → null(진단 불필요), deps 쪽도 감지
      expect(crossSpawnBelowFloor(dir, {})).toBeNull()
      expect(below(dir, { dependencies: { 'cross-spawn': '^6.0.0' } })).toBe(true)
    } finally {
      cleanup(dir)
    }
  })

  it('[lockfile] ^7.0.0 spec + package-lock 7.0.1 핀 → below(range fallback 전에 잡음, R1 P2)', () => {
    const dir = tmpTarget()
    try {
      writeFileSync(
        join(dir, 'package-lock.json'),
        JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/cross-spawn': { version: '7.0.1' } } }),
      )
      expect(below(dir, { devDependencies: { 'cross-spawn': '^7.0.0' } })).toBe(true)
    } finally {
      cleanup(dir)
    }
  })

  it('[설치버전 우선] node_modules 설치본이 lockfile·range보다 우선', () => {
    const dir = tmpTarget()
    try {
      mkdirSync(join(dir, 'node_modules', 'cross-spawn'), { recursive: true })
      writeFileSync(join(dir, 'node_modules/cross-spawn/package.json'), JSON.stringify({ version: '7.0.9' }))
      writeFileSync(
        join(dir, 'package-lock.json'),
        JSON.stringify({ packages: { 'node_modules/cross-spawn': { version: '6.0.0' } } }),
      )
      // 설치본 7.0.9(>=floor) → lock 6.0.0·spec ^6.0.0이 낮아도 무경고
      expect(below(dir, { devDependencies: { 'cross-spawn': '^6.0.0' } })).toBe(false)
    } finally {
      cleanup(dir)
    }
  })

  it('[통합] 하한 미만 → WARN(기본, 설치 계속)', () => {
    const dir = tmpTarget({ pkg: { name: 'x', devDependencies: { 'cross-spawn': '^6.0.0' } } })
    try {
      const r = runInit(OPTS(dir))
      expect(r.crossSpawnFloorWarned).toBe(true)
      expect(existsSync(join(dir, 'scripts/req/req-new.ts'))).toBe(true) // 비파괴 — 설치 계속
    } finally {
      cleanup(dir)
    }
  })

  it('[통합] --strict → throw + 부분 복사 없음', () => {
    const dir = tmpTarget({ pkg: { name: 'x', dependencies: { 'cross-spawn': '5.0.0' } } })
    try {
      expect(() => runInit(OPTS(dir, { strict: true }))).toThrow(/cross-spawn.*하한/)
      expect(existsSync(join(dir, 'scripts/req/req-new.ts'))).toBe(false)
    } finally {
      cleanup(dir)
    }
  })

  it('[통합] cross-spawn 없음/>=floor → 무경고', () => {
    const d1 = tmpTarget()
    const d2 = tmpTarget({ pkg: { name: 'x', devDependencies: { 'cross-spawn': '^7.0.6' } } })
    try {
      expect(runInit(OPTS(d1)).crossSpawnFloorWarned).toBe(false)
      expect(runInit(OPTS(d2)).crossSpawnFloorWarned).toBe(false)
    } finally {
      cleanup(d1)
      cleanup(d2)
    }
  })

  it('[통합] dependencies가 배열이면 throw(shape 검증, R1 P3) + 부분 복사 없음', () => {
    const dir = tmpTarget({ pkg: { name: 'x', dependencies: [] } })
    try {
      expect(() => runInit(OPTS(dir))).toThrow(/dependencies 필드가 객체가 아님/)
      expect(existsSync(join(dir, 'scripts/req/req-new.ts'))).toBe(false)
    } finally {
      cleanup(dir)
    }
  })
})

describe('[init] parseArgs', () => {
  it('--dir/--force/--dry-run 파싱, 미지의 인자 거부, --dir 값 누락 거부', () => {
    expect(parseArgs(['--force', '--dry-run']).force).toBe(true)
    expect(parseArgs(['--dry-run']).dryRun).toBe(true)
    expect(() => parseArgs(['--bogus'])).toThrow(/알 수 없는 인자/)
    expect(() => parseArgs(['--dir'])).toThrow(/--dir 값 누락/)
  })
})

describe('[init] runScriptCmd — pm별 유효 실행 커맨드(안내 정확성)', () => {
  it('npm은 run + `--` 구분자, pnpm/yarn은 bare script + 인자 직접', () => {
    // npm: `npm req:new …`은 Unknown command로 실패 → run + -- 필수(README 수동 명령과 동일)
    expect(runScriptCmd('npm', 'req:new', '<slug> --run')).toBe('npm run req:new -- <slug> --run')
    expect(runScriptCmd('pnpm', 'req:new', '<slug> --run')).toBe('pnpm req:new <slug> --run')
    expect(runScriptCmd('yarn', 'req:new', '<slug> --run')).toBe('yarn req:new <slug> --run')
  })
})

/**
 * REQ-2026-011 phase-5 — 설치 산출물 계획(`InstallPlan`)과 gitignore preflight
 * (D5 / DEC-011-5·9·10·11).
 *
 * 세 가지가 한 뿌리에서 나온다:
 *  1. 산출물 목록을 **쓰기 전에** 확정해야 한다. `InitResult.copied`는 Apply에서 채워지므로
 *     preflight의 ignore 검사가 참조할 수 없다(design 리뷰 R4).
 *  2. ignore 검사 대상과 stage 목록은 **같은 목록**이어야 한다. 따로 관리하면 어긋난다
 *     (R2에서 `AGENTS.commitgate.md`, R3에서 lockfile이 빠졌다).
 *  3. `git add <path>`는 ignored **그리고** untracked일 때만 fatal이다. tracked 파일은 add된다.
 */
describe('[init] classifyPreexistingDirty — 설치 전 워킹트리 3분류 (DEC-011-11)', () => {
  const ARTIFACTS = ['package.json', 'req.config.json', 'pnpm-lock.yaml']

  it('staged 변경은 staged로 분류된다 — `git commit`이 인덱스 전체를 담기 때문', () => {
    const d = classifyPreexistingDirty(['M  src/foo.ts', 'A  src/bar.ts'], ARTIFACTS)
    expect(d.staged).toEqual(['src/foo.ts', 'src/bar.ts'])
    expect(d.overlapping).toEqual([])
    expect(d.unrelated).toEqual([])
  })

  it('tracked+unstaged 산출물은 overlapping — 사용자 변경과 설치 변경을 사후 분리할 수 없다', () => {
    const d = classifyPreexistingDirty([' M package.json'], ARTIFACTS)
    expect(d.overlapping).toEqual(['package.json'])
    expect(d.unrelated).toEqual([])
  })

  it('untracked 산출물은 무해하다 — 파일 전체가 신규라 분리할 것이 없다', () => {
    const d = classifyPreexistingDirty(['?? package.json', '?? pnpm-lock.yaml'], ARTIFACTS)
    expect(d.staged).toEqual([])
    expect(d.overlapping).toEqual([])
    expect(d.unrelated).toEqual([])
  })

  it('산출물과 무관한 unstaged/untracked는 unrelated', () => {
    const d = classifyPreexistingDirty([' M src/foo.ts', '?? notes.txt'], ARTIFACTS)
    expect(d.unrelated).toEqual(['src/foo.ts', 'notes.txt'])
    expect(d.staged).toEqual([])
  })

  it('rename은 화살표 뒤(새 경로)를 쓴다', () => {
    const d = classifyPreexistingDirty(['R  old.ts -> new.ts'], ARTIFACTS)
    expect(d.staged).toEqual(['new.ts'])
  })

  it('빈 입력은 전부 빈 배열', () => {
    const d = classifyPreexistingDirty([], ARTIFACTS)
    expect(d).toEqual({ staged: [], overlapping: [], unrelated: [] })
  })
})

describe('[init] 설치 산출물 목록(InitResult.artifacts) — ignore 검사와 stage 목록의 SSOT', () => {
  it('복사분 + req.config.json + package.json + lockfile 을 담는다', () => {
    const dir = tmpTarget({ lock: 'pnpm-lock.yaml' })
    try {
      const r = runInit(OPTS(dir))
      expect(r.artifacts).toContain('scripts/req/req-new.ts')
      expect(r.artifacts).toContain('req.config.json')
      expect(r.artifacts).toContain('package.json')
      // `<pm> install`이 lockfile을 갱신한다(devDeps 주입 때문). stage하지 않으면 clean-tree 게이트가 죽는다.
      expect(r.artifacts, 'lockfile 누락 시 req:new --run이 clean-tree에서 실패한다').toContain('pnpm-lock.yaml')
    } finally {
      cleanup(dir)
    }
  })

  it.each(['npm', 'pnpm', 'yarn'] as const)('%s 프로젝트는 그 pm의 lockfile을 담는다', (pm) => {
    const locks = { npm: 'package-lock.json', pnpm: 'pnpm-lock.yaml', yarn: 'yarn.lock' }
    const dir = tmpTarget({ lock: locks[pm] })
    try {
      const r = runInit(OPTS(dir))
      expect(r.packageManager).toBe(pm)
      expect(r.artifacts).toContain(LOCKFILE[pm])
    } finally {
      cleanup(dir)
    }
  })

  it('기존 AGENTS.md에 마커가 없으면 AGENTS.commitgate.md 도 담는다', () => {
    const dir = tmpTarget()
    try {
      writeFileSync(join(dir, 'AGENTS.md'), '# 우리 프로젝트 규칙\n', 'utf8')
      const r = runInit(OPTS(dir))
      expect(r.agentsContractCopyCreated).toBe(true)
      expect(r.artifacts, '누락 시 untracked로 남아 req:new --run이 죽는다').toContain(KIT_AGENTS_CONTRACT_COPY_REL)
    } finally {
      cleanup(dir)
    }
  })

  it('AGENTS.md·CLAUDE.md를 새로 만들면 담고, 기존 파일을 보존했으면 담지 않는다', () => {
    const dir = tmpTarget()
    try {
      const r = runInit(OPTS(dir))
      expect(r.artifacts).toContain('AGENTS.md')
      expect(r.artifacts).toContain('CLAUDE.md')
    } finally {
      cleanup(dir)
    }
    const dir2 = tmpTarget()
    try {
      writeFileSync(join(dir2, 'CLAUDE.md'), '# 기존\n', 'utf8')
      const r = runInit(OPTS(dir2))
      expect(r.claudeMdCreated).toBe(false)
      expect(r.artifacts).not.toContain('CLAUDE.md')
    } finally {
      cleanup(dir2)
    }
  })
})

describe('[init] gitignore preflight (D5)', () => {
  const IGNORED_POINTERS = ['.claude/skills/commitgate/SKILL.md', '.claude/commands/req.md']

  it('CONTRACT_POINTER_RELPATHS는 진입점 3종 + AGENTS/CLAUDE/계약사본을 덮는다', () => {
    for (const { dest } of KIT_AGENT_ENTRYPOINTS) expect(CONTRACT_POINTER_RELPATHS).toContain(dest)
    expect(CONTRACT_POINTER_RELPATHS).toContain('AGENTS.md')
    expect(CONTRACT_POINTER_RELPATHS).toContain('CLAUDE.md')
    expect(CONTRACT_POINTER_RELPATHS).toContain(KIT_AGENTS_CONTRACT_COPY_REL)
  })

  it('`.claude` 통짜 무시: 경고하고 설치는 계속한다(기본 모드)', () => {
    const dir = tmpTarget()
    try {
      writeFileSync(join(dir, '.gitignore'), '.claude\n', 'utf8')
      const r = runInit(OPTS(dir))
      for (const p of IGNORED_POINTERS) expect(r.gitIgnoredArtifacts, p).toContain(p)
      // .cursor는 무시되지 않는다
      expect(r.gitIgnoredArtifacts).not.toContain('.cursor/rules/commitgate.mdc')
      // 비파괴: 설치는 계속된다
      expect(existsSync(join(dir, 'scripts/req/req-new.ts'))).toBe(true)
    } finally {
      cleanup(dir)
    }
  })

  /**
   * `--strict`는 **어떤 파일도 쓰기 전에** 멈춰야 한다. `.claude/`·`scripts/req/` 부재만 보면
   * `req.config.json`·`package.json`을 먼저 쓰고 나중에 throw하는 구현을 놓친다(design 리뷰 R1).
   */
  it('`--strict`: throw + 신규 0개·수정 0개(전수 스냅샷)', () => {
    const dir = tmpTarget()
    try {
      writeFileSync(join(dir, '.gitignore'), '.claude\n', 'utf8')
      const before = snapshot(dir)
      expect(() => runInit(OPTS(dir, { strict: true }))).toThrow(/gitignore|무시/)
      expect(snapshot(dir)).toEqual(before)
    } finally {
      cleanup(dir)
    }
  })

  it('lockfile이 무시되면 조용히 제외한다 — 계약 포인터가 아니므로 --strict도 통과', () => {
    const dir = tmpTarget({ lock: 'pnpm-lock.yaml' })
    try {
      writeFileSync(join(dir, '.gitignore'), 'pnpm-lock.yaml\n', 'utf8')
      const r = runInit(OPTS(dir, { strict: true }))
      expect(r.gitIgnoredArtifacts).toContain('pnpm-lock.yaml')
      expect(r.gitIgnoredArtifacts).not.toContain('.claude/commands/req.md')
    } finally {
      cleanup(dir)
    }
  })

  /** DEC-011-10: `git check-ignore`는 인덱스를 보지 않는다. tracked 파일은 ignore 규칙에 걸려도 add된다. */
  it('무시 규칙에 걸려도 이미 tracked면 제외하지 않는다', () => {
    const dir = tmpTarget({ lock: 'pnpm-lock.yaml' })
    try {
      writeFileSync(join(dir, '.gitignore'), 'pnpm-lock.yaml\n', 'utf8')
      gitIn(dir, ['add', '-f', 'pnpm-lock.yaml'])
      gitIn(dir, ['commit', '-q', '-m', 'lock'])
      const r = runInit(OPTS(dir))
      expect(r.gitIgnoredArtifacts).not.toContain('pnpm-lock.yaml')
    } finally {
      cleanup(dir)
    }
  })

  it('findIgnoredArtifacts는 존재하지 않는 경로도 규칙으로 판정한다', () => {
    const dir = tmpTarget()
    try {
      writeFileSync(join(dir, '.gitignore'), '.claude\n', 'utf8')
      expect(findIgnoredArtifacts(dir, ['.claude/commands/req.md', 'package.json'])).toEqual([
        '.claude/commands/req.md',
      ])
    } finally {
      cleanup(dir)
    }
  })
})

describe('[init] 설치 전 dirty 워킹트리 (DEC-011-11)', () => {
  it('staged 변경이 있으면 preexistingDirty.staged에 담고 --strict는 쓰기 0건으로 멈춘다', () => {
    const dir = tmpTarget()
    try {
      writeFileSync(join(dir, 'foo.ts'), 'export const a = 1\n', 'utf8')
      gitIn(dir, ['add', 'foo.ts'])
      const before = snapshot(dir)
      expect(() => runInit(OPTS(dir, { strict: true }))).toThrow(/staged/)
      expect(snapshot(dir)).toEqual(before)

      const r = runInit(OPTS(dir)) // 기본 모드는 설치를 막지 않는다(비-breaking)
      expect(r.preexistingDirty.staged).toContain('foo.ts')
      expect(r.preexistingDirty.overlapping).toEqual([])
    } finally {
      cleanup(dir)
    }
  })

  it('산출물과 겹치는 tracked 변경은 overlapping — 사후 분리 불가', () => {
    const dir = tmpTarget()
    try {
      gitIn(dir, ['add', 'package.json'])
      gitIn(dir, ['commit', '-q', '-m', 'init'])
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', version: '0.0.1' }, null, 2), 'utf8')
      const r = runInit(OPTS(dir))
      expect(r.preexistingDirty.overlapping).toContain('package.json')
      expect(r.preexistingDirty.unrelated).not.toContain('package.json')
    } finally {
      cleanup(dir)
    }
  })

  it('무관한 변경은 unrelated에만 담기고 설치를 막지 않는다', () => {
    const dir = tmpTarget()
    try {
      gitIn(dir, ['add', 'package.json'])
      gitIn(dir, ['commit', '-q', '-m', 'init'])
      writeFileSync(join(dir, 'src.ts'), '1\n', 'utf8')
      const r = runInit(OPTS(dir, { strict: true }))
      expect(r.preexistingDirty.unrelated).toContain('src.ts')
      expect(r.preexistingDirty.staged).toEqual([])
    } finally {
      cleanup(dir)
    }
  })

  it('설치 전에 찍는다 — CommitGate 산출물이 섞이지 않는다', () => {
    const dir = tmpTarget()
    try {
      const r = runInit(OPTS(dir))
      for (const set of [r.preexistingDirty.staged, r.preexistingDirty.overlapping, r.preexistingDirty.unrelated])
        expect(set).not.toContain('scripts/req/req-new.ts')
    } finally {
      cleanup(dir)
    }
  })

  /**
   * design 리뷰 R7 정정: **untracked 산출물은 세 목록 어디에도 담기지 않는다.**
   *
   * baseline이 없어 분리할 "사용자 변경"과 "설치 변경"이 존재하지 않는다. 그리고 이것을 차단하면
   * README가 지시하는 첫 흐름(`git init && npm init -y && npx commitgate --strict`)이 **항상** 실패한다 —
   * 그 흐름의 `package.json`은 정의상 untracked이기 때문이다. 거짓 차단은 `--strict`를 피하도록 가르친다.
   */
  it('untracked 산출물(`?? package.json`)은 --strict를 막지 않는다 — README quick start 보호', () => {
    const dir = tmpTarget() // git init 직후 = package.json untracked (npm init -y와 같은 상태)
    try {
      const r = runInit(OPTS(dir, { strict: true }))
      expect(r.artifacts, 'stage 목록에는 들어간다').toContain('package.json')
      expect(r.preexistingDirty.staged).toEqual([])
      expect(r.preexistingDirty.overlapping).toEqual([])
      expect(r.preexistingDirty.unrelated).not.toContain('package.json')
    } finally {
      cleanup(dir)
    }
  })
})
