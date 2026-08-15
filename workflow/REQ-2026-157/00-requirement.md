# REQ-2026-157 요구

`setup` 이 묻는 항목이 3개 → **4개**로 늘었고(`reviewBudget.onSoftLimit`), `stopGate` 에 `auto` 가
생겼다. **핵심 정책 문서(README 정지 지점 절·`docs/configuration.md`)는 갱신됐지만,
설치·빠른 시작·보장·에이전트 문서가 옛 전제를 유지하고 있다.**

## 실측 — `setup` 은 4개를 묻는다

`bin/setup.ts` 의 `buildQuestions` (`PROMPTS`):

| # | 키 | 프롬프트 |
|---|---|---|
| 1 | `reviewModel` | 리뷰 모델 |
| 2 | `reviewReasoningEffort` | 리뷰 추론강도 |
| 3 | `stopGate` | 사람이 멈추는 지점 |
| 4 | **`reviewBudget.onSoftLimit`** | 리뷰 예산을 넘겼을 때(비용 통제 — 안전 게이트가 아닙니다) |

기본값: `stopGate: "req"` · `onSoftLimit: "ask"`(`config.ts:355`).
`stopGate` 선택지는 `phase` · `req` · `merge` · **`auto`** 네 개다.

## 고칠 곳 (외부 검토가 지적한 5건 — 전부 실측 확인)

| # | 파일 | 지금 | 사실 |
|---|---|---|---|
| 1 | `README.md:187` · `README.en.md:188` | "질문은 세 개" | **네 개** |
| 2 | `docs/quick-start.md:30~40` · 영문판 | 질문 3개 표 · `stopGate` 선택지 3개 | 질문 4개 · `auto` 포함 4개 |
| 3 | `docs/quick-start.md:131` · 영문판 | "6~8회는 사람 예외가 **필요**" | `onSoftLimit` 에 달렸다 — `auto` 면 hardCap 전까지 자동 |
| 4 | `docs/guarantees.md:16` · 영문판 | "6~8회차는 회차마다 사람 예외 기록이 있어야" | 같음 — 설정 종속인데 절대 규칙처럼 읽힌다 |
| 5 | `docs/agent-prompt.md:21` · 영문판 | setup 이 "리뷰 모델·추론강도·멈춤 지점"을 고른다 | **리뷰 예산 정책**이 빠졌다 |

`README.md:188`(3단계 setup 한 줄 설명)도 같은 목록을 쓰므로 함께 고친다.

## 🔴 이 REQ 의 성격

**문서만 고친다.** 코드·동작은 한 줄도 바꾸지 않는다. 게이트·기본값·선택지는 지금이 옳고,
문서가 그것을 잘못 말하고 있는 것이다.

## 독자 기준

비개발자·초보자가 읽는다. 그래서:
- **무엇을 고르면 무엇이 달라지는지**를 먼저 말하고, 설정 키 이름은 그다음에 괄호로 준다.
- `onSoftLimit` 은 **비용 축**이지 안전 축이 아니라는 것을 분명히 한다 — `auto` 를 골라도
  리뷰 승인·사람 확인은 그대로다. 이것을 오해하면 "안전을 껐다"고 생각한다.
- 절대 규칙처럼 쓰지 않는다: "6~8회는 사람 예외가 필요" → "기본값에서는 …, `auto` 로 바꾸면 …".

## 범위 밖

- 코드·기본값·선택지 변경.
- `docs/configuration.md` 재작성(이미 정확하다 — 링크만 건다).
