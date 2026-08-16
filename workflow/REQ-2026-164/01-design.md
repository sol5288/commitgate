# REQ-2026-164 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

- `docs/upgrade.md`·`.en.md` — 축이 산문으로 흩어져 있다. `## 공통 — 버전 bump` 아래 요약 한 줄
  (`설치 → sync --apply --scripts → quickstart --apply → check`)이 가장 가까운 목록이지만 8축 중 일부만 담는다.
- `README.md`·`README.en.md` — 업그레이드 스니펫과 명령표가 `sync --apply --gitignore` 로 **stale**.
- 축 목록은 **어디에도 없다**. 각 축은 자기 진단 안에만 존재한다.

## 핵심 설계 결정

### DEC-1 — 축 등록부는 **코드**에 둔다: `scripts/req/lib/upgrade-axes.ts`

```ts
/**
 * 🔴 진단은 **체크 id 만이 아니다**(design r02 P1). persona drift 는 `sync` 계획 출력으로만 드러나고
 *    안정 id 가 없다. 그것을 체크 id 배열에 억지로 넣으면 실재 가드가 깨지고, 빈 배열로 두면 표가
 *    "진단 없음"이라고 **거짓을 말한다**. 세 종류를 타입으로 구분한다.
 */
export type AxisDiagnosis =
  | { kind: 'check'; id: string }        // `D20` · `C6` … — 가드가 **실재**를 검사한다
  | { kind: 'command'; command: string } // id 가 없고 명령 출력으로만 드러남(예: `sync` 계획)
  | { kind: 'none' }                     // 진단 수단이 **없다**(caret 범위)

export interface UpgradeAxis {
  id: string    // 안정 식별자(문서 표의 행 키)
  what: string  // 무엇이 어긋나는가(한 줄)
  /** 🔴 **비지 않는다.** 빈 배열은 "진단이 없다"와 "아직 안 적었다"를 구분하지 못한다 — `none` 을 명시한다. */
  diagnostics: readonly AxisDiagnosis[]
  remedy: string // 조치 — 실행 명령 또는 수동 절차 서술
}
export const UPGRADE_AXES: readonly UpgradeAxis[]

/** README 가 그대로 담아야 하는 **정본 요약 명령**(DEC-3). 문자열이 한 곳에서만 나온다. */
export const UPGRADE_SUMMARY_COMMAND: string
/** README 가 가리켜야 하는 정본 문서 경로(한/영). */
export const UPGRADE_CANONICAL_DOC: { ko: string; en: string }
```

🔴 **문서에 목록만 적는 것으로 끝내지 않는다.** 그것이 지금 갈라진 원인이다. 등록부를 코드에 두고
**문서가 그것을 담는지 테스트가 검사**한다 — 이 저장소가 `D_CHECK_IDS` ↔ `07` 정본표에서 이미 쓰는 형태다.

🔴 **런타임 소비자를 만들지 않는다.** 진단·조치 동작은 이미 각 체크가 하고 있고, 여기서 또 판정하면
같은 사실을 두 곳이 말하게 된다(이 REQ 의 비목표). 소비자는 **가드**다 — 이 저장소는 소비처 없는 신호를
"죽은 기능"으로 취급해 왔으므로(REQ-2026-031), 등록부의 소비처가 가드 하나임을 명시해 둔다.

### DEC-2 — 가드는 **표 구역 안에서 축별 행**을 본다

🔴 **문서 전체 포함 검사로는 부족하다**(design r01 P1 ×2):
- `diagnostics` 를 안 보면, 등록부의 진단을 `D20 → D22` 로 바꾸고 문서를 안 고쳐도 green 이다 —
  사용자는 정본 표에서 **틀린 진단**을 받는다.
- 문서 **아무 곳**이나 보면, 새 축의 id·명령을 산문 어딘가에 흘려 넣어도 green 이다 —
  요구가 정한 *"모든 축을 한 표에"* 가 깨지고 사용자는 한 자리에서 확인하지 못한다.

그래서 **표 구역을 마커로 확정**하고 그 안의 **행 단위**로 검사한다:

```md
<!-- commitgate:upgrade-axes -->
| 축 | 무엇이 어긋나나 | 진단 | 조치 |
|---|---|---|---|
| `schema` | vendored 스키마가 설치본과 다름 | `D20` | `npx commitgate sync --apply` |
…
<!-- /commitgate:upgrade-axes -->
```

가드 계약:
1. **진단 실재** — `kind:'check'` 인 항목의 `id` 가 `D_CHECK_IDS` 또는 `check` 항목 id 에 실제로 있다.
   `kind:'command'`·`kind:'none'` 은 실재 검사 대상이 아니다(id 가 없는 것이 사실이다).
2. **표 구역 존재** — 한/영 정본에 마커 쌍이 있고 그 안이 표다.
3. **축별 행** — 등록부의 각 축에 대해 표 구역 안에 그 축의 `id` 를 담은 **행이 정확히 하나** 있고,
   그 행이 **그 축의 `diagnostics` 전부**와 **`remedy` 핵심 명령**을 담는다.
   - `kind:'check'` → 그 체크 id 문자열
   - `kind:'command'` → 그 명령 문자열
   - `kind:'none'` → **"진단 없음"**
4. **`diagnostics` 는 비지 않는다** — 등록부 자체를 검사한다(빈 배열 = 아직 안 적음).
5. **표에만 있는 축 금지** — 표 구역의 행 개수가 등록부의 축 개수와 같다(문서에만 있는 유령 축 차단).

🔴 **문구를 통째로 고정하지 않는다.** 설명 열은 자유롭게 다듬을 수 있어야 하고, 고정하면 사소한 표현
변경마다 red 가 되어 사람이 가드를 끈다. 고정하는 것은 **축 id · 진단 id · 조치 명령** 세 토큰뿐이다.

### DEC-3 — 정본은 한 곳, README 는 **요약 + 링크**(가드가 구조까지 본다)

`docs/upgrade.md` 에 축 표를 두고, README 는 절차를 복제하지 않는다 — 지금 갈라진 이유가 README 가
절차를 복제했기 때문이다.

🔴 **"옛 명령이 없다"만 검사하면 부족하다**(design r02 P1). 그러면 README 를 다른 문자열
(`sync --apply --scripts --gitignore`)로 바꾸거나, 링크 없이 절차를 다시 복제해도 green 이다.
가드가 **세 가지**를 본다:

README 의 업그레이드 구역을 `<!-- commitgate:upgrade-summary -->` 마커로 확정하고 **그 구역의 구조**를 본다:

1. `UPGRADE_SUMMARY_COMMAND` 를 **그대로** 담는다(정본과 같은 문자열 — 상수가 유일 출처).
2. `UPGRADE_CANONICAL_DOC` 링크를 담는다(정본으로 보낸다).
3. 🔴 **그 구역에 표가 없다** — 마커 유무가 아니라 **표 문법(`|---`) 자체**를 금지한다.
   마커만 빼고 8축 표를 복제하면 앞선 세 검사가 전부 green 이었다(design r03 P1).
4. 🔴 **그 구역의 `npx commitgate …` 명령이 요약 하나뿐이다.** 절차를 다시 늘어놓으면 red 다.

이 넷이 "요약 + 링크"라는 구조를 **문구 고정 없이** 강제한다.

### DEC-4 — 진단이 **없는/id 없는** 축을 사실대로 적는다

- `혼합(mixed) 설치`: D19 는 **`mixed` 만 WARN** 하고 순수 Stage A 는 `OK` 다(코드 주석이 그 이유를 적는다 —
  Stage A 는 지원되는 형태이고 FAIL 이면 이 저장소 자신의 커밋도 막힌다). 그래서 축 이름을
  "Stage A→B 전환"이 아니라 **"혼합 설치"** 로 둔다 — 사실과 다른 진단을 표에 적지 않는다.
- `caret 범위`: `^0.x` 는 소비자 `package.json` 에서 PM 이 강제하므로 코드로 감지·수정할 수 없다
  → `[{ kind: 'none' }]`, 표에는 **"진단 없음"**.
- `review persona`: drift 가 `sync` 계획 출력으로만 드러나고 안정 id 가 없다
  → `[{ kind: 'command', command: 'npx commitgate sync --persona' }]`, 표에는 그 명령.

🔴 **없는 것을 있다고 적지 않는다.** 이 축만 진단이 없다는 사실이 사용자가 알아야 할 정보다.

## Phase별 구현

| phase | 내용 |
|---|---|
| 1 | `lib/upgrade-axes.ts` 등록부 + `docs/upgrade.md`·`.en.md` 축 표 + 가드(진단 실재·정본 포함) |
| 2 | README 한/영 정합(stale 스니펫·명령표) + 가드 확장 |
| 3 | CHANGELOG |

🔴 **phase 1 에서 등록부와 정본 문서를 함께 넣는다.** 등록부만 먼저 넣으면 가드가 그 순간 red 라
phase 가 green 으로 착륙하지 못한다.

## 변경 파일

- 신규: `scripts/req/lib/upgrade-axes.ts`(등록부 + 요약 상수) · `tests/unit/upgrade-axes.test.ts`
- 수정: `docs/upgrade.md` · `docs/upgrade.en.md` · `README.md` · `README.en.md` · `CHANGELOG.md`

## 하위호환·안전

- **동작 변경 0.** 진단·조치 코드를 건드리지 않는다 — 등록부는 가드만 소비한다.
- 가드는 **포함 검사**라 문구 수정에 관대하다. 축을 늘리거나 조치 명령을 바꿀 때만 red 다.
- 기존 `docs-stale-claims`·`sync-guidance-claims` 가드와 겹치지 않는다(저쪽은 **폐기된 주장**, 이쪽은
  **누락된 축**).
