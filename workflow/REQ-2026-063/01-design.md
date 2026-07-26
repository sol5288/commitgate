# REQ-2026-063 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

| 축 | 현재 | 근거 |
|---|---|---|
| 멈춤 설정 | `phaseCommit: { autoApprove: 'never' \| 'low-only' }` | `config.ts`의 `PhaseCommit` |
| 해소 | `raw.phaseCommit ?? DEFAULTS.phaseCommit` — **키가 없어도 채워진다** | `config.ts`(resolution) |
| 소비 | `req:next`가 `cfg.phaseCommit.autoApprove`를 `phaseCommitAutoApprove`로 받아 판정 | `req-next.ts:543,664,820` |
| HIGH 처리 | `low-only`는 `risk_level === 'LOW'` **정확 일치**일 때만 자동 커밋 | `req-next.ts:543-544` |
| 이중 백스톱 | HIGH는 `req-commit`의 `userConfirmGate`가 또 막는다 | `req-commit.ts:103-111` |
| setup 질문 | 모델·effort 2개 | `bin/setup.ts`의 `SETUP_KEYS` |

## 핵심 설계 결정

### DEC-1 — `stopGate`가 **의미 SSOT**, `phaseCommit`은 파생 alias
```
stopGate: 'phase' ⇄ phaseCommit.autoApprove: 'never'
stopGate: 'req'   ⇄ phaseCommit.autoApprove: 'low-only'
```
- `ResolvedConfig`는 **둘 다** 갖는다. `stopGate`가 새 소비자용, `phaseCommit`은 **기존 소비자 계약 보존**용
  (`req-next.ts`의 `phaseCommitAutoApprove` 배선을 이 REQ에서 건드리지 않는다 — 비목표).
- 그래서 이 REQ는 **행동을 바꾸지 않는다**: 기존 설정은 같은 `phaseCommit` 값으로 해소되고,
  신규 `stopGate`는 그 값으로 번역될 뿐이다.

### DEC-2 — 🔴 충돌 검사는 **raw key 명시 여부** 기준 (C1)
```ts
const hasStopGate   = Object.prototype.hasOwnProperty.call(raw, 'stopGate')
const hasPhaseCommit = Object.prototype.hasOwnProperty.call(raw, 'phaseCommit')
if (hasStopGate && hasPhaseCommit && AUTO_APPROVE_OF[raw.stopGate] !== raw.phaseCommit.autoApprove) throw
```
**해소값을 비교하면 안 된다.** `phaseCommit`은 부재해도 `{autoApprove:'never'}`로 채워지므로
(`raw.phaseCommit ?? DEFAULTS.phaseCommit`), `stopGate: "req"`만 쓴 **정상 설정**이 오탐되어 거부된다.
이 오탐은 "새 축을 쓰면 거부당한다"는 최악의 형태다 — 새 축을 아무도 못 쓴다.

### DEC-2b — 🔴 충돌 오류는 **무엇이 모순인지** 말해야 한다 (수용기준 5)
`throw new Error('설정 충돌')`만 해도 "거부한다"는 테스트는 통과하지만 사용자는 **무엇을 고쳐야 하는지
모른다.** 오류 메시지는 다음을 **모두** 담는다:
- 두 키의 **실제 값**(`stopGate: "req"` · `phaseCommit.autoApprove: "never"`)
- **기대 매핑**(`stopGate: "req"` ⇄ `"low-only"`)
- **해결 방법**(둘 중 하나를 지우거나 값을 맞춘다 — `stopGate`가 새 축이다)

이것을 테스트 oracle로 고정한다 — 메시지에 두 값과 기대 매핑이 들어 있는지 단언한다.
그러지 않으면 "거부만 하고 안내는 없는" 구현이 계획을 통과한다.

### DEC-3 — 해소 우선순위
| raw | 결과 |
|---|---|
| `stopGate`만 | `stopGate` 그대로 · `phaseCommit` = 파생 |
| `phaseCommit`만 (legacy) | `phaseCommit` 그대로 · `stopGate` = 역파생 |
| 둘 다 (일치) | 그대로 |
| 둘 다 (모순) | **throw**(DEC-2) |
| 둘 다 없음 | `DEFAULTS` = `phase` / `never` |

### DEC-4 — 스키마 2벌 동시 확장
`CONFIG_SCHEMA`(코드)와 `workflow/req.config.schema.json`(파일)에 `stopGate`를 **같은 커밋에서** 넣는다.
한쪽만 고치면 소비자의 vendored 스키마가 신규 키를 `additionalProperties:false`로 거부해 **모든 명령이 죽는다**
(REQ-2026-062 phase-1과 같은 근거). 드리프트 가드 테스트가 확인한다.

### DEC-5 — 🔴 `enum`은 **2값만** — `merge`를 미리 넣지 않는다
`stopGate: "merge"`는 delivery set 없이는 **"언제 멈출지"를 아무도 모르는 상태**가 된다.
스키마에 값만 먼저 넣으면 사용자가 고를 수 있는데 동작이 없다 — 거짓 UI다. B3가 함께 착륙할 때 넣는다.

### DEC-6 — `setup` 질문 추가
`SETUP_KEYS`에 `stopGate`를 더한다(질문 3개). 검증은 기존대로 `CONFIG_SCHEMA` 서브스키마에서 온다
(REQ-2026-060 DEC-4) — enum이 늘면 선택지가 자동으로 따라간다.

🔴 **화면이 명시해야 할 것**: *"HIGH 위험 티켓은 어느 값에서도 매 phase 확인합니다."*
사용자가 `req`를 고르고 "이제 전부 자동"이라고 오해하면, HIGH 티켓에서 멈출 때 도구가 고장 난 것처럼 보인다.
이 사실은 정책이지 결함이 아니다(REQ-2026-019 폐기 사유 — C3).

### DEC-6b — 🔴 `setup`은 `stopGate`를 쓸 때 legacy `phaseCommit`을 **제거**한다 (정규화)

**이것이 없으면 setup 자체가 프로젝트를 벽돌로 만든다.** 시나리오:

1. 기존 프로젝트: `{ "phaseCommit": { "autoApprove": "low-only" } }`
2. 사용자가 setup에서 `stopGate: "phase"`를 고른다.
3. setup의 merge는 **건드리지 않은 키를 보존**한다(REQ-2026-060 DEC-6) → 파일에 두 키가 함께 남는다:
   `{ "stopGate": "phase", "phaseCommit": { "autoApprove": "low-only" } }`
4. DEC-2의 충돌 검사가 **정확히 이 조합을 거부**한다 → **이후 모든 명령이 죽는다.**

C2(기존 설정 무회귀)와 R4(setup이 stopGate를 묻는다)를 동시에 만족하려면 **저장 계약**이 필요하다:

> 🔴 `setup`이 `stopGate`를 기록할 때는 **같은 쓰기에서 `phaseCommit` 키를 삭제**한다.
> 값이 마침 일치해도 삭제한다 — alias를 남겨 두면 다음에 한쪽만 손으로 고쳤을 때 같은 덫이 재발한다.

- 삭제는 **`stopGate`를 실제로 기록할 때만** 한다. 사용자가 그 질문에서 Enter(유지)를 눌러
  `stopGate` 패치가 없으면 `phaseCommit`도 그대로 둔다(건드린 키만 바꾼다는 원칙 유지).
- 구현: `mergeConfigText`에 **삭제 키 목록**을 넘긴다(패치와 같은 원자적 쓰기 안에서 처리).
- 회귀 테스트: 위 4단계 시나리오를 그대로 재현해 **결과 파일이 `loadConfig`를 통과**하는지 단언한다.
  "쓰기 결과가 스스로 만든 게이트에 걸리지 않는다"가 이 REQ의 필수 오라클이다.

### DEC-7 — `null` 비움을 허용하지 않는다
모델·effort와 달리 `stopGate`는 "전역 상속" 개념이 없다. `NULL_SENTINEL`(`-`) 입력은 **거부**되어야 한다 —
스키마에 `null`을 넣지 않으면 기존 검증 경로가 자동으로 거부한다(별도 코드 불필요).

## Phase별 구현

| phase | 내용 | 코드 파일 |
|---|---|---|
| **phase-1** | `stopGate` 타입·스키마 2벌·해소·충돌 검사(DEC-1~DEC-5) | 3 |
| **phase-2** | `setup` 질문 추가 + HIGH 고지(DEC-6·DEC-7) | 2 |
| **phase-3** | 문서(한/영)·CHANGELOG | 0(docs) |

## 변경 파일

- `scripts/req/lib/config.ts` — `StopGate` 타입 · `CONFIG_SCHEMA.stopGate` · 해소·충돌 검사
- `workflow/req.config.schema.json` — 같은 확장
- `tests/unit/req-config.test.ts`
- `bin/setup.ts` — `SETUP_KEYS`에 `stopGate` · HIGH 고지 · **legacy `phaseCommit` 삭제 정규화**(DEC-6b)
- `tests/unit/setup.test.ts`
- `docs/*` · `CHANGELOG.md`

## 하위호환·안전

- **행동 무변경**(DEC-1): 소비 지점(`req-next`의 `phaseCommitAutoApprove`)을 건드리지 않는다.
  기존 설정은 같은 값으로 해소되고, 신규 축은 그 값으로 번역될 뿐이다.
- **기존 설정 무회귀**(C2·DEC-3): `phaseCommit`만 있는 config가 그대로 동작하고 `stopGate`가 역파생된다.
- **새 축 오탐 없음**(C1·DEC-2): raw 기준 충돌 검사라 `stopGate`만 쓴 설정이 거부되지 않는다.
- **HIGH 정책 불변**(C3): `low-only`의 `risk_level === 'LOW'` 정확 일치 판정을 건드리지 않는다.
  `req-commit`의 `userConfirmGate` 이중 백스톱도 그대로다.
- **`merge` 미도입**(DEC-5): 동작 없는 선택지를 노출하지 않는다.
- 🔴 **setup이 만든 파일이 setup이 만든 게이트에 걸리지 않는다**(DEC-6b): `stopGate`를 기록할 때
  legacy `phaseCommit`을 같은 원자적 쓰기에서 삭제한다. 이 계약이 없으면 기존 `low-only` 프로젝트가
  setup에서 `phase`를 고르는 **정상 경로**가 프로젝트를 벽돌로 만든다.
