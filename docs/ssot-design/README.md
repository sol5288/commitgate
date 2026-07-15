# CommitGate 설계 SSOT — 재구현용 단일 진실 원천

이 디렉터리(`docs/ssot-design/`)는 **CommitGate** 프로젝트를 한 번도 본 적 없는 숙련 개발팀이 **동일한 동작·데이터·CLI·운영 특성으로 1:1 재구현**할 수 있도록 작성된 설계 SSOT(Source of Truth)이다.

문서는 "현재 구현의 사실"을 기준으로 한다. 소스 코드·설정·테스트·CI를 근거로 하며, 근거가 없는 서술은 `추론` 또는 `확인 불가`로 표기한다(표기 규칙: [00-document-control.md](00-document-control.md)).

## 1. 문서화 기준점

| 항목 | 값 | 근거 |
|---|---|---|
| 대상 커밋 SHA | `2f6926f000a78750f559d9b046f117b628fe893d` (`2f6926f`) | `git rev-parse HEAD` |
| 조사 일시 | 2026-07-15 | 세션 컨텍스트 `Today's date` |
| 대상 브랜치 | `main` | `git rev-parse --abbrev-ref HEAD` |
| 패키지 버전 | `commitgate@0.6.0` | [package.json](../../package.json) |
| 라이선스 | MIT | [LICENSE](../../LICENSE) |

## 2. 제품 한 줄 정의

**CommitGate는 AI 코딩 에이전트(Builder)가 만든 변경을, 별도 리뷰어(Codex)의 구조화된 승인 없이는 커밋하지 못하도록 막는 fail-closed 커밋 게이트 워크플로 kit이다.** 대상 프로젝트에 `scripts/req/*` CLI와 계약 파일(`AGENTS.md` 등)을 복사(vendored scaffold)하는 방식으로 설치된다.

## 3. 독자와 범위

- **독자**: 재구현을 맡은 시니어 개발자, 아키텍트, QA. Node.js/TypeScript/git에 익숙하다고 가정한다.
- **범위**: `npx commitgate` 설치기, `req:new/next/review-codex/doctor/commit` 5개 CLI, Codex/git 연동, 워크플로 상태·증거 데이터 모델, 테스트·CI·릴리즈 절차.
- **비범위**: 대상 프로젝트(사용자 repo)의 애플리케이션 로직, Codex/OpenAI 내부 구현, npm 레지스트리 내부.

## 4. 재구현 권장 읽는 순서

문서 간 선행 의존성을 반영한 순서다.

1. [01-system-context.md](01-system-context.md) — 무엇을·왜 만드는가, 행위자와 경계
2. [02-repository-and-runtime.md](02-repository-and-runtime.md) — 스택·명령·환경·설정
3. [03-domain-and-data-model.md](03-domain-and-data-model.md) — 상태·응답·증거 데이터 모델 (이후 모든 문서의 어휘 기반)
4. [04-user-roles-and-permissions.md](04-user-roles-and-permissions.md) — 역할·인가·통제점
5. [07-business-rules-and-state-machines.md](07-business-rules-and-state-machines.md) — 게이트 규칙·상태 머신·D-체크
6. [06-api-and-integration-contracts.md](06-api-and-integration-contracts.md) — CLI 계약·Codex/git 연동
7. [05-user-flows-and-ui-spec.md](05-user-flows-and-ui-spec.md) — CLI를 "화면"으로 본 사용자 흐름
8. [08-architecture-and-module-spec.md](08-architecture-and-module-spec.md) — 모듈 책임·의존·시퀀스
9. [09-security-and-reliability.md](09-security-and-reliability.md) — 보안·복원력 통제
10. [10-operations-deployment-and-observability.md](10-operations-deployment-and-observability.md) — CI·릴리즈·관측성
11. [11-test-strategy-and-acceptance.md](11-test-strategy-and-acceptance.md) — 테스트·인수 기준
12. [12-traceability-matrix.md](12-traceability-matrix.md) — 기능↔흐름↔API↔데이터↔규칙↔테스트 추적
13. [gaps-and-decisions.md](gaps-and-decisions.md) — 불일치·미구현·재구현 임시결정
14. [13-review-and-validation-log.md](13-review-and-validation-log.md) — 본 문서화 자체의 리뷰·검수 기록

## 5. 재구현 필수 선행조건

- Node.js **18.17 이상**([package.json](../../package.json) `engines.node`)
- git (모든 게이트의 기반 상태원), npm/pnpm/yarn 중 하나
- 리뷰 실호출을 재현하려면 Codex CLI(`@openai/codex`) + 로그인. 리뷰 로직 자체는 `createFakeReviewerAdapter`로 대체 검증 가능(테스트).

## 6. 전체 문서 인덱스

| 파일 | 내용 |
|---|---|
| [00-document-control.md](00-document-control.md) | 범위·용어집·표기 규칙·갱신 트리거 |
| [01-system-context.md](01-system-context.md) | 제품 목적·행위자·시스템 컨텍스트·NFR |
| [02-repository-and-runtime.md](02-repository-and-runtime.md) | 디렉터리·스택·명령·환경변수·설정 |
| [03-domain-and-data-model.md](03-domain-and-data-model.md) | state.json·machine.schema·config.schema·증거 로그 |
| [04-user-roles-and-permissions.md](04-user-roles-and-permissions.md) | 역할·인가 지점·통제점·승인 문장 |
| [05-user-flows-and-ui-spec.md](05-user-flows-and-ui-spec.md) | CLI 명령별 입력·출력·상태·오류 |
| [06-api-and-integration-contracts.md](06-api-and-integration-contracts.md) | CLI 계약·Codex/git/npm 연동 |
| [07-business-rules-and-state-machines.md](07-business-rules-and-state-machines.md) | 게이트 규칙·D-체크·상태 머신 |
| [08-architecture-and-module-spec.md](08-architecture-and-module-spec.md) | 모듈 명세·의존 그래프·시퀀스 |
| [09-security-and-reliability.md](09-security-and-reliability.md) | 보안 통제·신뢰 경계·복원력 |
| [10-operations-deployment-and-observability.md](10-operations-deployment-and-observability.md) | CI·릴리즈 통제점·관측성 |
| [11-test-strategy-and-acceptance.md](11-test-strategy-and-acceptance.md) | 테스트 분류·인수 기준 |
| [12-traceability-matrix.md](12-traceability-matrix.md) | 추적성 매트릭스 |
| [13-review-and-validation-log.md](13-review-and-validation-log.md) | 리뷰·검수 로그 |
| [gaps-and-decisions.md](gaps-and-decisions.md) | 갭·결정 기록 |
| [assets/](assets/) | Mermaid 다이어그램 원본 |

## 7. 근거 표기 관례

각 주요 사실 뒤에 근거를 `파일:심볼` 형태로 병기한다. 예: `safeSpawnSync`([scripts/req/lib/adapters.ts](../../scripts/req/lib/adapters.ts)). 원본 저장소 루트 기준 상대 경로를 사용한다.
