# REQ-2026-061 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

| 축 | 현재 | 근거 |
|---|---|---|
| verb 표면 | `init`/`quickstart`/`sync`/`migrate`/`setup`/`uninstall` + `req:*` 8종 | `bin/dispatch.mjs`(SSOT) |
| 진단 | `req:doctor <REQ>` — **활성 티켓 전제** | `scripts/req/req-doctor.ts` |
| probe | `createReviewerProbes()`(version/auth/login) — **REQ-060에서 신설** | `scripts/req/lib/adapters.ts` |
| 설정 검증 | `loadConfig()`가 파싱 + AJV + confinement, 실패 시 throw | `scripts/req/lib/config.ts:234~` |
| 설치 모드 판정 | `req:doctor` D19가 `package.json`의 `req:*` 형태로 Stage A/B 구분 | `req-doctor.ts:429~` |

**핵심 갭**: 티켓이 없는 시점(설치 직후·CI·에이전트 사전 점검)에 쓸 수 있는 진단이 **없다**.

## 핵심 설계 결정

### DEC-1 — `check`는 **비대화형**이고 `setup`의 거울상이다
`setup`(대화형 전용·사람만)과 `check`(비대화형·에이전트 허용)로 **역할을 완전히 가른다**.
그래서 "setup은 대화형 전용"이라는 규칙에 예외가 생기지 않는다(REQ-2026-060 §4.1의 근거 그대로).

- `check`는 **질문하지 않고 아무것도 고치지 않는다.** TTY 여부를 신경 쓰지 않는다.
- 로그인이 필요하면 **`commitgate setup`을 안내**할 뿐 실행하지 않는다.

### DEC-2 — 판정은 순수 함수, IO는 주입
`runChecks(inputs) → CheckReport`를 **순수**로 두고, config 읽기·probe 호출은 호출부가 수집해 넘긴다.
`req:doctor`의 `checks(inp)` 구조와 같은 관례다(테스트가 live codex 없이 전 분기를 돈다).

### DEC-3 — 항목·등급 체계
`req:doctor`의 `OK/WARN/FAIL`을 그대로 쓴다(사용자가 이미 아는 어휘).

| id | 항목 | FAIL 조건 | WARN 조건 |
|---|---|---|---|
| `C1` | `req.config.json` 파싱·스키마 | 파싱 실패 또는 스키마 위반 | — |
| `C2` | 리뷰어 CLI 설치 | `versionProbe.ok === false` | — |
| `C3` | 리뷰어 로그인 | `logged-out` | **`unknown`** |
| `C4` | 리뷰 모델·추론강도 핀 | — | 둘 중 하나라도 `null`(전역 상속 — 리뷰 비용·재현성 미고정) |

🔴 **`C3`의 `unknown`은 WARN이지 FAIL이 아니다**(수용기준 5). 이유는 REQ-2026-060에서 확정한 것과 같다:
auth probe는 **승인 무결성 게이트가 아니라 진단**이고, codex가 출력 문자열을 바꾸면 `unknown`이 대량 발생한다.
FAIL로 두면 진단이 곧 오탐 경보가 된다. 실제 미인증이면 리뷰 호출이 스스로 fail-closed한다.

### DEC-4 — exit code
`FAIL ≥ 1` → **exit 1**. 그 외(OK/WARN만) → **exit 0**.

🔴 **이 exit code는 어떤 게이트도 참조하지 않는다.** `check`는 어디서도 spawn되지 않으므로
(≠ `req:commit` → `req:doctor`), non-zero가 기존 워크플로를 막지 않는다. D19~D23을 WARN 상한으로 묶은
제약이 여기엔 적용되지 않는 이유다.

### DEC-5 — `--json`은 **평평하고 안정적인** 형태
```jsonc
{
  "ok": false,                    // FAIL 0건인가
  "checks": [ { "id": "C1", "level": "OK|WARN|FAIL", "msg": "…" } ],
  "summary": { "ok": 2, "warn": 1, "fail": 1 }
}
```
- 사람용 렌더링과 **같은 `CheckReport`에서 파생**한다(두 출력이 갈라지지 않는다).
- `--json`일 때 **사람용 줄을 섞지 않는다** — 파이프로 받는 소비자가 파싱에 실패한다.

### DEC-6 — config 로드 실패를 **진단으로 흡수**한다
`loadConfig()`는 실패 시 **throw**한다. 그대로 두면 "설정이 깨졌다"는 가장 흔한 진단 대상이
스택트레이스로 죽어 버려 `check`가 무용해진다. 따라서 `check`는 `loadConfig`를 **try/catch로 감싸
`C1` FAIL로 변환**한다. 다른 항목(C2~C4)은 계속 평가한다 — 한 항목의 실패가 나머지 진단을 가리지 않는다.

*(C1이 FAIL이면 C4는 값을 알 수 없으므로 `WARN`이 아니라 "판정 불가"로 스킵 표기한다.)*

### DEC-7 — root 해소는 `--dir`(기본 cwd)
`resolveRoot`의 cwd 상향탐색·package-root fallback에 기대지 않는다 — 그 fallback은 설정이 없을 때
**패키지 자신**을 root로 보므로, 소비자 repo에서 실행하면 엉뚱한 곳을 진단할 수 있다(`config.ts:203-210`).
`check`는 `--dir`(기본 `process.cwd()`)를 **명시적 root**로 쓰고, 그 아래 `req.config.json`만 본다.

### DEC-8 — verb 등록은 `package.json`을 늘리지 않는다
`STAGE_B_REQ_VERBS`가 `req:` 접두만 필터하므로(`init.ts:189-191`) `check` 등록은 대상 repo의
`package.json`에 아무것도 주입하지 않는다. `files:["bin"]`이 이미 있어 tarball 적재도 자동이다.

## Phase별 구현

| phase | 내용 | 코드 파일 |
|---|---|---|
| **phase-1** | `bin/check.ts`(순수 판정 + 렌더링 + CLI) · dispatch 등록 · 테스트 | 4 |
| **phase-2** | 문서(한/영)·CHANGELOG | 0(docs) |

## 변경 파일

- `bin/check.ts` **(신규)**
- `bin/dispatch.mjs` — `check` verb 등록
- `tests/unit/check.test.ts` **(신규)**
- `tests/unit/dispatch.test.ts`
- `docs/troubleshooting{,.en}.md` · `docs/quick-start{,.en}.md` · `CHANGELOG.md`

## 하위호환·안전

- **기존 동작 무변경.** 신규 verb 추가일 뿐 게이트·doctor·req:* 를 건드리지 않는다.
- **읽기 전용**이다. 파일을 쓰지 않고 프로세스를 바꾸지 않는다(probe의 `codex --version`·
  `codex login status`만 실행 — 둘 다 부작용 없는 조회).
- `authProbe`가 `unknown`이어도 **아무것도 막지 않는다**(WARN).
- `check` 실행은 워킹트리를 더럽히지 않는다 — `req:new`의 clean-tree 요구와 충돌하지 않는다.
