# Releasing CommitGate

## 배포 게이트 (필수)
`npm publish` **전에 반드시** 전 플랫폼 CI가 green이어야 한다. 같은 green이 **PR merge(`I2`)의 전제**이기도 하다.

- CI: `.github/workflows/ci.yml` — `{ubuntu-latest, macos-latest, windows-latest} × {Node 18, 20, 22}`에서 `npm ci → typecheck → test → smoke` 실행.
- smoke = **pack tarball 설치본**의 `commitgate` bin 실행(`npm run smoke`, 로컬 소스 실행 아님).
- ⚠️ CI 경계: `req:review-codex`/`req:commit`(live Codex + 인증)은 CI에서 실행하지 않는다. 리뷰 **로직**은 `createFakeReviewerAdapter` 유닛이 전 OS에서 커버하고, live Codex 왕복은 별도(로컬/사용자 환경).

## 통제점 (승인 문장)

각 단계는 **고유한 승인 문장**을 가진다. 그 문장 그대로 승인받지 못했으면 실행하지 않는다. 한 승인은 다음 단계로 **이월되지 않는다**(자세한 규칙은 [AGENTS.template.md](../AGENTS.template.md) §5).

`main`은 protected branch이며 required status checks가 걸려 있다. 통합 경로는 **두 가지이고 둘 다 유효**하다 — 이 프로젝트는 1인 개발 기준이라 **PR은 선택**이다.

| # | 단계 | 경로 | 승인 문장 |
|---|---|---|---|
| `I1` | feature branch push + PR 생성 | A | `feature branch push + PR 생성 승인` |
| `I2` | required checks green 확인 후 PR merge | A | `required checks green 확인 후 PR merge 승인` |
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

## 경로 A — PR 경유 (선택)

```sh
# ── 여기서 멈춤: [I1] feature branch push + PR 생성 승인 ──
git push -u origin chore/release-<version>
gh pr create --base main --fill

# required status checks(전 플랫폼 CI) 실행 → 전부 green인지 확인
gh pr checks --watch

# ── 여기서 멈춤: [I2] required checks green 확인 후 PR merge 승인 ──
gh pr merge --merge          # 또는 --squash / --rebase (repo 관행에 맞게)
```

여기서는 CI가 **머지 전에** 돈다. green이 `I2`의 전제다.

## 경로 B — direct push (1인 개발 통상 경로)

`git push origin main`은 **required status checks를 우회한다.** 그래서 이 경로는 `B1` 승인을 따로 받는다. 경로를 고르는 것은 자유지만, **우회했다는 사실과 CI가 사후 검증이라는 사실은 보고에서 생략하지 않는다.**

```sh
# ── 여기서 멈춤: [B1] branch protection bypass를 사용한 direct push 승인 ──
git checkout main
git merge --ff-only chore/release-<version>    # 또는 일반 merge
git push origin main
```

- bypass 권한을 가진 계정은 이 push가 **거부되지 않고 그냥 성공한다.** 권한이 있다는 사실은 승인이 아니다.
- push 응답의 `remote: Bypassed rule violations for refs/heads/main`은 우회가 **이미 일어난 뒤** 나오는 사후 신호다. 사전 정지의 근거로 쓸 수 없다 — 그래서 push **전에** 멈추고 `B1`을 요청한다.
- **CI는 push 이후에 돈다**(`on: push: branches: [main]`). 이 green은 반영을 사전에 검증한 것이 아니라 **사후 확인**이다. 사후 green은 사전 게이트를 대체하지 않는다.
- push 후 CI가 green이 아니면 **여기서 멈춘다.** `R1`(tag)로 넘어가지 않는다.

```sh
# push 후: main CI가 시작됐는지, 전부 green인지 확인
gh run list --branch main --limit 1
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

# 4) 반영 이후 CI가 이 커밋에서 green인지 확인
gh run list --branch main --limit 1
```

`HEAD != origin/main`이거나 CI가 green이 아니면 **여기서 멈춘다.** 아래 R1/R2/R3는 이 확정된 커밋 위에서만 실행한다.
경로 B로 반영했다면 이 green은 **push 이후에 나온 사후 확인**이다 — `R1`을 요청할 때 그 사실을 함께 보고한다.

## 릴리즈 단계 (각각 별도 승인)

⚠️ 아래 셋은 통합 단계의 일부가 아니다. `I2`(merge) 승인에도 `B1`(direct push) 승인에도 포함되지 않고, 서로도 독립이다 — `tag 생성·push 승인`이 `npm publish 승인`을 포함하지 않는다. 위 "릴리즈 대상 커밋 확정"을 마친 뒤 각각 따로 요청한다.

```sh
# (전제: cwd = 확정된 origin/main 커밋을 체크아웃한 상태)

# ── [R1] tag 생성·push 승인 ──
git tag v<version>                  # HEAD(=origin/main)에 붙는다
git push origin v<version>

# ── [R2] npm publish 승인 ──
npm publish                  # 2FA(사람 최종 실행 — 완전 자동 불가). 현재 체크아웃을 패키징하므로 위 커밋이어야 한다.

# ── [R3] GitHub release 생성 승인 ──
gh release create v<version> --generate-notes
```

- tag를 원격 상태 기준으로 붙이고 싶으면 `git tag v<version> origin/main`처럼 대상 커밋을 명시해도 된다.
- 보안 취약 버전 발견 시: `npm deprecate commitgate@<v> "<사유·업그레이드 안내>"`.

## 경로 선택은 자유, 투명성은 아니다

PR을 생략해도 된다. 하지만 다음은 생략할 수 없다.

- **우회했다는 사실**: 경로 B의 `git push origin main`은 required status checks를 우회한다. push **전에** 보고하고 `B1` 승인을 받는다.
- **CI가 사후라는 사실**: 경로 B에서 CI green은 반영을 사전에 막아 준 것이 아니다. `R1`을 요청할 때 그 순서를 그대로 보고한다.
- **승인 문장**: `main merge 승인`·`push 승인`은 `B1`이 아니다. bypass 권한 보유도 승인이 아니다.

## 로컬 셀프체크
```sh
npm run typecheck && npm test && npm run smoke
```
로컬 green은 3 OS × Node 3버전 매트릭스를 **대체하지 않는다.** required status checks는 CI에서만 확인된다.
