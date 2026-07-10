# 프로젝트 지침

<!-- 이 파일은 `npx commitgate`가 CLAUDE.md가 없을 때만 생성한 템플릿입니다. 자유롭게 수정하세요. -->

## CommitGate

이 저장소는 **CommitGate**를 쓴다. 코드 변경은 REQ 티켓 단위로 묶이고, Codex가 승인한 staged tree만 커밋된다.

코드를 커밋하게 되는 요청은 일반 구현으로 처리하지 말고 이 워크플로를 따른다.

- **계약 정본**: 저장소 루트의 [`AGENTS.md`](./AGENTS.md). 절대 규칙·통제점·승인 문장이 거기 있다.
  (`<!-- commitgate:contract -->` 마커가 없으면 CommitGate 계약이 아니다 — init이 함께 설치한 루트의 `AGENTS.commitgate.md`를 계약으로 읽고, 사용자에게 `AGENTS.md`로의 병합을 요청하라.)
- **다음 행동은 추측하지 않는다**: `req:next <REQ-id>`가 알려 준다.
  `RUN`은 그대로 실행, `AGENT`는 그 작업 수행 후 `git add`, `AWAIT_HUMAN`은 **멈추고 승인 문장을 그대로** 받는다.
  워크플로 명령은 이 저장소의 **패키지매니저 실행 형식**으로 돌린다. `req:next`의 `RUN` 출력이 정확한 형태를 그대로 보여 준다.
- 자세한 진입 절차는 `/req` 슬래시 커맨드 또는 `.claude/skills/commitgate/SKILL.md`에 있다.
