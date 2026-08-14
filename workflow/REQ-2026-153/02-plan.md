# REQ-2026-153 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고.

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**.
> - **phase 진행 중**: 변경 영역 테스트 + `tests/unit/dispatch.test.ts`.
> - **통합 직전 1회**: **전체 스위트**(`npm test`) + `bin/verify-range.ts --base main --head HEAD --strict`.
>   🔴 `verify-range` 는 `scripts/req/` 가 아니라 **`bin/`** 이고 인자는 `--base`/`--head` 다.

🔴 **선행**: 설계 승인 직후 `state.json` 의 `phases[]` 에 아래 id 를 선언한다.

```
phase-1-hardblocked-path-realpath
```

## Phase 1 — 경로 정규화 (`phase-1-hardblocked-path-realpath`)

범위: `hardBlockedReport` 의 root·티켓 경로 정규화 · `toTicketRel` 순수 함수 · 링크 재현 테스트.

Exit:
- 🔴 **순수 함수 `toTicketRel` 회귀**(항상 실행): 같은 수준으로 정규화된 두 절대경로에서
  POSIX 상대경로를 낸다. win32 구분자(`\`)가 `/` 로 바뀐다. 티켓이 root 밖이면 `..` 를
  **감추지 않고** 그대로 돌려준다.
- 🔴 **링크 재현 e2e**: `symlinkSync(realRepo, link, 'junction')` 으로 링크를 만들고 **링크 경유
  티켓 경로**로 `hardBlockedReport` 를 부른다. 보고에 파손 아카이브(`r03`)가 **실리지 않는다** =
  티켓 안팎 분류가 옳다. (지금은 macOS·Windows CI 에서 실린다.)
- 🔴 **변이 검사**: `resolveReal` 을 항등으로 되돌리면 위 e2e 가 **red**. red 가 아니면 재현이
  성립하지 않은 것이므로 **통과시키지 말고 보고한다.**
- 🔴 **링크 생성 실패 시**: 조용히 skip 하지 않는다 — 사유를 출력하며 skip 하고, 순수 함수
  테스트는 그대로 돈다(두 층).
- 🔴 **차단 무회귀**: 이 스위트의 첫 오라클("보고가 차단을 흔들 수 없다") 4건이 그대로 통과한다.
  특히 `티켓 디렉터리가 아예 없어도 차단한다` — `realpathSync` 가 던져도 차단이 유지된다.
- 🔴 **실경로 환경 무회귀**: 링크가 없는 기존 fixture 들의 보고 내용이 **바뀌지 않는다**.
- 🔴 **DEC-3 경계**: 역슬래시 → `/` 는 **경로 구분자** 변환이며 git 이 준 경로에는 적용하지 않는다
  (REQ-2026-152 계약 무회귀) — 소스 가드로 고정.
- 계약 스위트: `npx vitest run tests/unit/hardblocked-report.test.ts tests/unit/nonconvergence.test.ts tests/unit/req-review-codex.test.ts tests/unit/dispatch.test.ts`
- Codex 승인.

## 완료
- 게이트 해당분 · **통합 직전 전체 스위트 1회 + `verify-range --strict`** · CHANGELOG.
- 🔴 CHANGELOG 는 **게이트 차단은 정상이었고 보고 내용만 틀렸다**는 범위를 정확히 적는다.
  과장하지 않는다.
- 🔴 통합 후 **CI 를 한 번 돌려 확인**할 것을 사람에게 제안한다(이 저장소 CI 는 수동 전용이고,
  이 결함은 CI 로만 관측된다). 🔴 에이전트가 임의로 실행하지 않는다.
- 통합은 `stopGate: "auto"` 다. 사전 위임 또는 `[B1]` direct push 를 사람이 승인한다.
- 🔴 이 브랜치는 **REQ-2026-152 위에** 쌓여 있다(`req:new` 가 main 아님을 경고했다) — 병합하면
  152 도 함께 들어간다. 통합 요청 시 그 사실을 밝힌다.
