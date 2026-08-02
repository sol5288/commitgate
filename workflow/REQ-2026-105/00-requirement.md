# REQ-2026-105 요구사항

CLI 경계(runCli/isMain) 중복 통합

## 배경

2026-08-02 자체 감사 A트랙 3번째(개선 A3의 일부). 감사가 "가장 큰 중복"으로 지목한 CLI 부트스트랩을 직접 재측정했다.

| 측정 | 결과 |
|---|---|
| `runCli`를 정의하는 파일 | **18개** (첫 측정에서 17개로 셌으나 `bin/setup.ts`가 `export **async** function runCli`이라 `export function runCli` grep에서 빠졌다 — 정정) |
| 그중 본문이 **바이트 동일** | **11개**(`bin/init.ts` + `scripts/req/*.ts` 10개) — 정규화 해시 `dac5633d` 일치 |
| 접두어만 다른 동형 | **4개**(`quickstart`·`uninstall`·`sync`·`migrate`) — `commitgate <verb>: ` 접두어 + `runX(parseArgs(argv))` 호출 |
| 본문이 실제로 다른 것 | **3개**(`check.ts`·`delivery.ts`·`setup.ts`) — 셋 다 help 신호를 **오류가 아닌 제어 흐름**으로 처리한다(앞 둘은 `HelpRequested` catch, `setup.ts`는 help를 exit 0). `setup.ts`는 게다가 **async**이고 `deps?` 파라미터를 받는다 |
| `isMain` 선언 | **18곳**. 16곳 `pathToFileURL(process.argv[1] ?? '')`, **2곳**(`req-confirm.ts:169`·`req-rebind.ts:291`) `process.argv[1] !== undefined && …` |

## 요구

1. **CLI 경계 헬퍼를 하나 만든다.** 예외를 "접두어 + 한 줄 메시지 + `exitCode=1`"로 바꾸는 경계를 한 곳에 둔다. 스택트레이스 비노출이라는 계약이 17곳에 흩어져 있으면 한 곳만 어긋나도 사용자에게 raw stack이 샌다.

2. **`isMain` 판정 18곳 전부를 한 표현식으로 통일한다.** 두 변형은 `process.argv[1]`이 없을 때 평가 경로가 갈린다 — 한쪽은 `pathToFileURL('')`을 평가하고 다른 쪽은 단락한다. 어느 쪽이 옳은지를 한 곳에서 정한다.
   🔴 **`runCli` 통합과 `isMain` 통합은 별개 관심사다.** 자기 `runCli`를 유지하는 파일도 `isEntrypoint`는 쓸 수 있다 — 요구 3의 예외가 요구 2의 예외로 번지지 않게 한다(설계 r01 P1이 지적한 지점).

3. **본문이 실제로 다른 3곳(`check.ts`·`delivery.ts`·`setup.ts`)은 `runCli`를 통합하지 않는다.** 셋 다 help를 "오류가 아닌 제어 흐름"으로 처리하고, `setup.ts`는 async + `deps?` 주입 seam까지 갖는다. 흡수하려면 헬퍼가 예외 클래스와 핸들러를 파라미터로 받아야 하는데, 그러면 "예외 → 한 줄 + exit 1"이라는 경계의 계약이 약해진다. 대신 **왜 공유하지 않는지 주석을 남겨** 다음 사람이 누락으로 오해하지 않게 한다.

## 비요구(명시적 범위 밖)

감사는 A3에 네 항목을 넣었으나 **가치/표면 비율을 재보고 두 개를 뺀다.**

- **git 어댑터 싱글턴 패턴 7벌 통합(-45줄)**: 각 파일이 `let gitAdapter` + `main()`에서 재할당하는 형태다. 헬퍼로 묶으려면 모듈 전역을 다루는 간접층이 생기는데, 이는 REQ-2026-103이 방금 `gitAdapter` 복원 누락으로 데인 지점이다. **간접층이 늘면 그런 결함이 더 안 보인다.** 별도 판단.
- **`sha256`·POSIX 경로 정규화 유틸 통합(-45줄)**: 한 줄 표현식(`replace(/\/g,'/')`)을 import로 바꾸는 것이 20여 곳에서 더 낫다고 단정하기 어렵다. 읽는 사람 입장에서 한 줄 표현식이 더 직접적인 경우가 많다. **줄 수 감소가 곧 개선은 아니다.**
- **JSONL 원장 3형제 제네릭화(-120줄)**: 가치가 있으나 **소비자에 이미 커밋된 원장이 바이트 계약**이라 리팩터 전에 직렬화 골든 테스트를 고정해야 한다. 성격이 달라 별도 REQ로 분리한다.

## 완료 기준

- `npm test` 그린(특히 `tests/unit/dispatch.test.ts`의 "모든 VERB_MODULES 대상이 runCli를 export한다").
- 소비자 관측 변화 0: 오류 메시지 문자열·exit code·verb 표면이 전부 불변.
