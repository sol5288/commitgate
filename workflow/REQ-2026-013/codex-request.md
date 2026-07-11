# REQ-2026-013 리뷰 요청 (R5 — design R1·R2·R3·R4 반영)

## 배경

다운스트림 2차 요청서로 착수. 리뷰 codex 호출이 전역 `ultra`를 상속해 11~13분·토큰 과다·수렴 안 됨·무응답/exit=1 실패. 원인 P1~P4를 현재 코드에서 대조·실측 확정. design R1(10)·R2(3)·R3(3)·R4(4)를 반영했다.

## design R4 지적 → 반영 (closure)

| R4 지적 | 반영 |
|---|---|
| enum이 `minimal` 허용·`none`/`max` 거부 → 잘못 | **반박**: 공식 config-reference(WebFetch 확인)가 `minimal\|low\|medium\|high\|xhigh`로 명시(`xhigh` model-dependent). R4의 `none\|max`는 문서 불일치 → enum 유지, D4에 검증 근거 명기 |
| D8 스냅샷 N·byte 상한 미확정 → 대량 재주입 위험 | **경계 확정**: 최대 10건·각 detail ≤300B·총 ≤4KiB·초과 생략 표식(코드 상수·회귀 판정)(D8) |
| state write가 실제로 원자적 아님(writeFileSync 직접 덮어씀) | **원자성 범위 정밀화**: "같은 `writeState` 호출로 selector·body 동시 기록(desync 제거)"으로 축소. state.json crash-durability(temp+rename)는 기존 공통 이슈 → 별도 REQ(D8) |
| stderr가 allowlist/검증 없이 8KiB 포함 → 유출 | stderr **best-effort redaction(비밀 패턴 마스킹) + ≤4KiB**, best-effort 한계 명시(D6) |

## design R3 지적 → 반영 (closure)

| R3 지적 | 반영 |
|---|---|
| D6 allowlist를 범용 `safeSpawnSync`에 넣어 비-codex 명령(npm/pnpm) stdout도 파싱→유출 | 추출을 **codex 경계 `defaultCodexRunner`로 한정**. `safeSpawnSync`는 stdout 파싱 안 함(원시 필드 담아 throw, 범용 메시지=exit+bounded stderr). stderr도 byte-bounded로 "allowlist만" 충돌 해소(D5·D6) |
| D8이 selector(state.last_review)와 body(가변 codex-response.json) 동일성 미보장 → 미검증 내용 주입 | 검증된 findings **bounded 스냅샷을 `state.last_review`에 원자적 기록**, 재리뷰는 그 스냅샷만 읽음(가변 파일 안 읽음). 부재 시 fail-closed(D8) |
| D6 8KiB가 필드별 → 수천 이벤트로 총량 수십 MiB | **총량 상한**: 최대 N 이벤트 + 총 UTF-8 byte ≤ 8KiB, 초과 시 단일 생략 표식(D6) |
| obs: finding 스키마는 title/summary 아님(severity/file/detail) | 스냅샷 필드를 `{severity, file, detail}`로(D8) |
| obs: Phase 3 >8파일 | vertical slice 분할 예고(3a reviewModel / 3b effort) |

## design R2 지적 → 반영 (closure)

| R2 지적 | 반영 |
|---|---|
| reviewReasoningEffort null 탈출구가 `type:['string','null']`+enum으로 성립 안 함(null이 enum 탈락) | **null을 enum 목록에 포함**: `{type:['string','null'], enum:[...5, null]}`. 회귀: `{effort:null}` 통과·`{effort:'higth'}` 거부(D1·D4) |
| D6 fallback의 '비-비밀 라인'이 미정의 → 미지 이벤트 유출 | **blacklist→allowlist**: 허용 이벤트·허용 문자열 필드만, 미지/중첩/파싱실패 폐기. 허용 없으면 **raw stdout 미포함**(exit+stderr+생략 표식)(D6) |
| D8 findings 선택에 승인 경계 없음 → 승인된 결함 재주입 | **`state.last_review` 기반**: `outcome==='needs-fix'`+타깃 일치일 때만 직전 응답 findings 주입, 승인 후 리셋(D8) |

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
