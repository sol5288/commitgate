# REQ-2026-058 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

### F-3 — 두 커밋 명령 생성기가 갈라져 있다

`scripts/req/req-next.ts`에 커밋 명령 생성기가 둘이다.

| 생성기 | 사용 경로 | `-m` |
|---|---|---|
| `commitCmd` (`:346`) | AWAIT_HUMAN(사람 승인) — `:545` | **없음** |
| `autoCommitCmd` (`:355`) | LOW 자동 커밋(REQ-2026-037) | 있음(`-m "<이 phase의 conventional 커밋 메시지>"`) |

`autoCommitCmd`의 주석이 이유를 이미 적어 뒀다 — *"`req:commit`은 메시지 없이는 fail-closed로 죽기 때문
(read-only인 req:next는 메시지를 합성할 수 없다)"*. 그 사실은 사람 승인 경로에도 똑같이 성립한다.

### F-5 — HEAD 부재 조회가 git stderr를 상속한다

"HEAD에 아직 없음"은 **정상 상태**이고 코드는 그것을 `catch → null`로 처리한다. 그런데 git은 그 전에
stderr로 `fatal: path '…' does not exist in 'HEAD'`를 이미 뱉는다. 호출부는 4곳이다.

| 위치 | 조회 |
|---|---|
| `lib/evidence-ports.ts:51` | `git show HEAD:<path>` (`headText`) |
| `lib/evidence-ports.ts:68` | `git cat-file blob HEAD:<path>` (`headBlobSha256`) |
| `req-commit.ts:487` | `git show HEAD:<path>` (`headBlobText`) |
| `req-reconstruct.ts:34·73` | `git show HEAD:<path>` |

`bin/init.ts`의 `assertGitWorkTree`가 같은 문제를 **probe 전용 quiet runner**로 이미 해결해 뒀다
(`stdio: ['ignore','pipe','ignore']`) — 그 선례를 따른다.

### F-4·F-6~F-9 — 안내 문구

| 항목 | 위치 | 현재 |
|---|---|---|
| F-4 | `bin/init.ts:1380` | `(2단계 install 을 먼저 실행해야 <lockfile> 이 존재합니다…)` — Stage B에선 lockfile이 `init` **이전**(선행 `npm i -D commitgate`)에 이미 있다 |
| F-6 | `bin/uninstall.ts` `renderRevertSection` | revert를 권하면서 그 커밋에 든 `workflow/.gitignore`가 함께 사라진다는 사실을 말하지 않는다 |
| F-7 | `bin/uninstall.ts` `renderPlan` §6 | Stage B가 만들지 않는 `scripts/`를 잔여 후보로 나열 |
| F-8 | `bin/uninstall.ts` `renderPlan` — `not-installed` 분기 | 조기 return이라 §3(감사 증거)을 건너뛴다 |
| F-9 | `bin/uninstall.ts` `renderNpxSection` | `_npx` 삭제 범위(모든 npx 패키지)를 밝히지 않는다 |

## 핵심 설계 결정

### DEC-1. F-3은 **`commitCmd`에 자리표시자를 넣는 방식**으로 고친다(생성기 통합 아님)

`autoCommitCmd`와 같은 문자열을 쓰되 함수를 합치지는 않는다. 두 경로는 **승인 주체가 다르고**
(자동 커밋 정책 vs 사람 확인), 앞으로 인자가 갈라질 수 있다. 지금 합치면 그 차이가 생길 때 다시 쪼개야 한다.
중복되는 것은 자리표시자 문자열 하나뿐이므로 **상수로 추출**해 드리프트를 막는다.

> 자리표시자는 사람이 그 자리를 메우고 실행하라는 뜻이다. `req:next`는 읽기 전용이라 메시지를 만들 수 없고,
> 만들어서도 안 된다 — 커밋 메시지는 사람·Builder의 판단이다.

### DEC-2. F-5는 **그 조회에만** stderr를 버린다(전역 억제 금지)

`headText`·`headBlobSha256`·`headBlobText`·reconstruct의 HEAD 조회에 `stdio: ['ignore','pipe','ignore']`를 준다.

🔴 **다른 git 호출의 stderr는 그대로 둔다.** 전역으로 끄면 진짜 오류(권한·손상·잠금)의 진단까지 사라진다 —
이 저장소에는 이미 "doctor 진단 삼킴"이라는 반대 방향 마찰 기록이 있다. **부재가 정상인 조회에만** 적용한다.

⚠️ 판정은 바뀌지 않는다: 여전히 예외 → `null`/`[]`. 바뀌는 것은 **사람이 보는 노이즈**뿐이다.
`GitAdapter.exec` 자체를 손대지 않는 이유도 같다 — 그 경계는 모든 호출이 공유한다.

### DEC-3. F-6은 **분류가 이미 아는 사실**을 안내로 옮긴다

planner는 `workflow/.gitignore`를 이미 "CommitGate 소유 파일"로 분류하고(§1), 도입 커밋도 안다(§4).
그 커밋이 `.gitignore`를 담고 있는지는 **git에 물어보면 된다**(`git show --name-only <sha>`).
담고 있고 **보존할 티켓 증거가 있으면**(§3 protect 비어 있지 않음) revert 절에 경고와 선택지를 붙인다:

- 증거를 계속 쓸 것이면 revert 뒤 `workflow/.gitignore`를 복원하거나 그 규칙을 루트 `.gitignore`로 옮긴다.
- 티켓 증거까지 정리할 것이면 그 파일들도 함께 지운다(그때는 노출이 문제가 아니다).

조건부로 내는 이유: 증거가 없으면(§3이 비면) 노출될 scratch도 없어 경고가 소음이 된다.

### DEC-4. F-7·F-8·F-9는 문자열·분기 정리

- **F-7**: Stage B는 `scripts/req/**`를 복사하지 않는다. 잔여 디렉터리 목록에서 `scripts/`를 뺀다
  (`KIT_SOURCE_DIR_REL` 흔적이 실제로 있는 경우 — 즉 Stage A 설치본 — 에만 남긴다).
- **F-8**: `not-installed` 조기 return 앞에 **증거 절을 먼저 낸다**. "되돌릴 것이 없다"와 "증거가 남아 있다"는
  동시에 참일 수 있다.
- **F-9**: `_npx` 삭제 명령에 범위를 명시한다 — CommitGate만이 아니라 그 사용자가 npx로 실행한 **모든**
  패키지 캐시가 지워진다.

### DEC-5. 오라클은 **출력 문자열**이다

`renderPlan`·`installGuidance`·`commitCmd`는 전부 순수 함수라 문자열 단언으로 고정할 수 있다.
F-5만 예외 — "stderr에 무엇이 안 나오는가"는 문자열 단언으로 잡히지 않으므로, **자식 프로세스의 stderr를
캡처**해 `fatal:`이 없음을 확인한다(부재 단언이므로 음성 대조가 필요하다: 같은 픽스처에서 `stdio` 옵션을
빼면 실제로 나타나는지 확인한 뒤 고정한다).

## Phase별 구현

### Phase 1 — 워크플로 안내·진단 (`phase-1-workflow-guidance`)

F-3(`req-next.ts`) + F-5(`evidence-ports.ts`·`req-commit.ts`·`req-reconstruct.ts`).

### Phase 2 — 설치·제거 안내 (`phase-2-install-uninstall-guidance`)

F-4(`bin/init.ts`) + F-6·F-7·F-8·F-9(`bin/uninstall.ts`).

## 변경 파일

| Phase | 파일 | 변경 |
|---|---|---|
| 1 | `scripts/req/req-next.ts` | `commitCmd`에 메시지 자리표시자(상수 공유) |
| 1 | `scripts/req/lib/evidence-ports.ts` | HEAD 조회 2곳 stderr 억제 |
| 1 | `scripts/req/req-commit.ts` | `headBlobText` stderr 억제 |
| 1 | `scripts/req/req-reconstruct.ts` | HEAD 조회 stderr 억제 |
| 1 | `tests/unit/req-next.test.ts` | 자리표시자 단언 |
| 1 | `tests/unit/state-checkpoint.test.ts` | 승인 경로 stderr에 `fatal:` 부재(음성 대조 포함) |
| 2 | `bin/init.ts` | lockfile 문구 정정 |
| 2 | `bin/uninstall.ts` | revert 파급 경고 · `scripts/` 제거 · not-installed 증거 고지 · `_npx` 범위 |
| 2 | `tests/unit/uninstall.test.ts` | 위 4건 문자열 단언 |

## 하위호환·안전

- **게이트·판정 불변**: exit code·승인 규칙·D-체크 결과가 달라지지 않는다. 바뀌는 것은 출력 문자열과
  자식 프로세스 stderr 처리뿐이다.
- **`uninstall`은 읽기 전용 유지**: 새 경고는 `git show --name-only`(조회)만 쓴다. 삭제 플래그를 추가하지 않는다.
- **`req:next` 읽기 전용 유지**: 자리표시자는 문자열이다. 메시지를 만들지 않는다.
- F-5는 **부재가 정상인 조회에만** 적용하므로, 다른 실패의 진단 가시성은 그대로다.
