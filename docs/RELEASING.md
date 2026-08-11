# Releasing CommitGate

## 배포 게이트

### 필수 — 로컬 게이트

릴리스 커밋을 만들기 전에 아래를 **전부** 통과해야 한다. 이것이 이 프로젝트의 **필수 게이트**다.

```sh
npm run typecheck
npm run docs:lint
npm run test:fast
npm run test:integration
npm test
npm run smoke
npm pack --dry-run --json
npx commitgate verify-range --strict
```

- smoke = **pack tarball 설치본**의 `commitgate` bin 실행(`npm run smoke`, 로컬 소스 실행 아님).
- `verify-range --strict` = 릴리스 범위(직전 tag..HEAD)의 승인 증거 심층 검증. 미입증 커밋·손상 증거·
  manifest 문제가 하나라도 있으면 릴리스하지 않는다.
- ⚠️ 경계: `req:review-codex`/`req:commit`(live Codex + 인증)과 `npm run verify:overrides`는 자동 검증에
  포함되지 않는다(실제 과금 호출). 리뷰 **로직**은 `createFakeReviewerAdapter` 유닛이 커버하고,
  live Codex 왕복은 별도(로컬/사용자 환경·명시 요청)다.

### 선택 — GitHub CI

🔴 **GitHub CI는 publish의 필수 조건이 아니고, 기본적으로 실행되지 않는다.**

`.github/workflows/ci.yml`은 **`workflow_dispatch` 전용**이다 — push·tag push·pull_request·schedule 어떤
자동 트리거도 없다. 따라서 커밋·push·tag를 만드는 것만으로 Actions가 도는 일은 없다. Actions 사용량과
한도가 실제 비용이므로, **실행 여부는 사람이 매번 정한다.**

실행 경로는 둘뿐이다.

```sh
# (a) 직접 실행 — 사람이 지시할 때만
gh workflow run ci.yml --ref <branch>

# (b) 통합 절차 안에서 명시 요청(req.config.json 의 githubCi 설정 필요)
npx commitgate integrate --run --run-github-ci
```

대화형 `integrate --run`은 **"GitHub CI workflow를 실행하시겠습니까? … [y/N]"** 을 묻고 **기본값은 No**다 —
Enter·빈 문자열·`n`은 모두 미실행이다. `githubCi` 설정이 없으면 질문 자체를 하지 않고 생략한다(정상 상태).

요청해서 실행한 경우의 규칙:

- `success`만 통과다. `failure`·`cancelled`·`timed_out`은 물론 **`skipped`·`neutral`도 통과가 아니다**
  (요청한 검사가 실행되지 않았거나 판정이 없다는 뜻이다).
- red·timeout·skipped·run 식별 실패는 **그 실행 단위에서 중단**한다(병합·다음 단계로 넘어가지 않는다).
- **CI를 생략했다는 사실은 최종 보고에 명시한다.** 생략은 정상이지만 침묵은 아니다.

> 참고: GitHub의 branch protection에 required status check가 남아 있으면, 자동 트리거가 없는 지금은
> 그 체크가 영원히 pending으로 남아 PR merge가 막힐 수 있다. 저장소 파일만으로는 확정할 수 없으므로,
> 필요하면 사람이 GitHub 설정에서 required check를 정리한다(CommitGate는 외부 설정을 바꾸지 않는다).

## 통제점 (승인 문장)

각 단계는 **고유한 승인 문장**을 가진다. 그 문장 그대로 승인받지 못했으면 실행하지 않는다. 한 승인은 다음 단계로 **이월되지 않는다**(자세한 규칙은 [AGENTS.template.md](../AGENTS.template.md) §5).

`main`은 protected branch다. 통합 경로는 **두 가지이고 둘 다 유효**하다 — 이 프로젝트는 1인 개발 기준이라 **PR은 선택**이다.

| # | 단계 | 경로 | 승인 문장 |
|---|---|---|---|
| `I1` | feature branch push + PR 생성 | A | `feature branch push + PR 생성 승인` |
| `I2` | PR merge | A | `검증 결과 확인 후 PR merge 승인` |
| `B1` | protected branch에 direct push | B | `branch protection bypass를 사용한 direct push 승인` |
| `R1` | tag 생성 및 tag push | — | `tag 생성·push 승인` |
| `R2` | `npm publish` | — | `npm publish 승인` |
| `R3` | GitHub release 생성 | — | `GitHub release 생성 승인` |

## 공통 — 버전 bump
npm은 동일 버전 재배포가 불가하므로 **버전 bump 필수**.

```sh
git checkout -b chore/release-<version>
npm version <patch|minor|major> --no-git-tag-version   # tag·커밋 자동 생성 없음
git commit -am "chore(release): <version>"
```

- `patch`=버그/문서, `minor`=기능추가, `major`=호환깨짐.
- 버전은 `package.json`과 `package-lock.json`(root `.version` **및** `packages[""].version`) 모두 일치해야 한다. `npm version`이 둘 다 갱신하므로 커밋 전에 확인할 것.
  🔴 **손으로 bump하면 `package-lock.json`이 따라오지 않는다** — 실제로 밟은 적이 있다(0.16.0). `npm version`을 쓸 것.

## 경로 A — PR 경유 (선택)

```sh
# ── 여기서 멈춤: [I1] feature branch push + PR 생성 승인 ──
git push -u origin chore/release-<version>
gh pr create --base main --fill

# PR 생성만으로는 CI가 돌지 않는다(자동 트리거 없음).
# 검사를 원하면 사람이 명시적으로 실행한다:
gh workflow run ci.yml --ref chore/release-<version>
gh run list --workflow ci.yml --limit 1

# ── 여기서 멈춤: [I2] 검증 결과 확인 후 PR merge 승인 ──
gh pr merge --merge          # 또는 --squash / --rebase (repo 관행에 맞게)
```

CI를 실행하지 않았다면 `I2`를 요청할 때 **로컬 게이트만으로 검증했다는 사실**을 그대로 보고한다.

## 경로 B — direct push (1인 개발 통상 경로)

`git push origin main`은 **branch protection을 우회한다.** 그래서 이 경로는 `B1` 승인을 따로 받는다. 경로를 고르는 것은 자유지만, **우회했다는 사실은 보고에서 생략하지 않는다.**

```sh
# ── 여기서 멈춤: [B1] branch protection bypass를 사용한 direct push 승인 ──
git checkout main
git merge --ff-only chore/release-<version>    # 또는 일반 merge
git push origin main
```

- bypass 권한을 가진 계정은 이 push가 **거부되지 않고 그냥 성공한다.** 권한이 있다는 사실은 승인이 아니다.
- push 응답의 `remote: Bypassed rule violations for refs/heads/main`은 우회가 **이미 일어난 뒤** 나오는 사후 신호다. 사전 정지의 근거로 쓸 수 없다 — 그래서 push **전에** 멈추고 `B1`을 요청한다.
- **push는 CI를 트리거하지 않는다.** 검사를 원하면 push 후 사람이 명시적으로 실행한다:

```sh
gh workflow run ci.yml --ref main
gh run list --workflow ci.yml --limit 1
```

## 반영 이후 — 릴리즈 대상 커밋 확정 (승인 불필요, tag·publish의 전제)

경로 A·B **어느 쪽이든** 이 단계를 거친다.

⚠️ 경로 A에서 `gh pr merge` 직후 로컬 체크아웃은 **아직 `chore/release-<version>` 브랜치**에 있다. 여기서 곧바로 `git tag`를 찍으면 **머지 결과가 아니라 브랜치 커밋**에 태그가 붙는다. `--squash`/`--rebase`로 머지했다면 그 브랜치 커밋은 `main`에 **존재하지도 않는다**. tag·publish는 반드시 **protected branch의 실제 결과 커밋**에서 수행한다.

```sh
# 1) protected branch로 이동해 원격 결과를 그대로 가져온다(ff만 — 로컬 커밋이 섞이면 중단)
git checkout main
git pull --ff-only origin main

# 2) 릴리즈 대상 커밋 확정 — 이 SHA가 tag·publish의 기준이다
git log -1 --format='%H %s'
git rev-parse HEAD           # == origin/main 이어야 함
git rev-parse origin/main

# 3) 이 커밋의 버전이 릴리즈하려는 버전인지 확인
node -p "require('./package.json').version"

# 4) 이 커밋 범위의 승인 증거를 다시 strict로 확인한다(릴리스 커밋 포함 범위)
npx commitgate verify-range --base v<previous> --strict
```

`HEAD != origin/main`이거나 `verify-range --strict`가 실패하면 **여기서 멈춘다.** 아래 R1/R2/R3는 이 확정된 커밋 위에서만 실행한다.

🔴 **tag 대상은 bump 커밋이 아니라 확정된 HEAD다.** bump 뒤에 증거 부기 커밋이 더 붙는 것이 정상이며,
tag는 그 마지막 strict-clean 커밋을 가리켜야 한다(0.18.0에서 실제로 겪은 함정).

## 릴리즈 단계 (각각 별도 승인)

⚠️ 아래 셋은 통합 단계의 일부가 아니다. `I2`(merge) 승인에도 `B1`(direct push) 승인에도 포함되지 않고, 서로도 독립이다 — `tag 생성·push 승인`이 `npm publish 승인`을 포함하지 않는다. 위 "릴리즈 대상 커밋 확정"을 마친 뒤 각각 따로 요청한다.

```sh
# (전제: cwd = 확정된 origin/main 커밋을 체크아웃한 상태)

# ── [R1] tag 생성·push 승인 ──
git tag v<version>                  # HEAD(=origin/main)에 붙는다
git push origin v<version>          # tag push도 CI를 트리거하지 않는다

# ── [R2] npm publish 승인 ──
npm publish                  # 2FA(사람 최종 실행 — 완전 자동 불가). 현재 체크아웃을 패키징하므로 위 커밋이어야 한다.

# ── [R3] GitHub release 생성 승인 ──
gh release create v<version> --generate-notes
```

- tag를 원격 상태 기준으로 붙이고 싶으면 `git tag v<version> origin/main`처럼 대상 커밋을 명시해도 된다.
- 보안 취약 버전 발견 시: `npm deprecate commitgate@<v> "<사유·업그레이드 안내>"`.
- publish 후 검증: 레지스트리 integrity가 로컬 `npm pack`과 **바이트 일치**하는지 + 격리 캐시에서 실설치 smoke.

## 경로 선택은 자유, 투명성은 아니다

PR을 생략해도 된다. 하지만 다음은 생략할 수 없다.

- **우회했다는 사실**: 경로 B의 `git push origin main`은 branch protection을 우회한다. push **전에** 보고하고 `B1` 승인을 받는다.
- **CI를 실행했는지 여부**: 실행했으면 run id와 결론을, 생략했으면 **생략했다는 사실**을 보고한다.
- **승인 문장**: `main merge 승인`·`push 승인`은 `B1`이 아니다. bypass 권한 보유도 승인이 아니다.

## 로컬 셀프체크
```sh
npm run typecheck && npm test && npm run smoke
```
로컬 green은 3 OS × Node 3버전 매트릭스를 **대체하지 않는다** — 다만 그 매트릭스는 이제 **선택**이고,
돌리려면 `gh workflow run ci.yml --ref <branch>` 로 사람이 직접 실행한다.
