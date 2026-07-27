# REQ-2026-068 설계 — 픽스처 auto 유지보수 전역 차단

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

`tests/setup/git-hermetic.ts` (vitest `setupFiles`)

- 워커마다 임시 디렉터리를 만들고 **전역 git config 파일을 우리 것으로 대체**한다
  (`GIT_CONFIG_GLOBAL`·`GIT_CONFIG_SYSTEM`·`GIT_CONFIG_NOSYSTEM`·`HOME`/`USERPROFILE`).
- 그 파일의 내용은 `HERMETIC_GITCONFIG = '[user]\n\tuseConfigOnly = true\n'` 하나뿐이다.

`tests/unit/state-checkpoint.test.ts`는 **자기 파일 안에서만** `disableAutoMaintenance`를 호출한다.

## 핵심 설계 결정

### DEC-1 — 🔴 처방은 **전역 config 파일**에 넣는다

`HERMETIC_GITCONFIG`에 `gc.auto=0`·`maintenance.auto=false`를 더한다.

🔴 **이 훅이 이미 모든 픽스처의 git 호출에 적용된다** — `GIT_CONFIG_GLOBAL`이 프로세스 env이므로
자식 `git`이 전부 상속한다. 파일마다 `git config`를 부르는 방식은 이번 실패가 보여 주듯 **빠뜨린다**:
REQ-2026-059가 처방을 만들고도 한 파일에만 적용해, 20개 파일이 같은 결함을 안고 있었다.

🔴 **두 키를 모두 끈다.** git 버전에 따라 자동 실행 경로가 `gc --auto`이거나 `maintenance run --auto`다.
하나만 끄면 다른 러너에서 같은 증상이 남는다.

⚠️ repo-local `git config gc.auto 0`은 **전역보다 우선**하므로, 이미 그렇게 하고 있는
`state-checkpoint.test.ts`는 영향이 없다(중복이지 충돌이 아니다).

### DEC-2 — 정리 재시도는 **공용 헬퍼**로 (R2)

`rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })`.
Node의 재시도는 `EBUSY`·`ENOTEMPTY`·`EPERM`에만 걸리므로 **다른 오류는 그대로 드러난다** — 정리를
조용히 삼키는 것이 아니다.

🔴 실패한 그 파일(`req-review-codex.test.ts`)의 `afterEach`에 적용한다. 나머지 파일은 DEC-1로
원인이 사라지므로 **일괄 수정하지 않는다** — 무관한 파일을 20개 건드리면 리뷰 면적만 커지고,
diff가 커질수록 진짜 변경이 묻힌다.

### DEC-3 — 🔴 오라클은 "설정이 적용됐는가"를 **실제 저장소에서** 본다

전역 config 문자열만 단언하면 tautology다(우리가 쓴 것을 우리가 읽는다). 임시 저장소를 실제로
`git init` 하고 **`git config --get gc.auto`가 `0`**을 내는지 본다 — env 배선까지 함께 검증된다.

## Phase별 구현

`02-plan.md` 참조.

## 변경 파일

| 파일 | 변경 |
|---|---|
| `tests/setup/git-hermetic.ts` | `HERMETIC_GITCONFIG`에 두 키 추가 |
| `tests/unit/git-hermetic.test.ts` | 실제 저장소에서 두 키가 꺼졌는지 · identity 차단 무회귀 |
| `tests/unit/req-review-codex.test.ts` | 실패한 `afterEach`에 재시도 |

## 하위호환·안전

- 피시험 동작 무변경 — 유지보수는 저장소 관리 기능이다.
- identity 차단 4경로 무변경(회귀 가드로 고정).
- repo-local 설정이 있는 파일은 그대로 우선한다.
