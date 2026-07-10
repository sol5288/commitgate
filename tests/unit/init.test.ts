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
  stageList,
  installGuidance,
  quoteForShell,
  pathNeedsManualQuoting,
  unquoteGitPath,
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
function tmpTarget(opts?: {
  pkg?: object
  lock?: string
  withGit?: 'real' | 'fake' | 'none'
  withPkg?: boolean
  spacedName?: boolean
  pctName?: boolean
}): string {
  const prefix = opts?.pctName === true ? 'reqwf %PCT% ' : opts?.spacedName === true ? 'reqwf init ' : 'reqwf-init-'
  const dir = mkdtempSync(join(tmpdir(), prefix))
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

/**
 * REQ-2026-011 phase-6 — 설치 직후 안내 (D4 / DEC-011-7·8·11).
 *
 * `runInit`은 스캐폴드를 만들고 `package.json`을 고치지만 `git add`/`commit`은 하지 않는다.
 * 그래서 설치 직후 워킹트리는 **확정적으로 dirty**한데, 기존 안내의 마지막 줄이
 * `req:new <slug> --run`이었다. 그 명령은 clean 워킹트리를 요구하므로 **100% 실패**했다.
 *
 * 안내에 `git add -A`를 쓰지 않는 이유(DEC-011-7): brownfield repo의 무관한 변경과 `.env`가
 * 함께 커밋되고, 이어지는 `req:review-codex`가 staged diff 전문을 외부로 전송한다.
 * 같은 REQ의 D8-B가 줄이려는 위험을 정확히 증폭시킨다.
 *
 * `&&`를 쓰지 않는 이유(DEC-011-8): Windows PowerShell 5.1과 cmd.exe에 그 연산자가 없다.
 * 이 저장소는 PowerShell 5를 명시 대상으로 인정한다(`scripts/req/lib/config.ts`의 BOM 방어).
 */
describe('[init] stageList — 산출물에서 무시되는 것만 뺀다', () => {
  it('gitIgnoredArtifacts를 제외한다', () => {
    expect(stageList(['a', 'b', 'c'], ['b'])).toEqual(['a', 'c'])
  })
  it('제외할 것이 없으면 그대로', () => {
    expect(stageList(['a'], [])).toEqual(['a'])
  })
})

describe('[init] installGuidance — 안내 문구 (D4)', () => {
  const text = (dir: string, over?: Partial<InitOptions>): string => installGuidance(runInit(OPTS(dir, over))).join('\n')
  /** 실행될 **명령 줄**만 본다 — 산문 경고가 `-A`를 언급하는 것과 실제 명령을 구분한다. */
  const commands = (dir: string, over?: Partial<InitOptions>): string[] =>
    installGuidance(runInit(OPTS(dir, over)))
      .map((l) => l.trim())
      .filter((l) => l.startsWith('git '))

  it('명령으로 `git add -A` 를 내지 않는다 — brownfield의 .env가 외부로 전송된다', () => {
    const dir = tmpTarget()
    try {
      const cmds = commands(dir)
      expect(cmds.some((c) => c.startsWith('git add -A') || c.startsWith('git add .'))).toBe(false)
      expect(
        cmds.some((c) => c.startsWith('git add --')),
        '명시적 경로 목록으로 stage 한다',
      ).toBe(true)
    } finally {
      cleanup(dir)
    }
  })

  it('shell 연산자 `&&` 를 쓰지 않는다 — PowerShell 5.1·cmd 비호환', () => {
    const dir = tmpTarget()
    try {
      expect(text(dir)).not.toContain('&&')
    } finally {
      cleanup(dir)
    }
  })

  it('stage 목록에 설치 산출물이 실제로 들어 있다', () => {
    const dir = tmpTarget({ lock: 'pnpm-lock.yaml' })
    try {
      const g = text(dir)
      expect(g).toContain('scripts/req')
      expect(g).toContain('req.config.json')
      expect(g).toContain('package.json')
      expect(g, 'lockfile — <pm> install 이 갱신한다').toContain('pnpm-lock.yaml')
      expect(g, '눈으로 확인하는 단계').toContain('git status')
    } finally {
      cleanup(dir)
    }
  })

  it('pm-aware 하고, 마지막 단계가 req:new 다', () => {
    const dir = tmpTarget({ lock: 'pnpm-lock.yaml' })
    try {
      const g = text(dir)
      expect(g).toContain('pnpm install')
      expect(g).toContain('pnpm req:new')
      expect(g).not.toContain('npm run req:new')
    } finally {
      cleanup(dir)
    }
  })

  it('gitignore된 진입점은 stage 목록에서 뺀다 — `git add <ignored>` 는 fatal', () => {
    const dir = tmpTarget()
    try {
      writeFileSync(join(dir, '.gitignore'), '.claude\n', 'utf8')
      const g = text(dir)
      expect(g).not.toContain('.claude/commands/req.md')
      expect(g, '무시되지 않은 진입점은 남는다').toContain('.cursor/rules/commitgate.mdc')
    } finally {
      cleanup(dir)
    }
  })

  it('마커 없는 기존 AGENTS.md → AGENTS.commitgate.md 가 stage 목록에 있다', () => {
    const dir = tmpTarget()
    try {
      writeFileSync(join(dir, 'AGENTS.md'), '# 우리 규칙\n', 'utf8')
      expect(text(dir), '빠지면 untracked로 남아 req:new --run이 죽는다').toContain(KIT_AGENTS_CONTRACT_COPY_REL)
    } finally {
      cleanup(dir)
    }
  })

  /** DEC-011-11: 안전한 커밋 안내를 만들 수 없으면 **내지 않는다.** 잘못된 안내보다 안내 없음이 낫다. */
  it('staged 변경이 있으면 `git add` 목록을 내지 않고 이유를 밝힌다', () => {
    const dir = tmpTarget()
    try {
      writeFileSync(join(dir, 'foo.ts'), 'a\n', 'utf8')
      gitIn(dir, ['add', 'foo.ts'])
      const g = text(dir)
      expect(g).not.toContain('git add ')
      expect(g).toContain('foo.ts')
      expect(g).toMatch(/staged/)
    } finally {
      cleanup(dir)
    }
  })

  it('산출물과 겹치는 tracked 변경이 있으면 `git add` 목록을 내지 않는다', () => {
    const dir = tmpTarget()
    try {
      gitIn(dir, ['add', 'package.json'])
      gitIn(dir, ['commit', '-q', '-m', 'init'])
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', version: '9.9.9' }), 'utf8')
      const g = text(dir)
      expect(g).not.toContain('git add ')
      expect(g).toContain('package.json')
    } finally {
      cleanup(dir)
    }
  })

  /**
   * `-u` 없는 bare `git stash`는 untracked를 두고 간다 → clean-tree 게이트가 여전히 실패한다(design 리뷰 R5).
   * 반대로 **경로 없는** `git stash -u`는 너무 넓다 — gitignore되지 않은 `node_modules/`까지 쓸어 가
   * 방금 설치한 `tsx`가 사라지고 `req:new`가 죽는다(실측). 그래서 pathspec을 붙인다.
   */
  it('무관한 변경만 있으면 경로를 명시한 `git stash push -u --` 단계를 넣는다', () => {
    const dir = tmpTarget()
    try {
      gitIn(dir, ['add', 'package.json'])
      gitIn(dir, ['commit', '-q', '-m', 'init'])
      writeFileSync(join(dir, 'notes.txt'), 'x\n', 'utf8')
      const cmds = commands(dir)
      expect(cmds.some((c) => c.startsWith('git add --'))).toBe(true)
      const stash = cmds.find((c) => c.startsWith('git stash'))
      expect(stash, 'pathspec 없는 stash는 node_modules를 쓸어 간다').toBe('git stash push -u -- notes.txt')
    } finally {
      cleanup(dir)
    }
  })

  it('워킹트리가 깨끗하면 stash 단계가 없다', () => {
    const dir = tmpTarget()
    try {
      gitIn(dir, ['add', 'package.json'])
      gitIn(dir, ['commit', '-q', '-m', 'init'])
      expect(text(dir)).not.toContain('git stash')
    } finally {
      cleanup(dir)
    }
  })

  /**
   * `<pm> install`이 만드는 `?? node_modules/`가 clean-tree 게이트를 막는다. README가 지시하는
   * `git init && npm init -y`에는 `.gitignore`가 없으므로 **문서화된 첫 흐름이 100% 실패한다**(실측).
   */
  it('node_modules가 무시되지 않으면 .gitignore 추가를 안내하고 그 파일도 stage 목록에 넣는다', () => {
    const dir = tmpTarget()
    try {
      const g = text(dir)
      expect(r0(dir).nodeModulesWillDirty).toBe(true)
      expect(g).toContain('node_modules')
      expect(g).toContain('.gitignore')
      const add = commands(dir).find((c) => c.startsWith('git add --')) ?? ''
      expect(add.split(' ')).toContain('.gitignore')
    } finally {
      cleanup(dir)
    }
  })

  it('node_modules가 이미 무시되면 그 단계가 없고 .gitignore를 stage하지 않는다', () => {
    const dir = tmpTarget()
    try {
      writeFileSync(join(dir, '.gitignore'), 'node_modules/\n', 'utf8')
      gitIn(dir, ['add', '.gitignore', 'package.json'])
      gitIn(dir, ['commit', '-q', '-m', 'init'])
      const r = r0(dir)
      expect(r.nodeModulesWillDirty).toBe(false)
      const add = commands(dir).find((c) => c.startsWith('git add --')) ?? ''
      expect(add.split(' ')).not.toContain('.gitignore')
    } finally {
      cleanup(dir)
    }
  })

  /**
   * phase-6 리뷰 R1: `.gitignore`를 stage 목록에 사후로 밀어 넣으면, tracked `.gitignore`에 이미 있던
   * unstaged 수정이 설치 커밋에 딸려 들어간다 — `git add -A`를 금지한 이유를 정확히 우회한다.
   * 그래서 `.gitignore`를 **산출물**로 만들어 3분류 기계를 그대로 태운다.
   */
  it('tracked `.gitignore` 에 unstaged 수정이 있으면 overlapping으로 잡고 `git add` 목록을 내지 않는다', () => {
    const dir = tmpTarget()
    try {
      writeFileSync(join(dir, '.gitignore'), 'dist\n', 'utf8') // node_modules는 아직 무시 안 함
      gitIn(dir, ['add', '.gitignore', 'package.json'])
      gitIn(dir, ['commit', '-q', '-m', 'init'])
      writeFileSync(join(dir, '.gitignore'), 'dist\ncoverage\n', 'utf8') // 사용자의 무관한 수정

      const r = r0(dir)
      expect(r.nodeModulesWillDirty).toBe(true)
      expect(r.artifacts, '.gitignore가 산출물이어야 3분류가 본다').toContain('.gitignore')
      expect(r.preexistingDirty.overlapping).toContain('.gitignore')

      const cmds = commands(dir)
      expect(cmds.some((c) => c.startsWith('git add'))).toBe(false)
    } finally {
      cleanup(dir)
    }
  })

  it('untracked `.gitignore` 는 무해하다 — stage 목록에 넣고 안내를 낸다', () => {
    const dir = tmpTarget()
    try {
      gitIn(dir, ['add', 'package.json'])
      gitIn(dir, ['commit', '-q', '-m', 'init'])
      writeFileSync(join(dir, '.gitignore'), 'dist\n', 'utf8') // 커밋된 적 없음

      const r = r0(dir)
      expect(r.preexistingDirty.overlapping).toEqual([])
      expect(r.preexistingDirty.unrelated, 'untracked 산출물은 unrelated도 아니다').not.toContain('.gitignore')
      const add = commands(dir).find((c) => c.startsWith('git add --')) ?? ''
      expect(add.split(' ')).toContain('.gitignore')
    } finally {
      cleanup(dir)
    }
  })

  /**
   * phase-6 리뷰 R2: `node_modules` 무시 판정이 **커밋되지 않은** `.gitignore`에 의존하면,
   * 안내가 그 파일을 `git stash push -u` 로 치우는 순간 규칙이 사라져 `?? node_modules/` 가 되살아난다.
   * 그래서 `.gitignore` 가 dirty하면 무조건 산출물로 편입한다.
   */
  it('untracked `.gitignore` 가 node_modules 를 무시해도, 그 파일을 stash 대상으로 두지 않는다', () => {
    const dir = tmpTarget()
    try {
      gitIn(dir, ['add', 'package.json'])
      gitIn(dir, ['commit', '-q', '-m', 'init'])
      writeFileSync(join(dir, '.gitignore'), 'node_modules/\n', 'utf8') // 아직 커밋 안 됨

      const r = r0(dir) // ⚠️ runInit은 한 번만 — 두 번 돌리면 두 번째 계획이 달라진다
      const cmds = cmdsOf(r)
      // R6 정정: 규칙이 있어도 그 `.gitignore`가 tracked가 아니면 clone에 따라오지 않는다 → 보장으로 인정 안 함.
      expect(r.nodeModulesWillDirty, '커밋되지 않은 규칙은 이식되지 않는다').toBe(true)
      expect(r.artifacts, 'stash되면 규칙이 사라진다 → 설치 커밋에 담아야 한다').toContain('.gitignore')
      expect(r.preexistingDirty.unrelated, 'stash 목록에 들어가면 안 된다').not.toContain('.gitignore')

      const add = cmds.find((c) => c.startsWith('git add --')) ?? ''
      expect(add.split(' ')).toContain('.gitignore')
      expect(cmds.some((c) => c.startsWith('git stash'))).toBe(false)
    } finally {
      cleanup(dir)
    }
  })

  it('tracked·unstaged `.gitignore` 의 미커밋 수정에 node_modules 규칙이 있으면 안내를 내지 않는다', () => {
    const dir = tmpTarget()
    try {
      writeFileSync(join(dir, '.gitignore'), 'dist\n', 'utf8')
      gitIn(dir, ['add', '.gitignore', 'package.json'])
      gitIn(dir, ['commit', '-q', '-m', 'init'])
      writeFileSync(join(dir, '.gitignore'), 'dist\nnode_modules/\n', 'utf8') // 커밋되지 않은 규칙

      const r = r0(dir)
      expect(r.nodeModulesWillDirty).toBe(false)
      expect(r.preexistingDirty.overlapping).toContain('.gitignore')
      expect(cmdsOf(r).some((c) => c.startsWith('git add'))).toBe(false)
    } finally {
      cleanup(dir)
    }
  })

  /**
   * init은 멱등하다. 커밋 전에 두 번 실행해도 안내가 **방금 깐 kit을 stash 하라고 말하면 안 된다** —
   * 두 번째 실행에서 kit 파일들은 `skips`가 되므로, 그것이 산출물에서 빠지면 `unrelated`로 분류된다.
   */
  it('커밋 전에 두 번 실행해도 안내가 kit 파일을 stash 대상으로 만들지 않는다', () => {
    const dir = tmpTarget()
    try {
      gitIn(dir, ['add', 'package.json'])
      gitIn(dir, ['commit', '-q', '-m', 'init'])
      runInit(OPTS(dir))
      const r2 = runInit(OPTS(dir)) // 재실행 — 전부 skip

      expect(r2.copied).toEqual([])
      expect(r2.skipped.length).toBeGreaterThan(0)
      expect(r2.artifacts, 'skip된 kit 파일도 설치 커밋에 속한다').toContain('scripts/req/req-new.ts')
      expect(r2.preexistingDirty.unrelated).not.toContain('scripts/req/req-new.ts')
      const add = cmdsOf(r2).find((c) => c.startsWith('git add --')) ?? ''
      expect(add.split(' ')).toContain('scripts/req/req-new.ts')
    } finally {
      cleanup(dir)
    }
  })

  /**
   * phase-6 리뷰 R3: `skips`에는 init이 **보존하려던 사용자 파일**도 섞인다.
   * 그것을 산출물로 넣으면 설치 커밋이 사용자 파일을 삼킨다 — `git add -A` 금지의 목적을 우회한다.
   * 소유권 기준은 `bin/uninstall.ts`와 같은 **byte-identity**다.
   */
  it('kit 경로에 있던 사용자 파일(내용이 다름)은 stage 목록에 넣지 않는다', () => {
    const dir = tmpTarget()
    try {
      gitIn(dir, ['add', 'package.json'])
      gitIn(dir, ['commit', '-q', '-m', 'init'])
      mkdirSync(join(dir, '.cursor/rules'), { recursive: true })
      writeFileSync(join(dir, '.cursor/rules/commitgate.mdc'), '# 내가 쓴 규칙\n', 'utf8')

      const r = r0(dir)
      expect(r.skipped, 'init은 보존한다').toContain('.cursor/rules/commitgate.mdc')
      expect(r.artifacts, '사용자 파일은 설치 산출물이 아니다').not.toContain('.cursor/rules/commitgate.mdc')
      const add = cmdsOf(r).find((c) => c.startsWith('git add --')) ?? ''
      expect(add.split(' ')).not.toContain('.cursor/rules/commitgate.mdc')
      // 사용자 파일이므로 무관한 변경으로 분류되어 stash 안내를 받는다.
      expect(r.preexistingDirty.unrelated).toContain('.cursor/rules/commitgate.mdc')
    } finally {
      cleanup(dir)
    }
  })

  it('바이트가 같은 skip(직전 실행이 깐 것)은 stage 목록에 넣는다', () => {
    const dir = tmpTarget()
    try {
      gitIn(dir, ['add', 'package.json'])
      gitIn(dir, ['commit', '-q', '-m', 'init'])
      runInit(OPTS(dir))
      const r2 = runInit(OPTS(dir))
      expect(r2.skipped).toContain('.cursor/rules/commitgate.mdc')
      expect(r2.artifacts).toContain('.cursor/rules/commitgate.mdc')
    } finally {
      cleanup(dir)
    }
  })

  /**
   * phase-6 리뷰 R4: 설치 결과는 **저장소에 이식 가능**해야 한다.
   *
   * `git check-ignore`는 `.git/info/exclude`와 전역 excludesFile도 인정하지만 그 둘은 clone에
   * 따라오지 않는다. 설치한 사람의 로컬 설정 때문에 안내가 `.gitignore` 규칙을 빼먹으면,
   * 팀원의 fresh clone에서 `<pm> install` 후 `?? node_modules/`가 나타나 `req:new`가 막힌다.
   */
  it('`.git/info/exclude` 만으로 무시되는 경우는 인정하지 않는다 — clone에 따라오지 않는다', () => {
    const dir = tmpTarget()
    try {
      gitIn(dir, ['add', 'package.json'])
      gitIn(dir, ['commit', '-q', '-m', 'init'])
      writeFileSync(join(dir, '.git/info/exclude'), 'node_modules/\n', 'utf8')

      const r = r0(dir)
      expect(r.nodeModulesWillDirty, '로컬 exclude는 이식되지 않는다').toBe(true)
      expect(r.artifacts).toContain('.gitignore')
      expect(cmdsOf(r).find((c) => c.startsWith('git add --'))?.split(' ')).toContain('.gitignore')
    } finally {
      cleanup(dir)
    }
  })

  it('저장소 `.gitignore` 에서 온 규칙만 clean-tree 보장으로 인정한다 (tracked여야 한다)', () => {
    const dir = tmpTarget()
    try {
      writeFileSync(join(dir, '.gitignore'), 'node_modules/\n', 'utf8')
      gitIn(dir, ['add', '.gitignore', 'package.json'])
      gitIn(dir, ['commit', '-q', '-m', 'init'])
      expect(r0(dir).nodeModulesWillDirty).toBe(false)
    } finally {
      cleanup(dir)
    }
  })

  /**
   * phase-6 리뷰 R6: `.gitignore` **자신이** 로컬 exclude로 숨겨져 있으면 그 규칙은 커밋되지 않는다.
   * `git add .gitignore` 는 fatal이고, 팀원의 fresh clone에서 `?? node_modules/` 가 되살아난다.
   * 이식 가능한 clean-tree를 보장할 수 없으므로 안내를 내지 않고, `--strict` 는 쓰기 전에 멈춘다.
   */
  it('`.gitignore` 자신이 무시되면 안내를 내지 않는다', () => {
    const dir = tmpTarget()
    try {
      gitIn(dir, ['add', 'package.json'])
      gitIn(dir, ['commit', '-q', '-m', 'init'])
      writeFileSync(join(dir, '.git/info/exclude'), '.gitignore\n', 'utf8')
      writeFileSync(join(dir, '.gitignore'), 'node_modules/\n', 'utf8')

      const r = r0(dir)
      expect(r.nodeModulesWillDirty, '.gitignore가 tracked가 아니다').toBe(true)
      expect(r.artifacts).toContain('.gitignore')
      expect(r.gitIgnoredArtifacts, 'git add 가 fatal이다').toContain('.gitignore')
      expect(cmdsOf(r).some((c) => c.startsWith('git add'))).toBe(false)
    } finally {
      cleanup(dir)
    }
  })

  it('`.gitignore` 자신이 무시되면 --strict 는 쓰기 0건으로 멈춘다', () => {
    const dir = tmpTarget()
    try {
      gitIn(dir, ['add', 'package.json'])
      gitIn(dir, ['commit', '-q', '-m', 'init'])
      writeFileSync(join(dir, '.git/info/exclude'), '.gitignore\n', 'utf8')
      writeFileSync(join(dir, '.gitignore'), 'node_modules/\n', 'utf8')
      const before = snapshot(dir)
      expect(() => runInit(OPTS(dir, { strict: true }))).toThrow(/\.gitignore/)
      expect(snapshot(dir)).toEqual(before)
    } finally {
      cleanup(dir)
    }
  })

  /**
   * phase-6 리뷰 R5: 경로를 인용 없이 삽입하면 안내가 깨진다.
   * `cd C:\Work\My Repo` 는 PowerShell 5.1에서 인자 두 개로 쪼개지고,
   * `git stash push -u -- notes today.txt` 는 pathspec 두 개가 되어 그 파일이 dirty로 남는다.
   */
  it('공백이 든 target root 와 파일명을 큰따옴표로 묶는다', () => {
    const dir = tmpTarget({ spacedName: true })
    try {
      gitIn(dir, ['add', 'package.json'])
      gitIn(dir, ['commit', '-q', '-m', 'init'])
      writeFileSync(join(dir, 'notes today.txt'), 'x\n', 'utf8')

      const r = r0(dir)
      const g = installGuidance(r).map((l) => l.trim())
      const cd = g.find((l) => /^\d+\. cd /.test(l)) ?? ''
      expect(cd, 'PowerShell 5.1은 공백에서 인자를 쪼갠다').toBe(`1. cd "${r.targetRoot}"`)
      const stash = g.find((l) => l.startsWith('git stash')) ?? ''
      expect(stash).toBe('git stash push -u -- "notes today.txt"')
    } finally {
      cleanup(dir)
    }
  })

  it('공백 없는 경로는 인용하지 않는다(출력 가독성)', () => {
    expect(quoteForShell('scripts/req/req-new.ts')).toBe('scripts/req/req-new.ts')
    expect(quoteForShell('C:\\Work\\repo')).toBe('C:\\Work\\repo')
    expect(quoteForShell('notes today.txt')).toBe('"notes today.txt"')
  })

  /**
   * cmd.exe는 **큰따옴표 안에서도** `%VAR%`(환경변수)와 `!VAR!`(지연확장)를 치환한다.
   * PowerShell은 큰따옴표 안의 `` ` ``·`$`를 확장한다. 어떤 인용으로도 복붙이 안전하지 않다.
   */
  it('어떤 셸 인용으로도 안전하지 않은 경로를 식별한다', () => {
    expect(pathNeedsManualQuoting('a$b.txt')).toBe(true)
    expect(pathNeedsManualQuoting('a`b.txt')).toBe(true)
    expect(pathNeedsManualQuoting('notes %USERPROFILE%.txt'), 'cmd.exe 환경변수 확장').toBe(true)
    expect(pathNeedsManualQuoting('a!b.txt'), 'cmd.exe 지연확장').toBe(true)
    expect(pathNeedsManualQuoting('a"b.txt')).toBe(true)
    expect(pathNeedsManualQuoting('notes today.txt')).toBe(false)
    expect(pathNeedsManualQuoting('scripts/req/req-new.ts')).toBe(false)
  })

  it('`%VAR%` 가 든 무관한 파일이 있으면 복붙 명령을 내지 않는다', () => {
    const dir = tmpTarget()
    try {
      gitIn(dir, ['add', 'package.json'])
      gitIn(dir, ['commit', '-q', '-m', 'init'])
      writeFileSync(join(dir, '.gitignore'), 'node_modules/\n', 'utf8')
      gitIn(dir, ['add', '.gitignore'])
      gitIn(dir, ['commit', '-q', '-m', 'ignore'])
      writeFileSync(join(dir, 'notes %USERPROFILE%.txt'), 'x\n', 'utf8')

      const r = r0(dir)
      expect(r.preexistingDirty.unrelated).toContain('notes %USERPROFILE%.txt')
      const cmds = cmdsOf(r)
      expect(cmds.some((c) => c.startsWith('git add')), 'cmd.exe가 pathspec을 바꿔치기한다').toBe(false)
      expect(cmds.some((c) => c.startsWith('git stash'))).toBe(false)
      expect(installGuidance(r).join('\n')).toContain('notes %USERPROFILE%.txt')
    } finally {
      cleanup(dir)
    }
  })

  it('target root 에 `%` 가 있으면 `cd` 명령 대신 경로만 알려 준다', () => {
    const dir = tmpTarget({ pctName: true })
    try {
      const g = installGuidance(r0(dir)).map((l) => l.trim())
      expect(g.some((l) => l.startsWith('1. cd '))).toBe(false)
      expect(g.some((l) => l.startsWith('1. 저장소 루트로 이동:'))).toBe(true)
    } finally {
      cleanup(dir)
    }
  })

  /**
   * `git status --porcelain`은 **공백이 든 경로를 C-인용해서** 준다(`"notes today.txt"`).
   * `core.quotePath=false`는 비-ASCII 이스케이프만 끄지 이 인용은 끄지 못한다 — 실측으로 확인.
   * 되돌리지 않으면 경로가 산출물 목록과 매칭되지 않고 안내가 이중 인용을 낸다.
   */
  it('porcelain의 C-인용 경로를 되돌린다', () => {
    expect(unquoteGitPath('"notes today.txt"')).toBe('notes today.txt')
    expect(unquoteGitPath('package.json')).toBe('package.json')
    expect(unquoteGitPath('"a\\"b.txt"')).toBe('a"b.txt')
    expect(unquoteGitPath('"a\\\\b.txt"')).toBe('a\\b.txt')
    expect(unquoteGitPath('"a\\tb.txt"')).toBe('a\tb.txt')
  })

  it('공백이 든 경로가 3분류에서 올바로 매칭된다', () => {
    const d = classifyPreexistingDirty(['?? "notes today.txt"', ' M "my pkg.json"'], ['my pkg.json'])
    expect(d.unrelated).toEqual(['notes today.txt'])
    expect(d.overlapping).toEqual(['my pkg.json'])
  })

  /** `runInit`을 한 번만 돌리는 헬퍼(위 테스트들이 결과 필드를 직접 본다). */
  function r0(dir: string) {
    return runInit(OPTS(dir))
  }
  /** 이미 얻은 결과에서 명령 줄만 추출(runInit 재호출 금지). */
  function cmdsOf(r: ReturnType<typeof runInit>): string[] {
    return installGuidance(r)
      .map((l) => l.trim())
      .filter((l) => l.startsWith('git '))
  }
})

/**
 * 완료 기준 그 자체: **안내를 순서대로 따르면 `req:new --run` 의 clean-tree 게이트를 통과한다.**
 * lockfile·`AGENTS.commitgate.md` 중 하나라도 stage 목록에서 빠지면 여기서 잡힌다.
 */
describe('[init] 통합 — 안내대로 커밋하면 워킹트리가 clean해진다', () => {
  it('마커 없는 AGENTS.md + tracked lockfile 이 있는 brownfield repo', () => {
    const dir = tmpTarget({ lock: 'pnpm-lock.yaml' })
    try {
      writeFileSync(join(dir, 'AGENTS.md'), '# 우리 규칙\n', 'utf8')
      writeFileSync(join(dir, '.gitignore'), 'node_modules/\n', 'utf8') // 현실적인 brownfield 상태
      gitIn(dir, ['add', '.gitignore', 'package.json', 'pnpm-lock.yaml', 'AGENTS.md'])
      gitIn(dir, ['commit', '-q', '-m', 'baseline'])

      const r = runInit(OPTS(dir))
      expect(r.agentsContractCopyCreated).toBe(true)

      // `<pm> install`이 lockfile을 갱신하는 것을 모사(네트워크 install 없이).
      writeFileSync(join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n', 'utf8')

      gitIn(dir, ['add', '--', ...stageList(r.artifacts, r.gitIgnoredArtifacts)])
      gitIn(dir, ['commit', '-q', '-m', 'chore: install commitgate'])

      expect(gitIn(dir, ['status', '--porcelain', '--untracked-files=all']).trim()).toBe('')
    } finally {
      cleanup(dir)
    }
  })

  it('무관한 변경이 있으면 안내대로 커밋 + `git stash -u` 후 clean해진다', () => {
    const dir = tmpTarget()
    try {
      gitIn(dir, ['add', 'package.json'])
      gitIn(dir, ['commit', '-q', '-m', 'baseline'])
      writeFileSync(join(dir, 'notes.txt'), 'x\n', 'utf8') // untracked — bare stash로는 안 치워진다

      const r = runInit(OPTS(dir))
      // 안내 2단계(`<pm> install`)가 lockfile을 만들고, 5단계가 `.gitignore`에 node_modules/를 넣게 한다.
      // 그 단계들을 건너뛰면 `git add`가 존재하지 않는 경로에서 fatal이 된다 — 안내는 순서대로 따라야 성립한다.
      const lock = r.lockfileRel
      expect(lock).toBe('package-lock.json')
      writeFileSync(join(dir, lock as string), '{}\n', 'utf8')
      expect(r.nodeModulesWillDirty).toBe(true)
      writeFileSync(join(dir, '.gitignore'), 'node_modules/\n', 'utf8')

      gitIn(dir, ['add', '--', ...stageList(r.artifacts, r.gitIgnoredArtifacts)])
      gitIn(dir, ['commit', '-q', '-m', 'chore: install commitgate'])
      // 안내가 내는 것과 동일한 pathspec 형태. 경로 없이 stash하면 node_modules까지 딸려 간다.
      gitIn(dir, ['stash', 'push', '-u', '-q', '--', ...r.preexistingDirty.unrelated])

      expect(gitIn(dir, ['status', '--porcelain', '--untracked-files=all']).trim()).toBe('')
    } finally {
      cleanup(dir)
    }
  })
})
