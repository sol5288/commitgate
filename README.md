# ai-req-workflow

AI REQ workflow — **Builder(Claude 등) ↔ Reviewer(Codex)** 핸드오프를 fail-closed로 강제하는 개발 워크플로 kit.
승인된 staged tree와 리뷰 evidence를 묶어, 리뷰받지 않은 변경이 커밋되지 못하게 한다.

> 출처: `palm-kiosk-app`의 REQ-2026-017 portability kit을 독립 패키지로 추출한 것.
> **Stage A (현재)**: 대상 repo에 파일을 vendored 설치하는 스캐폴딩 모델. **Stage B (예정)**: `node_modules` 직접 실행 라이브러리 모델.

## 무엇을 하나

| 명령 | 용도 |
|---|---|
| `req:new <slug> --run` | REQ 티켓 생성(채번·feature 브랜치·`00-requirement/01-design/02-plan` 스캐폴드) |
| `req:review-codex <id> --kind design\|phase [--phase <p>] --run` | Codex 리뷰 프롬프트 조립·호출·구조화 응답 검증·승인 반영 |
| `req:doctor <id>` | 일관성 게이트(D-체크: staged tree↔승인 tree, 설계 freshness, 워킹트리 clean 등) |
| `req:commit <id> [--run] [--message-file <f>]` | 승인된 phase 커밋 + evidence-finalize(2-커밋) |

## 설치

```sh
# 대상 repo(= git repo + package.json)에서
npx ai-req-workflow            # 또는: npx req-workflow-init
```

`req-workflow-init`이 하는 일(멱등·비파괴):

1. `scripts/req/**` + `workflow/{machine,req.config}.schema.json` 복사(기존 파일은 스킵, `--force`로 덮어씀)
2. `req.config.json` 시드(부재 시): 감지한 packageManager + `handoffPath:null`
3. 대상 `package.json`에 `req:*` 스크립트 + `ajv`/`tsx` devDeps 주입(**기존 키 미덮어씀**)
4. `AGENTS.md` 부재 시 템플릿 생성(있으면 유지)

옵션: `--dir <path>`(대상 지정) · `--force` · `--dry-run` · `--help`.

## 전제 (prerequisites)

- **git** — 워크플로는 git 전제(워킹트리·index·write-tree). 비-git VCS 미지원.
- **Node.js ≥ 18.17** + **tsx** — 스크립트 실행기(init이 devDep로 주입).
- **codex CLI** — 리뷰 실호출. 미설치 시 `req:review-codex --run`은 **fail-closed throw**(설계·검증은 가능, 실 리뷰만 불가).
- **패키지매니저** — `pnpm`/`npm`/`yarn`. `req:commit`이 `req:doctor`를 자식 프로세스로 호출.
- 의존성 `ajv` — config·응답 스키마 검증.

## 설정 (`req.config.json`)

대상 repo 루트(또는 `--root <dir>`)에 두면 `loadConfig`가 읽는다. **파일이 없으면 DEFAULTS = behavior-preserving.** 모든 키 선택.

| 키 | DEFAULT | 의미 | 제약(fail-closed) |
|---|---|---|---|
| `ticketRoot` | `"workflow"` | 티켓 디렉터리 루트 | root 하위 상대경로만(절대·`..` 거부) |
| `schemaPath` | `"workflow/machine.schema.json"` | verdict AJV 스키마 | root 하위 상대경로만 |
| `handoffPath` | `null`(init 시드) | 리뷰 프롬프트 컨텍스트(읽기 전용) | 문자열 또는 `null`. confinement 면제 |
| `branchPrefix` | `"feat/req-"` | 브랜치 생성·게이트 | **비어있지 않음**(빈 prefix는 게이트 무력화 → 거부) |
| `packageManager` | 감지값 | req:commit→req:doctor 자식 호출 | enum `pnpm`\|`npm`\|`yarn` |
| `granularityMaxFiles` | `8` | phase 분할 권고 임계(advisory WARN) | 양의 정수 |
| `designDocs` | `00-/01-/02-*.md` | 설계 바인딩·분류 | 각 **basename만**(슬래시·`..` 거부) |

`--root <dir>`: 4개 req 스크립트 전부 수용. 미지정 시 cwd 상향탐색으로 `req.config.json` 발견 → 없으면 kit package-root fallback.

## fail-closed 동작

| 상황 | 동작 |
|---|---|
| `req.config.json` 스키마 위반(unknown 키·잘못된 enum·malformed) | `loadConfig` AJV throw |
| `branchPrefix: ""` | 스키마 거부(minLength≥1) |
| `ticketRoot`/`schemaPath`/`designDocs`에 절대경로·`..` | confinement throw |
| 설계문서 미추적/≠3역할 | 미승인 취급 |
| codex 미설치/실패 | ReviewerAdapter throw(silent 아님) |
| 승인 후 설계 변경(freshness 불일치) | 게이트 FAIL(stale 승인) |
| staged tree ≠ 승인 tree | 게이트 FAIL(stale 승인) |

## 아키텍처 경계

- `scripts/req/lib/config.ts` — 경로·이름·패키지매니저 외부화(`loadConfig`·DEFAULTS·confinement)
- `scripts/req/lib/adapters.ts` — `GitAdapter`(모든 git 호출)·`ReviewerAdapter`(codex) 경계. 테스트는 `FakeReviewerAdapter`로 live codex 없이 검증.

프로젝트별 차이는 **`req.config.json`과 adapter 경계에서만** 흡수한다 — 코어 승인 바인딩은 불변.

## 개발

```sh
npm install
npm test        # vitest — req:* 순수 단위 테스트 + init 테스트
npm run typecheck
```

## 한계 (현재 kit)

- `defaultBranch`(`main`)·`reqIdPrefix`(`REQ`)·REQ 번호 정규식은 하드코딩(다중 trunk·id 포맷 외부화는 후속).
- `designDocs`는 정확히 3역할(requirement/design/plan) 필수.
- git 전제(`GitAdapter`는 비-git 확장 여지만 둠).
- `ReviewerAdapter` default는 codex CLI(다른 리뷰어는 인터페이스 구현으로 추가).
