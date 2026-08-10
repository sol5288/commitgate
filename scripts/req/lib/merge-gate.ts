/**
 * MergeGate 순수 코어 — REQ-2026-126 phase-2.
 *
 * `commitgate integrate`(feature→trunk 로컬 통합)의 전제 판정·차단 사유·실행 계획을 소유한다.
 * git/fs/network/clock을 모른다 — bin이 사실(facts)을 수집해 넣고, 반환된 plan을 그대로 렌더/실행한다
 * (실행 순서를 bin이 하드코딩하지 않는다 — 설계 r04 P1).
 *
 * 🔴 integrate는 **항상 strict**다: 미입증 커밋·manifest 문제가 있으면 병합하지 않는다.
 *    verify-range의 보고 모드(기본 exit 0)와 구별되는 존재 이유다.
 */

export interface IntegrationFacts {
  currentBranch: string
  trunkBranch: string | null
  branchPrefix: string
  worktreeClean: boolean
  /** 진행 중 merge/rebase — 독립 사실이다. 각각 단독으로도 거부한다(설계 r02 P1). */
  mergeInProgress: boolean
  rebaseInProgress: boolean
  trunkExists: boolean
  /** verify-range 코어 산출 — null = 아직 계산 불가(전제 실패 등). 미입증 목록을 보존한다(설계 r03 P1). */
  verify: {
    counts: { merge: number; bookkeeping: number; approved: number; unproven: number }
    manifestProblems: number
    unproven: { sha: string; subject: string }[]
  } | null
}

export interface IntegrationPlan {
  ok: boolean
  /** 차단 사유(사람용) — 미입증은 각 커밋(sha 8자리·subject)이 줄로 포함된다. */
  problems: string[]
  /** ok일 때 실행 단계(순서 있는 렌더 가능 계획). 차단이면 빈 배열. */
  steps: string[]
}

/** 전제 + strict 증거 판정. 전부 평가해 사유를 한 번에 보여준다(하나 고치면 다음이 나오는 두더지잡기 방지). */
export function planIntegration(f: IntegrationFacts): IntegrationPlan {
  const problems: string[] = []

  if (f.trunkBranch === null) problems.push('trunkBranch가 null입니다(req.config.json) — 통합 대상 trunk가 없습니다')
  else if (!f.trunkExists) problems.push(`trunk 브랜치가 로컬에 없습니다: ${f.trunkBranch}`)

  if (f.trunkBranch !== null && f.currentBranch === f.trunkBranch)
    problems.push(`trunk(${f.trunkBranch}) 위에서 실행했습니다 — integrate는 feature 브랜치에서 실행합니다(자기 병합 금지)`)
  else if (!f.currentBranch.startsWith(f.branchPrefix))
    problems.push(`현재 브랜치(${f.currentBranch})가 feature 브랜치가 아닙니다(branchPrefix: ${f.branchPrefix})`)

  if (!f.worktreeClean) problems.push('워킹트리가 clean 하지 않습니다 — 자동 stash 하지 않습니다. 변경을 커밋하거나 정리하세요')
  if (f.mergeInProgress) problems.push('진행 중인 merge가 있습니다(MERGE_HEAD) — 먼저 완료하거나 중단하세요')
  if (f.rebaseInProgress) problems.push('진행 중인 rebase가 있습니다 — 먼저 완료하거나 중단하세요')

  if (f.verify === null) {
    problems.push('승인 증거 검증을 수행할 수 없었습니다 — 위 전제를 해소한 뒤 다시 실행하세요')
  } else {
    if (f.verify.counts.unproven > 0) {
      problems.push(`미입증 커밋 ${f.verify.counts.unproven}건 — integrate는 strict입니다(승인 증거 없는 커밋은 병합하지 않음):`)
      for (const u of f.verify.unproven) problems.push(`  ? ${u.sha.slice(0, 8)} ${u.subject}`)
    }
    if (f.verify.manifestProblems > 0)
      problems.push(`approvals.jsonl 파싱 문제 ${f.verify.manifestProblems}행 — 증거 손상을 해소해야 병합할 수 있습니다`)
  }

  if (problems.length > 0) return { ok: false, problems, steps: [] }
  return {
    ok: true,
    problems: [],
    steps: [
      `git checkout ${f.trunkBranch}`,
      `git merge --no-ff ${f.currentBranch}`,
      `감사 로그 1행 기록(workflow/.integrate-runs.jsonl) — push는 하지 않습니다`,
    ],
  }
}

export type CiRunDecision = 'run' | 'skip' | 'ask' | 'fail-no-config'

/**
 * CI 실행 여부 결정(설계 DEC-2). 생략은 정상 상태다.
 * flag: true=`--run-github-ci` · false=`--no-github-ci` · null=미지정.
 */
export function decideCiRun(opts: { flag: boolean | null; configured: boolean; interactive: boolean }): CiRunDecision {
  if (opts.flag === true) return opts.configured ? 'run' : 'fail-no-config'
  if (opts.flag === false) return 'skip'
  // 미지정: config가 있고 대화형일 때만 묻는다. config가 없으면 질문 자체를 생략(정상).
  if (opts.configured && opts.interactive) return 'ask'
  return 'skip'
}
