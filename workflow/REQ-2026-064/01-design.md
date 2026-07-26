# REQ-2026-064 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

| 축 | 현재 | 근거 |
|---|---|---|
| 원장 키 | `LEDGER_KEYS` 12개 — **허용 키와 필수 키가 같은 배열** | `review-ledger.ts`의 `LEDGER_KEYS` |
| 검증 | `for (const k of LEDGER_KEYS) if (!(k in r)) '필수 키 누락'` | `ledgerRowProblems` |
| 직렬화 | `LEDGER_KEYS` 순서 고정 JSON | `serializeLedgerRow` |
| 손상 처리 | `parseLedger`의 `problems`가 비지 않으면 **D5 fail-closed** | `req-doctor` D5 |
| 측정 로그 | `.review-calls.jsonl`이 `review_model`·`review_reasoning_effort` 기록(**gitignore**) | `review-codex.ts`의 `ReviewCallLogRow` |
| 값 원천 | `cfg.reviewModel` · `cfg.reviewReasoningEffort` — codex `-c` override로 가는 그 값 | `review-codex.ts`(단일 배선) |
| 원장 쓰기 지점 | `attempt-opened`(호출 전) · `attempt-closed`(판정 후) | `review-codex.ts` |

## 핵심 설계 결정

### DEC-1 — 🔴 **필수 키와 선택 키를 분리**한다 (하위호환 계약 1·3)
```ts
export const LEDGER_KEYS = [...] as const           // 기존 12개 — 필수, 변경 없음
export const OPTIONAL_LEDGER_KEYS = ['review_model', 'review_reasoning_effort', 'review_provider'] as const
const ALLOWED = new Set([...LEDGER_KEYS, ...OPTIONAL_LEDGER_KEYS])
```
- **허용**: `ALLOWED`에 없으면 "알 수 없는 키"로 거부(오염 방어 유지).
- **필수**: `LEDGER_KEYS`만. 신규 키는 **부재해도 통과**한다 → 기존 커밋 원장이 그대로 유효.
- **엄격**: optional 키가 **있으면** 타입을 검증한다(있는데 틀린 것은 손상이다).

🔴 이 분리가 없으면 키 추가가 **야생의 모든 옛 원장을 무효화**하고 D5가 그 티켓의 리뷰를 전부 막는다.
0.9.10이 이미 배포됐으므로 가정이 아니라 실재 위험이다.

### DEC-2 — 새 행은 신규 키를 **항상 직렬화**한다 (계약 2)
`serializeLedgerRow`가 `[...LEDGER_KEYS, ...OPTIONAL_LEDGER_KEYS]` 순서로 쓴다.
값이 `null`이어도 **키는 존재**한다 — "기록하지 않음"과 "핀하지 않음(전역 상속)"이 구별되어야 한다.
전자는 옛 행(키 부재), 후자는 새 행(`null`)이다.

### DEC-3 — 🔴 이름이 **"핀한 모델"**임을 드러낸다 (정직성 경계)
필드는 `review_model`·`review_reasoning_effort`(`.review-calls.jsonl`과 **같은 이름**)이고,
타입 주석이 *"CommitGate가 이 요청에 핀한 값이며 codex가 실제 실행한 모델을 주장하지 않는다"*를 명시한다.
이름을 `actual_model` 류로 짓지 않는다 — 우리가 모르는 것을 아는 척하는 이름이 된다.

### DEC-4 — `review_provider`는 지금 상수 `'codex'`
provider 추상화는 이 REQ의 비목표다. 다만 **자리를 지금 만들어 둔다** — 나중에 provider가 늘 때
옛 행에 "무엇이 리뷰했는지"가 비어 있으면 그 시점의 감사가 불가능해진다.
값은 리뷰어 어댑터가 알려 주는 id를 쓰되, 현재 구현은 `codex` 하나다.

### DEC-5 — 값의 원천은 **`.review-calls.jsonl`과 동일** (R3)
`cfg.reviewModel`·`cfg.reviewReasoningEffort`를 **호출부에서 한 번 읽어** 두 기록에 같은 값으로 흘린다.
두 곳에서 각자 config를 읽으면 그 사이에 값이 바뀌었을 때 갈라진다.

### DEC-6 — 두 이벤트 **모두** 기록한다 (수용기준 4)
`attempt-opened`(호출 전)와 `attempt-closed`(판정 후) 양쪽에 넣는다.
opened만 넣으면 "무엇으로 호출했는가"는 남지만 **"무엇이 승인했는가"**가 남지 않고,
closed만 넣으면 호출은 됐는데 판정이 안 난 attempt의 모델을 알 수 없다.

### DEC-7 — `req:reconstruct`가 만드는 행도 계약을 따른다
재구성 행은 옛 정보를 모를 수 있다 → **`null`로 직렬화**한다(키는 존재).
`reconstructed: true`가 이미 "원본이 아님"을 말하므로 추가 표시는 불필요하다.

## Phase별 구현

| phase | 내용 | 코드 파일 |
|---|---|---|
| **phase-1** | 하위호환 계약(DEC-1·DEC-2) — 키 분리·검증·직렬화. **기록은 아직 안 한다**(행동 변화 최소) | 2 |
| **phase-2** | 모델·effort·provider 기록(DEC-3~DEC-7) | 3 |
| **phase-3** | 문서(한/영)·CHANGELOG | 0(docs) |

## 변경 파일

- `scripts/req/lib/review-ledger.ts` — `OPTIONAL_LEDGER_KEYS` · 검증 분리 · 직렬화
- `tests/unit/review-ledger.test.ts`(있으면) 또는 신규
- `scripts/req/review-codex.ts` — 두 이벤트에 값 주입(단일 배선)
- `scripts/req/req-reconstruct.ts` — 재구성 행의 `null` 직렬화
- `docs/*` · `CHANGELOG.md`

## 하위호환·안전

- 🔴 **기존 커밋 원장 무효화 없음**(DEC-1): 필수 키 집합을 늘리지 않는다. 이것이 이 REQ의 존재 이유다.
- **오염 방어 유지**: 허용 키 화이트리스트는 그대로 있고 목록만 커진다.
- **손상 판정 유지**: optional 키가 있는데 타입이 틀리면 거부한다(있는데 틀린 것은 손상이다).
- **자연키 불변**: `ledgerRowKey`는 `(ticket, series, attempt, event)` 그대로 — 신규 키가 멱등 판정에 끼지 않는다.
- **정직성**: 기록은 "핀한 값"이며 실제 실행 모델을 주장하지 않는다(DEC-3).

### 미측정 (정직성 경계)

- **야생의 0.9.10 원장으로 직접 회귀 검증하지 못한다** — 이 저장소의 원장은 모두 이 코드가 만든 것이다.
  대신 **신규 키가 없는 행 리터럴**을 테스트에 직접 써서 "옛 행"을 재현한다(SUT로 만든 값이 아니라
  손으로 고정한 리터럴이어야 tautology를 피한다).
