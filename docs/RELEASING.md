# Releasing CommitGate

## 배포 게이트 (필수)
`npm publish` **전에 반드시** 전 플랫폼 CI가 green이어야 한다.

- CI: `.github/workflows/ci.yml` — `{ubuntu-latest, macos-latest, windows-latest} × {Node 18, 20, 22}`에서 `npm ci → typecheck → test → smoke` 실행.
- smoke = **pack tarball 설치본**의 `commitgate` bin 실행(`npm run smoke`, 로컬 소스 실행 아님).
- ⚠️ CI 경계: `req:review-codex`/`req:commit`(live Codex + 인증)은 CI에서 실행하지 않는다. 리뷰 **로직**은 `createFakeReviewerAdapter` 유닛이 전 OS에서 커버하고, live Codex 왕복은 별도(로컬/사용자 환경).

## 재배포 레시피
npm은 동일 버전 재배포가 불가하므로 **버전 bump 필수**.

```sh
# 0) (전 플랫폼 CI green 확인)
git commit -am "..."                       # 변경 커밋
npm version patch --no-git-tag-version      # 0.1.x → 0.1.(x+1)
git commit -am "chore(release): <version>"
git push origin main
npm publish                                 # 2FA(사람 최종 실행 — 완전 자동 불가)
```

- `patch`=버그/문서, `minor`=기능추가, `major`=호환깨짐.
- 태그: `git tag v<version> && git push origin v<version>`.
- 보안 취약 버전 발견 시: `npm deprecate commitgate@<v> "<사유·업그레이드 안내>"`.

## 로컬 셀프체크
```sh
npm run typecheck && npm test && npm run smoke
```
