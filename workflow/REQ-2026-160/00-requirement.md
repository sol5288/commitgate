# REQ-2026-160 요구 — 위임 scope 미판정의 대화형 수동 통합 경로 정합

외부 리뷰 P2. **코드로 재현 확인했다.**

## 지금

| 위치 | 지금 |
|---|---|
| `bin/integrate.ts:354~362` | `scope === null` → `{ kind: 'denied', lines: [... '사람 확인으로 통합하세요.'] }` |
| `bin/integrate.ts:850~855` | `if (gate.kind === 'denied') { ... return { exit: 1 } }` — **대화형 여부를 보지 않는다** |

재현:

```
1. auto 스냅샷 티켓의 브랜치가 `feat/req-renamed` — branchPrefix 는 만족하지만 REQ 번호 형식 아님
2. 커밋 귀속으로는 auto 티켓을 정상적으로 찾는다 → 정책 = "사전 위임 필요" (정확)
3. delegationGate 가 scope 미판정을 이유로 `denied`
4. runIntegrate 가 **대화형이어도** 즉시 exit 1
```

그런데 그 `denied` 의 문구는 **"사람 확인으로 통합하세요"** 라고 말한다.

## 왜 P2 인가

보안 우회가 **아니다** — 비대화형은 계속 차단되고, 그 방향은 안전하다.
막힌 뒤의 **안내가 실행 불가능**한 것이 문제다.

🔴 REQ-2026-159 phase-1 r02 에서 **정책 판정 불가**에는 대화형 fallback 을 배선했다.
   **바로 옆의 같은 결함**(위임 scope 미판정)을 남겨 뒀다 — 이 저장소가 반복하는
   **"관측된 것만 고치고 그 부류 전체를 훑지 않는다"** 패턴이다.

## 절대 열면 안 되는 것

`scope 미판정` **하나만** 대화형 확인으로 열린다. 아래는 대화형에서도 계속 차단이다:

```
delegation absent · trunk moved · source mismatch · scope out of range
HIGH 위임 누락 · hardCap · BLOCKED/미판정 리뷰 · 증거 불일치
위임 만료 · 철회 · 이미 소비됨
```

🔴 새 분기가 이 사유들까지 열어 주면 **그것이 곧 보안 결함**이다. 회귀의 핵심 오라클이 여기다.

## 범위 밖

- 정책 해소 규칙(REQ-2026-159 DEC-2·DEC-9) — 건드리지 않는다.
- `hardCap`·HIGH·BLOCKED 정지 — 건드리지 않는다.
