# REQ-2026-112 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

| 사실 | 위치 | 확인 |
|---|---|---|
| 고지 상수가 export되어 질문 렌더러 2곳에서 쓰인다 | `bin/setup.ts:229`(정의) · `:244`·`:260`(사용) | 읽음 |
| 고지는 `!allowsNullValue(q.key)`인 질문에 붙는다 | `bin/setup.ts:244` | 읽음 |
| 실제 정지 규칙 | `req-commit.ts:132~133` — `merge`면 차단 없음, `req`면 REQ 완성 커밋만 차단 | 읽음 |
| 기본값 `stopGate: 'req'` | `scripts/req/lib/config.ts:215` | 읽음 |
| 가드 대상은 `README` 2종 + `docs/**` | `tests/unit/docs-stale-claims.test.ts` `docFiles()` | 읽음 |
| 등재 문자열 13개, 모두 테스트 파일 안에 있다 | 같은 파일 `STALE_CLAIMS` | 읽음 |
| D-체크 등록부 22개 · 정본 표도 22행(일치) | `req-doctor.ts:80` · `docs/ssot-design/07…md §3` | 실측 |
| 등록부의 모든 id가 **입력 변형 4개 중 하나에서 발화**해야 한다 | `docs-stale-claims.test.ts`의 죽은-항목 탐지 | 읽음 |

**남아 있는 6곳** (CHANGELOG의 역사 기록은 대상 아님):
`bin/setup.ts:230` · `AGENTS.template.md:77` · `docs/ssot-design/04:54` · `config.ts` 39·53·214.

`req-next.ts:688`에도 옛 표현이 있으나 **완화 사실을 설명하는 문장**이라 정정 대상이 아니다
(등재 문자열과도 매치하지 않는다 — "정지"이지 "확인"이 아니다).

## 핵심 설계 결정

### DEC-1 · 고지는 "정지 지점을 이 값이 정한다"로 다시 쓴다

거짓인 것은 첫 절뿐이다. 둘째 절(통합 승인은 어느 값에서도 필요)은 **참이므로 유지**한다.

새 문구:

```
정지 지점은 이 값이 정합니다 — phase: 매 phase 커밋 전 · req: REQ를 끝내는 커밋 전 ·
merge: 커밋에서는 멈추지 않음 · 통합(main 병합) 승인은 어느 값에서도 필요합니다
```

**근거**: 사용자가 이 문장을 읽는 시점은 `stopGate` 값을 고르는 순간이다. "무엇이 보장되는가"보다
**"이 값이 무엇을 정하는가"** 가 그 자리에서 더 유용하고, 무엇보다 참이다.

위 주석(224~228행)의 근거 서술도 함께 다시 쓴다 — 지금은 정반대를 말한다.
🔴 다시 쓸 때 **옛 문구를 축자 인용하지 않는다**(제약 1).

### DEC-2 · 가드 범위는 **두 축**으로 나눈다 — 파일 스캔과 상수 검증

| 축 | 대상 | 방법 |
|---|---|---|
| **텍스트 표면** | `README` 2종 · `docs/**` · **`AGENTS.template.md`** · **`templates/**/*.md`** · **`skills/**/*.md`** · **`workflow/review-persona.md`**(정확 경로) | 파일 내용 부분 문자열 검사(현행 방식 확장) |
| **코드 표면** | **`bin/setup.ts`** · **`scripts/req/lib/config.ts`** (명시적 파일 목록) | 같은 부분 문자열 검사 |
| **사용자 노출 상수** | `STOP_GATE_HIGH_NOTICE` | **상수를 import해 값을 검사**(위에 얹는 더 강한 오라클) |

🔴 **왜 코드 표면을 넣는가**(설계 리뷰 r01 P1): 원안은 상수만 검사해서 `config.ts`의 주석 3곳과
`setup.ts`의 근거 주석이 **검사되지 않았다.** 6곳 정정을 요구하면서 4곳에 오라클이 없었다.

🔴 **그래도 "코드 전체 스캔"은 아니다.** 대상은 **손으로 적은 파일 목록**이다. 글로브로 `**/*.ts`를
넣으면 폐기 문구를 설명하는 정정문·주석까지 걸려 **정정 자체가 불가능**해진다
(REQ-2026-104가 겪은 함정). 목록에 넣을 파일은 "폐기 주장이 남아 있던 곳"으로 한정한다.

🔴 **제외 목록이 필요하다.** 폐기 문구를 **담는 것이 정상인 파일**은 검사 대상에서 뺀다:
- `scripts/req/lib/retired-claims.ts` — 등재 정본(Phase 2에서 생김)
- `tests/unit/docs-stale-claims.test.ts` — 가드 자신
- `CHANGELOG.md` — 역사 기록
- `workflow/REQ-*/**` — 티켓 문서(정정을 설명하려면 인용이 필요하다)

제외는 **명시적 목록**이며, 대상 목록과 마찬가지로 테스트가 그 내용을 단언한다.

🔴 `workflow/`는 **글로브로 넣지 않는다.** `workflow/**`로 넣으면 REQ 티켓 문서까지 잡혀,
폐기 문구를 인용해 설명하는 설계 문서를 쓸 수 없게 된다. `workflow/review-persona.md` 하나만 넣는다.

### DEC-3 · 표현 변형을 등재한다

최소 `정책과 무관하게 유지`. 착수 시 `grep -rn "정책과 무관하게"`로 변형을 전수 확인한다.

⚠️ 등재 후 **기존 13개 항목이 새 대상 파일에서 발화하지 않는지** 먼저 확인한다.
범위를 넓히면 이미 있던 항목이 새 파일에서 걸릴 수 있다.

### DEC-4 · 폐기 문구 목록을 **shipped 모듈**로 옮긴다 (SSOT 하나)

새 파일 `scripts/req/lib/retired-claims.ts`가 정본이 된다.

```ts
export interface RetiredClaim { text: string; why: string }
export const RETIRED_CLAIMS: readonly RetiredClaim[] = [ … ]
```

- `tests/unit/docs-stale-claims.test.ts`가 이것을 **import**한다(테스트 안의 사본을 없앤다).
- 새 진단 D29도 같은 목록을 쓴다.
- `scripts/req`는 `package.json`의 `files`에 있으므로 **소비자에게 배포된다**.

**근거**: 목록이 테스트에만 있으면 소비자 쪽 진단이 그것을 볼 수 없다. 두 벌로 두면
한쪽만 갱신되는 순간 진단이 조용히 거짓이 된다 — 이 저장소가 자산 skew로 두 번 데인 지점이다.

#### 🔴 정본 결속 — **구조로 막고, 참조로 확인하고, 행동으로 검증한다**

설계 리뷰 r01·r02가 연속으로 지적한 지점이다. r02의 지적이 정확했다:
*"전수 발화 테스트는 **사본이 정본보다 적을 때만** 잡는다. 내용이 같은 사본은 통과한다."*

그래서 오라클 하나로 닫지 않고 **세 겹**으로 간다.

**① 구조 — `req-doctor.ts`는 목록을 import하지 않는다**

매칭을 정본 모듈이 소유한다. `req-doctor`는 **함수만** 가져간다.

```ts
// scripts/req/lib/retired-claims.ts  (정본)
export interface RetiredClaim { text: string; why: string }
export const RETIRED_CLAIMS: readonly RetiredClaim[] = [ … ]
/** 본문에서 폐기 주장을 찾는다. **매칭의 정본**이다. */
export function retiredClaimsIn(text: string): RetiredClaim[] {
  return RETIRED_CLAIMS.filter((c) => text.includes(c.text))
}
```

```ts
// scripts/req/req-doctor.ts
import { retiredClaimsIn, type RetiredClaim } from './lib/retired-claims'
// 🔴 `RETIRED_CLAIMS`를 import하지 않는다 — 배열을 손에 쥐지 않으면 사본을 둘 자리가 없다.
export { retiredClaimsIn } from './lib/retired-claims' // 테스트가 결속을 확인하는 seam
```

배열을 받지 않으므로 **"동일한 배열 사본"을 둘 자연스러운 자리가 사라진다.**
사본을 두려면 매칭 함수 자체를 재구현해야 하고, 그것은 ②가 잡는다.

**② 참조 동일성 — 재수출된 함수가 정본과 같은 객체인가**

```ts
expect(doctorRetiredClaimsIn).toBe(canonicalRetiredClaimsIn) // 같은 함수 객체여야 한다
```

내용이 같은 사본 구현은 `toBe`를 통과하지 못한다. r02가 지적한
"동일한 배열 사본" 시나리오가 여기서 막힌다.

**③ 행동 전수 — `main()`을 통해 정본의 모든 항목이 발화하는가**

`RETIRED_CLAIMS`의 각 항목을 `AGENTS.md`에 넣고 실제 진입점을 돌려 D29를 확인한다.
①②가 정적 결속을 보장하고, ③은 **배선**을 보장한다(재수출만 해 놓고 다른 것을 호출하는 경우).

**🔴 남는 한계(명시)**: ①②③을 모두 통과하면서 `main()` 안에서만 사설 재구현을 호출하는 코드는
이론적으로 가능하다. 그러려면 재수출한 함수를 **쓰지 않는 죽은 코드**로 두어야 하고,
그 순간 두 목록이 어긋나면 ③이 실패한다. 이 잔여 위험은 **감수한다** — 그것을 없애려면
소스 정규식이 필요한데, 이 저장소는 *"권위를 관찰에서 구하지 마라"*(REQ-2026-099)를 이미
학습했고 그 길을 두 번 폐기했다.

### DEC-5 · 새 진단 **D29** — 소비자 계약 파일의 폐기된 주장

| 항목 | 값 |
|---|---|
| id | `D29` (등록부 `D_CHECK_IDS`에 추가 → 타입이 등재를 강제) |
| level | **WARN 전용** (제약 5 — 진행을 막지 않는다) |
| 대상 | 소비자 저장소 루트의 `AGENTS.md`, 그리고 있으면 `AGENTS.commitgate.md` |
| 판정 | `RETIRED_CLAIMS`의 `text`가 부분 문자열로 있으면 WARN |
| 부재·읽기 실패 | **OK**(점검 불요) — 진단이 사람을 막지 않는다 |

🔴 **`runChecks`는 순수해야 한다**(기존 계약). 파일 읽기는 `main()`이 하고 결과만 `DoctorInputs`로
넘긴다 — D19·D20·D21이 이미 그 형태다(`main()`이 읽어 채운다).

🔴 **죽은 항목 탐지 테스트를 통과해야 한다.** 등록부의 모든 id는 입력 변형 4개 중 하나에서
발화해야 하므로, D29는 입력이 없을 때도 **OK를 push**한다(D20·D21의 "점검 불요" 선례와 동일).

**메시지**: 무엇이 왜 틀렸는지와 **어떻게 고치는지**(해당 문장을 지우거나 현재 동작으로 갱신)를 담는다.
사유를 새로 쓰지 않고 `RETIRED_CLAIMS`의 `why`를 그대로 쓴다 — 두 표면이 다른 말을 하면
사람이 어느 쪽이 맞는지 판단해야 한다(D28이 같은 이유로 사유 재작성을 금지했다).

### DEC-6 · phase 2분할

정정(텍스트 진실성)과 신설 진단(소비자 알림)은 **독립적으로 값을 한다.**
Phase 1만 반영해도 거짓은 사라지고, Phase 2는 기설치 소비자에게 알리는 별도 기능이다.
합치면 10파일이라 granularity 권고(8)를 넘는다.

## Phase별 구현

- **Phase 1 (`phase-1-notice-truth`)** — 6곳 정정 + 가드 범위 확장 + 변형 등재 + 상수 검증.
- **Phase 2 (`phase-2-retired-claims-check`)** — `retired-claims.ts` 정본화 + D29 + 정본 표 + 진단 테스트.

## 변경 파일

**Phase 1 (6)**

| 파일 | 변경 |
|---|---|
| `bin/setup.ts` | `STOP_GATE_HIGH_NOTICE` 문구 + 위 주석의 근거 서술 |
| `AGENTS.template.md` | 77행 정정 |
| `docs/ssot-design/04-user-roles-and-permissions.md` | 54행 정정 |
| `scripts/req/lib/config.ts` | 39·53·214행 주석 정정 |
| `tests/unit/docs-stale-claims.test.ts` | 대상 확장 · 변형 등재 · 상수 검증 추가 |
| `CHANGELOG.md` | Unreleased |

**Phase 2 (6)**

| 파일 | 변경 |
|---|---|
| `scripts/req/lib/retired-claims.ts` (신규) | `RETIRED_CLAIMS` + **매칭 함수 `retiredClaimsIn` 정본** |
| `tests/unit/docs-stale-claims.test.ts` | 사본 제거 → 정본 import |
| `scripts/req/req-doctor.ts` | `D29` 등록부·입력·검사 · `main()`이 파일 읽어 주입 |
| `docs/ssot-design/07-business-rules-and-state-machines.md` | §3 정본 표에 D29 행 |
| `tests/unit/doctor-retired-claims.test.ts` (신규) | AC-5·AC-6·AC-7 |
| `CHANGELOG.md` | Unreleased 보강 |

## 테스트 oracle (AC ↔ 검증)

| AC | 검증 | 잡는 결함 |
|---|---|---|
| AC-1a | 배포 지침 표면에 폐기 문구가 없다 | 정정 누락(문서) |
| **AC-1b** | **코드 표면 목록**(`bin/setup.ts`·`lib/config.ts`)에 폐기 문구가 없다 | **주석 정정 누락 — r01 P1이 지적한 공백** |
| AC-2 | `STOP_GATE_HIGH_NOTICE`를 import해 값 검사 | 화면 문구가 다시 거짓이 됨 |
| AC-3 | 검사 대상·제외 목록을 **실제로** 단언 + 변이 검사 | 범위가 조용히 축소됨 |
| AC-4 | 변형 문자열을 일부러 넣으면 실패 | 변형 재발 |
| AC-5 | hermetic repo의 `AGENTS.md`에 폐기 문구 → `main()` 실행 → D29 WARN | 배선 끊김 |
| AC-6 | 같은 repo에서 문구 없는 `AGENTS.md` → D29 OK | 오탐 |
| **AC-7a** | 재수출된 `retiredClaimsIn`이 정본과 `toBe` 동일 객체 | **내용이 같은 사본 구현 — r02 P1이 지적한 공백** |
| **AC-7b** | `RETIRED_CLAIMS` 전 항목이 `main()`을 통해 발화 | 배선 끊김·사본 드리프트 |

🔴 AC-5는 **실제 진입점 `main()`을 돌린다**. 이 저장소는 "빌더 직접호출 가드는 배선끊김을 못 잡는다"를
세 번 실증했다(REQ-2026-083·097·099). `doctor-terminal-wiring.test.ts`의 `mkRepo` 패턴을 쓴다.

## 하위호환·안전

- **동작 무변경**: `stopGate` 판정·`userConfirmGate`·커밋 경로 전부 그대로. 서술과 진단만 바뀐다.
- **소비자 파일 무수정**: D29는 읽기만 한다. 계약 보존 원칙(`AGENTS.md`는 사용자 소유)을 지킨다.
- **새 진단은 WARN**: 기설치 소비자의 진행을 막지 않는다. FAIL로 올리면 업그레이드 즉시
  전 소비자의 커밋이 막힌다 — 서술 문제로 그런 비용을 물릴 수 없다.
- **가드 범위 확장의 위험**: 기존 13개 항목이 새 대상에서 발화할 수 있다. Phase 1에서 먼저 확인한다.
- **역사 기록 보존**: `CHANGELOG.md`는 대상이 아니다. 과거 릴리스 노트가 그 시점의 사실을 적은 것은
  거짓이 아니라 기록이다.
