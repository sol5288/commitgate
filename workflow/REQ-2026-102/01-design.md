# REQ-2026-102 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

### doctor는 legacy를 `null`로 뭉갠다 — 사유를 말할 수 없다

[req-doctor.ts](../../scripts/req/req-doctor.ts) REQ-2026-097 배선:

```ts
const base = scanTicketIntake(...).baseState
return base === 'series-terminal' || base === 'dev-complete'
    || base === 'migrated-complete' || base === 'abandoned' ? base : null
```

`legacy`·`developing`·`needs-recovery`·`corrupt`가 **전부 `null`**로 붕괴한다. 그래서 D2/D3/D11은
"면제 아님"만 알 뿐 **왜 아닌지** 모르고, 사용자는 사유 없는 FAIL 3건만 본다.

`developing`이면 사유가 자명하다(진행 중이니 feature 브랜치에서 하라). **`legacy`만 다르다** —
사용자가 할 수 있는 것이 없는데 그 사실조차 알려주지 않는다.

### `req:close`가 이제 거짓인 이유를 댄다

[req-close.ts:154-155](../../scripts/req/req-close.ts)의 `탈출구가 필요 없습니다`는 REQ-097
**이전** 문장이다. REQ-097이 종결에 새 효용(브랜치 축 면제)을 붙이면서 낡았다.

## 핵심 설계 결정

### DEC-1 — 동작 무변경. 이 REQ는 **문구만** 고친다

리포터 제안 (a)면제·(b)WARN강등은 채택하지 않는다 — 실측상 커밋 경로가 열린다
(`00-requirement.md` 실측 1·2). D2/D3/D11의 **레벨과 조건은 한 글자도 바꾸지 않는다.**

### DEC-2 — 입력에 `'legacy'`를 **비면제 값**으로 추가한다

```ts
ticketTerminalEvent?: CloseProofEvent | 'legacy' | null
```

- `CloseProofEvent` → 면제(현행)
- **`'legacy'` → 면제하지 않되 사유를 말한다** (신설)
- `null`/`undefined` → 현행

🔴 **필드를 늘리지 않는다.** REQ-097 DEC-2가 boolean을 거부한 이유와 같다 — 두 필드로 쪼개면
`terminal='dev-complete' & legacy=true` 같은 **모순 조합이 타입으로 표현 가능**해진다. 값 하나가
"면제인가"와 "아니라면 왜인가"를 동시에 나른다.

면제 판정은 **여전히 한 곳**이다: `typeof v === 'string' && v !== 'legacy'`가 아니라,
명시적으로 `v !== null && v !== 'legacy'`로 읽히게 지역 상수를 둔다(아래 DEC-3).

### DEC-3 — 면제 여부와 사유를 분리하되, **allow-list + exhaustive**로 만든다

`exempt`가 기존 `terminal`의 자리를 그대로 대체하므로 **분기 구조가 바뀌지 않는다** —
`legacy`가 들어와도 기존 FAIL 조건을 그대로 탄다. 사유는 FAIL 메시지에만 덧붙는다.

🔴 **deny-list로 쓰면 fail-open이다.** 초안은 `exempt = terminal !== null && terminal !== 'legacy'`
였는데, 이러면 나중에 새 **비면제** 값(`'corrupt'` 등)을 타입에 추가하는 순간 그 값이 **조용히
면제 쪽으로 샌다.** 게이트가 소리 없이 넓어지는 구조다.

그래서 **exhaustive allow-list**로 둔다:

```ts
function isExemptTerminal(v: CloseProofEvent | 'legacy' | null): boolean {
  switch (v) {
    case null: case 'legacy': return false
    case 'series-terminal': case 'dev-complete':
    case 'migrated-complete': case 'abandoned': return true
    default: { const exhaustive: never = v; … }   // 새 값 추가 시 **컴파일 실패**
  }
}
```

REQ-2026-099에서 `D_CHECK_IDS`로 얻은 교훈과 같다 — **권위는 관찰이 아니라 타입이 강제해야 한다.**
(실측: 타입에 `'corrupt'`를 추가하면 `error TS2322: Type '"corrupt"' is not assignable to type 'never'`.)

### DEC-4 — legacy FAIL 메시지가 말해야 하는 것

세 검사 모두 기존 메시지 뒤에 **같은 한 문장**을 붙인다:

```
(legacy 티켓 — durability marker가 없어 종결을 검증할 수 없습니다.
 이 티켓이 아직 진행 중이면 자기 feature 브랜치에서 작업하세요.
 이미 끝난 티켓이면 현재 이 FAIL을 해소할 수단이 없습니다.)
```

🔴 **마지막 문장이 load-bearing이다.** 없는 해결책을 암시하지 않는다(REQ-2026-094 교훈:
없는 명령을 안내하면 사용자를 막다른 길로 보낸다). "해소할 수 없다"는 불친절해 보이지만,
사용자가 존재하지 않는 조치를 찾아 헤매는 것보다 낫다 — 리포터가 정확히 그것을 하다가
리포트를 썼다.

문구는 **한 곳에서 만들어** 세 검사가 공유한다(세 번 적으면 갈라진다).

### DEC-5 — `req:close`의 사유를 사실로 바꾼다

```
durable 티켓이 아닙니다(legacy) — 포기 종결 대상이 아닙니다.
  legacy 티켓은 req:new intake를 막지 않습니다.
  ⚠️ 다만 req:doctor의 브랜치 축(D2/D3/D11)은 종결이 검증돼야 면제되는데,
     legacy는 그 판정이 불가능합니다 — 현재 legacy 티켓을 종결로 표시할 경로는 없습니다.
```

참인 부분(intake 무차단)은 남기고, 거짓이 된 결론(`탈출구가 필요 없습니다`)을 **현재 사실**로
교체한다. 없는 명령을 안내하지 않는다.

### DEC-6 — 회귀 가드

1. **면제 집합 무변경**: `'legacy'` 입력에서 D2/D3/D11이 여전히 **FAIL**이다(R1 — 가장 중요).
2. **사유 노출**: 그 FAIL 메시지에 `legacy 티켓`과 `해소할 수 없습니다`가 있다.
3. **오염 없음**: `dev-complete` 등 면제 값에는 legacy 문구가 **붙지 않는다**.
4. **`null` 무회귀**: `developing`을 뜻하는 `null`에는 legacy 문구가 붙지 않고 FAIL만 난다.
5. **WARN/FAIL 레벨 불변**: legacy에서 세 검사가 모두 `FAIL`(WARN 아님 — 강등하지 않았음을 고정).
6. **`req:close` 문구**: legacy 거부 메시지에 `탈출구가 필요 없습니다`가 **없고**, 없는 명령을
   안내하지 않는다(`--abandon`을 legacy에 쓰라고 하지 않는다).
7. **배선**: `main()`이 실제 legacy 티켓에서 `'legacy'`를 주입한다(순수 테스트는 배선을 못 잡는다 —
   REQ-097·100·101에서 3연속 실증).

## Phase별 구현

**단일 phase** — 문구 변경과 그 가드로 응집돼 있고 런타임 동작 변경이 0이다.

## 변경 파일

| 파일 | 변경 |
|---|---|
| [scripts/req/req-doctor.ts](../../scripts/req/req-doctor.ts) | 입력 타입에 `'legacy'`(DEC-2)·`exempt` 분리(DEC-3)·legacy 사유 문구(DEC-4)·`main()` 매핑 |
| [scripts/req/req-close.ts](../../scripts/req/req-close.ts) | legacy 거부 사유 정정(DEC-5) |
| [tests/unit/req-doctor.test.ts](../../tests/unit/req-doctor.test.ts) | DEC-6 ①~⑤ |
| [tests/unit/doctor-terminal-wiring.test.ts](../../tests/unit/doctor-terminal-wiring.test.ts) | DEC-6 ⑦ 배선 e2e |
| [tests/unit/req-close.test.ts](../../tests/unit/req-close.test.ts) | DEC-6 ⑥ |
| [CHANGELOG.md](../../CHANGELOG.md) | Unreleased 항목 |

## 하위호환·안전

- **동작 변경 0.** 면제 집합·레벨·조건이 전부 그대로다. 바뀌는 것은 **FAIL 메시지의 문구**와
  `req:close`의 거부 사유뿐이다.
- **게이트가 약해지지 않는다** — `'legacy'`는 명시적으로 **비면제**다. DEC-6 ①·⑤가 고정한다.
- **`undefined`/`null` 경로 무변경** — 2-arg 호출·기존 테스트 리터럴이 깨지지 않는다.
- ⚠️ **남는 갭을 숨기지 않는다**: 끝난 legacy 티켓을 종결로 표시할 경로는 여전히 없다. 이 REQ는
  그것을 **사실대로 말하는 것**까지만 하고, 경로 신설은 별건으로 남긴다(`00-requirement.md` 범위 밖).
