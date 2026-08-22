# REQ-2026-170 요구사항

## 무엇

`scripts/req/lib/intake-batch.ts`(REQ-2026-169 가 만든 모듈)가 `cross-spawn` 을 **직접** import 해
프로세스 스폰 경계 등록부 밖에 새 스폰 경로를 만들었다. 이것을 `adapters.safeSpawnSyncStatus`
(shell 없는 단일 cross-spawn 경계)를 쓰도록 돌린다.

## 왜

`tests/unit/external-call-boundary.test.ts` 의
*"스폰하는 production 파일 집합이 allowlist와 정확히 일치한다"* 가 **red** 다.

```
Test Files  1 failed | 115 passed (116)
     Tests  1 failed | 4301 passed (4302)
```

🔴 이 가드는 **옳게 잡았다.** 그 파일의 주석이 규범을 적어 두었다:
*"추가할 때는 왜 그 파일이 직접 스폰해야 하는지를 함께 적는다 — 대부분은 `adapters.ts` 의
`safeSpawnSync` 를 쓰는 것이 옳다."*

`intake-batch` 는 `ls-tree`·`rev-parse` 를 **1회 왕복**으로 부를 뿐이다. `git-batch.ts` 가 등록부에 있는
이유(`cat-file --batch` 의 stdin 스트리밍)에 해당하지 않는다. 따라서 등록부를 늘릴 근거가 없다.

## 완료 기준

1. `intake-batch.ts` 가 `cross-spawn`·`node:child_process` 를 직접 import 하지 않는다.
2. `external-call-boundary.test.ts` 가 green — **등록부(`SPAWNING_FILES`)를 수정하지 않고**.
3. REQ-2026-169 가 세운 두 계약이 그대로다:
   - `scanIntake` 는 티켓 수와 무관하게 git 프로세스 **2회**(계수 오라클).
   - `-z` 열거 출력이 **가공되지 않는다**(후행 공백 제거가 프레이밍을 깨뜨리면 안 된다).
4. 실패와 "티켓 없음" 을 가르는 판정이 유지된다 — exit code 를 읽을 수 있어야 한다.
5. 🔴 `ls-tree` 출력 상한이 **256 MiB 그대로**다. 경계의 기본값은 64 MiB 라, 명시하지 않으면
   상한이 조용히 1/4 로 줄어 큰 저장소에서 지금 되던 스캔이 실패한다(design-r01 P1).

## 비목표

- 스폰 등록부(`SPAWNING_FILES`)에 항목 추가. 그것이 쉬운 길이지만 가드의 규범과 반대다.
- `git-batch.ts` 의 `cat-file --batch` 직접 스폰 변경(스트리밍이라 등록부에 남는 것이 옳다).
- REQ-2026-169 의 판정·성능 계약 변경.
