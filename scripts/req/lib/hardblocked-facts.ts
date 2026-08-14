/**
 * `hard-blocked` 보고의 **사실 수집**(REQ-2026-147 phase-2) — fs·git 경계.
 *
 * 🔴 판정·조립은 `lib/nonconvergence`(leaf, 순수)가 한다. 여기는 **읽어서 넣는 일만** 한다.
 *    두 관심사를 한 파일에 두면 순수 부분을 테스트할 때마다 실제 저장소가 필요해진다.
 *
 * 🔴 **아카이브는 워킹트리에서 읽는다.** `approvals.jsonl`·`archive_inventory` 는 승인일 때만
 *    만들어지므로, 8회 전부 needs-fix 로 hardCap 에 닿은 티켓에는 커밋된 아카이브가 **하나도 없다**
 *    (REQ-2026-144 r04 실측). 이것이 허용되는 이유는 보고가 **아무것도 게이트하지 않기 때문**이다.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { archiveBaseName } from './evidence'
import { parseLedger, ledgerPath } from './review-ledger'
import { successorSlug, type NonConvergenceInput, type RoundObservation } from './nonconvergence'
import { parseStatusZ, entryPaths } from './porcelain'
import type { ReviewKind } from './review-types'

export interface HardBlockedIo {
  /** repo 루트(절대). */
  root: string
  /** repo-상대 티켓 디렉터리(POSIX). */
  ticketRel: string
  ticketDir: string
  reqId: string
  branch: unknown
  kind: ReviewKind
  phaseId: string | null
  /** 열린 series 레코드(없으면 null). */
  openSeries: { series_id: string; attempts: number } | null
  hardCap: number
  attempt: number
  /**
   * `git status --porcelain -z …` **원문**(주입 — 이 모듈은 git 을 직접 부르지 않는다).
   * 🔴 `-z` 다. `--porcelain` 단독은 공백·비ASCII 경로를 **C-quote** 하므로 손으로 파싱하면
   *    티켓 경로가 티켓 **밖**으로 오분류된다(phase-2 r01 P1).
   */
  statusZ: () => string
}

const ROUND_RE = (base: string): RegExp =>
  new RegExp(`^${base.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}-r(\\d{2,})-(approved|needs-fix)\\.json$`)

/**
 * 라운드 관측 수집. 🔴 **파손된 라운드는 그 라운드만 건너뛴다** — 하나가 깨졌다고 전부 버리면
 * 보고가 통째로 사라진다(DEC-6).
 */
export function collectRounds(io: HardBlockedIo): RoundObservation[] {
  const dir = join(io.ticketDir, 'responses')
  if (!existsSync(dir)) return []
  const re = ROUND_RE(archiveBaseName(io.kind, io.phaseId))
  // 원장에서 회차별 판정을 얻는다(있으면). 없으면 파일명 접미로 떨어진다.
  const outcomeOf = new Map<number, string>()
  try {
    const abs = join(io.root, ...ledgerPath(io.ticketRel).split('/'))
    if (existsSync(abs)) {
      for (const r of parseLedger(readFileSync(abs, 'utf8')).rows) {
        if (r.event === 'attempt-closed' && typeof r.outcome === 'string') outcomeOf.set(r.attempt, r.outcome)
      }
    }
  } catch {
    // 원장을 못 읽어도 보고는 만든다 — 파일명 접미가 대체 판정이다.
  }
  const out: RoundObservation[] = []
  for (const name of readdirSync(dir)) {
    const m = re.exec(name)
    if (!m) continue
    const round = Number.parseInt(m[1] ?? '0', 10)
    try {
      const v = JSON.parse(readFileSync(join(dir, name), 'utf8')) as { findings?: unknown }
      const findings = Array.isArray(v.findings) ? (v.findings as RoundObservation['findings']) : []
      out.push({ round, outcome: outcomeOf.get(round) ?? m[2] ?? null, findings })
    } catch {
      // 🔴 이 라운드만 건너뛴다.
    }
  }
  return out
}

/**
 * `git status --porcelain -z` 원문 → 티켓 안/밖 더러움 분리.
 *
 * 🔴 **직접 파싱하지 않는다.** `parseStatusZ` 가 정본이다 — `--porcelain` 단독은 공백·비ASCII 경로를
 *    **C-quote** 하므로(`"workflow/\355\213\260…"`) 손으로 자르면 티켓 경로를 티켓 **밖**으로
 *    오분류하고, 그러면 파킹 줄이 빠져 다음 `req:new` 가 막힌다(phase-2 r01 P1).
 *    `-z` 는 인용을 하지 않고, rename 의 src·dest 를 `entryPaths` 가 둘 다 준다.
 */
export function splitDirty(statusZRaw: string, ticketRel: string): { ticketDirty: boolean; outsideDirty: string[] } {
  const prefix = `${ticketRel.replace(/\\/g, '/').replace(/\/+$/, '')}/`
  const paths = parseStatusZ(statusZRaw).flatMap((e) => entryPaths(e).map((p) => p.replace(/\\/g, '/')))
  return {
    ticketDirty: paths.some((p) => p.startsWith(prefix)),
    outsideDirty: [...new Set(paths.filter((p) => !p.startsWith(prefix)))].sort(),
  }
}

/** 보고 입력 조립. */
export function hardBlockedInput(io: HardBlockedIo): NonConvergenceInput {
  const { ticketDirty, outsideDirty } = splitDirty(io.statusZ(), io.ticketRel)
  const rounds = collectRounds(io)
  // 🔴 "열린 attempt 가 있다" = 원장에 닫히지 않은 회차가 남았다. series 가 열린 것과 다르다 —
  //    hardCap 상태에서 series 는 열려 있지만 회차는 보통 전부 닫혀 있다.
  let hasOpenAttempt = false
  try {
    const abs = join(io.root, ...ledgerPath(io.ticketRel).split('/'))
    if (existsSync(abs) && io.openSeries) {
      const rows = parseLedger(readFileSync(abs, 'utf8')).rows.filter((r) => r.series_id === io.openSeries!.series_id)
      const opened = new Set(rows.filter((r) => r.event === 'attempt-opened').map((r) => r.attempt))
      for (const r of rows) if (r.event === 'attempt-closed') opened.delete(r.attempt)
      hasOpenAttempt = opened.size > 0
    }
  } catch {
    hasOpenAttempt = false // 모르면 안내하지 않는다(없는 명령을 주는 것보다 낫다).
  }
  return {
    reqId: io.reqId,
    seriesId: io.openSeries?.series_id ?? null,
    hasOpenAttempt,
    ticketDirty,
    outsideDirty,
    ticketRel: io.ticketRel,
    successorSlug: successorSlug(io.branch, io.reqId),
    rounds,
    hardCap: io.hardCap,
    attempt: io.attempt,
  }
}
