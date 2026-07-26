# REQ-2026-065 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

| 축 | 현재 | 근거 |
|---|---|---|
| probe | `createReviewerProbes()` — `version()`/`auth()`/`login()` | `lib/adapters.ts`(REQ-2026-060) |
| auth 분류 | `logged-in` / `logged-out` / `unknown` + `reason` | `classifyAuthOutput` |
| 리뷰 흐름 | … step 3 예산 gate + attempt-opened(state) → **step 4 원장 append + pre-call 커밋** → step 7 호출 | `review-codex.ts` |
| 실패 분류 | spawn 실패 = `pre-dispatch`(환불) / exit≠0 = `dispatched`(차감) | `adapters.ts`의 `ReviewCallError` |
| 주입 seam | `main(argv, { reviewer })` — 테스트가 리뷰어를 갈아 끼운다 | `review-codex.ts` |

**핵심**: 원장 기록(step 4)이 호출(step 7)보다 **앞**이다. 그래서 확인은 **step 3보다도 앞**이어야 한다.

## 핵심 설계 결정

### DEC-1 — 🔴 probe 지점은 **예산 gate·원장 기록보다 앞** (C1)
```
① short-circuit 판정  … 기존
② 🔴 auth preflight   … 신규 — 여기가 유일하게 옳은 자리
③ 예산 gate + attempt-opened(state)
④ 원장 append + pre-call 커밋
…
⑦ 실제 호출
```
③·④ 뒤에 두면 **고아 attempt가 남고 예산이 이미 소모**된다 — 이 REQ가 막으려는 상태 그 자체다.

### DEC-2 — 순서: **version → auth**
미설치를 인증 문제로 오진하지 않는다. `version()`이 실패하면 auth는 물어볼 것도 없다.

### DEC-3 — 🔴 `logged-out`만 차단, `unknown`은 **WARN 후 진행** (C3)
```ts
if (!version.ok)             → throw (설치 안내)
else if (auth === 'logged-out') → throw (로그인 안내)
else if (auth === 'unknown')    → console.warn(...) 후 계속
```
근거는 오탐 비용의 비대칭(요구사항 C3). auth probe는 **진단이지 승인 무결성 게이트가 아니다** —
미로그인이 만들 수 있는 최악은 *실패한 리뷰*이지 *미리뷰 커밋*이 아니다.
`unknown`을 차단하면 codex가 출력 형식을 바꾼 날 **전 소비자가 동시에 멈춘다.**

### DEC-4 — `--run`일 때만 확인 (비목표)
`--dry-run`은 외부 호출을 하지 않으므로 로그인이 필요 없다. 확인하면 **아무 이유 없이 dry-run을 막는다.**

### DEC-5 — bypass 플래그 없음 (C2)
`--skip-auth-probe` 류를 만들지 않는다. 대신 **차단 조건 자체를 좁게** 잡아(`logged-out`만)
탈출구가 필요 없게 만든다 — 이것이 DEC-3의 또 다른 근거다.

### DEC-6 — probe 주입 seam
`main(argv, { reviewer, probes })`로 `probes`를 받는다(기본 = `createReviewerProbes()`).
테스트가 live codex 없이 `logged-out`·`unknown`·미설치 세 경로를 돈다.
🔴 **기존 `reviewer` 주입과 같은 형태**라 새 관례를 만들지 않는다.

### DEC-7 — 메시지는 실행 가능해야 한다 (R3)
- 미설치: 설치·PATH 확인 + `commitgate check`로 진단.
- 미로그인: **사용자에게** `commitgate setup`(대화형) 또는 `codex login` 실행을 요청.
  🔴 "실행하라"가 아니라 "요청하라" — setup은 사람 전용 명령이다(`AGENTS.md`).
- 두 메시지 모두 **예산이 차감되지 않았다**는 사실을 알린다(사용자가 가장 먼저 걱정하는 것).

## Phase별 구현

| phase | 내용 | 코드 파일 |
|---|---|---|
| **phase-1** | preflight 배선 + probe 주입 seam(DEC-1~DEC-7) | 2 |
| **phase-2** | 문서(한/영)·CHANGELOG | 0(docs) |

## 변경 파일

- `scripts/req/review-codex.ts` — preflight + `probes` 주입
- `tests/unit/req-review-codex.test.ts`
- `docs/troubleshooting{,.en}.md` · `CHANGELOG.md`

## 하위호환·안전

- **정상 경로 무영향**: 로그인된 사용자는 probe 2회(`--version`·`login status`)가 추가될 뿐이다.
  둘 다 부작용 없는 조회이고 리뷰 호출 자체보다 훨씬 싸다.
- **`unknown` 관대**(DEC-3): codex 출력이 바뀌어도 전 소비자가 멈추지 않는다.
- **dry-run 무영향**(DEC-4).
- **예산·원장 보호**(DEC-1): 차단은 예산 gate 이전이므로 차감도 원장 기록도 일어나지 않는다.
- **우회 없음**(DEC-5): 플래그를 만들지 않는다. 대신 차단 조건을 좁게 잡는다.

### 미측정 (정직성 경계)

- **로그아웃 상태의 `codex login status` 실제 출력·exit code** — 로그아웃할 수 없어 여전히 미측정이다.
  그래서 `classifyAuthOutput`은 exit code 단독 판정을 하지 않고 `unknown`을 남기며, DEC-3이 그것을
  차단하지 않는다. 이 설계는 **그 미측정을 전제로 안전한 쪽**이다.
