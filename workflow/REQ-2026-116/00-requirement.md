# REQ-2026-116 요구사항

로컬 머지 전 승인 증거 검증(verify-range) + GitHub CI opt-in

## 배경 (무엇이 문제인가)

1. **커밋 범위의 승인 증거를 로컬에서 입증할 수단이 없다.** D25/D30은 **티켓 단위**로 close proof·리뷰
   증거의 trunk 도달만 본다. "이 커밋 범위(base..head)의 각 커밋이 CommitGate 절차를 거쳤는가"를 묻는
   검사가 없다. 실제 소비자 감사(2026-08 yammy)에서 특정 비교 범위의 48개 커밋이 consumed approval
   SHA·부기 trailer·워크플로 증거 어느 것으로도 통과 여부를 입증할 수 없었다 — 우회 단정은 못 하지만,
   **입증 불가 자체가 감사 전제(P-C)의 구멍**이다.
2. **GitHub CI 정책이 성문화돼 있지 않다.** 확정 정책: GitHub CI는 사용량·비용이 있으므로 CommitGate의
   필수 게이트가 아니다. 현재 실행 코드에 GitHub API/`gh` 호출은 0건이고(전수 조사 완료) 소비자에게 CI를
   요구·설치하지 않지만, (a) 머지 직전 절차 자체가 없어 opt-in 흐름도 없고, (b) 문서에 "CI는 선택이며
   비용이 발생할 수 있다"는 고지가 없으며, (c) SSOT 로드맵 STR-01은 "GitHub Actions를 protected branch의
   required check로 사용한다"를 목표로 서술해 **정책과 충돌**한다.

## 요구

- **R1 · verify-range 로컬 검증** — `base..head` 범위의 커밋 전수를 로컬 git·커밋된 증거만으로 분류한다:
  승인 소비 커밋(consumed approval SHA) · 도구 부기 커밋(trailer) · 머지 커밋 · **미입증 커밋**.
  네트워크·GitHub 인증·gh CLI 없이 동작한다. GitHub-hosted runner를 쓰지 않는다.
- **R2 · GitHub CI opt-in (머지 직전 절차)** — verify-range가 머지 직전 절차를 제공하므로 확정 정책의
  opt-in 계약을 그대로 구현한다:
  - 대화형: "GitHub CI 검사를 실행하시겠습니까? 비용 또는 사용량이 발생할 수 있습니다. [y/N]" —
    **기본 No**. Enter/`n` → CI 생략, 로컬 검증만으로 계속.
  - 명시 플래그: `--github-ci`(실행) / `--no-github-ci`(생략). 둘 다 주면 오류(fail-closed).
  - 비대화형(또는 `--json`): 플래그 없으면 **생략**이 기본.
  - opt-in은 **실행 단위**다 — 과거 선택을 저장·재사용하지 않는다.
  - 명시적으로 요청한 CI 확인이 실패(미설치·미인증·네트워크·실행 없음·red)하면 **명확히 표시하고
    실패 exit** — 조용히 무시하지 않는다.
  - CI를 요청하지 않은 경로에서는 GitHub 인증·gh·네트워크가 **일절 필요 없다**.
  - 생략은 정상 상태로 표기한다(실패처럼 보이지 않게).
- **R3 · 로컬 감사 로그** — 검증 요약과 CI 선택 결과를 `workflow/.verify-runs.jsonl`(gitignored)에
  append 기록한다. 민감정보·프롬프트 본문·파일 내용은 기록하지 않는다. 쓰기 실패는 판정을 바꾸지 않는다.
- **R4 · 배선과 문서** — `req:next` 통합 통제점(AWAIT_HUMAN) 안내에 verify-range 사용을 한 줄 노출한다
  (신호만 추가하고 사용지침 없으면 죽은 기능 — 이 저장소의 실측 교훈). 문서(workflow·guarantees 한/영)에
  GitHub CI가 선택이며 비용·사용량이 발생할 수 있음을 명시하고, STR-01의 "required check 사용" 목표
  서술을 정책에 맞게 정정한다.

## 제약

- 기존 게이트(D-체크·리뷰 게이트·req:commit)의 동작을 바꾸지 않는다. 새 verb는 읽기 전용 진단 +
  로컬 로그 append뿐이다.
- 테스트는 실제 GitHub API·GitHub Actions를 호출하지 않는다 — CI 확인은 포트(어댑터)로 분리하고
  테스트는 fake를 주입한다.
- CommitGate는 워크플로를 트리거(dispatch)하지 않는다 — opt-in의 의미는 head SHA에 대한 **CI 결과
  확인(조회)**이다. push·PR 생성·브랜치 갱신을 CommitGate가 유발하지 않는다.
- 보장 경계: 단일 활성 worktree·협조적 작업자·정상 경로. squash/rebase로 재작성된 이력의 커밋은
  승인 소비 SHA와 일치하지 않으므로 **미입증으로 정직하게 보고**한다(절대 보장 표현 금지).
- 소비자 저장소가 가진 GitHub Actions 설정을 삭제·변경하지 않는다.

## 완료 기준 (회귀 테스트로 고정)

1. 대화형·설정 없음·Enter → CI 어댑터 미호출, 로컬 검증은 수행.
2. 대화형 `n` → 미호출.
3. 대화형 `y` → 어댑터 **정확히 1회** 호출.
4. 비대화형·옵션 없음 → 미호출.
5. `--github-ci` → 호출.
6. `--no-github-ci` → 미호출.
7. `--github-ci`인데 어댑터 실패 → 실패 표시 + 실패 exit(머지 절차 중단 신호).
8. CI 생략 경로에서도 커밋 범위 분류·미입증 목록은 항상 산출된다.
9. gh·GitHub 인증이 없는 환경에서도 기본(생략) 경로는 정상 동작한다.
10. 단위·통합 테스트가 실제 GitHub 사용량을 소비하지 않는다(fake 주입 구조).
