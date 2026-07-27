# REQ-2026-068 요구사항 — CI 정리 경합 제거(픽스처 전역)

## 배경

`main=b36dd58` 통합 직후 CI에서 **macos-latest · node 20 한 job만** 실패했다.

```
Tests  1 failed | 2085 passed | 1 skipped (2087)
FAIL tests/unit/req-review-codex.test.ts
Error: ENOTEMPTY: directory not empty, rmdir '.../req052-addendum-MByIA6/.git'
  at tests/unit/req-review-codex.test.ts:4771   ← afterEach 정리
```

**단언은 전부 통과했고 `afterEach` 정리에서만 죽었다.** git이 커밋 뒤 유지보수를 detached 프로세스로
띄우고, 그 프로세스가 `.git/objects/pack/`에 쓰는 동안 `rmSync`가 그 디렉터리를 지우려 해서 나는 경합이다.

🔴 **같은 증상을 이미 한 번 고쳤다.** REQ-2026-059가 `state-checkpoint.test.ts`에 대해
`disableAutoMaintenance`(`gc.auto=0` + `maintenance.auto=false`)와 재시도 정리를 넣었다.
그때 처방을 **그 파일에만** 적용했기 때문에, 실 git 저장소를 만드는 나머지 픽스처(20개 파일)에는
같은 결함이 그대로 남아 있었다.

## 요구사항

### R1 — 처방을 **전역으로** 건다
실 git 저장소를 만드는 **모든** 픽스처가 auto 유지보수 없이 돌아야 한다.
파일마다 손으로 넣는 방식은 이번 실패가 보여 주듯 빠뜨린다.

### R2 — 정리 실패는 얇은 보험으로 덮는다
원인을 없앤 뒤에도 파일시스템 지연이 남을 수 있으므로 정리에 재시도를 둔다.
🔴 재시도는 `EBUSY`·`ENOTEMPTY`·`EPERM`에만 적용된다 — 다른 오류는 그대로 드러나야 한다.

## 제약

- **피시험 동작을 바꾸지 않는다.** 유지보수는 저장소 관리 기능이고 검증 대상은 커밋 내용·인덱스·상태다.
- 기존 테스트를 수정·삭제하지 않는다(추가·중앙화만).
- `tests/setup/git-hermetic.ts`의 기존 차단(identity 4경로)은 **한 줄도 건드리지 않는다**.

## 비목표

- 테스트 병렬화 복원(`fileParallelism: false`는 별건 — REQ-2026-044).
- 실패한 job의 다른 원인 탐색 — 로그상 원인은 정리 경합 하나다.

## 수용 기준

1. `npm test` green(로컬 · 전 OS CI).
2. 픽스처가 만든 저장소에서 `gc.auto`·`maintenance.auto`가 꺼져 있음을 테스트가 확인한다.
3. 처방이 **한 곳**에 있고, 새 픽스처가 별도 조치 없이 그 처방을 받는다.
4. `git-hermetic.ts`의 기존 identity 차단 동작이 그대로다(회귀 가드).
