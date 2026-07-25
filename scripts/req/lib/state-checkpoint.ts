/**
 * 티켓 `state.json`의 **durable checkpoint** (REQ-2026-057).
 *
 * 존재 이유: 승인 증거(`responses/**`)는 커밋되는데 그 승인을 반영한 **작업 상태는 커밋되지 않아**,
 * 티켓을 정상 완주해도 `state.json`이 dirty로 남는다. 그 결과 (1) 다음 `req:new`가 clean-tree 게이트에서
 * 막히고(`lib/scratch.ts`의 `isToolOutputScratch`는 `state.json`을 **의도적으로** 제외한다),
 * (2) 계약이 시키는 대로 그 변경을 버리면 커밋된 증거가 있는데도 `req:next`가 재리뷰를 요구한다.
 * 남겨도 막히고 버려도 안 되는 상태를 없애려면 상태가 증거와 함께 Git에 남아야 한다.
 *
 * 🔴 **leaf 모듈이다.** `review-codex`·`req-commit` 양쪽이 값으로 import하므로 여기서 그것들을 값으로
 *    import하면 런타임 순환이 생긴다(`lib/scratch.ts`가 leaf인 이유와 같다). 상태 타입은
 *    `import type`(컴파일 시 소거)으로만 받는다.
 *
 * 🔴 **증거 커밋에 상태를 끼워 넣지 않는다**(설계 DEC-1). 그러려면 `req-commit`의 "`responses/` 외 staged
 *    금지" 가드를 완화해야 하는데, 그 가드는 코드/state 누수를 막는 마지막 방어선이다. 대신 티켓
 *    `state.json` **한 경로만** 담는 자기 커밋을 낸다 — `precallCommitLedgerRow`와 같은 pathspec 관용구다.
 *
 * ⚠️ 원자성: 증거 커밋과 이 커밋 사이에서 중단되면 `state.json`이 dirty로 남는다. 그것은 **이 REQ 이전의
 *    기존 동작**이므로 회귀가 아니고, 재실행(멱등)이나 다음 경계의 checkpoint가 흡수한다.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** `state.json` 직렬화의 **단일 지점**. `review-codex`의 `writeState`가 이 함수를 쓴다(포맷 드리프트 금지). */
export function serializeState(state: unknown): string {
  return `${JSON.stringify(state, null, 2)}\n`
}

export interface StateCheckpointArgs {
  /** 소비 저장소 루트(절대 경로). */
  root: string
  /** 티켓 디렉터리의 repo-상대 경로(예: `workflow/REQ-2026-057`). */
  ticketRel: string
  /** 대상 티켓 id. 디스크 상태의 `id`와 대조한다. */
  ticketId: string
  /** 호출자가 **방금 `writeState`로 기록한** 상태 객체. 디스크 내용과 바이트 대조한다. */
  state: { id?: unknown }
  /** 커밋 메시지에 들어갈 사유(예: `design 승인`, `phase phase-1-x 소비`). */
  reason: string
  /** git 실행기(호출부의 어댑터를 그대로 받는다 — 테스트가 주입 가능). */
  gitFn: (args: string[]) => string
}

/**
 * 티켓 `state.json`을 pathspec 커밋한다.
 *
 * @returns 커밋했으면 `true`, **변경이 없어 무동작이면 `false`**(멱등 — 빈 커밋을 만들지 않는다).
 *
 * fail-closed 조건(둘 다 커밋 없이 throw):
 *   - 디스크 내용이 `state`의 직렬화와 다르다 → 외부 편집·경쟁 쓰기. 도구가 쓴 값만 커밋한다.
 *   - 디스크 상태의 `id`가 `ticketId`와 다르다 → 다른 티켓 상태를 이 티켓 커밋에 싣지 않는다.
 */
export function commitStateCheckpoint(args: StateCheckpointArgs): boolean {
  const { root, ticketRel, ticketId, state, reason, gitFn } = args
  const stateRel = `${ticketRel}/state.json`
  const stateAbs = join(root, ...stateRel.split('/'))

  // 멱등: 워킹트리·인덱스 어느 쪽에도 변화가 없으면 낼 커밋이 없다.
  if (gitFn(['status', '--porcelain', '--', stateRel]).trim() === '') return false

  if (!existsSync(stateAbs)) throw new Error(`state checkpoint 거부: ${stateRel} 이 없습니다.`)
  const onDisk = readFileSync(stateAbs, 'utf8')
  if (onDisk !== serializeState(state))
    throw new Error(
      `state checkpoint 거부: ${stateRel} 의 디스크 내용이 도구가 기록한 상태와 다릅니다(외부 편집·경쟁 쓰기 의심) — 커밋하지 않았습니다.`,
    )

  // `state`가 아니라 **디스크**의 id를 본다 — 커밋되는 것이 디스크 내용이기 때문이다.
  // (위 바이트 대조를 통과했으므로 두 값은 같지만, 판정 대상을 커밋 대상과 일치시켜 둔다.)
  const diskId = (JSON.parse(onDisk) as { id?: unknown }).id
  if (diskId !== ticketId)
    throw new Error(`state checkpoint 거부: ${stateRel} 의 id(${String(diskId)})가 대상 티켓(${ticketId})과 다릅니다.`)

  // 🔴 pathspec 커밋 — 이 경로만. 사용자가 stage해 둔 코드/문서는 인덱스에 그대로 남는다.
  gitFn(['add', '--', stateRel])
  gitFn(['commit', '-m', `chore(${ticketId}): state checkpoint — ${reason}`, '--', stateRel])
  return true
}
