# 프로젝트 지침

<!-- 이 파일은 `npx commitgate`가 CLAUDE.md가 없을 때만 생성한 템플릿입니다. 자유롭게 수정하세요. -->

<!-- commitgate:quickstart -->
## CommitGate — 빠른 시작 (첫 요청에서 이대로)

이 저장소의 코드/문서 변경은 CommitGate REQ 워크플로로만 처리한다. 일반 구현으로 바로 커밋하지 않는다.

1. 요청이 [무엇 / 왜 / 제약 / 완료 기준]으로 정리되지 않았으면 **먼저 사용자에게 확인**한다. 추측해서 채우지 않는다.
2. `package.json`의 `req:new` 스크립트와 `req.config.json`의 `packageManager`를 확인해, 이 저장소의
   패키지매니저 실행 형식으로 `req:new <슬러그>`를 실행해 REQ 티켓·브랜치를 만든다. 형식을 추측하지 않는다.
3. 그다음부터 매 단계는 `req:next <REQ-id>`의 출력만 따른다. `kind`가 정본이다:
   - `RUN`         → 출력된 명령을 그대로 실행하고 다시 `req:next`
   - `AGENT`       → 구현·검증·명시적 `git add` 후 다시 `req:next`
   - `AWAIT_HUMAN` → **멈춘다.** 출력된 승인 문장을 그대로 받기 전에는 진행하지 않는다
   - `DONE`        → 이 티켓 종료. 통합·릴리즈는 별도 통제점
   - `BLOCKED`     → 사람에게 보고. **같은 리뷰를 재시도하지 않는다**
4. 리뷰가 `NEEDS_FIX`면 지적(findings)을 고친 뒤 다시 `req:next`로 돌아간다.
5. `state.json`·`responses/`는 직접 `git add` 하지 않는다 — 도구가 관리한다.
6. 커밋은 `req:next`가 `RUN`으로 지시할 때 `req:commit`으로만 한다. 스스로 `req:commit`을 호출하지 않는다.
   직접 `git commit`은 CommitGate 자체 스캐폴딩 산출물(`init`·`migrate`·`sync`가 쓴 파일)을 커밋할 때만 쓴다.
<!-- /commitgate:quickstart -->

- 세부 규칙·통제점·승인 문장의 **정본**은 루트 [`AGENTS.md`](./AGENTS.md)이다.
  (`<!-- commitgate:contract -->` 마커가 없으면 CommitGate 계약이 아니다 — init이 함께 설치한 루트의 `AGENTS.commitgate.md`를 계약으로 읽고, 사용자에게 `AGENTS.md`로의 병합을 요청하라.)
- Claude Code에서는 `/req` 슬래시 커맨드로 시작할 수도 있다. 진입 절차 상세는 `.claude/skills/commitgate/SKILL.md`.
