# REQ-2026-106 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

| # | 위치 | 현재 상태 |
|---|---|---|
| 1 | `tests/unit/req-review-codex.test.ts:134-175` | `assembleReviewPrompt`를 직접 호출하지만 `toContain`·`indexOf` 순서 비교만 한다 — **바이트 미고정**. 공백·구분자·줄바꿈이 바뀌어도 통과 |
| 2 | `review-codex.ts:122` `ReviewPromptInput` · `:198` `assembleReviewPrompt` | 이미 export. 이동 없이 골든을 붙일 수 있다 |
| 3 | `lib/evidence.ts:18` | `import type { ApprovalEvidence, ReviewKind } from '../review-codex'` |
| 4 | `lib/review-exception.ts:14` · `lib/review-ledger.ts:22` | `import type { ReviewKind } from '../review-codex'` |
| 5 | `review-codex.ts` | `ReviewKind`·`ApprovalEvidence`·`WorkflowState` 정의처. 9개 CLI가 여기서 import |

## 핵심 설계 결정

### DEC-1 골든은 **테스트 내부 literal**과 바이트 비교한다

```ts
const EXPECTED_PHASE_PROMPT = `---\nREVIEW_BASE_SHA: abc123\n...`  // 파일에 박은 literal
expect(norm(assembleReviewPrompt(input))).toBe(norm(EXPECTED_PHASE_PROMPT))
```

- 🔴 **expected를 SUT로 구성하지 않는다**(REQ-2026-031 교훈). `import`한 상수·템플릿으로 expected를 조립하면 SUT가 바뀔 때 expected도 같이 바뀌어 **동어반복**이 된다.
- 🔴 **`norm`은 CRLF→LF 정규화만 한다**(REQ-2026-042 교훈: autocrlf 환경에서 Write는 LF, Edit는 CRLF를 남겨 같은 내용이 갈린다). 그 외 공백은 **정규화하지 않는다** — 공백이 계약의 일부다.
- 케이스는 **계약이 갈리는 축**만 덮는다: `kind=design` / `kind=phase` / `previousFindingsToClose` 유무. 조합 폭발을 노리지 않는다.

### DEC-2 골든의 값어치는 **변이검사로 증명한다**

골든 테스트는 "통과한다"만으로는 오라클임이 증명되지 않는다(아무것도 안 보는 테스트도 통과한다). 조립부 문자열을 한 글자 바꿔 **실패하는 것을 확인**하고, 편집으로 되돌린다(`git checkout --` 금지 — REQ-2026-082에서 미커밋 작업을 잃은 적이 있다).

### DEC-3 타입은 **정의를 옮기고 모놀리스는 re-export**한다

`lib/review-types.ts`를 만들어 `ReviewKind`·`ApprovalEvidence`·`WorkflowState`(및 그들이 참조하는 보조 타입)의 **정의를 옮긴다**. `review-codex.ts`는 `export type { ... } from './lib/review-types'`로 **re-export를 유지**한다.

- 이유: 9개 CLI가 `from './review-codex'`로 이 타입들을 가져온다. re-export를 유지하면 **호출부를 하나도 건드리지 않고** 역방향 의존만 끊을 수 있다. 검수 면적이 파일 3개로 줄어든다.
- `lib/`의 3개 모듈은 `from './review-types'`로 바꾼다 → `lib/`이 leaf가 된다.
- 🔴 **런타임 코드는 옮기지 않는다.** `type`·`interface`만이다. `.js` 산출물이 없는 타입 전용 이동이라 동작 변화가 원리적으로 불가능하다 — 이것이 이 phase의 안전 논거다.

### DEC-4 어떤 타입까지 내리는가 — **의존 폐포까지만**

`WorkflowState`가 참조하는 `SeriesRecord`·`PhaseEntry` 등이 함께 가야 한다면 함께 옮긴다(타입은 반쪽만 옮길 수 없다). 그러나 **폐포를 넘어서 "관련돼 보이는 것"을 끌고 가지 않는다** — 이 REQ의 목적은 역방향 의존 해소이지 타입 재조직이 아니다. 무엇을 옮겼는지는 typecheck가 판정한다.

## Phase별 구현

| phase | 내용 | 파일 |
|---|---|---|
| `phase-1-prompt-byte-goldens` | 요구 1 — 골든 + 변이검사. **코드 이동 0** | 1 |
| `phase-2-review-types-descent` | 요구 2 — `lib/review-types.ts` 신설·3개 lib 전환·모놀리스 re-export | 5 |
| `phase-3-changelog` | CHANGELOG(앞 phase SHA 포인터 표 포함) | 1 |

phase-1이 먼저인 이유: **안전망을 먼저 친다.** phase-2는 타입만 옮기므로 프롬프트에 영향이 없지만, 순서를 이렇게 두면 이후 어떤 이동이든 골든이 지키고 있다.

## 변경 파일

- phase-1: `tests/unit/review-prompt-golden.test.ts`(신규)
- phase-2: `scripts/req/lib/review-types.ts`(신규) · `scripts/req/review-codex.ts` · `scripts/req/lib/{evidence,review-exception,review-ledger}.ts`
- phase-3: `CHANGELOG.md`

## 하위호환·안전

| 축 | 영향 |
|---|---|
| 프롬프트 바이트 | **불변** — 이 REQ가 그것을 고정하는 것이 목적이다 |
| 타입 이동 | 런타임 코드 없음. `tsc --noEmit`이 완전성을 판정 |
| 9개 CLI 호출부 | **미접촉**(re-export 유지, DEC-3) |
| state·아카이브·원장 | **미접촉** |
| 배포 페이로드 | `scripts/req`가 이미 `files[]`에 있어 신규 파일 자동 포함 |

**되돌리기**: phase별 독립 커밋.
