# REQ-2026-169 요구사항

## 무엇

`req:new` 의 intake 게이트 스캔이 **티켓 수에 비례해 git 프로세스를 띄우는 구조**를 없앤다.
판정 로직·판정 결과는 **하나도 바꾸지 않고**, HEAD blob 을 읽는 **IO 방식만** 배치로 바꾼다.

## 왜 (관측된 사실)

소비자 저장소 `44_meallo`(commitgate 0.26.0 · 티켓 300개)에서 실측:

| 항목 | 값 |
|---|---|
| `npx commitgate req:new <slug>` **dry-run** | **603초 (10분 3초)** |
| 같은 저장소의 `npx` 기동 비용(`--help`) | 2.6초 |
| 이 Windows 박스의 `git show` 1회 스폰 비용 | ~197ms |

원인은 `lib/evidence-ports.ts` 의 `createEvidencePorts` 가 `headText`·`headBlobSha256`·`headArchivePaths`
**호출 1회당 git 프로세스 1개**를 띄우고, `scanIntake` 가 그 포트를 **티켓마다** 새로 만들기 때문이다.
티켓 1개당 `4(headText) + 4+(design 검증) + N(phase archive)` 회 → meallo 기준 약 3,000회 스폰.
3,000 × 197ms ≈ 600초로 실측과 일치한다.

🔴 이 비용은 **dry-run 에도 전부 든다** — 게이트 판정을 먼저 계산하기 때문이다.
🔴 티켓 수에 **선형**이므로, 쓸수록 느려지고 되돌아오지 않는다.

## 완료 기준

1. `scanIntake` 가 티켓 수와 무관하게 **git 프로세스 2개**만 쓴다 — 재귀 열거 1 + 배치 읽기 1.
   🔴 **티켓 목록도 그 재귀 열거에서 파생한다.** 별도의 목록 조회(`ls-tree -d`)를 남기면 정상 경로가
   3개가 되어 이 기준이 거짓이 된다(design-r01 P1 이 잡은 결함).
   폴백 경로를 제외하고, 이 사실이 **호출 횟수를 세는 테스트**로 고정된다 — 계수는 `scanIntake` 가
   내는 **모든** git 실행을 관측해야 한다(일부만 세면 또 공허해진다).
2. 기존 `tests/unit/req-new-intake.test.ts` 의 실 git 케이스가 **단정을 한 줄도 고치지 않고** 전부 통과한다.
3. 이 저장소(166 티켓)에서 `req:new` dry-run 이 **10초 이내**로 끝난다(현재 5분대).
4. `scanTicketIntake` 단일 티켓 호출부(`req:commit`·`req:doctor`)의 동작·시그니처가 그대로다.

## 비목표 (이번에 하지 않는다)

- intake **판정 규칙**의 변경(어떤 상태가 차단되는지). 입력이 같으면 결과도 같아야 한다.
- 캐시(티켓 tree OID 메모이제이션). 배치만으로 목표치를 넘으므로 지금 만들지 않는다(YAGNI).
- 종결 티켓 스캔 생략 등 **범위 축소**. 종결 여부 자체가 스캔 결과라, 생략하려면 별도 인덱스를
  믿어야 하고 그 인덱스가 곧 게이트 우회로가 된다.
- `bin/report.ts`·`bin/verify-range.ts`·`bin/integrate.ts` 가 쓰는 기존 `readBlobsAtRef` 호출부 수정.
  (측정 결과 그쪽도 개선 여지가 있으나 **범위 밖** — 아래 설계의 관측 기록만 남긴다.)
- `workflow/` 티켓 아카이빙·삭제 명령.
