# REQ-2026-112 리뷰 요청 — phase-2

## 배경

REQ-2026-071이 위험도에 따른 별도 백스톱을 걷어내고 정지 지점을 `stopGate` 하나로 모았는데,
그 정정이 `README`+`docs/`에만 적용돼 여섯 곳에 옛 주장이 남아 있었다.
**phase-1**이 그 여섯 곳을 정정하고 가드를 배포 지침·코드 표면까지 넓혔다(커밋 `4816703`).

**그러나 이미 설치된 소비자는 자동으로 못 고친다** — `init`은 `AGENTS.md`가 **없을 때만** 복사하고
(`bin/init.ts`), `sync`는 persona·스키마·gitignore 축만 다루며, D21은 quickstart 블록만 본다.
사용자 결정(방안 b)에 따라 **파일을 고치지 않고 진단으로 알린다.**

## 변경 요약 (phase-2, 6파일)

| 파일 | 변경 |
|---|---|
| `scripts/req/lib/retired-claims.ts` (신규) | `RETIRED_CLAIMS`(13항목) + **매칭 정본 `retiredClaimsIn`** |
| `tests/unit/docs-stale-claims.test.ts` | 사본 배열 제거 → 정본 재수출 |
| `scripts/req/req-doctor.ts` | `D29` 등록·`DoctorInputs.retiredClaimHits`·검사·`main()` 배선·매칭 함수 재수출 |
| `docs/ssot-design/07…md` | §3 정본 표에 D29 행 |
| `tests/unit/doctor-retired-claims.test.ts` (신규) | AC-5·AC-6·AC-7a·AC-7b |
| `CHANGELOG.md` | Unreleased 보강 |

## 설계 리뷰가 요구한 **정본 결속 3중 방어**가 어떻게 구현됐는가

r01·r02 P1이 연속으로 지적한 지점이다. 구현은 설계 DEC-4 그대로다.

**① 구조 — 배열을 import하지 않는다**

```ts
// req-doctor.ts
import { retiredClaimsIn, type RetiredClaim } from './lib/retired-claims'
export { retiredClaimsIn } from './lib/retired-claims'   // 결속 seam
```

`RETIRED_CLAIMS`를 가져오지 않으므로 **사본을 둘 자리가 없다.**

**② 참조(AC-7a)** — 재수출된 함수가 정본과 `toBe` 같은 객체인가.
**변이 검사**: 재수출을 사설 사본 구현으로 바꾸니 이 테스트만 실패했다 — r02가 지적한 시나리오 그대로다.

**③ 행동(AC-7b)** — 정본 **전 항목**이 `main()`을 통해 발화하는가.
**변이 검사**: `main()`의 계산을 제거하니 AC-5·AC-7b가 실패했다.

## 리뷰 포인트

1. **D29를 WARN으로 둔 것**이 맞는지. FAIL이면 업그레이드 즉시 기설치 소비자의 커밋이
   **서술 문제로** 막힌다. 반대로 WARN은 무시될 수 있다.
2. **`runChecks` 순수성 유지** — 파일 읽기는 `main()`이 하고 결과만 주입한다(D19·D20·D21과 같은 형태).
   읽기 실패·파일 부재는 `undefined` → OK(점검 불요)로 처리했다. 진단이 사람을 막지 않는다는 원칙과 맞는지.
3. **사유 재작성 금지** — 메시지가 정본의 `why`를 그대로 쓴다(D28과 같은 원칙).
   두 표면이 다른 말을 하면 사람이 판단해야 하기 때문이다.
4. **대상 파일 선정** — `AGENTS.md`와 `AGENTS.commitgate.md` 둘만 본다(`CONTRACT_FILE_RELS`).
   `init`이 만드는 두 형태인데, 빠진 계약 표면이 있는지.
5. **오탐 수용** — 소비자가 "예전엔 이랬다"로 인용하면 WARN이 뜬다. WARN이라 진행은 막지 않는다는
   전제로 감수했는데 이 절충이 맞는지.
6. **`RETIRED_CLAIMS`를 배포 페이로드에 넣는 것**(문자열 ~2KB). 목록이 테스트에만 있으면
   소비자 진단이 볼 수 없다는 것이 근거다.
