/**
 * REQ-2026-085 DEC-6/7 — **부기 커밋 표식**(도구가 만든 커밋과 사람이 쓴 커밋의 구분).
 *
 * ## 왜 필요한가
 * CommitGate는 리뷰 1회·phase 1개마다 원장·증거·state를 **별도 커밋**으로 남긴다. 이건 버그가 아니라
 * 내구성의 대가다 — 특히 원장 `attempt-opened`는 외부 호출이 실패해도 "시도했다"는 사실이 남아야 하므로
 * 호출 **전에** 커밋된다(REQ-2026-052 DEC-A4·A6). 소비 repo 실측에서 108커밋 중 **79개(73%)가 부기**였고
 * 실제 코드 커밋은 23개(21%)였다. 그래서 `git log --oneline`으로 "이 티켓에서 뭐가 바뀌었나"를 읽을 수 없다.
 *
 * ## 해법: 쓰기는 그대로, 읽기만 분리
 * 커밋을 **합치지 않는다**(합치면 내구성이 깨진다). 대신 도구가 만드는 커밋에 trailer 한 줄을 붙여
 * 기계로 걸러낼 수 있게 한다.
 *
 * **왜 trailer이고 subject prefix가 아닌가**: subject는 이미 `chore(REQ-…)`인데 **사람도 같은 형식을 쓴다**.
 * 그걸로 거르면 사람이 쓴 `chore(REQ-…)` 커밋까지 숨는다. trailer는 도구만 쓰는 별도 줄이라 확실히 갈린다.
 *
 * 🔴 **표식은 메시지에만 더한다.** 커밋 경로(pathspec)·순서·개수·내구성 보장은 하나도 바뀌지 않는다.
 */

/** 부기 커밋을 식별하는 trailer 한 줄. 값은 고정 — 파싱 대상이라 형태가 변하면 읽기 명령이 깨진다. */
export const BOOKKEEPING_TRAILER = 'CommitGate-Bookkeeping: true'

/**
 * 부기 커밋을 **제외하고** 로그를 보는 git 인자(= 코드 커밋만 남는다).
 *
 * 🔴 문서(`docs/workflow.md`)와 테스트가 **이 상수 하나**를 쓴다 — 문자열이 갈라지면 문서가 거짓이 된다.
 * `--grep`은 커밋 메시지 전체(본문·trailer 포함)를 보므로 trailer가 걸린다. `^`는 줄 시작 앵커라
 * 본문에 우연히 같은 문구가 인용돼도 줄 첫머리가 아니면 걸리지 않는다.
 */
export const BOOKKEEPING_LOG_EXCLUDE_ARGS: readonly string[] = ['--invert-grep', `--grep=^${BOOKKEEPING_TRAILER}`]

/** 사람이 복사해 쓰는 형태(문서·안내 문구 정본). */
export const BOOKKEEPING_LOG_EXCLUDE_CMD = `git log --oneline ${BOOKKEEPING_LOG_EXCLUDE_ARGS.join(' ')}`

/**
 * 부기 커밋 메시지를 만든다 — subject + 빈 줄 + trailer.
 *
 * 도구가 커밋을 만드는 **모든** 자리가 이 함수를 통과해야 한다. 한 곳이라도 빠지면 그 커밋이
 * 코드 커밋으로 잘못 보인다(읽기 명령의 유일한 실패 모드다).
 *
 * @param subject 기존 커밋 subject. 그대로 첫 줄이 된다 — 호출부의 메시지를 바꾸지 않는다.
 */
export function bookkeepingMessage(subject: string): string {
  return `${subject}\n\n${BOOKKEEPING_TRAILER}`
}
