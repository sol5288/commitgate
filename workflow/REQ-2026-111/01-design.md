# REQ-2026-111 설계

> 정본 결정은 SSOT(해당 DEC). 본 문서는 그 결정을 현재 코드/구조에 어떻게 반영할지 기록.

## 현재 상태(변경 대상)

| 사실 | 위치 | 확인 |
|---|---|---|
| D-체크 등록부 22개 | `scripts/req/req-doctor.ts:80` `D_CHECK_IDS` | 읽음 |
| `runChecks(inp)`는 **순수** — `Check[]`(`{id, level, msg}`)를 반환 | `req-doctor.ts:442` | 읽음 |
| `main()`이 `checks`를 출력하고 FAIL 개수로 exit | `req-doctor.ts:1333~1337` | 읽음 |
| `req-doctor.ts`에 파일 쓰기 코드 **0건** | `grep writeFileSync\|appendFileSync` → 0 | 실측 |
| 관측 로그 선례: 상수 + try/catch 삼킴 | `review-codex.ts:633` `REVIEW_CALL_LOG_REL`, `:763~769` | 읽음 |
| D22가 repo-root 스크래치 gitignore 여부를 WARN | `req-doctor.ts:1319` `unprotectedRepoRootScratch([REVIEW_CALL_LOG_REL], git)` | 읽음 |
| `main()` 배선 e2e 테스트 선례(실 git) | `tests/unit/doctor-terminal-wiring.test.ts` | 읽음 |

`main()`의 해당 지점(현재):

```ts
const checks = runChecks(inp)
for (const c of checks) console.log(`[req:doctor] ${c.level} ${c.id}: ${c.msg}`)
const fails = checks.filter((c) => c.level === 'FAIL')
console.log(`[req:doctor] ${fails.length ? `FAIL ${fails.length}건` : 'PASS'} (REQ=${state.id})`)
if (fails.length) process.exit(1)
```

## 핵심 설계 결정

### DEC-1 · 로그는 **커밋되지 않는 로컬 관측 자산**이다

경로: **`workflow/.doctor-runs.jsonl`** (repo root 기준). `workflow/.review-calls.jsonl`과 같은 성격·같은 자리.

**근거**

- 그 선례가 이 프로젝트의 **유일한 성공한 관측 사례**다. 소비자 3곳의 리뷰 게이트 발화를 실측할 수 있었던
  이유가 그 파일이다.
- 커밋하면 세 가지를 물려받는다:
  1. **커밋 소음** — doctor는 phase마다 여러 번 돈다. 실행마다 커밋이 늘어난다.
  2. **브랜치-지역 유실** — 커밋된 증거는 병합되지 않은 브랜치와 함께 사라진다.
     실측: 소비자 3곳에서 리뷰 아카이브의 **3.1%가 유실**됐고 그중 다수가 실패 기록이었다.
  3. **D10/D13 스크래치 규칙과의 충돌** — 티켓 내부에 새 커밋 자산을 두면 스테이징 규칙이 복잡해진다.

**기각한 대안**: 티켓 내부 원장(`responses/`)에 기록 — 위 세 문제를 전부 안는다.
관측이 목적인데 감사 자산의 제약을 지불할 이유가 없다.

### DEC-2 · **실행 1회 = 1행**. OK는 개수로만 남긴다

```jsonc
{
  "ticket_id": "REQ-2026-111",   // state.id
  "at": "2026-08-02T…Z",          // ISO
  "verdict": "FAIL",              // FAIL이 1건 이상이면 "FAIL", 아니면 "PASS" — 출력 문구와 같은 기준
  "evaluated": 22,                // checks.length
  "nonok": [                      // level !== 'OK' 인 것만, runChecks 반환 순서 유지
    { "id": "D18", "level": "WARN" },
    { "id": "D10", "level": "FAIL" }
  ]
}
```

**근거**

- 답해야 할 질문은 *"어떤 검사가 실제로 발화한 적 있는가"*다. **non-OK만 있으면 답이 나온다.**
- 체크당 1행으로 하면 실행마다 22행이다. 대부분이 `OK`이고 정보가 없는데 파일만 커진다.
- `msg`는 담지 않는다 — 경로·파일명 등 내용이 섞이고(요구 제약 5), 질문에 답하는 데 불필요하다.

### DEC-3 · `evaluated`는 **개수만** 남긴다 (한계를 명시한다)

`runChecks`가 매 호출에서 22개 전부를 push한다고 **가정하지 않는다.** 조건에 따라 일부가 빠질 수 있다
(`docs-stale-claims.test.ts`의 죽은-항목 탐지가 입력 변형 4개를 쓰는 이유가 그것이다).

따라서 이 로그로 답할 수 있는 것과 없는 것을 명확히 한다:

| 질문 | 답할 수 있나 |
|---|---|
| "D-x가 발화한 적 있는가" | ✅ `nonok`에 등장 여부 |
| "D-x가 몇 번 FAIL했는가" | ✅ 집계 |
| "D-x가 몇 번 **평가**됐는가" | ❌ — 개수만 알 뿐 id별로는 모른다 |

세 번째는 **이번 비목표**다. id 목록까지 남기면 행이 커지고, 지금 필요한 판단(절제 후보 식별)에는
첫 두 개로 충분하다. 필요해지면 필드 추가로 확장 가능하다(append-only JSONL이라 하위호환).

### DEC-4 · 🔴 관측은 판정을 **바꾸지 않는다**

- 순수 빌더 `buildDoctorRunRow(checks, meta)`와 부작용 `appendDoctorRun(rootAbs, row)`를 분리한다.
- `appendDoctorRun`은 **모든 예외를 삼킨다**. `review-codex.ts:766~768`과 동일한 형태·동일한 이유.
- 호출 지점은 `checks` 계산 **직후, 출력 루프 전**. `process.exit`보다 앞이라 FAIL 실행도 기록된다.
- **기존 4줄(출력·fails·요약·exit)은 한 글자도 바꾸지 않는다.**

```ts
const checks = runChecks(inp)
appendDoctorRun(cfg.root, buildDoctorRunRow(checks, { ticketId: String(state.id ?? ''), at: new Date().toISOString() }))
for (const c of checks) console.log(...)   // 이하 무변경
```

### DEC-5 · gitignore는 **세 표면**을 동시에 손본다

| 표면 | 이유 |
|---|---|
| 루트 `.gitignore` | 이 저장소(dogfood)에서 D10이 FAIL하지 않게 |
| `templates/workflow.gitignore` | **소비자**에서 D10이 FAIL하지 않게 |
| `req-doctor.ts:1319`의 D22 목록 | 위 둘이 빠진 설치본을 **진단이 알려주게** |

🔴 이 셋 중 하나만 넣으면 **자산 skew**다. 이 저장소는 그 전례가 두 번 있다(REQ-2026-025·038 —
루트 `.gitignore`에만 넣고 배포 템플릿에서 누락). 그래서 AC-4는 **양쪽을 다 검사**한다.

## Phase별 구현

단일 phase다. 변경 파일 5개로 granularity 권고(8파일) 안이고, 부분 배선 상태로 나눌 이유가 없다.

**Phase 1 (`phase-1-doctor-run-log`)** — 상수·순수 빌더·append·`main()` 배선 + gitignore 3표면 + 테스트.

## 변경 파일

| 파일 | 변경 |
|---|---|
| `scripts/req/req-doctor.ts` | `DOCTOR_RUN_LOG_REL` 상수 · `DoctorRunRow` 타입 · `buildDoctorRunRow`(순수·export) · `appendDoctorRun`(삼킴) · `main()` 1줄 배선 · D22 목록에 상수 추가 |
| `.gitignore` | `workflow/.doctor-runs.jsonl` |
| `templates/workflow.gitignore` | 동일 규칙 |
| `tests/unit/doctor-run-log.test.ts` (신규) | AC-1~AC-5 |
| `CHANGELOG.md` | Unreleased 항목 |

## 테스트 oracle (AC ↔ 검증)

🔴 **순수 테스트만으로는 부족하다.** 이 저장소에는 *"빌더 직접호출 가드는 배선끊김을 못 잡는다"*는
실증이 세 번 있다(REQ-2026-083·097·099). 그래서 AC-1·AC-2·AC-3은 **실제 진입점 `main()`을 돌린다**
(`doctor-terminal-wiring.test.ts`가 쓰는 `mkRepo` + `doctorMain([SHORT, '--root', repo])` 패턴).

| AC | 검증 | 이 테스트가 잡는 결함 |
|---|---|---|
| AC-1 | hermetic repo에서 `main()` 1회 → 파일 1행 | 배선 누락(빌더만 있고 호출 안 함) |
| AC-2 | FAIL 상태 구성 → 그 행의 `nonok`에 해당 `id`·`level` | 빌더가 non-OK를 빠뜨림 |
| AC-3 | 로그 경로를 **디렉터리로 만들어** 쓰기 실패 유도 → 두 실행의 출력 줄과 exit 호출이 동일 | 예외가 새어 doctor를 죽임 |
| AC-4 | 두 gitignore 파일 **모두**에 규칙. **변이 검사**: 한쪽만 있으면 실패 | 자산 skew |
| AC-5 | D22에 넘기는 목록에 상수 포함 | 진단이 skew를 못 알림 |

**AC-3이 이 REQ의 핵심 오라클이다.** "관측이 판정을 바꾸지 않는다"가 제약 1이고, 그것이 깨지면
관측 추가가 게이트를 망가뜨린다. 쓰기 실패를 **실제로 만들어** 비교한다(mock이 아니라 실 파일시스템).

## 하위호환·안전

- **기존 동작 무변경**: D-체크 판정·메시지·level·출력 형식·exit code 전부 그대로.
  이 REQ는 코드를 **추가**만 한다(기존 4줄 앞에 1줄).
- **기존 로그 없음**: 새 파일이라 마이그레이션 대상이 없다.
- **소비자 영향**: 업그레이드 후 첫 `req:doctor`부터 파일이 생긴다. gitignore가 함께 배포되므로
  D10이 FAIL하지 않는다. 기설치 소비자가 `templates/workflow.gitignore`를 안 받았다면
  **D22가 WARN으로 알린다**(FAIL 아님 — 진행을 막지 않는다).
- **개인정보·비밀**: 로그에 담기는 것은 `ticket_id`·시각·검사 id·level뿐이다.
  경로·파일명·메시지 본문은 담지 않는다.
- **파일 크기**: 실행당 1행(≈120바이트). 하루 100회 실행해도 12KB 수준이라 회전이 불필요하다.
