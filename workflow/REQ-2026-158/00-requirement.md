# REQ-2026-158 요구

REQ-2026-157 이 quick-start·guarantees·agent-prompt·configuration 상세절을 고쳤지만,
**README 첫 소개·워크플로 문서·설치 템플릿·configuration 요약 표**에 옛 표현이 남았다.

## 남은 드리프트 (전부 실측 확인)

| 우선 | 위치 | 지금 | 사실 |
|---|---|---|---|
| 높음 | `README.md:59` · `README.en.md:59` | "자동 5회 · 6~8회 사람 예외 · 9회부터 차단" | 회차 번호로 단정할 수 없다 |
| 높음 | `docs/workflow.md:55~60` · 영문판 | "`autoBudget` 을 넘긴 회차(기본 6~8)" | 같음 |
| 높음 | `docs/configuration.md:14` 요약 표 | "1~5회차는 자동. 6~8회차는…" | 🔴 **같은 파일의 상세절은 이미 고쳐져 있어 문서 안에서 모순** |
| 보통 | `AGENTS.template.md:145` | setup 이 "리뷰 모델·추론강도"를 묻는다 | **네 축**(모델·추론강도·`stopGate`·`reviewBudget.onSoftLimit`) |
| 낮음 | `README.md:331` · `README.en.md:332` 명령 표 | "리뷰 모델·멈춤 지점 선택" | 추론강도·리뷰 예산 정책 누락 |

## 왜 남았나

REQ-2026-157 이 만든 `setup-docs-parity.test.ts` 의 "회차 번호 금지" 검사는 **quick-start 두 문서에만**
걸려 있었다. README 첫 소개·workflow·configuration 요약 표·`AGENTS.template.md` 는 검사 밖이었다.

🔴 **가드의 적용 범위가 결함의 범위보다 좁았다** — 이 저장소가 반복한 패턴이다.

## 사실 (REQ-2026-157 에서 실측 확정)

```
attempt = dispatched + 1
if (dispatched >= hardCap)   → hard-blocked   ← **실제 나간 호출** 수
if (productive < autoBudget) → allow          ← **판정이 나온 리뷰** 수
onSoftLimit === 'auto' ? soft-auto : needs-exception
```

- 무효(invalid) 응답은 `void_attempts` 로 빠져 `productive` 에 안 들어가고 `dispatched` 에는 들어간다.
- 그래서 **"N회차부터"라고 고정해 말할 수 없다.**

## `AGENTS.template.md` 가 중요한 이유

이 파일은 **설치 프로젝트로 복사되는 에이전트 계약**이다. 여기가 틀리면 모든 소비자 저장소의
에이전트가 틀린 계약을 읽는다. 그리고 "에이전트가 정책을 임의로 완화하면 안 된다"는 근거도
**두 정책 축**(`stopGate`·`onSoftLimit`)을 포함해야 한다 — 지금은 "리뷰 모델 같은 게이트 파라미터"
라고만 적혀 있어 어느 축을 말하는지 불분명하다.

## 범위 밖

- 코드·기본값·선택지 변경 — 이 REQ 도 **문서만** 고친다.
- quick-start·guarantees·agent-prompt·configuration **상세절** — 이미 정확하다.
