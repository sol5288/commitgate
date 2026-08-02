import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createEvidencePorts } from '../../scripts/req/lib/evidence-ports'

/**
 * REQ-2026-109 — 증거 포트의 **ref 매개변수화**와 **경로 인용 재현**.
 *
 * 배경: `bin/delivery.ts`가 같은 포트 3개를 따로 구현해(`refEvidencePorts`) delivery integrate의
 * 무결성 게이트에 주입하고 있었다. 그 사본은 정본이 주석으로 경고한 함정을 밟았다 —
 * `ls-tree`에 `-z`가 없어 **git이 인용한 경로**를 그대로 받았다.
 *
 * 🔴 **재현 조건은 두 개다**(설계 r01 P1으로 정정):
 *   1. 경로에 **비ASCII**가 있어야 한다. **공백은 git의 C-style 인용 대상이 아니다** — 실측 확인.
 *   2. `core.quotePath`가 **참**이어야 한다(git 기본값). 이 저장소를 개발하는 머신은 전역
 *      `core.quotepath=false`라 인용이 보이지 않았다 — **기본값이 아닌 로컬 설정이 결함을 가린다.**
 *      그래서 테스트 저장소에 이 값을 **명시적으로 세운다**(전역 설정에 의존하면 머신마다 결과가 갈린다).
 */
const git = (cwd: string, args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' })

/** 비ASCII 티켓 경로 + `core.quotePath=true` 저장소. 아카이브 1개를 커밋하고 SHA를 돌려준다. */
function setupRepo(): { root: string; responsesRel: string; archiveRel: string; first: string } {
  const root = mkdtempSync(join(tmpdir(), 'req109-'))
  git(root, ['init', '-q', '.'])
  git(root, ['config', 'user.email', 't@t'])
  git(root, ['config', 'user.name', 't'])
  git(root, ['config', 'core.quotePath', 'true']) // 🔴 재현 조건 2 — 전역 설정에 기대지 않는다
  const responsesRel = '워크플로/REQ-2026-001/responses' // 🔴 재현 조건 1 — 비ASCII
  const archiveRel = `${responsesRel}/phase-1-a-r01-approved.json`
  mkdirSync(join(root, responsesRel), { recursive: true })
  writeFileSync(join(root, archiveRel), '{"status":"STEP_COMPLETE"}\n', 'utf8')
  git(root, ['add', '-A'])
  git(root, ['commit', '-qm', 'first'])
  const first = git(root, ['rev-parse', 'HEAD']).trim()
  return { root, responsesRel, archiveRel, first }
}

describe('[REQ-2026-109] 증거 포트 — 경로 인용 재현', () => {
  it('🔴 옛 방식(`-z` 없이 `\\n` 분리)은 **인용된 경로**를 낸다 — 이것이 거짓 차단의 원인이었다', () => {
    const { root, responsesRel } = setupRepo()
    try {
      // 삭제된 `refEvidencePorts`를 import할 수 없으므로 **그 방식을 여기서 재현**한다.
      // 그래야 "왜 `-z`가 필요한지"가 이 저장소의 기록으로 남는다(다음 사람이 `-z`를 지우지 않게).
      const out = git(root, ['ls-tree', '-r', '--name-only', 'HEAD', '--', responsesRel])
      const old = out.split('\n').map((x) => x.trim()).filter(Boolean)
      expect(old).toHaveLength(1)
      // git이 큰따옴표로 감싸고 8진 이스케이프로 바꾼다 → 매니페스트가 기록한 경로와 불일치.
      expect(old[0]!.startsWith('"')).toBe(true)
      expect(old[0]).not.toBe(`${responsesRel}/phase-1-a-r01-approved.json`)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('정본 `headArchivePaths`는 **원래 경로**를 낸다(`-z`)', () => {
    const { root, responsesRel, archiveRel } = setupRepo()
    try {
      const ports = createEvidencePorts(root, responsesRel)
      expect(ports.headArchivePaths(responsesRel)).toEqual([archiveRel])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('[REQ-2026-109] 증거 포트 — ref 매개변수화', () => {
  it('ref 미지정이면 HEAD를 읽는다(기존 호출부 무회귀)', () => {
    const { root, responsesRel, archiveRel } = setupRepo()
    try {
      expect(createEvidencePorts(root, responsesRel).headText(archiveRel)).toContain('STEP_COMPLETE')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('🔴 ref를 주면 **그 시점** 내용을 읽는다 — delivery가 feature ref로 검증할 수 있는 근거', () => {
    const { root, responsesRel, archiveRel, first } = setupRepo()
    try {
      // 두 번째 커밋에서 내용을 바꾼다. `first`로 읽으면 옛 내용이어야 한다.
      writeFileSync(join(root, archiveRel), '{"status":"CHANGED"}\n', 'utf8')
      git(root, ['add', '-A'])
      git(root, ['commit', '-qm', 'second'])

      expect(createEvidencePorts(root, responsesRel).headText(archiveRel)).toContain('CHANGED')
      expect(createEvidencePorts(root, responsesRel, first).headText(archiveRel)).toContain('STEP_COMPLETE')
      // blob sha도 ref를 따른다(무결성 검증이 쓰는 포트).
      const atFirst = createEvidencePorts(root, responsesRel, first).headBlobSha256(archiveRel)
      const atHead = createEvidencePorts(root, responsesRel).headBlobSha256(archiveRel)
      expect(atFirst).not.toBe(atHead)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
