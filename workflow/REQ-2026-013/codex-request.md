# REQ-2026-013 리뷰 요청 (R2 — design R1 반영)

## 배경

다운스트림 2차 요청서로 착수. 리뷰 codex 호출이 전역 `ultra`를 상속해 11~13분·토큰 과다·수렴 안 됨·무응답/exit=1 실패. 원인 P1~P4를 현재 코드에서 대조·실측 확정. design R1(NEEDS_FIX 10건)을 아래처럼 반영했다.

## design R1 지적 → 반영 (closure)

| R1 지적 | 반영 |
|---|---|
| P1 timeout이 SIGTERM hard-kill 아님 | **killSignal 내부 고정 SIGKILL**(무시 불가, 실측) + SIGTERM-무시 자식 회귀 테스트. 완전 tree-kill(detached 손자)은 **후속 REQ**로 정직 분리(D5 잔여) |
| P2 `\|\| res.signal` timeout 오판(ENOBUFS) | timeout 판별 **`err.code==='ETIMEDOUT'`만**, ENOBUFS 별도 오류(실측 확인) |
| P2 D6 raw 덤프 비밀 유출 | 구조화 오류 이벤트(`turn.failed`/`error`)만 추출, `command_execution`/`aggregated_output` 제외, byte(Buffer.byteLength) 이중 상한 fallback |
| P2 stateless 연속성 근거 오류(status 한 단어) | 직전 same-target NEEDS_FIX **findings를 bounded 주입**(D8), `readPreviousResult` 대체 |
| P2 resume가 리뷰 대상 미바인딩(#5) | **resume opt-in을 이번 범위에서 제외** → stateless 전용. target-binding opt-in은 후속 REQ(#5·#6 원천 제거) |
| P3 모순 검사 위치(dry-run 우회, #6) | opt-in 제거로 `--resume-thread` 자체가 없어 해당 없음 |
| P2 Phase bootstrap(tsx가 워킹트리) | **Phase 재정렬 timeout→stdout→model-pin→stateless**, model-pin 자기 리뷰=exec 검증, 첫 slice는 사람 감시 회복 |
| P2 사용자 문서 누락 | `req.config.json.sample`·README(KR/EN)·CHANGELOG 변경 범위 포함(D10) |
| P3 `eslint0` exit인데 ESLint 없음 | exit 기준을 `typecheck·vitest·smoke`로 |
| obs: 8KiB byte 기준 | Buffer.byteLength 기준 절단 |
| obs: cfgStub 갱신 | `req-commit.test.ts` cfgStub 변경 파일에 포함 |
| obs: `--ignore-user-config` | 후속 후보로 비목표에 기록 |

## 변경 요약 (config 키 3)

- **P2 timeout**(Phase 1): `reviewTimeoutMs`(600s), SIGKILL, ETIMEDOUT 판별.
- **P3 stdout**(Phase 2): 구조화 오류 추출·비밀 제외·byte 상한. retry 제외.
- **P1 model-pin**(Phase 3): `reviewModel`(slug, gpt-5.6-terra)·`reviewReasoningEffort`(enum, high), exec·resume `-c` 주입, null 탈출구.
- **P4 stateless**(Phase 4): `isResume=false`, `--fresh-thread` 보존, bounded findings 주입.

## 리뷰 포인트

1. **timeout 잔여의 수용성(D5)**: SIGKILL이 직접 codex를 보장하고 detached-손자-파이프를 후속으로 분리한 것이 "무한 대기 금지" 수용기준을 이 REQ 범위에서 충족하는가? codex exec가 파이프-홀딩 손자를 detach하지 않는다는 전제의 위험.
2. **D6 이벤트 계약 의존**: `turn.failed`/`error`/`stream_error` 추출 + 비밀 이벤트 제외가 codex JSONL 계약과 맞는가? 미스매치 시 fallback(byte 상한 비-비밀 tail)이 안전 저하로 충분한가?
3. **stateless 연속성(D8)**: bounded findings 주입이 finding closure를 충분히 전달하면서 goalpost drift(누적)를 피하는가? 주입 크기·선택(직전 NEEDS_FIX만)이 타당한가?
4. **Phase 순서/부트스트랩(D9)**: timeout→stdout→model-pin이 자기-리뷰 함정을 실제로 해소하는가? 첫 slice(timeout)의 자기 리뷰가 timeout 코드 자체를 타는 잔여 위험 — 사람 감시 회복이 충분한가?
5. **null 병합·주입 안전(D1·D2-1)**: `!== undefined` 병합 + 패턴/enum 입력단 차단으로 TOML 주입을 막는 것이 견고한가?
6. **범위 규율**: resume opt-in·완전 tree-kill·retry·P5~P7을 후속으로 분리한 경계가 타당한가?

## 확정된 방향 (사용자 검토)

Fork1=A(SIGKILL+잔여 후속) · Fork2=A(stateless 전용, opt-in 후속) · Fork3=A(bounded findings 주입). D3 코어 기본 gpt-5.6-terra 유지 · D4 공식 enum.
