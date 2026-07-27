# REQ-2026-075 계획 — phase 분해 (DEC-WF-027 §9.0)

설계 승인 후 phase별 진행. **각 phase 후 Codex 리뷰·승인 → 다음.**

> **Granularity 정책(REQ-2026-016 Phase C)**: phase 1개는 리뷰 가능한 크기로 — 코드 변경 8파일 이하 권고.
> 🔴 이 REQ는 **설정 두 곳 + 문서**뿐이라 한 phase다. 나눌 검수 면적이 없다.

## Phase 1 — 상한 있는 병렬 · CI concurrency · 문서 (`phase-1-bounded-parallel`)

범위(DEC-1·DEC-4): `vitest.config.ts` · `.github/workflows/ci.yml` · `docs/development.md`/`.en.md` · `CHANGELOG.md`.

순서:
1. `vitest.config.ts` — `fileParallelism: false`를 지우고 `maxWorkers: 2`를 둔다.
   🔴 주석은 **지우지 않고 갱신한다**. REQ-2026-044가 왜 병렬을 껐는지가 이 설정의 존재 이유이고,
   그 맥락을 지우면 다음 사람이 "왜 2인가"를 모른 채 올린다. 적을 것:
   - hang 조건은 `동시 워커 × 워커당 스폰`이라는 것
   - GitHub 러너가 4 vCPU라 그 **절반**에서 멈춘다는 것
   - 되돌리려면 `fileParallelism: false`로 복귀하면 된다는 것
2. `.github/workflows/ci.yml` — `concurrency` 추가.
   🔴 **`main`과 태그(`v*`)는 취소 대상에서 제외**한다(DEC-4). `refs/tags/*`는 `refs/heads/main`과
   다른 ref라 "main이 아니면 취소"로 쓰면 릴리스 검증이 취소된다 — 두 조건을 모두 적는다.
3. `docs/development.md`/`.en.md` — 테스트 실행 방식(상한 있는 병렬)과 **왜 2인지**를 적는다.
4. `CHANGELOG.md` — 🔴 "빨라졌다"가 아니라 **실측 수치**로 적는다(507초 → 310초 · 2237 tests).

Exit:
- `npm test` green + **소요 시간 기록**(설계 실측표와 대조)
- typecheck 0 · `docs:lint` green
- 🔴 **CI 9잡 green 확인** — hang은 러너 리소스에 의존하므로 로컬 통과가 보장이 아니다.
  이것이 이 REQ의 진짜 위험이고 REQ-044가 전면 직렬을 택한 이유다.
- Codex 승인

## 완료
- 게이트 해당분 · 사용자 main 통합(통제점 승인 필요).
- 🔴 후속(별도 REQ): 스폰을 `main()` 직접 호출로 바꾸는 리팩터링(tsx 기동 1.25초/회를 없애는
  가장 큰 레버 · 면적 큼) · 매트릭스 계층화(branch protection 재설정 동반).
