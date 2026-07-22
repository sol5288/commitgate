# REQ-2026-049 요구사항 — DONE 게이트 fail-closed 보강 + 테스트 Git identity hermetic (P1)

## 무엇을 / 왜

REQ-2026-048이 `main`(`cc1e755`)에 들어갔지만 **P1은 해결되지 않았다.** 코덱스 판정으로 두 결함이 확인됐다.

### 결함 A — CI 6/9 실패(테스트 fixture의 Git identity 미설정)

`cc1e755`의 CI는 **macOS 3개만 성공하고 ubuntu·windows 6개가 실패**했다. 원인은 production 코드가 아니라 **테스트 fixture**다 — `tests/unit/req-review-codex.test.ts` 등의 헬퍼는 `execFileSync('git', ['-c','user.email=…','-c','user.name=…', …])`처럼 **호출마다 인라인으로만** identity를 준다. repo-local config를 설정하지 않으므로, REQ-048이 도입한 **자동 evidence commit**(`evidence-ports`의 bare `git commit`)은 identity를 못 찾고 **runner 전역 설정에 의존**하게 된다. 전역 identity가 있는 macOS만 통과한 이유다.

로컬 Windows에서 단일 스위트 317개가 통과한 것도 **로컬 Git identity 덕분**이므로 검증 근거가 되지 못한다. 이 사실이 로컬에서 드러나지 않는 것 자체가 결함이다.

### 결함 B — DONE 게이트가 fail-open(더 중요)

`scripts/req/lib/evidence.ts`의 `verifyCommittedDesignEvidence`는 커밋된 매니페스트에 **`validateManifest`를 돌리지 않고** 마지막 `kind=design` 행만 느슨하게 읽는다. 그 결과 **손상된 committed manifest가 DONE 게이트를 통과**한다:

- `archive_inventory: []` → `Array.isArray([])`가 참이고 `every()`가 **공허 참**이라 durable=true.
- `response_path`를 HEAD에 존재하는 **임의 blob**으로 지정 → 코드가 **존재만** 확인하고 SHA를 대조하지 않는다.
- `response_sha256`이 실제 승인 아카이브와 **불일치**해도 검사되지 않는다.

즉 "HEAD blob에서 매니페스트·아카이브·SHA를 검증한다"는 REQ-048 완료기준 6을 **충족하지 못한다.**

**경계 한 줄**: 이 REQ는 **REQ-048을 수정하지 않는다**. clean `cc1e755`에서 갈라진 새 P1 티켓이며, **branch protection bypass 없이** 통합한다.

## 완료 기준 (검증 가능)

1. **테스트 Git identity hermetic**: 테스트가 만드는 **모든** git 저장소 헬퍼가 **repository-local** `user.name`/`user.email`을 설정한다. 인라인 `-c`만으로 때우지 않는다.
2. **전역 설정으로 가려지지 않음**: 테스트 실행 환경이 **global/system git config를 차단**해, repo-local identity가 없으면 **로컬에서도 실패**한다. CI 전역 설정 유무로 결과가 갈리지 않는다.
3. **DONE 게이트는 `HEAD`에서만** 다음을 전부 검증한다:
   - 커밋된 매니페스트가 **`validateManifest`를 통과**한다(스키마·경로 confinement·`-approved.json` 파일명·top-level SHA 형식·중복/주입).
   - **`response_sha256 === HEAD(response_path)의 SHA`** (존재 확인만으로 불충분).
   - `archive_inventory`가 **비어 있지 않고**, **승인 아카이브를 정확한 SHA로 포함**한다.
   - inventory가 **HEAD에 있는 해당 티켓 design 아카이브 전체 집합(`needs-fix` + `approved`)과 정확히 일치**한다(빠짐·잉여 모두 거부).
   - 각 inventory 항목의 SHA가 HEAD blob SHA와 일치한다.
   - **HEAD state가 파손돼 phase 정보를 해석할 수 없으면 BLOCKED**.
4. **음성 대조 테스트**가 다음을 전부 포함한다: 빈 inventory · inventory에서 needs-fix 누락 · top-level SHA 불일치 · 잘못된 경로 · extra field · **워킹 트리만 고치고 HEAD는 손상된 경우**.
5. `tsc --noEmit` 0 · 전체 스위트 그린 · `docs:lint` 0 · `smoke` 0 · `req:doctor` PASS · 각 phase Codex 리뷰 승인.
6. **9/9 CI 성공**과 **fresh-clone 검증**을 통과한다. 그 전까지 "P1 해결" 선언과 `0.9.8` 배포는 **보류**다.
7. 통합은 **PR 경로**(`[I1]`→`[I2]`)로 한다. **branch protection bypass 금지.**

## 범위 (MVP)

- 테스트 git 헬퍼 identity 일괄 수정 + 전역 config 차단(테스트 환경).
- `verifyCommittedDesignEvidence` fail-closed 재작성 + 필요한 포트 확장(HEAD 아카이브 목록 조회).
- 음성 대조 테스트 · CHANGELOG(미발행 `0.9.8` 항목 보정).

## 비목표 (경계)

- **REQ-048 커밋 수정·되돌리기** — 이미 `main`에 있고 이 REQ가 그 위에서 고친다.
- **버전 상향** — `0.9.8`은 아직 publish되지 않았으므로 새 버전을 만들지 않고 그 항목을 보정한다.
- **publish/tag/release** — 계속 금지.
- 승인 판정 로직·phase 증거 경로·`state.json`의 캐시 지위 변경.
- `req:doctor`·일반 `req:commit`에 FAIL 게이트 추가(여전히 금지).

## 근거·불변식

- **존재 확인은 검증이 아니다.** 결함 B의 본질은 "있다"와 "맞다"를 혼동한 것이다 — 모든 항목은 **SHA로 대조**해야 한다.
- **집합 일치가 필요하다.** 부분 집합만 확인하면 needs-fix 라운드를 빼고도 통과한다 — 완전성이 이 게이트의 목적이다.
- **테스트가 환경에 기대면 검증이 아니다.** 전역 git identity에 의존하는 테스트는 "통과"가 아무것도 증명하지 못한다.
