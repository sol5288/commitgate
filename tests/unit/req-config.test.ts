import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  loadConfig,
  resolveRoot,
  packageRoot,
  buildScriptInvocation,
  stripBom,
  DEFAULTS,
  CONFIG_SCHEMA,
} from '../../scripts/req/lib/config'

/** 임시 root 디렉터리 생성(옵션으로 req.config.json 작성). */
function tmpRoot(config?: object): string {
  const dir = mkdtempSync(join(tmpdir(), 'reqcfg-'))
  if (config !== undefined) writeFileSync(join(dir, 'req.config.json'), JSON.stringify(config), 'utf8')
  return dir
}
function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
}

describe('[P3] stripBom / BOM 붙은 JSON', () => {
  it('stripBom은 선두 U+FEFF만 제거(그 외 원문 유지)', () => {
    expect(stripBom('﻿{}')).toBe('{}')
    expect(stripBom('{}')).toBe('{}')
    expect(stripBom('a﻿b')).toBe('a﻿b')
  })
  it('BOM 붙은 req.config.json도 loadConfig가 파싱(PowerShell5 UTF8 이식성)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'reqcfg-bom-'))
    try {
      writeFileSync(join(dir, 'req.config.json'), '﻿' + JSON.stringify({ branchPrefix: 'feat/x-' }), 'utf8')
      expect(loadConfig({ root: dir }).branchPrefix).toBe('feat/x-')
    } finally {
      cleanup(dir)
    }
  })
})

describe('[P2b] req.config.json.sample 유효성', () => {
  it('샘플을 그대로 복사해 req.config.json으로 두면 loadConfig 통과(첫 실행 실패 없음)', () => {
    const sample = readFileSync(resolve(packageRoot(), 'req.config.json.sample'), 'utf8')
    // _comment 같은 unknown 키가 남아있으면 additionalProperties:false로 throw → 아래가 이를 가드
    const dir = mkdtempSync(join(tmpdir(), 'reqcfg-sample-'))
    try {
      writeFileSync(join(dir, 'req.config.json'), sample, 'utf8')
      expect(() => loadConfig({ root: dir })).not.toThrow()
    } finally {
      cleanup(dir)
    }
  })
})

describe('[P1] DEFAULTS — 코어 기본값 계약', () => {
  it('DEFAULTS가 현재 값과 일치', () => {
    expect(DEFAULTS.ticketRoot).toBe('workflow')
    expect(DEFAULTS.schemaPath).toBe('workflow/machine.schema.json')
    // REQ-2026-009: handoffPath는 프로젝트별 값 → 코어 기본은 비활성(null).
    // 사용하려면 req.config.json에 명시하거나 `--handoff <path>`로 준다.
    expect(DEFAULTS.handoffPath).toBeNull()
    expect(DEFAULTS.branchPrefix).toBe('feat/req-')
    expect(DEFAULTS.packageManager).toBe('pnpm')
    expect(DEFAULTS.granularityMaxFiles).toBe(8)
    expect(DEFAULTS.designDocs).toEqual({ requirement: '00-requirement.md', design: '01-design.md', plan: '02-plan.md' })
  })

  it('DEFAULTS.handoffPath의 정적 타입은 string | null 로 유지된다(직접 import 소비자 하위호환)', () => {
    // `null`로 좁혀지면 `const p: string | null = DEFAULTS.handoffPath` 가 아니라
    // 반대 방향 대입(문자열 재할당)이 깨진다. 타입 주석으로 넓은 타입을 보존한다.
    const widened: string | null = DEFAULTS.handoffPath
    expect(widened).toBeNull()
    const reassigned: typeof DEFAULTS.handoffPath = '../somewhere/handoff.md'
    expect(reassigned).toBe('../somewhere/handoff.md')
  })
})

describe('[P1] resolveRoot — --root > cwd 상향탐색 > package-root', () => {
  it('--root 우선', () => {
    const r = tmpRoot()
    try {
      expect(resolveRoot({ root: r })).toBe(resolve(r))
    } finally {
      cleanup(r)
    }
  })
  it('cwd 상향탐색으로 req.config.json 발견', () => {
    const r = tmpRoot({})
    const sub = join(r, 'a', 'b')
    mkdirSync(sub, { recursive: true })
    try {
      expect(resolveRoot({ root: null, cwd: sub })).toBe(resolve(r))
    } finally {
      cleanup(r)
    }
  })
  it('config 못 찾으면 package-root fallback(현재 APP_ROOT와 동일)', () => {
    const r = tmpRoot() // config 없음
    try {
      expect(resolveRoot({ root: null, cwd: r })).toBe(packageRoot())
    } finally {
      cleanup(r)
    }
  })
})

describe('[P1] loadConfig — config 부재 시 DEFAULTS(behavior-preserving 수용기준 #1)', () => {
  it('config 없으면 DEFAULTS + 파생 경로', () => {
    const r = tmpRoot()
    try {
      const c = loadConfig({ root: r })
      expect(c.ticketRoot).toBe('workflow')
      expect(c.branchPrefix).toBe('feat/req-')
      expect(c.packageManager).toBe('pnpm')
      expect(c.granularityMaxFiles).toBe(8)
      expect(c.workflowDirAbs).toBe(join(resolve(r), 'workflow'))
      expect(c.schemaPathAbs).toBe(join(resolve(r), 'workflow', 'machine.schema.json'))
    } finally {
      cleanup(r)
    }
  })
  it('부분 config는 DEFAULTS 위에 merge', () => {
    const r = tmpRoot({ ticketRoot: '.req', packageManager: 'npm' })
    try {
      const c = loadConfig({ root: r })
      expect(c.ticketRoot).toBe('.req')
      expect(c.packageManager).toBe('npm')
      expect(c.branchPrefix).toBe('feat/req-') // default 유지
    } finally {
      cleanup(r)
    }
  })
  it('부분 designDocs도 DEFAULTS 위에 merge', () => {
    const r = tmpRoot({ designDocs: { requirement: 'REQUIREMENT.md' } })
    try {
      const c = loadConfig({ root: r })
      expect(c.designDocs.requirement).toBe('REQUIREMENT.md')
      expect(c.designDocs.design).toBe('01-design.md')
    } finally {
      cleanup(r)
    }
  })
})

describe('[P1] loadConfig fail-closed 안전제약 (Red-first 우선)', () => {
  const bad = (config: object) => {
    const r = tmpRoot(config)
    try {
      expect(() => loadConfig({ root: r })).toThrow()
    } finally {
      cleanup(r)
    }
  }
  it('빈 branchPrefix → throw (D11 무력화 방지)', () => bad({ branchPrefix: '' }))
  it('designDocs 슬래시 → throw', () => bad({ designDocs: { requirement: 'a/b.md' } }))
  it('designDocs .. → throw', () => bad({ designDocs: { design: '..' } }))
  it('ticketRoot root 밖 탈출 → throw', () => bad({ ticketRoot: '../outside' }))
  it('schemaPath root 밖 탈출 → throw', () => bad({ schemaPath: '../../etc/x.json' }))
  // [P1-R1] 절대경로 거부(root 내부를 가리켜도) — repo-상대만 portable.
  it('[P1-R1] ticketRoot 절대경로(POSIX) → throw', () => bad({ ticketRoot: '/abs/workflow' }))
  it('[P1-R1] ticketRoot 절대경로(Windows drive) → throw', () => bad({ ticketRoot: 'C:\\abs\\workflow' }))
  it('[P1-R1] ticketRoot 절대경로(Windows /) → throw', () => bad({ ticketRoot: 'C:/abs/workflow' }))
  it('[P1-R1] ticketRoot UNC → throw', () => bad({ ticketRoot: '\\\\server\\share' }))
  it('[P1-R1] schemaPath 절대경로(POSIX) → throw', () => bad({ schemaPath: '/etc/x.json' }))
  it('[P1-R1] schemaPath 절대경로(Windows) → throw', () => bad({ schemaPath: 'C:/abs/x.json' }))
  it('packageManager enum 밖 → throw', () => bad({ packageManager: 'bun' }))
  it('granularityMaxFiles 0 → throw', () => bad({ granularityMaxFiles: 0 }))
  it('granularityMaxFiles 비정수 → throw', () => bad({ granularityMaxFiles: 2.5 }))
  it('알 수 없는 키 → throw(additionalProperties false)', () => bad({ bogus: 1 }))
  it('malformed req.config.json → throw', () => {
    const r = mkdtempSync(join(tmpdir(), 'reqcfg-'))
    writeFileSync(join(r, 'req.config.json'), '{not json', 'utf8')
    try {
      expect(() => loadConfig({ root: r })).toThrow()
    } finally {
      cleanup(r)
    }
  })
})

describe('[P1] handoffPath — confinement 면제(읽기 전용 참조)', () => {
  it('null 허용', () => {
    const r = tmpRoot({ handoffPath: null })
    try {
      expect(loadConfig({ root: r }).handoffPath).toBe(null)
      expect(loadConfig({ root: r }).handoffPathAbs).toBe(null)
    } finally {
      cleanup(r)
    }
  })
  // REQ-2026-009: config 파일이 아예 없을 때도 코어 기본값이 null이므로 비활성이어야 한다.
  // (이전에는 DEFAULTS가 사설 프로젝트 경로를 가리켜, 그 경로가 실재하는 머신에서만 handoff가 붙었다.)
  it('req.config.json 부재 시 handoffPath·handoffPathAbs 모두 null', () => {
    const r = tmpRoot() // config 파일 없음
    try {
      const cfg = loadConfig({ root: r })
      expect(cfg.handoffPath).toBeNull()
      expect(cfg.handoffPathAbs).toBeNull()
    } finally {
      cleanup(r)
    }
  })
  it('root 밖(../) 허용 — 형제 repo SSOT 참조', () => {
    const r = tmpRoot({ handoffPath: '../sibling/x.md' })
    try {
      expect(loadConfig({ root: r }).handoffPath).toBe('../sibling/x.md')
    } finally {
      cleanup(r)
    }
  })
})

describe('[P1] buildScriptInvocation — packageManager별 argv', () => {
  it('pnpm → [pm, script, ...args]', () =>
    expect(buildScriptInvocation('pnpm', 'req:doctor', ['2026-017'])).toEqual(['pnpm', 'req:doctor', '2026-017']))
  it('yarn → [pm, script, ...args]', () =>
    expect(buildScriptInvocation('yarn', 'req:doctor', ['2026-017'])).toEqual(['yarn', 'req:doctor', '2026-017']))
  it('npm → run + -- (생성 argv 검증)', () =>
    expect(buildScriptInvocation('npm', 'req:doctor', ['2026-017'])).toEqual(['npm', 'run', 'req:doctor', '--', '2026-017']))
})

describe('[P1] req.config.schema.json 파일 == CONFIG_SCHEMA (드리프트 가드)', () => {
  it('파일과 상수 일치', () => {
    const filePath = resolve(packageRoot(), 'workflow', 'req.config.schema.json')
    expect(JSON.parse(readFileSync(filePath, 'utf8'))).toEqual(CONFIG_SCHEMA)
  })
})
