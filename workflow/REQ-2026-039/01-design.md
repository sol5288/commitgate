# REQ-2026-039 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

- `templates/CLAUDE.template.md` — 신규 CLAUDE.md 생성 원본(seed-once). 현 CommitGate 안내는
  "AGENTS.md 읽어라" 이정표(16줄).
- `AGENTS.template.md` — 신규 AGENTS.md 생성 원본이자 계약 정본(seed-once). 첫 줄
  `<!-- commitgate:contract -->` 마커 유지 필수.
- 두 파일 모두 `package.json:files`에 포함돼 패키지 payload로 배포됨.
- init은 두 파일을 **부재 시에만** 생성(--force로도 안 덮음, init.ts:1216·1218). → 템플릿 수정은
  **앞으로의 신규 설치**에만 반영(기존 설치본·기존 파일 무영향).

## 핵심 설계 결정

### D1. Quick Start를 두 템플릿 앞부분에 **동일 블록**으로 삽입
마커 `<!-- commitgate:quickstart -->` … `<!-- /commitgate:quickstart -->`로 감싼다. 마커는
(a) 일치 테스트의 추출 앵커, (b) REQ-040의 주입 앵커로 재사용된다. AGENTS.md는 Codex·Cursor에서
유일하게 항상 읽히는 채널이므로 크로스-하네스를 위해 여기에도 둔다.

### D2. 블록 = 조작 절차만, 계약 위치 안내는 **블록 밖**
"계약 정본이 어디냐"는 파일마다 다르다(CLAUDE.md→AGENTS.md 포인터, AGENTS.md→자기 자신). 그래서
마커 **안**에는 harness-무관 조작 절차만 담아 바이트 동일을 유지하고, 계약 위치 문장은 마커
**밖**에 파일별로 둔다.
- CLAUDE.template: 블록 뒤 "세부 규칙·통제점·승인 문장은 루트 `AGENTS.md`에 있다."
- AGENTS.template: 블록 뒤 "아래 본문이 정본 계약(절대 규칙·통제점·승인 문장)이다." + 기존 본문.

### D3. Quick Start 본문 (최종안 — 마커 사이 바이트 동일)

```
<!-- commitgate:quickstart -->
## CommitGate — 빠른 시작 (첫 요청에서 이대로)

이 저장소의 코드/문서 변경은 CommitGate REQ 워크플로로만 처리한다. 일반 구현으로 바로 커밋하지 않는다.

1. 요청이 [무엇 / 왜 / 제약 / 완료 기준]으로 정리되지 않았으면 **먼저 사용자에게 확인**한다. 추측해서 채우지 않는다.
2. `package.json`의 `req:new` 스크립트와 `req.config.json`의 `packageManager`를 확인해, 이 저장소의
   패키지매니저 실행 형식으로 `req:new <슬러그>`를 실행해 REQ 티켓·브랜치를 만든다. 형식을 추측하지 않는다.
3. 그다음부터 매 단계는 `req:next <REQ-id>`의 출력만 따른다. `kind`가 정본이다:
   - `RUN`         → 출력된 명령을 그대로 실행하고 다시 `req:next`
   - `AGENT`       → 구현·검증·명시적 `git add` 후 다시 `req:next`
   - `AWAIT_HUMAN` → **멈춘다.** 출력된 승인 문장을 그대로 받기 전에는 진행하지 않는다
   - `DONE`        → 이 티켓 종료. 통합·릴리즈는 별도 통제점
   - `BLOCKED`     → 사람에게 보고. **같은 리뷰를 재시도하지 않는다**
4. 리뷰가 `NEEDS_FIX`면 지적(findings)을 고친 뒤 다시 `req:next`로 돌아간다.
5. `state.json`·`responses/`는 직접 `git add` 하지 않는다 — 도구가 관리한다.
6. 커밋은 `req:next`가 `RUN`으로 지시할 때 `req:commit`으로만 한다. 스스로 `req:commit`을 호출하지 않는다.
   직접 `git commit`은 CommitGate 자체 스캐폴딩 산출물(`init`·`migrate`·`sync`가 쓴 파일)을 커밋할 때만 쓴다.
<!-- /commitgate:quickstart -->
```

반영된 리뷰 지적:
- **P1(리터럴 명령 금지 + 첫 명령 순환참조 제거)**: 2행은 `package.json`/`req.config.json`에서 실행
  형식을 파생한다(첫 `req:new` 시점엔 참조할 도구 출력이 아직 없어 "출력 복사"는 순환). 3행부터는
  `req:next` 출력을 그대로 실행.
- **P2(req:commit 오호출 방지)**: 6행 "`req:next`가 `RUN`으로 지시할 때만, 스스로 호출 금지".
- **P3(git commit 예외 협소화)**: 6행 = init·migrate·sync 산출물 커밋만(코드 검증됨).
- **보강**: 5 kind 전부 + `NEEDS_FIX`(4행)·`BLOCKED`(3행) 처리.

### D4. 일치·존재·보존경계 테스트
`tests/unit/`에 추가:
- (a) 두 템플릿에서 quickstart 마커 블록을 추출해 **바이트 동일** assert.
- (b) 신규 설치 결과물(init을 임시 대상에 적용)의 CLAUDE.md·AGENTS.md가 quickstart 마커 블록을
  **포함**함을 assert.
- (c) 기존 CLAUDE.md·AGENTS.md가 있으면 init이 **보존**(주입 안 함)함을 assert — REQ-040 경계
  규정. (기존 seed-once 테스트가 커버하면 재사용·확장.)

### D5. CHANGELOG
`CHANGELOG.md` Unreleased에 항목 추가(package-payload 테스트가 companion을 Unreleased에서 찾음 —
REQ-036/037 이력). 릴리스는 별도.

## Phase별 구현

단일 phase(작은 변경, Test-First). 상세는 02-plan.

## 변경 파일

- `templates/CLAUDE.template.md` (수정 — 블록 삽입)
- `AGENTS.template.md` (수정 — 블록 삽입, 첫 줄 마커 보존)
- `tests/unit/…` (신규 또는 기존 확장 — D4)
- `CHANGELOG.md` (Unreleased)

## 하위호환·안전

- **기존 설치본·기존 파일 무영향**: seed-once라 템플릿 변경은 신규 설치에만 반영.
- 마커는 HTML 주석 — 렌더링·파싱 무해.
- payload 크기 소폭 증가(문서만). 실행 코드·의존성 변경 없음.
- 리스크 등급 HIGH로 열었으나 실변경은 docs+test뿐 — 매 phase 사람 확인은 보수적 백스톱
  (init.ts는 이 REQ에서 변경하지 않음 → 그 변경은 REQ-040).
