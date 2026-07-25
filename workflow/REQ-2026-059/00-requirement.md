# REQ-2026-059 요구사항

## 무엇

REQ-2026-057이 추가한 near-e2e 픽스처(`tests/unit/state-checkpoint.test.ts`)의 **임시 저장소 정리를
결정적으로** 만든다. 지금은 정리 단계가 git의 백그라운드 작업과 경합해 간헐 실패한다.

## 왜

`main=3eb8585`의 CI 9 job 중 **ubuntu-latest · node 20 하나만** 실패했다. 단언 실패가 아니다:

```
FAIL tests/unit/state-checkpoint.test.ts > … checkpoint 커밋이 semantic identity를 바꾸지 않는다
Error: ENOTEMPTY: directory not empty, rmdir '/tmp/cg-ckpt-e2e-…/.git/objects/pack'
Tests  1 failed | 1727 passed | 1 skipped (1729)
```

`afterEach`의 `rmSync(repo, {recursive, force})`가 도는 동안, 이 픽스처가 만든 커밋들 뒤에 git이
**detached로 띄운 auto 유지보수(gc)** 가 `.git/objects/pack/`에 파일을 쓰고 있어 `rmdir`가 실패한다.

- **제품 결함이 아니다** — 단언은 전부 통과했다(1727 pass). 실패한 것은 테스트 하네스의 정리 단계다.
- 그러나 **CI가 빨간 상태로 남으면 다음 변경의 신호가 죽는다.** 간헐 실패를 방치하면 "원래 가끔 빨감"이
  되어 진짜 회귀를 가린다.
- 로컬(Windows)·다른 8개 job에서는 재현되지 않았다 — 플랫폼·타이밍 의존이라 **원인을 없애야** 한다.

## 완료 기준

1. 이 픽스처가 만드는 임시 저장소에서 **git 백그라운드 유지보수가 아예 뜨지 않는다**(원인 제거).
2. 정리 실패가 여전히 발생할 수 있는 경우에도 테스트가 그것 때문에 죽지 않는다(짧은 재시도).
3. 단언·검증 내용은 **하나도 바꾸지 않는다** — 이 REQ는 정리 경로만 다룬다.
4. `npm test` green · `tsc --noEmit` 0 · CI 9 job 전부 green.

## 비목표

- 다른 테스트 파일의 픽스처 정리 방식 일괄 변경(지금 실패한 것은 이 파일이다. 같은 증상이 다른 곳에서
  관측되면 그때 같은 처방을 적용한다).
- 제품 코드 변경.
