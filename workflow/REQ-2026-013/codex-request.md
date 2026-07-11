# REQ-2026-013 리뷰 요청

## 배경

다운스트림 2차 요청서로 착수. 리뷰 codex 호출이 사용자 전역 `~/.codex/config.toml`(`model_reasoning_effort="ultra"`)을 상속해 리뷰 1회 11~13분·토큰 과다·수렴 안 됨·exit=1 통째 실패. 원인 P1~P4를 현재 코드(main=`2ca2934`)에서 파일:라인으로 대조·확정했다. 이번 REQ는 리뷰어 호출을 도구가 명시 통제한다.

## 변경 요약

- **P1**: config `reviewModel`(slug 패턴, 기본 `gpt-5.6-terra`)·`reviewReasoningEffort`(enum `minimal|low|medium|high|xhigh`, 기본 `high`) 신설, codex 인자 exec·resume 양쪽에 `-c model=`·`-c model_reasoning_effort=` 주입. 두 키 `null`=전역 상속 탈출구(`!== undefined` 병합으로 보존).
- **P2**: config `reviewTimeoutMs`(기본 600s), `safeSpawnSync`에 timeout+killSignal, 초과 시 fail-closed.
- **P3**: 실패 오류에 stdout 꼬리(20줄+8KiB 이중 상한) 포함해 빈-오류 제거. **retry는 이번 범위 제외**(후속 REQ).
- **P4**: 재리뷰 기본 stateless(`reviewResume` 기본 false), `--resume-thread` opt-in, `--fresh-thread` 회복 의미 보존, 둘 동시 지정은 fail-closed.

## 리뷰 포인트

1. **`-c` 주입 정확성(D2·D2-1)**: exec·resume 양쪽에서 `-c model="…"`·`-c model_reasoning_effort="…"`가 codex에 존중되는가? resume는 `--sandbox`를 거부하지만 `-c sandbox_mode`는 받는 것이 실측인데, `-c model`도 동일하다고 가정했다 — 이 가정의 위험과 phase-1 live 확인 방법.
2. **주입 안전이 스키마 제약에 의존(D2-1)**: `reviewModel` slug 패턴 + `reviewReasoningEffort` enum이 `"`·개행을 막으므로 조립부 escaping을 생략했다. 이 의존이 견고한가, 아니면 조립부에서도 방어(escape/재검증)해야 하는가?
3. **timeout 판별(D5)**: `spawnSync` timeout이 `res.error`(ETIMEDOUT)로 오는가 `res.signal`로 오는가 — 양쪽 검사가 충분한가? cross-spawn이 이를 그대로 전달하는가? 기본 600s는 타당한가(정상 리뷰 11~13분 실측 대비)?
4. **stdout 이중 상한(D6)**: 20줄+8KiB가 진단에 충분하면서 안전한가? codex 오류가 stdout JSONL의 어느 위치에 오는지(마지막 줄 보장?) — 꼬리 절단이 오류 사유를 놓칠 위험.
5. **resume 기본 뒤집기의 안전(D8)**: 기본 stateless가 `previous_codex_result`(프롬프트)만으로 연속성을 충분히 전달하는가? `--resume-thread`+`--fresh-thread` 모순을 fail-closed로 throw하는 것과, config `reviewResume:true` + `--fresh-thread`(비-모순)의 경계가 명확한가?
6. **null 병합 보존(D1)**: nullable 두 키를 `!== undefined`로 병합해 명시적 `null`이 기본값으로 복귀하지 않게 했다(`??` 금지). 이 구분이 `handoffPath`·`reviewPersonaPath`와 일관되는가?
7. **config 두 축 동기화(D1)**: `CONFIG_SCHEMA`와 `workflow/req.config.schema.json` 둘 다 갱신 + `req-config.test.ts` 가드로 드리프트를 막는 계획이 맞는가?
8. **범위 규율**: retry·P5(컨텍스트 스코핑)·P6(phase durability)·P7을 비목표로 분리한 것이 타당한가? 특히 retry 제외로 인해 이번 REQ만으로 안정성이 충분히 개선되는가(D6 표면화 + D5 timeout으로).
9. **D3 코어 기본값**: `reviewModel="gpt-5.6-terra"`를 `DEFAULTS` 중립성 예외로 두는 근거가 충분한가? (사용자 확정 방향 — 다운스트림 override/`null` 탈출구 유지.)

## 확정된 방향 (사용자 검토 반영)

- D3 코어 기본 `gpt-5.6-terra` 유지 · D4 문자열→**공식 enum** · D7 retry **제외**(후속) · timeout 기본 **600s** · reviewModel **slug 패턴** · stdout **20줄+8KiB** · resume 모순 **fail-closed** · null **`!== undefined` 보존**.
