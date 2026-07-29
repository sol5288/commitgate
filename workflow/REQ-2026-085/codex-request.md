# REQ-2026-085 리뷰 요청

## 배경

소비 repo(yammy) 0.11.0 운영 구간 감사(REQ-2026-084와 같은 감사)에서 나온 **관측성** 3건이다.
게이트의 안전 속성 문제가 아니다 — 코드 커밋 16/16이 전부 승인에 대응했다. 사람이 상태를 읽는 표면의 문제다.

1. 종결된 티켓 6개가 **하나의 스택**으로 trunk 밖에 15시간 쌓였는데 도구가 아무 말도 하지 않았다.
2. `state.phase`가 죽은 필드인데 **모든 리뷰 프롬프트에 `- phase: INTAKE`로 주입**되고 있었다.
3. 부기 커밋이 히스토리의 73%를 덮어 코드 이력을 읽을 수 없다(내구성의 정당한 대가지만 읽기 경로가 없다).

## 변경 요약

- **phase-1**: `state.phase` 제거 4자리(방출·필수검사·프롬프트·D11). 🔴 D11의 `DONE` 예외는 런타임이 절대 쓰지 않는 값으로 열리는 **위조 가능한 우회로**라 삭제한다 — 기존 테스트의 정답이 뒤집힌다.
- **phase-2·3**: 도구가 만드는 부기 커밋 11곳에 `CommitGate-Bookkeeping: true` trailer를 단일 헬퍼 경유로 부여. 커밋 경로·순서·개수·내구성은 무변경.
- **phase-4**: `req:doctor` D25 — 종결됐지만 trunk에 도달하지 않은 티켓을 WARN. 판정 근거는 **trunk 트리의 close proof 파일**(브랜치 존재 아님).
- **phase-5**: 문서(읽기 명령) + CHANGELOG.

## 🔴 진행 상태 — 이 diff는 phase-5만 담는다

phase 리뷰는 **해당 phase의 staged diff만** 본다. 앞 phase는 이미 커밋돼 이 diff에 나타나지 않으므로
"구현되지 않았다"고 읽지 말 것. 아래는 **작업 트리에서 직접 확인**할 수 있다.

| phase | 상태 | 커밋 | 확인할 파일 |
|---|---|---|---|
| phase-1 dead-state-phase | ✅ 커밋됨 | `f3dbf5d4` | `scripts/req/req-new.ts`의 `buildInitialState`(phase 미방출) · `review-codex.ts`의 `loadState`·`contextPhase` · `req-doctor.ts`의 D11(조건 삭제) |
| phase-2 bookkeeping-marker-core | ✅ 커밋됨 | `bade6f50` | `scripts/req/lib/bookkeeping.ts`(신설) · `lib/state-checkpoint.ts` · `lib/evidence.ts` · `req-commit.ts` |
| phase-3 bookkeeping-marker-lifecycle | ✅ 커밋됨 | `733ed2ee` | `req-close.ts`·`req-rebind.ts`·`req-reconstruct.ts`·`req-review-exception.ts`·`bin/delivery.ts` · `tests/unit/bookkeeping.test.ts`의 전수 스캔 |
| phase-4 unmerged-warning | ✅ 커밋됨 | `b1d02374` | `req-doctor.ts`의 `unmergedClosedTickets`·D25 · `lib/config.ts`의 `trunkBranch` · `workflow/req.config.schema.json` |
| **phase-5 docs-changelog** | **🔎 지금 리뷰 대상** | (이 diff) | `docs/workflow.md` · `docs/workflow.en.md` · `CHANGELOG.md` |

## 리뷰 포인트

- **D11 축소의 정당성**: 런타임 어디에도 `state.phase`에 `'DONE'`을 쓰는 곳이 없다는 전제가 맞는가. 맞다면 정상 경로 판정은 불변이고 위조 경로만 닫힌다. 틀리다면 이 변경은 정상 티켓을 막는다 — **이 REQ에서 가장 위험한 지점**이다.
- **D25가 아무것도 막지 않는가**: 어떤 입력에서도 FAIL이 아닌가. 판정 불가(trunk ref 없음)가 조용히 통과하는가 — 오탐으로 doctor 출력 전체를 무시하게 만들면 안 된다.
- **D25 판정 근거**: 병합 후 브랜치를 삭제한 정상 운영에서 오탐이 없는가(그래서 브랜치가 아니라 커밋된 close proof를 본다).
- **부기 표식의 무해성**: 커밋 **경로(pathspec)·순서·개수**가 하나도 안 바뀌었는가. 특히 pre-call ledger 커밋의 "외부 호출 **전**" 순서(REQ-2026-052 DEC-A4·A6)가 보존되는가.
- **표식 누락**: 도구가 만드는 커밋 자리 중 헬퍼를 안 거치는 곳이 남았는가. 하나라도 빠지면 읽기 명령이 그 커밋을 코드 커밋으로 잘못 보여준다.
- **하위호환**: `state.phase`가 있는 기존 티켓이 그대로 로드되는가. `trunkBranch` 미지정 설정이 그대로 동작하는가.
