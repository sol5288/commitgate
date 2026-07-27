#!/usr/bin/env tsx
/**
 * req:rebind — 설계 재승인 뒤 **앞선 phase를 현재 design_ref로 재결속**한다 (REQ-2026-069).
 *
 * **왜 필요한가**: 리뷰가 P1을 내면 설계 문서를 고치게 되고, 그때마다 설계 재승인이 걸려 `design_hash`가
 * 바뀐다. 앞서 승인된 phase는 **옛 해시에 묶인 채** 남고, `dev-complete`는 모든 phase가 현재 design_ref에
 * 결속돼야 발행되므로 **티켓이 종결되지 않는다**(그러면 `req:new`도 막힌다).
 * 빠져나갈 길이 없다 — phase 리뷰는 `git diff --cached` 범위인데 그 코드는 이미 커밋됐다.
 *
 * 실측: REQ-2026-066·067(설계 4회 재승인)은 막혀 `--migrate`로 우회했고, 재승인이 0회인 068은 자가 종결했다.
 *
 * 🔴 **이 명령은 판단을 대신하지 않는다.** "이 설계 변경이 그 phase의 검수를 무효화하는가"는 도구가 알 수
 *    없다. 사람이 확인 문구로 답하고, 그 사실이 **매니페스트에 append**되어 감사에 남는다.
 * 🔴 **기존 phase 행을 고치지 않는다** — 덮어쓰면 원래 어느 설계로 검토됐는지가 사라진다.
 * 🔴 **시각은 실제 시계**에서 읽는다(지어낸 타임스탬프는 REQ-2026-019 폐기 사유).
 *
 * 사용: req:rebind <REQ> --phase <id> --confirm "<문구>" [--run] [--root <path>]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadConfig } from './lib/config'
import { createGitAdapter } from './lib/adapters'
import { assertSetupComplete } from './lib/setup-gate'
import { designHashFromManifest, parseManifestEntries, validateManifest, type RebindEntry } from './lib/evidence'
import { closeProofPath } from './lib/close-proof'
import { computeDevCompleteProof } from './req-commit'
import { appendCloseProofRowToDisk, loadState, readPhases } from './review-codex'

export interface Opts {
  reqId: string | null
  phase: string | null
  confirm: string | null
  root: string | null
  run: boolean
}

/** 인자 파싱(fail-closed). 값 자리에 온 옵션을 값으로 삼키지 않는다(REQ-2026-061 r01 P1과 같은 함정). */
export function parseArgs(argv: string[]): Opts {
  const o: Opts = { reqId: null, phase: null, confirm: null, root: null, run: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === undefined || a === '--') continue
    if (a === '--run') o.run = true
    else if (a === '--phase' || a === '--confirm' || a === '--root') {
      const v = argv[++i]
      if (v === undefined || (a !== '--confirm' && v.startsWith('-')))
        throw new Error(`${a} 값이 필요합니다 (받음: ${v ?? '(없음)'})`)
      if (a === '--phase') o.phase = v
      else if (a === '--confirm') o.confirm = v
      else o.root = v
    } else if (a.startsWith('-')) throw new Error(`알 수 없는 옵션: ${a}`)
    else o.reqId = a
  }
  return o
}

/**
 * 확인 문구(순수). **티켓·phase마다 다르다** — 고정 문구면 복사-붙여넣기로 엉뚱한 대상을 재결속한다
 * (`delivery`의 확인 문구와 같은 이유).
 */
export function confirmSentence(reqId: string, phaseId: string): string {
  return `rebind ${reqId} ${phaseId}`
}

export type RebindPlan =
  | { ok: true; from: string; to: string }
  | { ok: false; reason: string; hint: string }

/**
 * 재결속 자격 판정(순수 — 매니페스트 본문만 본다).
 *
 * 🔴 `to`는 **매니페스트의 현재 design_ref**여야 한다(DEC-5). 임의 해시로의 재결속을 받으면
 *    승인되지 않은 설계로 phase를 묶는 경로가 된다.
 */
export function planRebind(manifest: string, phaseId: string): RebindPlan {
  const to = designHashFromManifest(manifest)
  if (!to) return { ok: false, reason: '커밋된 design 승인이 없습니다', hint: '먼저 설계 리뷰를 통과시키세요' }
  const rows = parseManifestEntries(manifest)
  const target = rows.find((e) => e.kind === 'phase' && e.phase_id === phaseId)
  if (!target) return { ok: false, reason: `phase 승인 행이 없습니다: ${phaseId}`, hint: '먼저 그 phase의 리뷰를 통과시키세요' }
  const from = target.phase_design_ref
  if (typeof from !== 'string' || from.length === 0)
    return {
      ok: false,
      reason: `${phaseId}에 phase_design_ref가 없습니다(이 필드 도입 이전 승인)`,
      hint: '재결속 대상이 아닙니다 — 레거시 티켓은 req:close --migrate를 쓰세요',
    }
  if (from === to)
    return { ok: false, reason: `${phaseId}는 이미 현재 설계에 결속돼 있습니다`, hint: '재결속할 것이 없습니다' }
  // 같은 재결속이 이미 있으면 중복 행을 남기지 않는다.
  const already = rows.some((e) => e.kind === 'rebind' && e.phase_id === phaseId && e.to_design_ref === to)
  if (already) return { ok: false, reason: `${phaseId}는 이미 재결속돼 있습니다`, hint: '추가 작업이 필요하지 않습니다' }
  return { ok: true, from, to }
}

export function main(argv: string[] = process.argv.slice(2)): void {
  const o = parseArgs(argv)
  // 🔴 setup 완료 게이트 — 다른 상태 변경 verb와 동일하게 **가장 앞**이다.
  assertSetupComplete({ root: o.root })
  if (!o.reqId) throw new Error('REQ 필요 (예: req:rebind 2026-069 --phase phase-1-x --confirm "…" --run)')
  if (!o.phase) throw new Error('--phase <id> 필요')

  const cfg = loadConfig({ root: o.root })
  const reqId = o.reqId.startsWith('REQ-') ? o.reqId : `REQ-${o.reqId}`
  const ticketRel = relative(cfg.root, join(cfg.workflowDirAbs, reqId)).replace(/\\/g, '/')
  const manifestRel = `${ticketRel}/responses/approvals.jsonl`
  const manifestAbs = join(cfg.root, manifestRel)
  if (!existsSync(manifestAbs)) throw new Error(`승인 매니페스트가 없습니다: ${manifestRel}`)
  const manifest = readFileSync(manifestAbs, 'utf8')

  const plan = planRebind(manifest, o.phase)
  if (!plan.ok) throw new Error(`${reqId} 재결속 불가: ${plan.reason}\n  → ${plan.hint}`)

  console.log(
    `[req:rebind] ${reqId} ${o.phase}: ${plan.from.slice(0, 12)} → ${plan.to.slice(0, 12)}`,
  )
  if (!o.run) {
    console.log(`[req:rebind] DRY-RUN — write 없음. 실행: --confirm "${confirmSentence(reqId, o.phase)}" --run`)
    return
  }

  const want = confirmSentence(reqId, o.phase)
  if ((o.confirm ?? '').trim() !== want)
    throw new Error(
      `확인 문구가 필요합니다 — \`--confirm "${want}"\`\n` +
        '  이 설계 변경이 그 phase의 검수를 무효화하지 않는다는 판단은 **사람의 것**입니다.',
    )

  const row: RebindEntry = {
    kind: 'rebind',
    phase_id: o.phase,
    from_design_ref: plan.from,
    to_design_ref: plan.to,
    confirmation: want,
    // 🔴 실제 시계. 지어낸 타임스탬프는 REQ-2026-019 폐기 사유다.
    confirmed_at: new Date().toISOString(),
  }
  const candidate = manifest + JSON.stringify(row) + '\n'
  // 🔴 쓰기 前 전체 검증 — 오염된 매니페스트 위에 덧쓰지 않는다(fail-closed).
  //    `validPhaseIds`는 **매니페스트 자신의 phase 행**에서 만든다: 이 명령은 커밋된 증거만 다루고,
  //    `state.json`의 phases[]는 스캐폴드 이후 재커밋되지 않아 여기서 오라클이 될 수 없다.
  const validPhaseIds = [
    ...new Set(
      parseManifestEntries(candidate)
        .filter((e) => e.kind === 'phase' && typeof e.phase_id === 'string')
        .map((e) => e.phase_id as string),
    ),
  ]
  const problems = validateManifest(candidate, { ticketRel, validPhaseIds })
  if (problems.length) throw new Error(`재결속 후 매니페스트 검증 실패: ${problems.slice(0, 3).join('; ')}`)

  writeFileSync(manifestAbs, candidate, 'utf8')
  const git = createGitAdapter(cfg.root)
  git.exec(['add', '--', manifestRel])
  git.exec(['commit', '-m', `chore(${reqId}): rebind ${o.phase} → 현재 설계`, '--', manifestRel])
  console.log(`[req:rebind] ✅ 재결속 기록 커밋 — ${o.phase}는 이제 현재 설계에 결속됩니다.`)

  /**
   * 🔴 재결속 **뒤에 완료를 다시 판정**한다(DEC-8).
   *
   * `dev-complete`는 `req:commit`의 evidence-finalize에서만 발행된다. 마지막 phase를 커밋한 뒤에
   * 재결속하면 완료를 다시 볼 계기가 없고 부를 `req:commit`도 남아 있지 않다 —
   * **결속만 고쳐지고 티켓은 그대로 막힌다**(이 REQ 자신에게 적용해 보고 발견했다).
   *
   * 🔴 판정·발행은 `req-commit`의 **정본을 재사용**한다. 직접 재구현하면 두 경로의 완료 판정이
   *    갈라져 한쪽에서만 닫히는 티켓이 생긴다.
   * 🔴 조건이 안 되면 **조용히 넘어간다** — 남은 phase가 있는 중간 재결속은 정상이고,
   *    그때 실패로 만들면 정상 경로가 막힌다.
   */
  const state = loadState(join(cfg.workflowDirAbs, reqId))
  const proof = computeDevCompleteProof({
    ticketId: reqId,
    phaseIds: readPhases(state).map((p) => p.id),
    reviewKind: 'phase',
    manifestContent: candidate,
    nowIso: new Date().toISOString(),
  })
  if (!proof) {
    console.log('[req:rebind] 아직 완료가 아닙니다 — 남은 phase를 마친 뒤 종결됩니다.')
    return
  }
  const cpRel = closeProofPath(ticketRel)
  const before = existsSync(join(cfg.root, cpRel)) ? readFileSync(join(cfg.root, cpRel), 'utf8') : ''
  // 멱등: 이미 같은 행이 있으면 내용이 그대로다(내부에서 duplicate → no-op).
  appendCloseProofRowToDisk(cfg.root, ticketRel, proof)
  const after = existsSync(join(cfg.root, cpRel)) ? readFileSync(join(cfg.root, cpRel), 'utf8') : ''
  if (after === before) {
    console.log('[req:rebind] dev-complete가 이미 있습니다(멱등 — 커밋 없음).')
    return
  }
  git.exec(['add', '--', cpRel])
  git.exec(['commit', '-m', `chore(${reqId}): dev-complete — 재결속으로 완료`, '--', cpRel])
  console.log(`[req:rebind] ✅ dev-complete 발행 — ${reqId} 종결. 이제 다음 REQ를 열 수 있습니다.`)
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  try {
    main()
  } catch (err) {
    console.error(`req:rebind: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  }
}
