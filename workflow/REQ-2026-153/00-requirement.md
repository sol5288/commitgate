# REQ-2026-153 요구

## 결함 — `hard-blocked` 보고가 티켓 안팎을 잘못 나눈다(경로 정규화 불일치)

`hardBlockedReport`(`review-codex.ts`)는 repo 루트를 **git 에게 묻는다**:

```ts
const root = git(['rev-parse', '--show-toplevel'])          // ← realpath 다(git 이 해소한다)
ticketRel: relative(root, ctx.ticketDir).replace(/\\/g, '/') // ← ctx.ticketDir 는 해소되지 않았다
```

두 값이 **다른 정규화 수준**이면 `relative()` 가 `../…` 를 내고, `splitDirty` 의 접두사 매칭
(`ticketRel + '/'`)이 **한 번도 맞지 않는다**. 그러면 티켓 안의 변경이 전부 "티켓 밖 변경"으로
분류돼 보고에 실린다.

### 실측

**① 재현된 불일치**(Windows junction · 이 세션에서 확인):

```
real: …\Temp\rp-R8L5yT      link: …\Temp\rp-link-144764
realpath(link) == real
relative(real, link + '/x')  →  ..\rp-link-144764\x     ← 접두사 매칭 붕괴
```

`git rev-parse --show-toplevel` 도 junction 을 해소해 실경로를 돌려준다(같은 실험에서 확인).

**② CI 증거**: `tests/unit/hardblocked-report.test.ts` 의
"🔴 파손된 아카이브가 있어도 차단하고, 나머지 라운드로 보고를 만든다" 가

| 플랫폼 | 결과 | 이유 |
|---|---|---|
| ubuntu(20·22·24) | ✅ | `/tmp` 가 실경로다 |
| macos(20·22·24) | ❌ | `/var/folders/…` 는 `/private/var/folders/…` 로의 심볼릭 링크 |
| windows(20·22·24) | ❌ | 러너 temp 가 8.3 단축 경로다 |

실패 형태는 `expected '…' not to contain 'r03'` — 파손된 아카이브 파일이 `outsideDirty` 로
분류돼 보고에 딸려 나온다.

🔴 **이것은 REQ-2026-147 부터 main 에 있던 결함이다.** 이 저장소 CI 는 `workflow_dispatch` 수동
전용이라 그동안 실행되지 않았다.

## 영향 범위

- **게이트 차단은 정상이다.** `hard-blocked` 는 여전히 throw 한다 — 보고는 부수 기능이고,
  그 계약("보고가 차단을 흔들 수 없다")은 지켜지고 있다.
- 틀리는 것은 **보고 내용**이다: 티켓 안의 변경을 "티켓 밖"으로 적어 사람을 잘못 안내한다.
- 소비자 중 repo 경로에 심볼릭 링크·junction 이 끼는 경우(macOS `/Users/x/work` 링크, Windows
  개발 드라이브 junction)에 실제로 발생한다 — 임시 디렉터리만의 문제가 아니다.

## 요구

1. `hardBlockedReport` 가 **양쪽을 같은 수준으로 정규화**한 뒤 `relative` 를 계산한다.
2. 정규화가 실패해도(경로 부재 등) **차단은 그대로**다 — 보고가 게이트를 흔들면 안 된다.
3. 심볼릭 링크·junction 경유 경로를 **실제로 만드는** 회귀 테스트를 둔다(플랫폼 무관).

## 범위 밖

- 다른 곳의 경로 처리 일반 정리 — 이 결함이 관측된 자리만 고친다.
- CI 트리거 정책(수동 전용) 변경.
