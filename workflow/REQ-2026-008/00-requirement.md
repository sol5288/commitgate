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

## 핵심 정책(문서에 반영할 5개)

1. 기본 통합 경로는 **PR 경유**다.
2. protected branch에 direct push가 필요하면 **"branch protection bypass를 사용한 direct push"**라고 명시해 별도 승인을 받는다.
3. **"main merge/push 승인"은 required checks bypass 승인과 다르다.** 포괄 승인으로 확대 해석하지 않는다.
4. bypass 권한이 있어도, push 전에 보호 규칙·required checks 우회 여부를 **보고하고 멈춘다**. 권한이 있다는 사실이 승인이 아니다.
5. tag push · `npm publish` · GitHub release는 main 반영과 **묶지 않고**, CI green 이후 별도 통제점으로 둔다.

## 제약(비목표)
- **문서/계약 변경만.** 코드 변경 금지.
- `package.json` · `package-lock.json` version 변경 금지(이미 0.3.0 — 그대로 둔다).
- `v0.3.0` tag, tag push, `npm publish`, GitHub release 금지.
- CI 설정(`.github/workflows/ci.yml`) 변경 금지.
- keyword scan을 강제하는 **테스트 추가 금지**(코드 변경에 해당). 검증은 수동 grep scan으로 증거를 남긴다.

## 완료 기준
- 네 문서에 정책 1~5가 일관되게 반영된다.
- `docs/RELEASING.md`의 재배포 레시피가 더 이상 `git push origin main`을 기본으로 보이게 하지 않는다.
- `AGENTS.template.md`가 "머지 승인" · "bypass 승인" · "릴리즈 승인"을 **세 개의 서로 다른 통제점**으로 분리한다.
- keyword scan: `branch protection bypass` · `direct push` · `required (status )checks` · `PR` · `tag` · `publish` 상당 문구가 해당 문서(한/영)에 존재.
- `npm run typecheck` · `npm test` · `npm run smoke` 그린, `req:doctor -- 2026-008` PASS, Codex design/phase 승인.
