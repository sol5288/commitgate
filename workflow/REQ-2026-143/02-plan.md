# REQ-2026-143 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고. 초과 시 req:doctor가 D18 WARN(분할 권고·FAIL 아님).

> **테스트 실행 계층(REQ-2026-100)**: 게이트는 테스트를 **실행하지 않는다**.
> - **phase 진행 중**: 변경 영역 테스트 + dispatch/verb 등록 + 정책 구조 가드.
> - **통합 직전 1회**: **전체 스위트** + `verify-range --strict`.
>   🔴 이 REQ 는 코드 변경이 없지만 `req.config.json` 을 바꾼다 — 설정을 읽는 테스트가 있으므로 생략하지 않는다.

🔴 **선행**: 설계 승인 직후 `state.json` 의 `phases[]` 에 `phase-1-errata-and-auto` 를 선언한다.

## Phase 1 — 정오표 + auto 전환 (`phase-1-errata-and-auto`)

범위: REQ-2026-142 의 `01-design.md`·`02-plan.md` 에 `## 정오표 (REQ-2026-143)` 절 추가 ·
`req.config.json` 의 `stopGate` 를 `"auto"` 로 · CHANGELOG.

Exit:
- 🔴 **본문은 한 글자도 고치지 않는다** — 덧붙이기만. `git diff` 로 확인한다.
- 🔴 정오표 3건이 전부 들어 있고, #2 에는 **"vitest 는 매칭 0건이어도 exit 0"** 이라는 위험이 적혀 있다.
- `req:repolicy 2026-143 --run` 으로 스냅샷을 `auto` 로 재채택. 확인 명령은
  `npx tsx scripts/req/req-doctor.ts 2026-143` — 출력에 `OK D32: 정지 정책 일치(stopGate="auto")` 가 있어야 한다.
- `npm run docs:lint` · 전체 스위트 · `verify-range --strict`.
- Codex 승인.

## 도그푸딩 절차(통합 단계 — phase 아님)

1. **위임 없이** `integrate --run` → **exit 1 · 사유 `absent` · trunk 불변** 실측(DEC-4 부정 사례).
2. 사람에게 위임 문장 요청 → 발급:

   ```sh
   npx tsx scripts/req/req-delegate.ts --scope ticket:REQ-2026-143      --source feat/req-2026-143-req-142-errata-and-auto-dogfood      --sentence "<사람이 승인한 문장>" --run
   ```

   🔴 `--source <branch>` 는 **필수**다(설계 r01 P1 — 빠뜨리면 `issueProblem()` 이 거절해 원장에 아무것도
   남지 않고, 다음 integrate 가 계속 `absent` 로 막힌다).
   🔴 `--allow-push`·`--allow-bypass` 는 **주지 않는다**.
3. `integrate --run` → 위임 소비로 자동 병합.
4. `git push` 는 **여전히 별도 승인**이다 — 위임에 원격 권한이 없으므로 도구도 하지 않는다.

## 완료
- 게이트 해당분 · 통합 직전 전체 스위트 1회 + `verify-range --strict` · 위 도그푸딩 절차 결과 보고.
