---
description: CommitGate REQ 워크플로로 요구사항을 처리한다 (티켓 발행 → 설계 → Codex 리뷰 → 구현 → 커밋)
argument-hint: <요구사항>
---

이 요청을 일반 구현으로 처리하지 말고, 이 저장소에 설치된 **CommitGate**로 처리하라.

## 요구사항

$ARGUMENTS

위 내용이 아래 네 칸으로 정리되지 않으면 **먼저 사용자에게 물어라.** 추측해서 채우지 마라.

```text
- 무엇을:
- 왜:
- 제약:
- 완료 기준:
```

## 계약

저장소 루트의 `AGENTS.md`를 읽어라. 절대 규칙·통제점·승인 문장의 정본이다.
(`<!-- commitgate:contract -->` 마커가 없으면 init이 함께 설치한 루트의 `AGENTS.commitgate.md`를 계약으로 읽고, 사용자에게 `AGENTS.md`로의 병합을 요청하라.)

## 절차

> 아래 명령은 **저장소의 패키지매니저 실행 형식**으로 돌린다(npm은 `run`과 `--` 구분자가 필요하고, pnpm·yarn은 스크립트 이름을 바로 받는다).
> `npx commitgate` 설치 출력과 `req:next`의 `RUN` 출력이 언제나 이 저장소에 맞는 정확한 형태를 보여 준다 — 그걸 그대로 쓰면 된다.

1. `req:new <slug> --run` — 티켓과 브랜치를 만든다.
2. 그다음부터는 **`req:next <REQ-id>`가 시키는 대로** 한다.
   - `RUN` → 출력된 명령을 그대로 실행 → 다시 `req:next`
   - `AGENT` → 그 작업을 하고 `git add` → 다시 `req:next`
   - `AWAIT_HUMAN` → **멈추고** 출력된 승인 문장을 그대로 받는다
   - `DONE` / `BLOCKED` → 사용자에게 보고
3. 이 루프를 끊지 말고 반복한다. 다음 행동을 스스로 추측하지 마라.

첫 응답은 발행한 REQ 번호, 브랜치, phase 분해, 통제점을 요약해서 보여 준다.
