# 문제 해결 (FAQ)

**Codex CLI가 없으면 어떻게 되나요?**
리뷰 명령이 실패합니다. 조용히 승인 처리하지 않습니다.

**승인 후 코드를 조금 고치면 커밋되나요?**
안 됩니다. 승인된 staged tree와 달라지면 stale 승인으로 보고 다시 리뷰를 요구합니다.

**`state.json`이나 `responses/`는 왜 stage하면 안 되나요?**
워크플로 증거와 상태 파일입니다. source 커밋에 섞이면 승인 바인딩이 흐려지므로 `req:commit`이 막습니다.

**cross-spawn 버전 경고가 나오면 어떻게 하나요?**
대상 프로젝트의 기존 `cross-spawn`이 CommitGate가 검증한 하한보다 낮을 수 있다는 뜻입니다. `npm i -D cross-spawn@^7.0.6`으로 올리세요. CI나 보안 민감 환경에서는 `npx commitgate --strict`를 사용해 경고를 실패로 다루세요.

**두 번 설치하면 덮어쓰나요?**
아니요. 기존 파일은 건너뜁니다. `--force`는 kit이 관리하는 **복사 자산**(스키마·`.claude`/`.cursor` 진입점 포인터)만 강제 갱신합니다. **수정한 스킬·`AGENTS.md`·`CLAUDE.md`·`workflow/.gitignore`는 `--force`로도 덮지 않습니다**(사용자 파일 보존 — [보장과 한계](./guarantees.md)·[에이전트 진입점](./agent-prompt.md) 참조).
