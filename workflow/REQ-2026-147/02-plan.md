# REQ-2026-147 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님).

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**.
> - **phase 진행 중**: 변경 영역 테스트 + `tests/unit/dispatch.test.ts`.
> - **통합 직전 1회**: **전체 스위트**(`npm test`) + `verify-range --strict`.

🔴 **선행**: 설계 승인 직후 `state.json` 의 `phases[]` 에 아래 두 id 를 선언한다.

```
phase-1-nonconvergence-analyzer · phase-2-hardcap-report-wiring
```

## Phase 1 — 비수렴 분석기 (`phase-1-nonconvergence-analyzer`)

범위: `scripts/req/lib/nonconvergence.ts` — 원장 행 + 라운드 verdict 를 받는 **순수** 함수.
반복 축(DEC-2) · 네 갈래 분해안(DEC-3) · 상태 기반 선택지(DEC-4) · 상한(DEC-5) · 보고 조립.

Exit:
- 🔴 **결정론**: 같은 입력이면 같은 문자열. 입력 배열 순서를 뒤집어도 결과가 같다.
- 🔴 반복 축은 **2라운드 이상**만. 1회 등장은 담기지 않는다.
- 🔴 **네 갈래가 각각 다른 문구**를 낸다 — 특히 **"분석할 자료가 없다"와 "매 라운드 지적이 달랐다"가
  구별**된다(REQ-2026-144 r06 P1). 자료 0개일 때 분해안을 내지 않는다.
- 파손된 라운드 하나는 **건너뛰고 나머지로** 만든다.
- 🔴 선택지는 **상태에서 계산**된다 — 열린 attempt 가 없으면 `--close-stale` 을 내지 않는다.
- 🔴 **CommitGate 명령 줄**은 전부 `npx commitgate ` 로 시작하고 `--run` 으로 끝난다.
  🔴 `git commit` 같은 비-CommitGate 정리 명령은 이 검사에서 **제외**한다(REQ-2026-145 r02 P1).
- 🔴 출력에 **`<` 가 없다**(PowerShell 리디렉션으로 명령이 죽는다). slug 는 `successorSlug` 로 산출.
- 🔴 선택지에 **hardCap 증액이 없다**(고정 문자열 부재 검사).
- 🔴 상한 준수: 라운드 요약 1줄 · 반복 축 3개 · **명령 5줄 이하**(선행 1 + A 1 + B 3).
- 🔴 **갈래 B 는 티켓이 더러우면 파킹 줄을 포함**한다(설계 r01·r02 P1 — 없으면 `req:new` 가
  clean-worktree 검사에 막혀 갈래 B 가 실행 불가). 깨끗하면 그 줄을 내지 않는다.
- 🔴 파킹 줄은 **`git add -- <티켓 디렉터리> && git commit …`** 이다. `git commit -m` 만으로는
  untracked needs-fix 아카이브가 남아 `req:new` 가 실패한다(r02 P1). `git add -A` 는 쓰지 않는다.
- 🔴 **티켓 밖 더러운 경로는 데이터로 열거**하고 명령으로 만들지 않는다(도구가 그 파일이 뭔지 모른다).
- 계약 스위트: `npx vitest run tests/unit/nonconvergence.test.ts tests/unit/dispatch.test.ts`
- Codex 승인.

## Phase 2 — 배선 (`phase-2-hardcap-report-wiring`)

범위: `review-codex.ts` 의 `hard-blocked` 분기가 보고를 실어 throw · 실패 시 **원문 fallback** ·
`docs/workflow*.md` · CHANGELOG.

Exit:
- 🔴 **보고 생성이 실패해도 `hard-blocked` 는 여전히 throw** 한다(주입 실패로 실증 — 무회귀 오라클).
- 🔴 `checkReviewBudget`·`budgetCounts` 는 이 REQ 의 diff 에 **나타나지 않는다**.
- 🔴 원장·아카이브가 **없는** 티켓에서도 차단이 정상 동작한다.
- 🔴 출력 머리에 **"조언(감사 증거 아님)"** 이 있다.
- 계약 스위트 + `npx vitest run tests/unit/req-review-codex.test.ts`
- Codex 승인.

## 완료
- 게이트 해당분 · **통합 직전 전체 스위트 1회 + `verify-range --strict`**.
- 🔴 이 브랜치는 **REQ-2026-144 의 파킹·종결 커밋을 포함**한다(대체 lineage). 통합하면 그 종결 기록도
  함께 main 에 들어간다 — 의도한 것이다.
- 통합은 `stopGate: "auto"` 다. 사전 위임을 받거나 `[B1]` direct push 를 사람이 승인한다.
