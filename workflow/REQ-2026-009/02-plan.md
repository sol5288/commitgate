# REQ-2026-009 계획 — phase 분해

design-first. 3 phase. 각 phase는 D18 임계(코드 8파일) 안.

## Phase 1 — 코어 기본값 (`phase-1-core-default`)

**동작 변경 phase.** Test-First(Red → Green).

범위(3파일):
- [scripts/req/lib/config.ts](../../scripts/req/lib/config.ts)
  - `DEFAULTS.handoffPath` → `null`.
  - `DEFAULTS` 위의 계약 주석(`⚠️ 현재 하드코딩 값 — 변경 시 behavior-preserving 깨짐`)을 새 계약으로 갱신: `handoffPath`는 프로젝트별 값이라 코어 기본은 비활성(`null`)이며, 사용하려면 `req.config.json` 또는 `--handoff`로 명시한다.
  - 모듈 헤더의 사설 티켓 참조(`REQ-2026-017`) 표현은 phase-2에서 함께 정리(여기선 payload 문자열만 건드림).
- [tests/unit/req-config.test.ts](../../tests/unit/req-config.test.ts)
  - **Red 먼저**: `expect(DEFAULTS.handoffPath).toBeNull()` 로 pin 교체(현재 palm 경로 pin은 삭제).
  - 추가: `req.config.json` 부재 시 `loadConfig().handoffPath === null` 및 `handoffPathAbs === null`.
  - 유지: 명시 `handoffPath: '../sibling/x.md'` 는 confinement 면제로 계속 통과.
- [tests/unit/init.test.ts](../../tests/unit/init.test.ts)
  - 동작 단언은 **그대로**(시드 `handoffPath:null`, 누락키 병합, 기존 명시값 `keep/me.md` 보존).
  - 주석의 "palm 경로 미상속 / resurface 차단" 표현만 갱신.

Exit: `npm run typecheck` 0 · `npm test` 그린 · `req:doctor` PASS · Codex phase 승인.

## Phase 2 — 주석 일반화 + payload 회귀 가드 (`phase-2-comment-scrub`)

범위(6파일):
- [bin/init.ts](../../bin/init.ts):313 — `코어 DEFAULTS의 palm 고유값(handoffPath)` → 사설명 제거, 의도만 서술.
- [scripts/req/review-codex.ts](../../scripts/req/review-codex.ts):5 · 7 · 20 — SSOT/0차 실측 사설 경로 제거. **:20의 `--handoff` 기본값 설명은 사실도 갱신**(기본 없음 = 비활성).
- [scripts/req/req-commit.ts](../../scripts/req/req-commit.ts):5 · [req-doctor.ts](../../scripts/req/req-doctor.ts):5 · [req-new.ts](../../scripts/req/req-new.ts):5 — SSOT 사설 경로 제거. 이 repo 티켓 문서 참조 또는 중립 서술로 대체.
- [tests/unit/package-payload.test.ts](../../tests/unit/package-payload.test.ts) **신규** — **보조 가드**:
  - `package.json`의 `files` 집합을 온디스크로 해소해 모든 파일을 읽고, 금지 문자열 4개(`palm-kiosk`, `palm-kiosk-app`, `../palm-kiosk`, `project-memory/ai-handoff.md`, 대소문자 무시) 0건을 단언.
  - npm을 실행하지 않으므로 전 플랫폼 CI에서 빠르고 결정적. **exit 판정의 정본은 아니다**(아래 참조).

Exit: 아래 "payload 검증(정본)" 통과 · `npm run typecheck` 0 · `npm test` 그린 · `npm run smoke` 그린 · `req:doctor` PASS · Codex phase 승인.

### payload 검증 — 정본 (PM 지시 #1·#2)
**exit 증거는 `npm pack --dry-run --json`의 실제 payload 파일 목록 기준이어야 한다. 온디스크 `files` 스캔으로 대체하지 않는다.**

1. `npm pack --dry-run --json` 실행 → 반환 JSON의 `files[].path` 를 payload 정본 목록으로 취한다.
2. 그 경로들만 읽어 금지 문자열 4개를 대소문자 무시로 스캔 → **0건**이어야 한다.
3. 교차 확인: `npm pack --pack-destination <격리 tmp>` 로 실제 tarball을 만들어 추출한 뒤 같은 스캔을 돌려 (1)(2)와 같은 결론인지 본다.
4. npm 호출은 전부 **격리된 `npm_config_cache`**로 실행한다. 사용자의 실제 npm 캐시를 만지지 않는다.
5. 스캔 결과(파일 수·매치 수)를 phase 리뷰 요청에 증거로 첨부한다.

## Phase 3 — 버전 bump (`phase-3-version-bump`)

범위(2파일): [package.json](../../package.json) · [package-lock.json](../../package-lock.json) → `0.3.1`.

- `npm version 0.3.1 --no-git-tag-version` 사용(태그·커밋 자동 생성 없음).
- root `.version` **및** `packages[""].version` 둘 다 `0.3.1`인지 확인(과거 0.2.1↔0.2.2 드리프트 재발 방지).
- 코드·문서 무변경. **분리 커밋**(승인 범위 구분).

Exit: version 3곳 일치 · `npm run typecheck` 0 · `npm test` 그린 · `npm run smoke` 그린 · `req:doctor` PASS · Codex phase 승인.

## 완료
- 게이트 해당분(typecheck·unit·smoke) 그린 + payload 스캔 0건.
- **`v0.3.1` tag(`R1`) · `npm publish`(`R2`) · GitHub release(`R3`) 미수행** — 각각 별도 통제점.
- **main 반영 금지.** 반영 방식(PR 경유 `I1`/`I2` vs `B1` direct push)은 이 REQ 완료 후 PM이 다시 결정한다.
