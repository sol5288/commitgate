# REQ-2026-083 설계 — 막힌 자리에서 다음 명령을 준다

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

"codex가 없다" 또는 "setup이 안 끝났다"를 말하는 **런타임 표면이 4곳**인데, 각자 다른 말을 한다.

| # | 표면 | 위치 | 지금 하는 말 | 설치 명령 | setup 언급 |
|---|---|---|---|---|---|
| S1 | `init` 설치 후 안내 | `bin/init.ts` `installGuidance` | `3. codex --version   # 리뷰 실호출 전제` | ❌ | 🔴 **0회** |
| S2 | `setup` codex 미설치 | `bin/setup.ts:612-615` | `설치·PATH 를 확인한 뒤 다시 실행하세요` | ❌ | — |
| S3 | `check` C2 실패 | `bin/check.ts:62` | `설치·PATH 를 확인하세요` | ❌ | — |
| S4 | `--help` | `bin/init.ts` `HELP_TEXT` | `npm i -g @openai/codex` | ✅ | ✅ |

S4만 0.12.1(REQ-2026-082)에서 고쳐졌고 나머지 셋은 그대로다. 🔴 **막힌 사용자가 실제로 보는 것은
S1~S3이지 S4가 아니다** — `--help`는 막히기 **전에** 치는 명령이다.

## 핵심 설계 결정

### DEC-1 — 🔴 S1의 결함은 "누락"이 아니라 **틀린 순서**다

`installGuidance`에 setup 한 줄을 끼워 넣는 것으로는 부족하다. 지금 안내는 **따라 하면 막히는 절차**다 —
마지막 `req:new`가 setup 미완료로 차단된다. 고쳐야 하는 것은 **순서**다.

🔴 **setup은 설치 커밋 _앞_이다.**

```
현재:  … → 설치 커밋 → 무관한 변경 정리 → req:new                     ← req:new 에서 막힌다
개선:  … → setup → 설치 커밋 → 무관한 변경 정리 → req:new
```

**정정 이력(phase-1 r01 P1).** 이 설계는 처음에 setup을 **설치 커밋 뒤**에 뒀다. 근거는
"setup이 `req.config.json`을 바꿔 dirty해지므로 '설치분만 stage' 지시와 충돌한다"였는데, **틀렸다.**
그렇게 두면 setup이 만든 config 변경이 커밋되지 않은 채 남아 **바로 다음 `req:new`가 clean-tree 게이트에서
막힌다** — 막히는 자리를 8번에서 그 직전으로 옮겼을 뿐이다.

전제가 틀렸던 지점: `req.config.json`은 **그 자체가 설치 산출물**이라 `planArtifactPaths`의 `extras`에
**항상** 들어가고(`plan.configRel`), 따라서 안내가 인쇄하는 `git add --` 목록에 이미 포함돼 있다.
setup을 커밋 앞에 두면 그 변경이 **같은 설치 커밋에 자연히 담긴다** — 추가 커밋 단계가 필요 없다.
이것은 `docs/quick-start.md:26`이 이미 안내하는 흐름과 같다("setup은 `req.config.json`을 바꾸므로 …
아래 설치 커밋에 함께 담으세요").

🔴 **두 반환 경로 모두**에 적용한다 — 정상 경로와 `unsafe` 조기 반환 경로. 한쪽만 고치면
그 조건에 걸린 사용자만 막힌다. `unsafe` 경로에서도 setup 안내는 **커밋 지시보다 앞**이어야 한다.

### DEC-2 — 🔴 불변식으로 세운다: **"codex가 없다"고 말하는 곳은 설치 명령을 함께 준다"**

S2·S3에 문자열을 각각 덧붙이는 것으로 끝내면 다음에 표면이 하나 늘 때 또 빠진다(S4를 고치고 S1~S3을
놓친 것이 정확히 그 실패다). **공유 상수**를 하나 두고 세 표면이 그것을 쓰게 한다.

```ts
/** codex 미설치를 말하는 모든 표면이 함께 주는 다음 명령. 표기를 한 곳에서 고정한다. */
export const CODEX_INSTALL_HINT = '설치: npm i -g @openai/codex  (설치 후 새 터미널에서 codex --version)'
```

🔴 **새 터미널 안내를 함께 넣는 이유**: Windows에서 전역 설치 직후 `codex`를 못 찾는 것은 PATH 갱신
문제이고(`docs/quick-start.md:138` 실측), 이때 사용자는 "설치가 실패했다"고 오해한다.
설치 명령만 주고 이 사실을 빼면 **같은 자리에서 두 번 막힌다.**

상수의 소유 위치는 `scripts/req/lib/adapters.ts`(probe와 같은 모듈)로 한다 — `bin/init.ts`·`bin/setup.ts`·
`bin/check.ts` 셋 다 이미 그 모듈에 의존하므로 새 의존 방향이 생기지 않는다.

### DEC-3 — 🔴 B(미로그인) 경로는 **건드리지 않는다**

실측에서 정상 동작을 확인했다 — 안내 → `codex login` 실제 호출 → 재검증 → 실패 시 실행 가능한 메시지.
고칠 것이 없는 곳을 만지면 **회귀 위험만 새로 만든다.** 이 REQ의 diff에 `setup.ts:628-639`가 들어가면 안 된다.

### DEC-4 — 회귀 가드는 **두 불변식**을 각각 고정한다

REQ-2026-082의 `--help` ↔ dispatch 교차 검증과 같은 형태로, **두 독립 아티팩트를 대조**한다.

| 가드 | 오라클 | 어디에 |
|---|---|---|
| **G-A** 순서 | `installGuidance` **두 경로 모두**에서 `commitgate setup` 위치 < `git commit` 위치 < `req:new` 위치 | `tests/unit/init.test.ts` |
| **G-B** 동반 | codex 미설치를 말하는 세 문자열이 **전부** `CODEX_INSTALL_HINT`를 포함한다 | `tests/unit/codex-missing-guidance.test.ts`(신규) |

🔴 **G-A는 세 지점의 순서를 전부 고정한다**(setup < commit < req:new). "setup이 req:new보다 앞"만 보면
phase-1 r01이 잡아낸 결함 — setup이 커밋 **뒤**에 있어 config 변경이 미커밋으로 남는 상태 — 를 통과시킨다.
`unsafe` 경로는 번호가 아니라 문구로 커밋을 지시하므로, 두 경로에 각각 맞는 앵커를 쓴다.

🔴 **G-B의 대상 목록을 하드코딩하지 않는다.** "세 문자열"을 테스트가 손으로 나열하면 네 번째 표면이
생겼을 때 조용히 통과한다 — 이 REQ가 고치는 실패 그 자체다. 각 표면이 **메시지 빌더 함수를 export**하고,
테스트는 그 함수들을 한 배열로 모아 검사한다. 표면 추가 시 빌더를 만들지 않으면 리뷰에서 드러나고,
만들었는데 배열에 안 넣으면 **그건 여전히 구멍**이다 — 그래서 배열 자체에
"새 표면을 추가하면 여기에 등록한다"는 주석을 달고, **개수 하한 단언**(≥3)으로 공회전을 막는다.
(완전 자동 발견은 정적 스캐너가 필요하고, REQ-2026-044에서 그 접근이 설계 5R 미수렴으로 폐기됐다 —
같은 함정에 다시 들어가지 않는다.)

🔴 두 가드 모두 **변이 검사로 실제 검출을 확인**한다. REQ-2026-082에서 `setup`이 도움말에 두 번 등장해
한 줄을 지워도 가드가 통과한 전례가 있다 — 검사 대상 문자열이 **유일하게 등장하는지** 먼저 확인한다.

### DEC-5 — 표기를 통일한다

현재 `npm i -g @openai/codex`(`--help`)와 `npm install -g @openai/codex`(`docs/quick-start*`)가 섞여 있다.
`CODEX_INSTALL_HINT` 한 곳에서 정하고 런타임 표면은 전부 그것을 쓴다.
🔴 문서(`docs/quick-start*`)의 기존 표기는 **바꾸지 않는다** — 문서는 별도 축이고, 이 REQ가 손대면
`readme-landing`·`docs:lint`가 검증하는 문서 축까지 diff에 섞여 리뷰 면적이 넓어진다.

## Phase별 구현

| phase | 범위 | 파일 |
|---|---|---|
| `phase-1-runtime-guidance` | DEC-1·2·5 — 상수 도입 + S1·S2·S3 배선 | `scripts/req/lib/adapters.ts` · `bin/init.ts` · `bin/setup.ts` · `bin/check.ts` |
| `phase-2-guards` | DEC-4 — 두 회귀 가드 + 변이 검사 | `tests/unit/init.test.ts` · `tests/unit/codex-missing-guidance.test.ts`(신규) |
| `phase-3-changelog` | CHANGELOG | `CHANGELOG.md` |

🔴 phase-3의 CHANGELOG는 **앞 phase 성과를 알린다** — REQ-2026-082 phase-3이 이것 때문에 diff-scoped
리뷰에서 2회 반려됐다. 처음부터 **phase별 구현 커밋·확인할 파일 표**를 함께 넣는다(그때 통과한 형태).

## 변경 파일

- phase-1: `scripts/req/lib/adapters.ts` · `bin/init.ts` · `bin/setup.ts` · `bin/check.ts`
- phase-2: `tests/unit/init.test.ts` · `tests/unit/codex-missing-guidance.test.ts`(신규)
- phase-3: `CHANGELOG.md`

## 하위호환·안전

- 🔴 **게이트 동작 불변** — 판정 로직·차단 조건·`check`의 읽기 전용 성질 전부 그대로. 바뀌는 것은 **문자열과 안내 순서**뿐이다.
- 🔴 **B(미로그인) 경로 무변경**(DEC-3). `setup.ts`의 로그인 블록은 diff에 들어가지 않는다.
- `installGuidance`의 `unsafe` 분기(안전한 커밋 안내를 만들 수 없는 경우)는 **조기 반환**한다 —
  그 경로에도 setup 안내가 필요한지 구현 시 확인하고, 필요하면 두 경로 모두에 넣는다.
- 문서 축(`docs/*`·README)은 이 REQ의 대상이 아니다(DEC-5).
- phase-2의 신규 테스트 파일은 스폰 없이 **함수 import만** 한다 — 스위트 지연의 96%가 스폰이다(REQ-2026-075).
