/**
 * `EvidencePorts`의 실제 구현(fs + git) — REQ-2026-048 phase-3.
 *
 * `lib/evidence.ts`는 leaf(순수)라 fs·git을 모른다. 부수효과는 전부 여기로 모아 두 호출자
 * (`review-codex`의 정상 승인 경로, `req:commit --finalize-design`의 복구 경로)가 **같은 포트**를 쓰게 한다.
 *
 * ⚠️ 이 모듈도 `review-codex`·`req-commit`·`req-doctor`를 import하지 않는다(leaf 유지).
 */
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'
import { isArchiveFileName } from './scratch'
import type { EvidencePorts } from './evidence'

/** repo-상대 경로 → 절대 경로(구분자 정규화). */
function abs(root: string, repoRel: string): string {
  return join(root, ...repoRel.replace(/\\/g, '/').split('/'))
}

/**
 * 실 파일시스템·git 기반 포트.
 *
 * @param root  소비 저장소 루트(=`cfg.root`).
 * @param responsesDirRel 티켓 `responses/` repo-상대 경로(아카이브 목록용).
 */
export function createEvidencePorts(root: string, responsesDirRel: string): EvidencePorts {
  /** 짧은 문자열 출력을 내는 git 호출(파일 내용용 아님). */
  const gitText = (args: string[]): string =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

  return {
    readText(repoRel) {
      const p = abs(root, repoRel)
      return existsSync(p) ? readFileSync(p, 'utf8') : null
    },
    writeText(repoRel, content) {
      const p = abs(root, repoRel)
      mkdirSync(dirname(p), { recursive: true })
      writeFileSync(p, content, 'utf8')
    },
    listArchiveNames() {
      const d = abs(root, responsesDirRel)
      return existsSync(d) ? readdirSync(d).filter(isArchiveFileName) : []
    },
    sha256(repoRel) {
      return createHash('sha256').update(readFileSync(abs(root, repoRel))).digest('hex')
    },
    headText(repoRel) {
      try {
        return gitText(['show', `HEAD:${repoRel}`])
      } catch {
        return null // HEAD에 없는 경로
      }
    },
    /**
     * 🔴 **바이트 그대로** 읽어 해시한다.
     *
     * `GitAdapter.exec`는 계약상 결과의 **후행 공백을 제거**한다(`git status --porcelain` 선행 공백 보존이 목적).
     * 그 변환은 파일 내용 해시를 **망가뜨린다**(끝 개행이 사라져 sha가 달라진다). 그래서 이 한 곳만
     * `execFileSync(..., {encoding:'buffer'})`로 원문 바이트를 받는다 — 어댑터 우회가 아니라 **다른 계약**이 필요해서다.
     *
     * 또한 워킹 파일이 아니라 **blob**을 읽는 것이 핵심이다. `core.autocrlf` 환경에서 워킹 파일은 CRLF로
     * 변환될 수 있고, 그러면 커밋된 내용과 sha가 달라져 거짓 불일치가 난다.
     */
    headBlobSha256(repoRel) {
      try {
        const buf = execFileSync('git', ['cat-file', 'blob', `HEAD:${repoRel}`], {
          cwd: root,
          maxBuffer: 64 * 1024 * 1024,
        })
        return createHash('sha256').update(buf).digest('hex')
      } catch {
        return null // HEAD에 없는 경로
      }
    },
    headCommitSha() {
      return gitText(['rev-parse', 'HEAD']).trim()
    },
    /**
     * 🔴 **pathspec 범위 커밋**. `git add <paths>` 로 새 파일을 추적 대상에 넣은 뒤,
     * `git commit -m <msg> -- <paths>` 로 **그 경로만** 커밋한다.
     *
     * `-- <paths>` 가 핵심이다: pathspec을 주면 git은 그 경로들의 내용만으로 커밋을 만들고
     * **나머지 index는 건드리지 않는다**. 설계 문서를 stage한 채 design 리뷰를 돌리는 정상 경로에서도
     * 그 staged 변경은 evidence 커밋에 섞이지 않고 index에 그대로 남는다.
     */
    commitPaths(paths, message) {
      if (paths.length === 0) return
      execFileSync('git', ['add', '--', ...paths], { cwd: root, encoding: 'utf8' })
      execFileSync('git', ['commit', '-m', message, '--', ...paths], { cwd: root, encoding: 'utf8' })
    },
  }
}
