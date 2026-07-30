# REQ-2026-091 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

| 자리 | 현재 |
|---|---|
| `review-codex.ts` 프롬프트 조립(design) | persona + Review Context + REVIEW_BASE_SHA + REVIEW_KIND + 요청서 + **00/01/02 문서**. 끝 |
| 커밋된 phase 승인 사실 | `<ticket>/responses/approvals.jsonl`(HEAD blob)에 `kind:'phase'` 행으로 존재 — **프롬프트에 안 들어간다** |
| `req-next.ts` `staleBindingNotice` | 도입부가 "**지금** 재결속하지 않으면 …" |

## 핵심 설계 결정

### DEC-1 — 프롬프트에 **커밋된 phase 블록**을 추가한다(있을 때만)

design 리뷰 조립 시, 커밋된 매니페스트에서 `kind:'phase'` 행의 `phase_id`를 모아 블록으로 넣는다.

```
---
# 이미 승인·커밋된 phase (참고 사실)
- phase-1-app-image
- phase-2-compose-profile

이 phase들의 코드는 **이미 커밋됐다** — 설계 문서를 수정해도 그 코드는 바뀌지 않는다.
따라서 이 phase의 결함을 **실제로 고치는 경로는 후속 REQ**다.
이 사실을 severity 판단에 반영하라. **판단은 당신의 것이다** — 이 블록은 무엇이 findings인지 정하지 않는다.
```

- 🔴 **비어 있으면 블록을 넣지 않는다**(R3). 첫 설계 리뷰의 프롬프트는 **바이트 단위로 지금과 동일**하다.
  가장 흔한 경로에 노이즈를 더하지 않고, 기존 byte-identity 테스트도 그 경로에서는 그대로 통과한다.
- 🔴 **결속(binding) 여부는 보지 않는다.** "이미 커밋됐는가"만이 관심사다 — 좌초됐든 아니든 코드는 커밋됐다.

### DEC-2 — 문구는 **사실과 경로**만 주고 severity 판정은 리뷰어에게 남긴다

🔴 **"이 설계 승인을 막는 근거가 아니다" 같은 단정을 넣지 않는다**(design r01 P1). 그렇게 쓰면 이미 커밋된
phase에서 **보안 구멍이나 정상 경로 요구 위반**이 드러났을 때도 리뷰어가 `observations`로만 처리해
**P1 분류가 우회**된다 — 결함을 품은 채 설계가 승인된다.

주는 것은 두 가지뿐이다.

1. **사실**: 그 코드는 이미 커밋됐고, 설계 문서 수정으로는 바뀌지 않는다.
2. **경로**: 그 결함을 실제로 고치는 것은 후속 REQ다.

그리고 **"판단은 당신의 것이다"를 명시**한다. 사실을 안 주면 지금처럼 되돌릴 수 없는 것을 차단 근거로 쓰고,
단정을 주면 심각한 결함이 조용히 통과한다. 사실만 주고 판단을 맡기는 것이 이 프로젝트의 P1 정의
(`machine.schema.json`의 severity description)가 이미 쓰는 방식이다.

### DEC-3 — 데이터 원천은 **커밋된 매니페스트**(HEAD blob)

`createEvidencePorts(...).headText(...)` — intake·D26·`staleBindingNotice`와 **같은 원천**(R4).
읽을 수 없거나 phase 행이 없으면 블록 없음(DEC-1).

### DEC-4 — 파서는 재구현하지 않는다

`parseManifestEntries`(leaf `lib/evidence.ts`)를 쓴다. 매니페스트 파싱이 두 벌이 되면 갈라진다
(REQ-2026-088에서 판정·안내 술어를 재사용한 것과 같은 이유).

### DEC-5 — `staleBindingNotice` 문구를 "티켓을 닫기 전에"로

```
- ⚠️ 설계 재승인으로 앞선 phase의 결속이 끊겼습니다 — **티켓을 닫기 전에** 재결속해야 dev-complete가 발행됩니다.
      (설계가 또 재승인되면 지금 한 재결속은 무효가 되니, 설계가 안정된 뒤 한 번에 하세요.)
```

🔴 왜 필요한가: rebind 행은 `to_design_ref`가 **그때의** design_ref다. 이후 재승인되면 그 행은 산입되지
않아 다시 재결속해야 한다 — 조기 실행은 커밋 1개와 확인 문장 1개를 버리는 것이다(R5).

## Phase별 구현

### phase-1-shipped-phases-block (DEC-1~4)

- `scripts/req/review-codex.ts`
  - 순수 `committedPhaseIds(manifestText)` — `parseManifestEntries` 위임, 정렬·중복 제거.
  - 순수 `shippedPhasesBlock(ids)` — 비면 `null`.
  - 프롬프트 조립 인자에 `shippedPhaseIds?: readonly string[]` 추가 → design 분기에서 문서 블록 **뒤**에 삽입.
  - `mainImpl`이 HEAD blob으로 값을 채운다(design 리뷰일 때만).
- `tests/unit/req-review-codex.test.ts` — 회귀 가드 + **byte-identity 기대값 갱신**(커밋된 phase가 있는 경우)

회귀 가드: ①커밋된 phase 있음 → 블록에 그 id들이 실리고 **후속 REQ 경로 + "판단은 당신의 것"**이 명시됨 · 🔴 "막는 근거가 아니다"류 단정이 **없음**
②🔴 **비었을 때 프롬프트가 기존과 바이트 동일**(대조군: 블록 인자 없이 조립한 결과와 `===`)
③phase 리뷰는 무영향 ④매니페스트 부재·파손 → 블록 없음 ⑤결속 끊긴 phase도 포함(DEC-1 — 커밋 여부만 본다).

Exit: typecheck0 · 전체 스위트 그린 · Codex phase 리뷰 승인.

### phase-2-notice-timing (DEC-5) + CHANGELOG

- `scripts/req/req-next.ts` — `staleBindingNotice` 도입부 문구.
- `tests/unit/req-next.test.ts` — "지금"이 없고 "닫기 전에"·"안정된 뒤"가 있음을 고정.
- `CHANGELOG.md` — Unreleased + **확인할 파일 표**(phase-1 커밋 SHA·경로).

Exit: typecheck0 · 전체 스위트 그린 · Codex phase 리뷰 승인.

## 변경 파일

| 파일 | phase |
|---|---|
| `scripts/req/review-codex.ts` · `tests/unit/req-review-codex.test.ts` | 1 |
| `scripts/req/req-next.ts` · `tests/unit/req-next.test.ts` · `CHANGELOG.md` | 2 |

## 하위호환·안전

- **커밋된 phase가 없으면 프롬프트가 바이트 동일**(DEC-1) → 첫 설계 리뷰·legacy 경로 무회귀.
- 인자 미지정(legacy 호출)이면 블록 없음 → 기존 테스트·호출부 그대로.
- D13·`design_hash`·phase 결속 모델 **무변경**. 이 REQ는 재승인의 **빈도**를 줄이는 것이고
  재승인이 phase를 좌초시키는 안전 속성 자체는 유지된다.
- 리뷰어의 P1 판정 권한 **무변경**(DEC-2) — 사실과 경로만 준다.
- 스키마·config 무변경 → `commitgate sync` 불요.
