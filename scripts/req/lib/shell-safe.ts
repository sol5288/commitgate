/**
 * 셸 인수 안전 판정(REQ-2026-149) — 안내 명령에 박히는 **모든 파생값**의 단일 관문.
 *
 * 🔴 **허용 목록이지 금지 목록이 아니다.** 셸마다 특수문자가 다르다:
 *    - PowerShell 5.1 은 `&&` 를 모르고, cmd.exe 는 `;` 를 명령 구분자로 쓰지 않는다.
 *    - **cmd.exe 는 큰따옴표 안에서도 `%VAR%` 를 확장한다** — 인용해도 안전하지 않다.
 *    - `!VAR!` 는 delayed expansion 이 켜진 cmd.exe 에서 확장된다.
 *    금지 목록은 새 셸·새 문자가 나올 때마다 뚫린다. 허용 목록은 **모르는 문자를 기본 거부**한다.
 *
 * 🔴 **`#` 을 반드시 포함한다.** 모든 `series_id` 가 `…#<seq>` 형태(`design:-#1`)라, 빼면
 *    `--close-stale`·`--resolve --series` 안내가 **정상 상태에서 통째로 사라진다** — "실행 가능한
 *    명령을 안내한다"는 요구를 정면으로 어긴다. `#` 은 큰따옴표 안에서 bash·PowerShell·cmd.exe
 *    셋 다 리터럴이다.
 *
 * 🔴 **공백은 포함하지 않는다.** 인용 규칙이 셸마다 갈린다. 공백이 든 `ticketRoot` 는 명령 대신
 *    데이터로 안내한다(문서화된 제약).
 *
 * 🔴 **leaf 다.** 안내를 내는 모든 곳이 이것을 쓴다 — 각자 판정하면 갈라진다.
 */

/**
 * 세 셸(bash · PowerShell 5.1+ · cmd.exe)에서 큰따옴표 안 **리터럴**로 남는 문자만.
 *
 * 포함 근거: branch(`feat/req-2026-149-x`) · REQ id(`REQ-2026-149`) · 티켓 경로(`workflow/REQ-…`) ·
 * series_id(`design:-#1`·`phase:phase-1-x#2`) · slug 를 전부 담는다.
 */
const SAFE_ARG_RE = /^[A-Za-z0-9._/@+=:#-]+$/

/**
 * 이 값을 큰따옴표로 감싸 명령에 넣어도 세 셸에서 **그대로** 전달되는가.
 *
 * 🔴 값이 어디서 왔든 **렌더링 직전에** 부른다. `successorSlug` 처럼 branch 에서 **파생된** 값도
 *    검사해야 한다 — `feat/req-…-%PATH%` 는 `%PATH%-successor` 가 되어 cmd.exe 에서 확장된다.
 */
export function shellSafeArg(v: unknown): boolean {
  return typeof v === 'string' && v.length > 0 && SAFE_ARG_RE.test(v)
}

/** 여러 값이 **전부** 안전한가. 하나라도 아니면 그 갈래의 명령을 만들지 않는다. */
export function allShellSafe(...vs: unknown[]): boolean {
  return vs.every((v) => shellSafeArg(v))
}

/** 안전한 값을 명령에 넣을 형태로 감싼다. 🔴 안전 판정을 통과한 값에만 쓴다. */
export function quoteArg(v: string): string {
  return `"${v}"`
}
