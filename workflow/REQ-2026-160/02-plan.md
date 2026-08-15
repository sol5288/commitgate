# REQ-2026-160 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**.
> - **phase 진행 중**: 그 phase 의 계약 스위트만.
> - **통합 직전 1회**: **전체 스위트**(`npm test`) + `bin/verify-range.ts --base main --head HEAD --strict`.

🔴 **선행**: 설계 승인 직후 `state.json` 의 `phases[]` 에 아래 id 를 **객체 형태**로 선언한다
(`{id,title,status,max_files,approved}` — 문자열 배열이 아니다).

```
phase-1-manual-confirm-gate
```

## Phase 1 — 수동 확인 게이트 (`phase-1-manual-confirm-gate`)

Exit — **판정**:
- 🔴 `DelegationGateResult` 에 `manual-confirmation-required` 를 추가하고, **`scope === null` 이고
  fail-closed 사실이 하나도 없을 때만** 낸다. 다른 거부 사유는 `denied` 그대로다.
- 🔴 **DEC-1a — fail-closed 선평가**: scope 미판정 경로에서도 정책 대상(커밋 귀속)의 `state.json`
  에서 위험 사실을 보수적으로 합쳐 **HIGH · hardCap · 리뷰 미판정이면 `denied`** 를 먼저 낸다.
  HIGH 는 `--high-risk` 위임으로만 풀리는데 이 경로에는 위임 자체가 없다.
- 🔴 `scope !== null` 경로의 사실 수집·판정은 **한 줄도 바꾸지 않는다**(무관한 티켓의 HIGH 가
  정상 통합을 막는 거짓 거부를 만들지 않기 위해서다).
- 🔴 `denied` 를 **사유 문자열로 재분류하지 않는다** — 문자열이 바뀌면 조용히 열린다.
- 🔴 `runIntegrate`: `denied` → 즉시 exit 1 · `manual-confirmation-required` → 사유 출력 후
  비대화형 exit 1 · 대화형은 기존 최종 `[y/N]`(기본 No)로 진행.
- 🔴 CAS 선점·strict 재검증·`gate.kind === 'allowed'` 에 걸린 소비/push 경로를 **바꾸지 않는다**.

Exit — **회귀(`runIntegrate` 를 태운다)**:
- 🔴 DEC-3 의 **여덟** 시나리오.
- 🔴 **#4·#5·#6(scope 미판정 + hardCap/HIGH/BLOCKED + 대화형 `y` → 병합 안 됨)이 핵심 오라클**이다.
- 🔴 **변이 3건**: ① 새 결과를 `denied` 로 되돌리면 #2 red · ② 모든 `denied` 를 대화형에서
  열어 주면 **#7 red** · ③ fail-closed 선평가를 빼면 **#4·#5·#6 red**.
- 🔴 대화형 경로에서 **`push` 호출 0회**를 센다(권한이 없으므로).

Exit — **계약·문서**:
- 🔴 `AGENTS.template.md` · `docs/workflow.md`(한/영)이 **두 가지를 구분**해 적는다:
  scope 미판정만 대화형 확인으로 열리고, **다른 거부 사유는 사람 확인으로도 열리지 않는다**.
- 🔴 `tests/unit/agent-autonomy-contract.test.ts` 가 그 구분을 검사한다 —
  **"열리지 않는다"쪽 문장이 없으면 red**. 열리는 쪽만 검사하면 절반만 지킨다.

Exit — **무회귀**:
- 🔴 기존 `integrate`·`delegation` 테스트가 그대로 통과한다.
- 🔴 `npm run docs:lint` 통과.

- 계약 스위트: `npx vitest run tests/unit/integrate-delegation.test.ts tests/unit/integrate-verb.test.ts tests/unit/ci-workflow-policy.test.ts tests/unit/agent-autonomy-contract.test.ts tests/unit/docs-stale-claims.test.ts` + `npm run docs:lint`
- Codex 승인.

## 완료
- 게이트 해당분 · **통합 직전 전체 스위트 1회 + `verify-range --strict`** · CHANGELOG.
- 🔴 CHANGELOG 는 **"열리는 것 하나 / 열리지 않는 것 전부"** 를 구분해 적는다 — 안내가 아니라
  **어떤 거부가 사람 확인으로 통과 가능한지**가 사용자에게 중요한 사실이다.
- 통합은 `stopGate: "auto"` 다. 사전 위임 또는 `[B1]` direct push 를 사람이 승인한다.
  🔴 **main 이 origin 보다 앞서 있다**(REQ-2026-159 재결속·dev-complete 부기 3커밋 미push).
  통합 승인 때 함께 밀 것.
