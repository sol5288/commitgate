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

**`req:doctor`가 `workflow/.review-calls.jsonl` 때문에 D10 FAIL을 내며 커밋이 전부 막힙니다.**
0.9.6 이하로 설치한 저장소에서 발생합니다. 리뷰 측정 로그(`workflow/.review-calls.jsonl`)는 `req:review-codex`가 저장소 루트에 남기는 스크래치인데, 그 버전의 배포 템플릿에 무시 규칙이 빠져 있어 `??`로 남고 D10이 클린 트리 위반으로 판정합니다. `workflow/.gitignore`에 누락 규칙을 보강하세요:

```
npx commitgate sync --gitignore --apply
```

기존 행은 변경·재정렬하지 않고 **없는 규칙만 말미에 추가**합니다(이미 있으면 아무것도 하지 않습니다). 0.9.7 이상에서는 `req:doctor`가 이 상황을 **D22 WARN**으로 미리 알려 줍니다(경고일 뿐 커밋을 막지 않습니다).

**이미 `workflow/.review-calls.jsonl`을 커밋해 버렸습니다.**
무시 규칙만 추가해서는 빠지지 않습니다 — git은 **이미 추적 중인 파일**을 `.gitignore`로 제외하지 않기 때문입니다. 추적에서만 제거하고(로컬 파일은 남습니다) 규칙을 유지하세요:

```
npx commitgate sync --gitignore --apply
git rm --cached workflow/.review-calls.jsonl
git commit -m "chore: stop tracking review-call measurement log"
```

이 로그는 측정 전용이라 커밋 대상이 아닙니다. 승인 원장(`responses/approvals.jsonl`)과 승인 아카이브는 이와 무관하게 계속 커밋됩니다.

## 런타임 생성 파일 인벤토리

CommitGate 실행 중 소비 저장소에 만들어지는 파일과 그 처리 방침입니다.

| 파일 | 생성 위치 | ignore 정책 | init 배포 자산 | sync 소유자 | Git 영속 |
|---|---|---|---|---|---|
| `workflow/.review-calls.jsonl` | 저장소 루트의 `workflow/` | `workflow/.gitignore`의 `/.review-calls.jsonl` | 예(`templates/workflow.gitignore`) | `sync --gitignore` | 아니오(측정 전용) |
| `workflow/REQ-*/codex-response.json` | 티켓 직계 | `/REQ-*/codex-response.json` | 예(동일) | `sync --gitignore` | 아니오(스크래치) |
| `workflow/REQ-*/.review-preview.txt` | 티켓 직계 | `/REQ-*/.review-preview.txt` | 예(동일) | `sync --gitignore` | 아니오(스크래치) |
| `workflow/REQ-*/.codex-*.tmp` | 티켓 직계 | `/REQ-*/.codex-*.tmp` | 예(동일) | `sync --gitignore` | 아니오(임시) |
| `workflow/REQ-*/state.json` | 티켓 직계 | 없음(추적 대상) | 아니오(`req:new`가 생성) | 없음 | 예(스캐폴드만) — 실행 중 변경은 커밋하지 않는 작업 상태 |
| `workflow/REQ-*/responses/*-rNN-*.json` | 티켓 `responses/` | 없음(추적 대상) | 아니오 | 없음 | **예(승인 증거)** |
| `workflow/REQ-*/responses/approvals.jsonl` | 티켓 `responses/` | 없음(추적 대상) | 아니오 | 없음 | **예(승인 원장)** |

> **유지 규칙**: 저장소 루트에 새 런타임 스크래치를 추가할 때는 ① 이 표에 행을 추가하고 ② `templates/workflow.gitignore`에 **앵커형** 규칙을 넣고 ③ `scripts/smoke.mjs`에 그 경로의 `git check-ignore` 단언을 함께 추가한다. smoke 단언은 경로별이라 새 파일을 자동으로 덮지 않는다.
>
> 중첩 `.gitignore`(`workflow/.gitignore`) 규칙은 **그 디렉터리 기준 상대경로**다. 루트 `.gitignore`가 쓰는 `workflow/…` 형태를 복사하면 `workflow/workflow/…`를 찾아 무효가 된다.
