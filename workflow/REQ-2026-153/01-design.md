# REQ-2026-153 설계

## DEC-1 — 양쪽을 `realpathSync` 로 맞춘 뒤 `relative` 를 구한다

이 저장소는 **같은 교훈을 이미 적어 두었다**(`review-codex.ts` `loadReviewPersona`):

> `rootAbs` 도 realpath 로 정규화한다 — 임시 디렉터리(예: macOS `/tmp` → `/private/tmp`)처럼
> root 자체가 symlink 경유일 때 문자열 비교가 거짓 음성을 내기 때문이다.

`hardBlockedReport` 는 그 규칙을 **root 쪽에만** 적용했다(git 이 해소해 주므로 공짜로). 티켓 경로는
호출자가 준 값 그대로다. 둘을 같은 수준으로 맞춘다.

```ts
const root = resolveReal(git(['rev-parse', '--show-toplevel']))
ticketRel: toTicketRel(root, resolveReal(ctx.ticketDir))
```

- 🔴 **`git` 쪽도 다시 정규화한다.** 지금은 git 이 실경로를 준다고 **가정**하고 있다. 이미 실경로면
  `realpathSync` 는 항등이므로 비용이 없고, 가정이 하나 줄어든다.
- 🔴 **한쪽만 고치면 안 된다.** 티켓만 해소하고 root 를 그대로 두면 반대 방향(root 가 링크 경유,
  티켓이 실경로)에서 같은 붕괴가 난다.

## DEC-2 — 정규화 실패는 **차단을 흔들지 않는다**

`realpathSync` 는 경로가 없으면 던진다. 이 스위트의 첫 오라클은 "보고가 차단을 흔들 수 없다"이고,
실제로 `티켓 디렉터리가 아예 없어도 차단한다` 테스트가 그 경우를 이미 돈다.

```ts
/** 해소되면 실경로, 아니면 입력 그대로(보고는 부수 기능 — 게이트를 흔들지 않는다). */
function resolveReal(p: string): string {
  try {
    return resolve(realpathSync(p))
  } catch {
    return resolve(p)
  }
}
```

- 🔴 **던지지 않는다.** `hardBlockedReport` 는 이미 `try/catch` 로 감싸여 `null` 을 돌려주면 원문
  fallback 이 나가지만, 여기서 던지면 **보고가 통째로 사라진다** — REQ-2026-147 이 만든 값을
  경로 하나 없다고 버릴 이유가 없다.
- 해소 실패 시 종전과 **정확히 같은 동작**(`resolve` 만 적용)으로 떨어진다.

## DEC-3 — `ticketRel` 계산을 순수 함수로 꺼낸다

```ts
/** repo 루트 기준 티켓 상대경로(POSIX). 둘 다 **같은 수준으로 정규화된** 절대경로여야 한다. */
export function toTicketRel(rootReal: string, ticketDirReal: string): string
```

- 🔴 **테스트 가능성이 이유다.** 지금은 이 계산이 `hardBlockedReport` 안에 인라인이라, 정규화가
  빠져도 **실 CLI 를 특정 플랫폼에서 돌려야만** 드러났다(그래서 3주 넘게 살아남았다).
- 역슬래시 → `/` 변환은 **여기서만** 한다. 🔴 이것은 **경로 구분자** 변환이지 파일명 정규화가
  아니다 — `relative()` 가 win32 에서 `\` 를 내므로 POSIX 로 맞추는 것이다.
  (REQ-2026-152 가 금지한 것은 **git 이 준 경로**를 바꾸는 것이다. 여기 입력은 OS 경로다.)
- 🔴 `..` 가 남으면 **그 사실을 감추지 않는다.** 정규화 후에도 티켓이 root 밖이면 그것은 진짜
  이상 상태다 — 값을 그대로 돌려주고, `splitDirty` 는 종전대로 아무것도 매칭하지 않는다.
  (조용히 티켓 안으로 만들어 주면 그게 더 나쁜 거짓말이다.)

## DEC-4 — 링크를 **실제로 만들어** 회귀를 고정한다

```ts
fs.symlinkSync(realRepo, linkPath, 'junction')
```

- 🔴 `'junction'` 은 Windows 에서 **관리자 권한 없이** 만들어지고, 비-Windows 에서는 디렉터리
  심볼릭 링크로 떨어진다 — 플랫폼 무관하게 같은 재현을 만든다(이 세션에서 실측 확인).
- 🔴 **링크 경유 경로로 `hardBlockedReport` 를 부른다**(티켓 디렉터리를 링크 밑으로 준다).
  그러면 root 는 git 이 해소한 실경로, 티켓은 링크 경유 — CI 가 실패한 그 배치 그대로다.
- 🔴 **변이 검사**: `resolveReal` 을 항등 함수로 되돌리면 그 테스트가 red 여야 한다.
  red 가 아니면 재현이 성립하지 않은 것이다(예: 환경이 링크 생성을 막음) — 그때는
  **테스트를 통과시키지 말고 그 사실을 보고한다.**
- 링크 생성이 환경 정책으로 막히면(`EPERM`) **skip 하지 않고 실패**시킨다면 CI 가 불안정해진다.
  🔴 그러나 조용한 skip 은 이 결함을 다시 숨긴다. **순수 함수 테스트(`toTicketRel`)를 항상 돌리고**,
  링크 e2e 는 생성 실패 시 명시적으로 그 사유를 출력하며 skip 한다 — 두 층으로 둔다.

## Phase 분해

단일 phase — `phase-1-hardblocked-path-realpath`. 변경 면적이 작고 오라클이 하나다.

## 변경 파일

`scripts/req/review-codex.ts` · `scripts/req/lib/hardblocked-facts.ts`(`toTicketRel`) ·
`tests/unit/hardblocked-report.test.ts` · `CHANGELOG.md`

## 안전

- 🔴 **차단 경로는 한 글자도 바뀌지 않는다.** 이 REQ 는 보고 입력의 계산만 고친다.
- 🔴 정규화 실패는 종전 동작으로 떨어진다 — 새 실패 지점을 만들지 않는다.
- 이미 실경로인 환경(ubuntu CI·대부분의 개발 머신)에서는 **동작이 동일**하다(`realpathSync` 가 항등).
