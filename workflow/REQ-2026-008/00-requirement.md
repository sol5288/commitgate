# REQ-2026-008 요구사항 — 통합 통제점 계약화 (PR 경유 기본 / bypass 명시 승인 / 릴리즈 별도 게이트)

## 무엇을
`main`(protected branch) 반영과 릴리즈에 관한 통제점 문구를 **repo 계약**에 반영한다. 대상은 `AGENTS.template.md`, `README.md`, `README.en.md`, `docs/RELEASING.md` 네 문서.

## 왜 — 실제로 재발 가능한 결함

REQ-2026-007에서 사용자가 "main merge + push"를 승인했고, 에이전트는 그것을 `git push origin main` 승인으로 읽었다. 그 push는 `main`의 branch protection(required status checks)을 **bypass 권한으로 우회**했고, push 응답의 `remote: Bypassed rule violations for refs/heads/main`으로 **사후에야** 드러났다. 사후 CI(run 28995410681)는 green이었으나, 게이트가 머지를 검증한 것이 아니라 머지 뒤에 따라왔다.

현재 계약이 이 오독을 막지 못한다:
- [AGENTS.template.md](../../AGENTS.template.md) "사람에게 보고해야 할 때"는 `main merge / push 직전` 한 줄뿐이다. **무엇을 승인받는지**(머지인지, 보호규칙 우회인지)를 구분하지 않는다.
- [docs/RELEASING.md](../../docs/RELEASING.md) "재배포 레시피"는 `git push origin main`을 **기본 레시피**로 제시한다. PR도 required checks도 등장하지 않는다. 문서가 direct push를 정상 경로로 가르치고 있다.
- [README.md](../../README.md) / [README.en.md](../../README.en.md)의 통제점 목록도 `main 병합 또는 push 직전` 한 줄이다.

즉 이 규칙은 지금 **작업자 메모리에만** 있고 repo 계약에는 없다.

## 핵심 정책

### 통제점 6개 — 각각 고유한 승인 문장과 시점을 갖는다
| # | 통제점 | 시점 | **승인 문장**(이 문장 그대로여야 승인) |
|---|---|---|---|
| `I1` | 통합 — PR 열기 | feature branch를 origin에 push하고 PR을 생성하기 직전 | `feature branch push + PR 생성 승인` |
| `I2` | 통합 — PR 머지 | required checks가 전부 green으로 끝난 것을 확인한 뒤, PR을 protected branch에 머지하기 직전 | `required checks green 확인 후 PR merge 승인` |
| `B1` | bypass (예외) | required checks를 우회해 protected branch에 direct push해야 할 때 | `branch protection bypass를 사용한 direct push 승인` |
| `R1` | 릴리즈 — tag | 버전 tag 생성 및 tag push 직전 | `tag 생성·push 승인` |
| `R2` | 릴리즈 — publish | `npm publish` 직전 | `npm publish 승인` |
| `R3` | 릴리즈 — release | GitHub release 생성 직전 | `GitHub release 생성 승인` |

### 해석 규칙
1. 기본 통합 경로는 **PR 경유**다(`I1` → required checks green → `I2`).
2. **`I1` 승인은 `I2`를 포함하지 않는다.** PR 생성 승인만으로 머지하지 않는다. `I2`는 checks 결과를 본 뒤에만 요청한다(green 전 선승인 금지).
3. protected branch에 direct push가 필요하면 `B1` 문장으로 별도 승인을 받는다. `B1`은 `I1`+`I2`를 대체하는 **예외 경로**다.
4. **"main merge/push 승인"은 required checks bypass 승인(`B1`)이 아니다.** 포괄 승인으로 확대 해석하지 않는다.
5. bypass 권한이 있어도, push 전에 보호 규칙·required checks 우회 여부를 **보고하고 멈춘다**. 권한이 있다는 사실이 승인이 아니다.
6. `R1`·`R2`·`R3`는 main 반영(`I2`)과 묶지 않고, CI green 이후 요청한다. **셋은 서로도 독립이다** — `tag 생성·push 승인`이 `npm publish 승인`을 포함하지 않는다.
7. **한 통제점의 승인은 다음 통제점으로 이월되지 않는다.** 승인은 승인받은 문장 그대로만 유효하다. 모호하면 확대 해석하지 말고 다시 묻는다.

## 제약(비목표)
- **문서/계약 변경만.** 코드 변경 금지.
- `package.json` · `package-lock.json` version 변경 금지(이미 0.3.0 — 그대로 둔다).
- `v0.3.0` tag, tag push, `npm publish`, GitHub release 금지.
- CI 설정(`.github/workflows/ci.yml`) 변경 금지.
- keyword scan을 강제하는 **테스트 추가 금지**(코드 변경에 해당). 검증은 수동 grep scan으로 증거를 남긴다.

## 완료 기준
- 네 문서에 위 통제점 6개와 해석 규칙 1~7이 일관되게 반영된다(문서 간 승인 문장이 어긋나지 않는다).
- `AGENTS.template.md`가 `I1`·`I2`·`B1`·`R1`·`R2`·`R3`를 **서로 다른 여섯 개의 통제점**으로 분리하고, 각 항목에 해당 승인 문장을 병기한다. 특히:
  - `I1`(PR 생성)과 `I2`(PR 머지)가 별개 항목이며, `I2`에 `required checks green 확인 후`라는 시점 조건이 붙어 있다.
  - `R1`·`R2`·`R3`가 하나의 포괄 "릴리즈 승인"으로 뭉뚱그려져 있지 **않다**.
  - 승인 이월 금지 규칙(해석 규칙 7)이 명문화돼 있다.
- `docs/RELEASING.md`의 재배포 레시피가 더 이상 `git push origin main`을 기본으로 보이게 하지 않고, 각 단계에 `[I1]`/`[I2]`/`[R1]`/`[R2]`/`[R3]` 승인 지점이 표시된다.
- keyword scan: `branch protection bypass` · `direct push` · `required (status )checks` · `PR` · `tag` · `publish` 상당 문구가 해당 문서(한/영)에 존재.
- `npm run typecheck` · `npm test` · `npm run smoke` 그린, `req:doctor -- 2026-008` PASS, Codex design/phase 승인.
