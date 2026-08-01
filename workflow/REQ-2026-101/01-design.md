# REQ-2026-101 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

### 갱신 기계는 완비돼 있고, 진단만 절반을 본다

| 함수 | 하는 일 | 낡은 블록을 아는가 |
|---|---|---|
| [`injectQuickstart`](../../bin/quickstart.ts) (:104) | 마커 有·다름 → **치환**(`updated`) / 마커 無 → 삽입 | ✅ **안다** |
| [`planQuickstart`](../../bin/quickstart.ts) (:189) | 대상 2파일에 대해 skip/noop/**replace**/insert 계획 | ✅ **안다**(`'replace'`) |
| [`missingQuickstartFiles`](../../bin/quickstart.ts) (:177) | `!content.includes(MARKER_OPEN)` | ❌ **모른다** |

doctor **D21**의 입력은 셋 중 **모르는 것 하나**뿐이다([req-doctor.ts:1114](../../scripts/req/req-doctor.ts)).
그래서 블록 내용을 개정해도 **이미 설치된 소비자는 신호를 못 받고**, 신호가 없으니 아무도
`commitgate quickstart --apply`를 실행하지 않는다.

지금까지 Quick Start 블록을 **한 번도 개정하지 않아** 드러나지 않은 구멍이다. 이 REQ가 처음으로
블록을 개정하므로 여기서 함께 닫는다.

### 소비자 실측(수혜 대상 확인)

`44_yammy_sales`·`45_MBTI_kiosk` 둘 다 `commitgate:quickstart` 마커 보유(백필 이력 있음),
둘 다 `commitgate ^0.17.0`. **탐지만 생기면 즉시 D21이 발화**한다.

## 핵심 설계 결정

### DEC-1 — 진단을 `planQuickstart`에서 파생시킨다 (새 술어 금지)

`missingQuickstartFiles`(부재만)를 **버리고**, verb가 이미 쓰는 계획기를 그대로 진단에 쓴다.

```ts
/** 백필이 필요한 파일 = 계획의 action이 insert(부재) 또는 replace(낡음)인 것. */
export function quickstartBackfillTargets(root: string): { rel: string; action: 'insert' | 'replace' }[] {
  const plan = planQuickstart(root, shippedQuickstartBlock())
  return plan.files.filter((f) => f.action === 'insert' || f.action === 'replace')
                   .map((f) => ({ rel: f.rel, action: f.action }))
}
```

🔴 **술어도 입력 획득도 공유한다**(REQ-2026-099·094 교훈). 진단이 "백필 필요"라고 말하면
`quickstart --apply`가 **반드시 그 파일을 쓴다** — 두 판단이 갈라질 수 없다. skip 사유(symlink·
계약 마커 부재·파일 부재)도 계획기가 이미 처리하므로 진단이 그것을 재구현하지 않는다.

대안 기각: `missingQuickstartFiles`에 내용 비교를 **추가**하는 방식. 그러면 계획기와 진단이 각자
비교를 갖게 되어 정확히 이 REQ가 고치는 종류의 이원화가 남는다.

### DEC-2 — D21은 두 사유를 **구분해서** 알린다

부재와 드리프트는 사용자에게 다른 사건이다.

- 부재: "블록이 없습니다 — 백필하세요"(기존 문구 유지)
- **드리프트**: "블록이 설치된 버전과 다릅니다 — `quickstart --apply`로 갱신하세요.
  ⚠️ 마커 안쪽 수정은 덮어써집니다"(R5)

한 줄에 뭉치면 사용자가 무엇을 해야 하는지, 무엇을 잃는지 알 수 없다.

### DEC-3 — **WARN 상한 유지**(절대 FAIL 아님)

D21의 기존 근거를 그대로 계승한다: `req:commit`이 이 doctor를 **하드 게이트로 spawn**하므로
FAIL이면 커밋이 벽돌이 된다. 블록 내용이 낡은 것은 커밋을 막을 근거가 아니다.
D19·D20·D22와 동형이다.

### DEC-4 — dev/dogfood 스킵 유지

`packageRootDiffers === false`면 점검 불요(현행). 이 저장소 자신은 template이 곧 원본이라 항상
`noop`이지만, 스킵 조건을 건드리지 않는다 — 무관한 회귀를 만들지 않는다.

### DEC-5 — Quick Start 블록에 계층 **한 줄**

`templates/CLAUDE.template.md`의 블록에 7번 항목을 더한다:

```
7. 테스트는 phase 진행 중엔 **변경한 소스를 import하는 것만**, **전체 스위트는 통합 직전 1회** 돌린다.
   게이트는 테스트를 실행하지 않는다 — 이건 비용 규칙이다.
```

전문(계층표·근거)은 `AGENTS.md` §1-1과 `02-plan.md`에 있다. Quick Start는 "빠른 시작"이므로
여기서는 **행동 한 줄**만 둔다. 블록이 길어지면 always-loaded 예산을 먹는다.

🔴 이 변경이 **DEC-1의 첫 수혜자**다 — 블록이 바뀌므로 기존 소비자 전원이 D21 드리프트 WARN을 받는다.

### DEC-7 — 판정 불가는 **조용한 OK**(선례 계승)

`shippedQuickstartBlock()`은 템플릿에 블록이 없으면 **throw**한다. 진단 경로에서 그것이 doctor를
죽이면 안 된다(doctor는 `req:commit`의 하드 게이트다). 그래서 `quickstartBackfillTargets`는
**`undefined`를 반환**하고 D21은 그것을 `점검 불요`(OK)로 처리한다.

선례가 일관된다 — D19의 `undefined→OK`, D20의 "조회 불가 → OK"([req-doctor.ts:561](../../scripts/req/req-doctor.ts)),
D24의 "2-arg/미계산 → OK". **판정할 근거가 없으면 알리지 않는다.**

🔴 이것은 fail-open이 아니다 — 이 검사는 **advisory**이고 어떤 게이트도 여기에 서 있지 않다.
차단하는 검사(D9·D13 등)의 fail-closed 원칙과 축이 다르다.

### DEC-8 — 반복 WARN은 억제하지 않는다

블록 개정 후 갱신 전까지 **매 `req:commit`마다** D21 WARN이 뜬다. 억제 장치를 만들지 않는다:

- **선례**: D24(setup grandfathered)가 이미 그렇게 동작한다 — 조건이 해소될 때까지 매번 뜬다.
- 억제하면 "알림을 봤는가"라는 상태를 어딘가 저장해야 하고, 그 상태가 곧 새 드리프트 축이 된다.
- 해소가 **명령 한 줄**(`commitgate quickstart --apply`)이라 억제할 만큼 비싸지 않다.

⚠️ 다만 WARN 피로는 실재한다(REQ-076: "거짓 red는 교착보다 나쁘다 — 사람이 red를 무시하기
시작한다"). 그래서 문구가 **무엇을 하면 사라지는지**를 한 줄로 말해야 한다(DEC-2).

### DEC-6 — 회귀 가드

1. **드리프트 탐지**: 블록이 있으나 내용이 다른 파일 → `quickstartBackfillTargets`가 `replace`로 잡는다.
2. **부재 탐지 무회귀**: 마커 없는 파일 → 여전히 `insert`.
3. **skip 사유 보존**: 계약 마커 없는 `AGENTS.md`·부재·symlink는 대상에서 빠진다.
4. **D21 문구 분기**: 부재/드리프트가 서로 다른 문구를 내고, 드리프트 문구에 덮어쓰기 경고가 있다.
5. **D21은 WARN 상한**: 어떤 입력에서도 FAIL이 나오지 않는다.
5b. **판정 불가는 OK**: `undefined` 입력이면 `점검 불요`(DEC-7) — WARN조차 내지 않는다.
6. **진단↔적용 일치(핵심)**: 진단이 지목한 파일을 `quickstart --apply`가 실제로 쓴다
   — 같은 임시 repo에서 진단 → 적용 → 재진단이 **빈 목록**이 되는 왕복을 고정한다.

## Phase별 구현

**단일 phase** — 함수 하나 교체 + D21 분기 + 블록 한 줄. 응집돼 있고 코드 3파일이다.

## 변경 파일

| 파일 | 변경 |
|---|---|
| [bin/quickstart.ts](../../bin/quickstart.ts) | `missingQuickstartFiles` → `quickstartBackfillTargets`(DEC-1) |
| [scripts/req/req-doctor.ts](../../scripts/req/req-doctor.ts) | D21 입력 타입·분기 문구(DEC-2), WARN 상한 유지(DEC-3) |
| [templates/CLAUDE.template.md](../../templates/CLAUDE.template.md) | Quick Start 블록 7번 항목(DEC-5) |
| [tests/unit/quickstart.test.ts](../../tests/unit/quickstart.test.ts) | DEC-6 ①②③⑥ |
| [tests/unit/req-doctor.test.ts](../../tests/unit/req-doctor.test.ts) | DEC-6 ④⑤ |
| [CHANGELOG.md](../../CHANGELOG.md) | Unreleased 항목 |

## 하위호환·안전

- **쓰기 동작 무변경.** `injectQuickstart`·`planQuickstart`·`quickstart --apply`는 손대지 않는다.
  바뀌는 것은 **누가 그 계획을 보는가**(진단)와 블록 내용이다.
- **WARN 상한 유지**(DEC-3) — 커밋 경로가 막히지 않는다.
- ⚠️ **기존 소비자 전원이 D21 WARN을 받게 된다**(블록 개정 때문). 의도된 것이며 그것이 이 REQ의
  목적이다. 다만 WARN이므로 **아무것도 차단하지 않고**, 사용자가 원치 않으면 무시해도 진행된다.
- ⚠️ **마커 안쪽을 편집한 소비자는 `--apply` 시 그 편집을 잃는다.** 마커 안은 도구 관리 영역이라는
  기존 계약 그대로지만, 지금까지 갱신이 일어난 적이 없어 사용자가 그 사실을 겪은 적이 없다.
  그래서 문구에 명시한다(R5·DEC-2).
- `missingQuickstartFiles`는 **내부 함수**다 — 소비자 API가 아니다(참조처: doctor 1곳 + 테스트).
