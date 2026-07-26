# REQ-2026-067 설계 — setup 대화형 UI(방향키 선택 · 배너 · 커밋 안내)

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

`bin/setup.ts`

- `Prompter { ask(q, hint): Promise<string>; close?(): void }` — **IO는 이 한 겹에만** 있다(REQ-2026-060 DEC-3).
- `createReadlinePrompter()` — `readline/promises`의 `question()` 한 줄 입력. `close: () => rl.close()`.
- `askAll(questions, prompter, onInvalid)` — 답을 `interpretAnswer`로 해석(빈 문자열=유지 / `-`=null /
  그 외=값)하고 `validateValue`(= `CONFIG_SCHEMA` 서브스키마)로 검증, 최대 `MAX_ANSWER_ATTEMPTS`회 재시도.
- `Question { key, prompt, current, currentIsDefault, choices?: string[] }` — `choices`는
  **이미 스키마 enum에서 파생**된다(`choicesFor`).
- `runSetup`은 ①TTY → ②기존 설정 로드 → ③codex 설치 확인 → ④질문 → ⑤로그인 → ⑥재검증 → ⑦저장(유일한 write).

테스트(`tests/unit/setup.test.ts`)는 `Prompter`에 **문자열 배열을 주입**한다 — 완전히 결정적이다.

## 핵심 설계 결정

### DEC-1 — 🔴 키 처리는 **순수 상태기계**, raw mode는 얇은 어댑터

선택 위젯의 로직을 `(state, key) → state'` 순수 함수로 분리한다.

```
SelectState { options: readonly string[]; index: number }
SelectOutcome = { kind: 'move'; state } | { kind: 'accept'; value } | { kind: 'cancel' } | { kind: 'ignore' }
applySelectKey(state, key: Key): SelectOutcome
```

🔴 **이유**: setup은 대화형 전용이라 CI에서 실제 키 입력을 검증할 수 없다. 로직을 어댑터 안에 두면
회귀 검증이 **사람 눈에만** 의존하게 된다. 순수 함수로 빼면 키 시퀀스 → 결과가 전 OS CI에서 고정된다.

어댑터가 하는 일은 셋뿐이다: raw mode on/off · stdin 청크를 파서에 먹이기 · 화면 다시 그리기.

### DEC-1b — 🔴 파싱은 **chunk 단위가 아니라 스트림 단위**다 (design r01 P1)

raw stdin은 바이트 스트림이라 **정상 입력인 ↑(`\x1b[A`)가 `\x1b` + `[A` 두 청크로 쪼개져 도착할 수 있다.**
청크마다 독립적으로 해석하면 첫 청크의 `\x1b`를 Esc로 읽고 **↑를 눌렀는데 setup이 중단된다.**
반대로 한 청크에 여러 키가 붙어 오기도 한다(빠른 입력·붙여넣기).

그래서 파서는 **잔여 버퍼를 소유**하는 증분 파서다(순수 — 버퍼를 인자로 받고 새 버퍼를 낸다).

```
parseKeys(buffer: string): { keys: Key[]; rest: string }
```

- 버퍼 앞에서부터 **완전한 시퀀스만** 잘라내 `keys`에 넣는다.
- 남은 것이 **더 긴 시퀀스의 접두사일 수 있으면** 자르지 않고 `rest`로 되돌린다
  (`\x1b` · `\x1b[` · `\x1bO`). 다음 청크가 붙으면 그때 확정된다.
- 접두사가 될 수 없는 바이트는 `other`로 소비한다 — 버퍼가 무한히 자라지 않는다.

🔴 **단독 Esc를 취소 키로 쓰지 않는다.** "Esc 하나"와 "시퀀스의 시작"은 **더 이상 입력이 오지
않는다는 사실**로만 구별되고, 그건 타이머(비결정적·테스트 불가) 없이는 알 수 없다.
취소는 **Ctrl+C 하나**로 정한다 — 보편적이고 모호하지 않다. Esc는 `rest`에 남았다가 다음 바이트와
함께 해석되거나, 인식 불가 조합이면 `ignore`된다(상태 불변이라 무해하다).

테스트로 고정한다: `['\x1b', '[A']` 분할 입력이 **이동 1회**로 처리될 것 ·
`'\x1b[A\x1b[B\r'` 한 청크가 **이동·이동·확정**으로 처리될 것 · `'\x1b'`만 오면 키 0개 + `rest='\x1b'`.

### DEC-2 — 🔴 `Prompter` 인터페이스를 **넓히지 않는다**

`ask(q, hint): Promise<string>`를 그대로 두고, 선택 UI는 **그 구현 안에서** 일어난다.
확정된 선택지 문자열을 `ask`의 반환값으로 내면 `askAll` 이하(해석·검증·저장)가 **한 줄도 바뀌지 않는다**.

🔴 이것이 수용기준 4(기존 테스트 무수정 통과)를 만족시키는 방법이다. `Prompter`에 `select()`를 더하면
테스트 Prompter가 새 메서드를 구현해야 하고, 그 순간 seam이 갈라진다.

부수 효과: **자유 입력 질문은 자동으로 무회귀**다(R1 명시 제외). 분기는 `q.choices` 유무 하나다.

### DEC-3 — 🔴 raw mode 해제는 **finally + 프로세스 안전망**

raw mode를 켠 채 프로세스가 죽으면 사용자 터미널이 **에코 없는 상태로 남는다**. 다음을 모두 건다.

1. 한 질문의 `ask`가 끝나면 **즉시** 원래 모드로 되돌린다(질문 사이에는 raw가 아니다).
2. `Prompter.close()`가 raw mode 해제 + 리스너 제거를 한 번 더 보장한다(멱등).
3. `runSetup`의 `finally`가 `close()`를 부른다(기존 구조 그대로).

🔴 **Ctrl+C는 `cancel`로 처리하고 우리가 정리한 뒤 종료한다.** raw mode에서는 SIGINT가 자동 발생하지
않아(`\x03`가 그냥 데이터로 온다) 기본 핸들러에 기댈 수 없다.

### DEC-4 — 선택지 파생은 그대로 스키마에서

`choicesFor(key)`가 이미 `CONFIG_SCHEMA` enum에서 파생한다(REQ-2026-063 DEC-4). **건드리지 않는다.**
enum이 늘면 위젯도 자동으로 늘어난다 — `merge` 추가 때 실제로 그렇게 동작했다.

### DEC-5 — 🔴 초기 커서는 **현재 값**에 놓는다

`Question.current`가 선택지에 있으면 그 인덱스에서 시작한다. 없으면 0.

🔴 그냥 Enter를 누르는 사용자가 **지금 값을 유지**하는 것이 기존 계약이다(`interpretAnswer('')`=유지).
커서를 0에 두면 Enter가 "첫 선택지로 변경"이 되어 **조용한 값 변경**이 일어난다.

⚠️ 다만 "유지(미기록)"와 "현재 값을 명시 선택(기록)"은 저장 결과가 다르다 —
전자는 파일에 키를 쓰지 않고 후자는 쓴다. 선택 위젯은 항상 **값을 반환**하므로 Enter가 곧 명시 선택이 된다.
그래서 **"유지" 항목을 목록의 첫 줄에** 둔다(DEC-6).

### DEC-6 — 🔴 목록 = `[유지] + [비움] + enum 값들`

선택 위젯은 문자열 하나를 내야 하는데, 기존 계약에는 값 말고 **두 개의 특수 답**이 있다.

| 표시 | 반환 | 의미 |
|---|---|---|
| `현재 값 유지 (…)` | `''` | 미기록 — 기존 `Enter` |
| `비움 — codex 전역 설정 상속` | `-`(`NULL_SENTINEL`) | `null` 기록 |
| 각 enum 값 | 그 값 | 명시 기록 |

🔴 특수 답을 빼면 **자유 입력에서 되던 일이 선택에서 안 되는 기능 후퇴**가 된다.
`stopGate`는 스키마에 null이 없어 `-`가 자동 거부되므로 **비움 항목을 넣지 않는다**
(`hintFor`가 이미 그렇게 판단한다 — 같은 근거를 공유한다).

초기 커서는 **`유지` 항목**(index 0)에 놓는다. 그래야 "Enter만 누르면 아무것도 안 바뀐다"가 유지된다.
DEC-5의 "현재 값에 커서"는 이 구조에서 자동 충족된다.

### DEC-7 — 배너는 순수 문자열 함수

`setupBanner(version): string`. `runSetup`이 **TTY 판정 이후·첫 질문 이전**에 1회 출력한다.

🔴 비-TTY 거부 경로에서는 출력하지 않는다(수용기준 6) — 거부 메시지 위에 장식이 붙으면
에이전트가 읽는 오류 출력이 지저분해진다. ASCII만 쓴다(Windows 콘솔 폰트 안전).

### DEC-8 — 종료 안내에 커밋 지시

`savedMessage(path, keys)`에 `req.config.json`을 커밋하라는 줄을 더한다.

🔴 실측 근거: 진행 중 티켓이 있는 저장소에서 setup을 돌리면 `req:doctor`가 **D10(unstaged 존재)**과
**D13(설계 승인 없는 비-티켓 변경)**으로 FAIL한다. 커밋하면 즉시 PASS다. 안내가 없으면 사용자는
방금 실행한 setup이 워크플로를 망가뜨렸다고 읽는다.

### DEC-9 — 🔴 stdout이 TTY가 아니면 **선택 위젯을 쓰지 않는다**

`isInteractiveTty`는 stdin·stdout 둘 다 본다. 이미 통과했으므로 위젯을 쓸 수 있다.
그래도 `setRawMode`가 없는 stdin(드문 플랫폼)에서는 **자유 입력으로 되돌린다**(graceful degrade).
🔴 위젯을 못 쓴다고 setup 전체를 실패시키지 않는다 — 지금까지 되던 일이다.

### DEC-10 — 🔴 화면 갱신은 **줄 단위 재출력**, 전체 화면 제어 안 함

선택 목록만 지우고 다시 그린다(`\x1b[<n>A` + `\x1b[0J`). alternate screen buffer·커서 저장/복원은
쓰지 않는다 — 스크롤백을 먹거나 터미널마다 다르게 동작한다. 확정 후에는 **고른 값 한 줄만** 남긴다.

## Phase별 구현

`02-plan.md` 참조.

## 변경 파일

| 파일 | 변경 |
|---|---|
| `bin/setup.ts` | 배너·선택 목록 구성·`createReadlinePrompter`의 선택 분기·저장 메시지 |
| `bin/select-prompt.ts` (신규) | 순수 상태기계(`applySelectKey`·`parseKey`·`renderSelect`) + raw mode 어댑터 |
| `tests/unit/select-prompt.test.ts` (신규) | 키 시퀀스 → 결과 고정 |
| `tests/unit/setup.test.ts` | **기존 테스트 무수정** + 선택 목록 구성·배너·저장 메시지 추가 |
| `docs/configuration(.en).md` · `CHANGELOG.md` | UI 변화 기록 |

## 하위호환·안전

- 저장 계약 무변경 — 건드린 키만 · Enter=유지=미기록 · 원자적 저장 · 로그인 실패 시 미저장.
- 비-TTY 거부 계약 무변경.
- `Prompter` 인터페이스 무변경 → 기존 테스트·주입 경로 그대로.
- raw mode 미지원 환경은 자유 입력으로 degrade — 기능 상실 없음.
