# REQ-2026-059 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

`tests/unit/state-checkpoint.test.ts`에는 임시 git 저장소를 만드는 픽스처가 둘이다.

| 픽스처 | 정리 시점 | 저장소에서 일어나는 일 |
|---|---|---|
| `makeRepo()` (헬퍼 단위 테스트) | 각 테스트의 `finally` | 시드 커밋 1 + checkpoint 커밋 0~1 |
| `setupTicketRepo()` (near-e2e) | `afterEach` | **`main()` 전체 경로** — 원장 커밋 · design evidence 커밋 · state checkpoint 커밋 |

둘 다 `git init` 후 `user.email`/`user.name`만 설정하고 정리는 `rmSync(dir, {recursive, force})`다.

**실패는 near-e2e 쪽에서만 났다.** 커밋 수가 많아 git이 명령 뒤에 **detached 유지보수**를 띄울 확률이
높기 때문이다. 그 프로세스가 `.git/objects/pack/`에 쓰는 동안 `rmSync`가 그 디렉터리를 `rmdir`하면
`ENOTEMPTY`가 난다. 그래서 **원인은 "정리 코드가 약해서"가 아니라 "저장소가 정리 시점에 아직 살아 있어서"**다.

## 핵심 설계 결정

### DEC-1. 원인 제거가 우선 — 픽스처 저장소에서 **auto 유지보수를 끈다**

`git init` 직후 repo-local로 두 값을 심는다.

```
gc.auto = 0            # auto gc 자체를 끈다(detach 여부와 무관하게 뜨지 않는다)
maintenance.auto = false  # git ≥2.29의 `maintenance run --auto` 경로도 함께 막는다
```

두 개를 다 끄는 이유: git 버전에 따라 명령 뒤 자동 실행 경로가 `gc --auto`이거나
`maintenance run --auto`다. 실패한 러너(ubuntu·node 20)의 git 버전에 맞춰 하나만 끄면 다른 러너에서
같은 증상이 남는다. **테스트 픽스처는 결정적이어야 하므로 두 경로를 모두 닫는다.**

> 이것은 피시험 동작을 바꾸지 않는다 — 유지보수는 git의 **저장소 관리** 기능이고, CommitGate가 검증하는
> 것은 커밋 내용·인덱스·상태다. `git-hermetic.ts`가 전역 config를 차단하는 것과 같은 축(테스트 환경을
> 재현 가능하게 고정)이다.

### DEC-2. 그래도 남는 경합에는 **짧은 재시도**를 준다(방어 심층화)

`rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })`.

DEC-1이 원인을 없애지만, 파일시스템·바이러스 스캐너·OS 캐시가 잠시 핸들을 쥐는 경우까지 막지는 못한다.
Node의 `rmSync`는 `EBUSY`·`ENOTEMPTY`·`EPERM`에 한해 재시도하므로 **다른 오류는 그대로 드러난다** —
실패를 삼키는 것이 아니다.

🔴 **재시도만으로 끝내지 않는 이유**: 재시도는 증상 완화라 타이밍이 나쁘면 다시 터진다. 원인(DEC-1)을
먼저 없애고, 재시도는 그 위의 얇은 보험으로만 둔다.

### DEC-3. 단언은 건드리지 않는다

이 REQ의 diff는 **픽스처 생성·정리 두 곳**에만 닿는다. 검증 내용을 손대면 "CI를 green으로 만들려고
테스트를 약화시켰다"와 구분할 수 없어진다.

## Phase별 구현

단일 phase. 변경 파일 1개.

## 변경 파일

| 파일 | 변경 |
|---|---|
| `tests/unit/state-checkpoint.test.ts` | 두 픽스처에 `gc.auto=0`·`maintenance.auto=false` · 정리에 `maxRetries`/`retryDelay` |

## 하위호환·안전

- 제품 코드 변경 0건. 다른 테스트 파일 무영향.
- 단언·기대값 변경 0건 — 통과 조건이 느슨해지지 않는다.
- 실패가 재현되면(재시도 소진) 여전히 그 오류로 죽는다 — 정리 실패를 조용히 삼키지 않는다.
