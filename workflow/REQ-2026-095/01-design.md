# REQ-2026-095 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

- `req-next.ts` — `COMMIT_MESSAGE_PLACEHOLDER`(상수) · `commitCmd`(AWAIT_HUMAN 경로) ·
  `autoCommitCmd`(LOW 자동 RUN 경로)가 모두 `-m <자리표시자>`를 싣는다. 두 액션은
  `detail`·`command`(+AWAIT_HUMAN이면 `controlPoint`·`approvalSentence`)를 갖고,
  `renderAction`이 `diagnostics`를 `  - <줄>`로 덧붙인다.
- `req-commit.ts` — `parseArgs`가 `--message-file`만 받는다(`-F` 없음).
  `resolveMessageSource`가 상호배타·필수·env fallback·절대경로·존재검증을 담당한다.
  🔴 **기능은 이미 있다**(REQ-2026-018). 없는 것은 **별칭과 안내**다.
- `AGENTS.template.md` — 명령표에 `--message-file`이 있으나, "RUN 명령을 그대로 실행"이 계약이라
  실제로 실행되는 것은 `req:next`가 낸 `-m` 형태다.

## 핵심 설계 결정

### DEC-1 — RUN 명령은 **건드리지 않는다.** 안내를 옆에 붙인다

`req:next`의 커밋 명령은 **그대로 실행 가능해야 한다**(REQ-2026-058 F-3이 실측으로 세운 계약 —
자리표시자가 없으면 doctor 17개를 통과한 뒤 `커밋 메시지 필요`로 죽어 사용자가 게이트 탓으로 오해했다).
`--message-file <경로>`로 바꾸면 에이전트가 **파일을 먼저 써야** 해서 RUN이 자기완결적이지 않게 된다.

→ `-m <자리표시자>` 명령은 그대로 두고, 같은 출력의 **`diagnostics`에 여러 줄 경로를 덧붙인다.**
`renderAction`이 이미 `diagnostics`를 렌더링하므로 **렌더러 변경이 없다**.

자리표시자 문자열도 바꾼다: `"<이 phase의 conventional 커밋 메시지>"` →
`"<이 phase의 conventional 커밋 메시지(한 줄)>"`. **제약을 자리표시자 자신이 말하게** 한다 —
diagnostics를 안 읽어도 눈에 들어온다.

### DEC-2 — 안내 문구는 **실측을 담는다**

```
  - 여러 줄 메시지(본문 포함)는 -m 으로 넘기지 마세요 — npm·pnpm·npx가 argv의 개행을
    잘라내거나 리터럴 \n 으로 바꿉니다(Windows 실측). 파일로 넘기세요:
      <메시지를 파일에 쓴 뒤>  npm run req:commit -- <target> --run --message-file <path>
```

- 🔴 **"pnpm 버그"라고 쓰지 않는다.** npm·npx도 같고, npm 쪽이 더 나쁘다(조용히 잃는다).
  범인을 좁게 지목하면 npm 사용자가 자기는 안전하다고 오해한다.
- 명령 예시는 **현재 packageManager로 조립**한다(`buildScriptInvocation` 재사용) — 소비자가
  자기 저장소에서 그대로 쓸 수 있어야 한다.

### DEC-3 — `-F` 별칭 (R2)

`parseArgs`에서 `-F`를 `--message-file`과 같은 자리로 받는다. `git commit -F`와 같은 규약이라
학습 비용이 0이고, 리포트가 명시적으로 요청했다. 동작·검증은 전부 기존 `resolveMessageSource` 재사용.

### DEC-4 — 붕괴 의심 경고: **탐지 가능한 것만, 차단 없이** (R3)

`-m` 값이 다음을 **모두** 만족하면 경고한다.

1. 리터럴 두 글자 `\n`을 포함한다.
2. **실제 개행이 하나도 없다.**

→ pnpm 계열의 재직렬화 흔적이다. 🔴 **자동 복원하지 않는다** — 본문에 정말 `\n`이라고 적은 경우
(이 저장소의 CHANGELOG·문서가 실제로 그런다)와 구별할 수 없다. 복원하면 그쪽을 조용히 망가뜨린다.

🔴 **차단하지 않는다.** 오탐이 커밋을 막으면 정당한 메시지를 쓴 사람이 진행할 수 없다.
그리고 **npm의 조용한 절단은 이 경고로 잡히지 않는다** — 받은 문자열이 그냥 짧을 뿐 흔적이 없다.
그 한계를 문구에 적어 사용자가 "경고가 없으니 안전하다"고 오해하지 않게 한다.

판정은 **순수 함수**(`looksLikeCollapsedMessage`)로 분리해 테스트가 문구가 아니라 판정을 고정한다.

🔴 **경고는 doctor·게이트보다 앞에서 낸다**(설계 r01 P1 대응). 두 이유가 겹친다.
① 자문이므로 커밋 성사 여부와 무관하게 사용자에게 보여야 한다.
② **배선 관측 테스트가 가능해진다** — 뒤 단계가 실패해도 경고는 이미 나와 있다.
순수 판정과 무-throw만 고정하면 **출력 배선이 통째로 빠져도 모든 테스트가 통과**한다(02-plan 가드 9).

### DEC-5 — 자동 커밋 경로도 같은 안내를 받는다

`autoCommitCmd`(LOW 자동)와 `commitCmd`(사람 확인) 둘 다 `-m`을 싣는다. 안내는 **두 경로 모두**에
붙인다 — 한쪽만 고치면 다른 쪽이 조용히 함정으로 남는다(이 저장소가 세 REQ 연속으로 겪은
"새 절 추가 ≠ 전수 갱신"의 같은 함정).

## Phase별 구현

단일 phase. 변경이 작고 서로 얽혀 있어(안내 문구·별칭·경고가 모두 "메시지 전달" 한 축) 나누면
리뷰 면적만 늘어난다.

## 변경 파일

| 파일 | 내용 |
|---|---|
| `scripts/req/req-next.ts` | 자리표시자 문구 + `diagnostics` 안내(DEC-1·2·5) |
| `scripts/req/req-commit.ts` | `-F` 별칭(DEC-3) + `looksLikeCollapsedMessage` 경고(DEC-4) |
| `docs/troubleshooting.md`·`.en.md` | 증상·실측표·해법 |
| `docs/workflow.md`·`.en.md` | 커밋 단계에 "여러 줄은 `--message-file`" 명시 |
| `CHANGELOG.md` | 0.16.0 항목에 합류 |
| `tests/unit/req-next.test.ts`·`req-commit.test.ts` | 안내·별칭·경고 판정 |

## 하위호환·안전

- **차단이 새로 생기지 않는다.** 경고 한 줄과 안내 문구가 전부다.
- **한 줄 메시지의 동작은 동일**하다. `req:next` 명령의 **구조**(`-m <자리표시자>`)와 **그대로 실행
  가능함**도 그대로다. 바뀌는 것은 자리표시자 **표기**뿐이며, R5가 무회귀 대상을 구조·실행 가능성으로
  정의한다(문구는 대상이 아니다).
- `-F`는 **순수 추가**다. 기존 `--message-file`·`REQ_COMMIT_MESSAGE_FILE`은 그대로.
- 🔴 이 REQ는 **상류를 고치지 못한다.** npm의 조용한 절단은 남는다 — 우리가 할 수 있는 것은
  사용자를 안전한 경로로 보내는 것뿐이고, 문서가 그 한계를 정직하게 말한다.
