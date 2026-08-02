# REQ-2026-106 요구사항

리뷰 커널: 프롬프트 바이트 골든 + 타입 하강(역방향 의존 해소)

## 배경

2026-08-02 자체 감사 A트랙 마지막(개선 A4). 감사는 `review-codex.ts`(3,040줄) 분해를 제안했다. **분해할지, 어디까지 할지를 측정으로 정했다.**

### 이 파일은 실제로 비용을 물린다(A3의 JSONL 건과 정반대)

| 측정 | 값 |
|---|---|
| `review-codex.ts` 커밋 수 | **52** (다음 파일 `req-doctor.ts` 23의 2.3배) |
| 이 파일을 건드린 서로 다른 REQ | **38** |
| `lib/`이 이 파일에서 타입을 import(역방향) | **3** — `evidence.ts:18`·`review-exception.ts:14`·`review-ledger.ts:22` |
| 이 파일을 import하는 CLI | **9** |

A3에서 JSONL 원장 3형제 제네릭화를 기각한 근거는 "세 파일을 함께 바꾼 커밋 0건 · 총 커밋 4·6·1"이었다. 여기는 정반대다 — **한 파일에 변경이 집중돼 있다.**

### 그러나 감사의 전제 하나는 틀렸다

감사는 "프롬프트 조립은 `main()`을 돌려야만 검증된다"며 추출의 근거로 삼았다. **실측하면 `assembleReviewPrompt`는 이미 export돼 있고 `tests/unit/req-review-codex.test.ts:134`가 직접 호출해 검사한다.** 추출해도 테스트 가능성은 늘지 않는다.

다만 기존 테스트는 `toContain`·순서 비교라 **바이트를 고정하지 않는다.** 공백·구분자·줄바꿈이 바뀌어도 통과한다. 프롬프트는 리뷰어에게 그대로 전달되는 **입력 계약**인데 그 계약이 핀으로 고정돼 있지 않다.

## 요구

1. **프롬프트 바이트 골든을 고정한다.** design·phase 각 조합에 대해 `assembleReviewPrompt`의 출력 전문을 **테스트 내부 literal**과 바이트 비교한다.
   - 🔴 **expected를 SUT로 구성하지 않는다**(REQ-2026-031 교훈: import한 상수로 expected를 만들면 동어반복이 된다). literal을 테스트 파일에 박는다.
   - 🔴 **줄바꿈을 정규화한다**(REQ-2026-042 교훈: autocrlf 환경에서 Write=LF·Edit=CRLF로 갈린다).

2. **`lib/`이 모놀리스에서 타입을 import하는 방향을 끊는다.** 현재 `lib/`의 3개 모듈이 `../review-codex`에서 타입을 가져온다 — **`lib/`이 leaf가 아니다.** 타입 전용 import라 런타임 순환은 없지만 아키텍처 역전 자체가 결함이고, 이 방향이 남아 있는 한 어떤 추출도 순환을 만든다.

   🔴 **옮기는 것은 실제로 필요한 타입만이다**(구현 착수 전 실측으로 범위를 좁혔다). lib 3개가 쓰는 것은 **`ReviewKind`·`ApprovalEvidence` 둘뿐**이다(`evidence.ts:18`·`review-exception.ts:14`·`review-ledger.ts:22`). 초안은 `WorkflowState`도 함께 내리려 했으나 **어떤 lib 모듈도 쓰지 않고**, 의존 폐포로 `PhaseEntry`·`SeriesRecord`·`HumanResolution`·`DesignDocBlobs`·`BlockedReviewMarker`(→`BlockedReviewTarget`)·`ReviewExceptionConfirmed`·`SuccessorOf`까지 6~8개를 파일 곳곳(367·807·1189·1491행 등)에서 끌고 온다. **그것들이 필요해지는 추출(series/budget)은 이 REQ가 명시적으로 미룬 작업이다** — 미룬 일을 위해 지금 옮기는 것은 투기다.

## 비요구(명시적 범위 밖) — 판단 근거를 남긴다

감사는 3개 추출을 더 제안했다. **하지 않는다.**

- **프롬프트 조립 → `lib/review-prompt.ts`(~350줄)**: 테스트 가능성 이득이 **없다**(위 실측 — 이미 export·테스트됨). 남는 이득은 파일 줄 수뿐인데, **줄 수 감소가 곧 개선은 아니다**(A3에서 같은 기준으로 sha256·경로 유틸 통합을 기각했다). 요구 1의 골든이 계약을 고정하고 나면, 이동은 언제든 안전하게 할 수 있으므로 서두를 이유도 없다.
- **series/budget 도메인 → `lib/review-series.ts`(~400줄)**: 100% 순수이고 이미 두터운 테스트(O1-*·O2-*)가 있다. 이동은 조직화일 뿐 안전성을 더하지 않는다.
- 🔴 **`mainImpl`(523줄) 분해**: **하지 않는다.** 이 함수의 **단계 순서가 곧 감사 계약**이고(DEC-A6 — 원장 opened 커밋 → binding 캡처 → 호출 → tamper 검증 → 아카이브 → outcome), 그 순서를 검증하는 단위 테스트는 없다(near-e2e가 관측 가능한 결과만 본다). **순서 계약을 지키는 코드를, 순서를 검증할 오라클 없이 재배치하는 것은 이 도구가 존재하는 이유를 위험에 빠뜨린다.** 분해하려면 먼저 순서 계약의 오라클을 설계해야 하고, 그것은 별도 REQ의 일이다.

## 완료 기준

- `npm test` 그린. 골든 테스트가 **변이검사를 통과**한다(프롬프트 조립부를 한 글자 바꾸면 실패).
- `grep -rn "from '../review-codex'" scripts/req/lib/` **0건** — `lib/`이 leaf가 된다.
- 소비자 영향 0: 프롬프트 바이트·state 스키마·CLI 표면 전부 불변(타입 이동은 런타임 코드가 아니다).
