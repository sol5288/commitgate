# REQ-2026-008 요구사항 — 통합 통제점 계약화 (PR 선택 / direct push는 bypass 명시 승인 / 릴리즈 별도 게이트)

## 무엇을
`main`(protected branch) 반영과 릴리즈에 관한 통제점 문구를 **repo 계약**에 반영한다. 대상은 `AGENTS.template.md`, `README.md`, `README.en.md`, `docs/RELEASING.md` 네 문서.

## 왜 — 실제로 재발 가능한 결함

REQ-2026-007에서 사용자가 "main merge + push"를 승인했고, 에이전트는 그것을 `git push origin main` 승인으로 읽었다. 그 push는 `main`의 branch protection(required status checks)을 **bypass 권한으로 우회**했고, push 응답의 `remote: Bypassed rule violations for refs/heads/main`으로 **사후에야** 드러났다. 사후 CI(run 28995410681)는 green이었으나, 게이트가 머지를 검증한 것이 아니라 머지 뒤에 따라왔다.

현재 계약이 이 오독을 막지 못한다:
- [AGENTS.template.md](../../AGENTS.template.md) "사람에게 보고해야 할 때"는 `main merge / push 직전` 한 줄뿐이다. **무엇을 승인받는지**(머지인지, 보호규칙 우회인지)를 구분하지 않는다.
- [docs/RELEASING.md](../../docs/RELEASING.md) "재배포 레시피"는 `git push origin main`을 아무 조건 없이 제시한다. 그것이 required status checks를 **우회한다는 사실도, 그 우회에 별도 승인이 필요하다는 사실도** 적혀 있지 않다.
- [README.md](../../README.md) / [README.en.md](../../README.en.md)의 통제점 목록도 `main 병합 또는 push 직전` 한 줄이다.

즉 이 규칙은 지금 **작업자 메모리에만** 있고 repo 계약에는 없다.

⚠️ 고쳐야 할 것은 **direct push의 존재 자체가 아니다.** 1인 개발에서 direct push는 정당한 경로다. 고쳐야 할 것은 (a) 그 경로가 required status checks를 우회한다는 사실이 문서에 없고, (b) 우회에 대한 **별도 승인 문장**이 정의돼 있지 않으며, (c) 그 경우 CI가 **사후 검증**이라는 점이 드러나지 않는다는 것이다.

## 핵심 정책

이 프로젝트는 **1인 개발** 기준이다. 따라서 **PR 경유는 의무가 아니라 선택 경로**다. 통합 경로는 두 가지이고, 어느 쪽이든 **승인 없이는 protected branch에 들어가지 않는다.**

- **경로 A (PR 경유, 선택)**: `I1` → required status checks green → `I2`
- **경로 B (direct push, 명시 승인 시 허용)**: `B1` → `git push origin main` → **CI 사후 실행**

경로 B가 금지되는 것이 아니다. 금지되는 것은 **우회 사실을 숨기는 것**이다.

### 통제점 6개 — 각각 고유한 승인 문장과 시점을 갖는다
| # | 통제점 | 경로 | 시점 | **승인 문장**(이 문장 그대로여야 승인) |
|---|---|---|---|---|
| `I1` | 통합 — PR 열기 | A(선택) | feature branch를 origin에 push하고 PR을 생성하기 직전 | `feature branch push + PR 생성 승인` |
| `I2` | 통합 — PR 머지 | A(선택) | required status checks가 전부 green으로 끝난 것을 확인한 뒤, PR을 protected branch에 머지하기 직전 | `required checks green 확인 후 PR merge 승인` |
| `B1` | 통합 — direct push | B | protected branch에 direct push하기 직전(required status checks를 우회한다) | `branch protection bypass를 사용한 direct push 승인` |
| `R1` | 릴리즈 — tag | — | 버전 tag 생성 및 tag push 직전 | `tag 생성·push 승인` |
| `R2` | 릴리즈 — publish | — | `npm publish` 직전 | `npm publish 승인` |
| `R3` | 릴리즈 — release | — | GitHub release 생성 직전 | `GitHub release 생성 승인` |

### 해석 규칙
1. 통합 경로는 A(PR)와 B(direct push) **둘 다 유효**하다. PR은 **선택**이며, 1인 개발에서는 B가 통상 경로일 수 있다.
2. 경로 A에서 **`I1` 승인은 `I2`를 포함하지 않는다.** PR 생성 승인만으로 머지하지 않는다. `I2`는 checks 결과를 본 뒤에만 요청한다(green 전 선승인 금지).
3. 경로 B는 **`B1` 문장으로만 승인된다.** `main merge 승인`·`push 승인` 같은 일반 문장은 `B1`이 아니다. 포괄 승인으로 확대 해석하지 않는다.
4. **direct push는 required status checks를 우회한다.** push **전에** 그 사실(보호 규칙 적용 여부, 우회 발생 가능성)을 보고하고 멈춘다. bypass 권한이 있다는 사실은 승인이 아니다.
5. **경로 B에서 CI는 사후 검증이다.** `git push origin main` 이후에 CI가 돌므로, 그 green은 머지를 *사전에* 검증한 것이 아니다. 이 사실을 보고에서 숨기지 않는다.
6. `R1`·`R2`·`R3`는 main 반영(`I2` 또는 `B1`)과 묶지 않는다. **CI green을 확인한 뒤에만** 요청한다. 경로 B였다면 그 green은 push 이후에 나온 것이다. **셋은 서로도 독립이다** — `tag 생성·push 승인`이 `npm publish 승인`을 포함하지 않는다.
7. **한 통제점의 승인은 다음 통제점으로 이월되지 않는다.** 승인은 승인받은 문장 그대로만 유효하다. 모호하면 확대 해석하지 말고 다시 묻는다.

## 제약(비목표)
- **문서/계약 변경만.** 코드 변경 금지.
- `package.json` · `package-lock.json` version 변경 금지(이미 0.3.0 — 그대로 둔다).
- `v0.3.0` tag, tag push, `npm publish`, GitHub release 금지.
- CI 설정(`.github/workflows/ci.yml`) 변경 금지.
- keyword scan을 강제하는 **테스트 추가 금지**(코드 변경에 해당). 검증은 수동 grep scan으로 증거를 남긴다.

## 완료 기준
- 네 문서에 위 통제점 6개와 해석 규칙 1~7이 일관되게 반영된다(문서 간 승인 문장이 어긋나지 않는다).
- **경로 A(PR)를 "의무"·"기본 필수"로 서술하지 않는다.** PR은 선택이고, direct push는 `B1` 승인 시 허용되는 정상 경로임이 네 문서에서 일관되게 읽힌다.
- `AGENTS.template.md`가 `I1`·`I2`·`B1`·`R1`·`R2`·`R3`를 **서로 다른 여섯 개의 통제점**으로 분리하고, 각 항목에 해당 승인 문장을 병기한다. 특히:
  - `I1`(PR 생성)과 `I2`(PR 머지)가 별개 항목이며, `I2`에 `required checks green 확인 후`라는 시점 조건이 붙어 있다.
  - `B1`이 "예외"가 아니라 **선택 가능한 통합 경로**로 서술되되, 우회 사전 보고 의무(해석 규칙 4)와 CI 사후성(해석 규칙 5)이 함께 명시된다.
  - `R1`·`R2`·`R3`가 하나의 포괄 "릴리즈 승인"으로 뭉뚱그려져 있지 **않다**.
  - 승인 이월 금지 규칙(해석 규칙 7)이 명문화돼 있다.
- `docs/RELEASING.md`가 경로 A와 경로 B **둘 다** 실행 가능한 레시피로 제시하고, 각 단계에 `[I1]`/`[I2]`/`[B1]`/`[R1]`/`[R2]`/`[R3]` 승인 지점이 표시된다. 경로 B 레시피에는 **CI가 push 이후에 돈다**는 사실과 green 확인 전 `R1`로 넘어가지 않는다는 조건이 붙는다.
- keyword scan: `branch protection bypass` · `direct push` · `required (status )checks` · `PR` · `tag` · `publish` 상당 문구가 해당 문서(한/영)에 존재.
- `npm run typecheck` · `npm test` · `npm run smoke` 그린, `req:doctor -- 2026-008` PASS, Codex design/phase 승인.
