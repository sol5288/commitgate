# 개발·현재 범위

현재 버전은 **런타임 패키지 모델**입니다. 실행 코드와 런타임 의존성은 `node_modules/commitgate`에만 있고, 프로젝트에는 거버넌스·감사 데이터와 `req:* = commitgate <verb>` 스크립트만 남습니다. (예전 vendored scaffold 설치본은 [`migrate`](./upgrade.md#예전-설치본에서-옮겨오기-migrate)로 전환합니다.)

현재 운영 중인 검증입니다.

- GitHub Actions에서 `ubuntu-latest`, `macos-latest`, `windows-latest` × Node 18/20/22 매트릭스를 실행합니다.
- `npm run smoke`는 pack tarball을 임시 프로젝트에 실제로 설치해, 대상에 `scripts/req/`가 **없고** `tsx`·`ajv`·`cross-spawn`이 **주입되지 않으며** 다섯 `req:*`가 패키지 bin을 가리키는지, 그리고 `npm run req:doctor`가 실제로 패키지 안의 모듈까지 dispatch되는지 확인합니다. `migrate` 비파괴성도 같은 방식으로 검증합니다.
- Windows `.cmd` 래퍼 주입 회귀 테스트가 패키지 매니저와 Codex wrapper 경로를 보호합니다.
- `npm test`는 **전체 스위트**를 돌리고, 게이트 판정도 이것을 봅니다(변경분만 돌리는 방식은 쓰지 않습니다 —
  영향 분석이 놓친 회귀를 통과시킵니다).

### CI 잡에는 20분 상한이 있습니다

`.github/workflows/ci.yml`의 `timeout-minutes: 20`이 교착한 잡을 끊습니다(GitHub 기본값은 **360분**).

🔴 **왜 20분인가**: 실측 최장은 windows의 **7.0분**입니다. 그 약 3배로 둡니다 — 더 조이면 러너 성능
변동이나 npm 레지스트리 지연으로 **정상 실행이 죽어 거짓 red**가 납니다. 거짓 red는 교착보다 나쁩니다.
사람이 red를 무시하기 시작하기 때문입니다.

🔴 **두 번째 목적은 로그입니다**: GitHub는 **진행 중인 잡의 로그를 주지 않습니다**
(`gh run view --job <id> --log` → "still in progress"). 2026-07-27 `macos-latest · node 18`이 교착했을 때,
원인을 보려면 잡을 **죽여야 했습니다** — 진단하려면 증거를 없애야 하는 상태였습니다. 타임아웃으로
종료되면 로그가 남습니다. 값을 올리려면 이 점을 함께 고려하세요.

### 테스트는 상한 있는 병렬로 돕니다

`vitest.config.ts`의 `maxWorkers: 2`가 동시에 도는 테스트 파일 수를 묶습니다.

🔴 **왜 상한이 필요한가**: `init`·`uninstall`·`migrate` 계열 테스트는 임시 저장소에서 `commitgate`
프로세스를 스폰합니다. 파일 병렬을 기본값(≈ CPU 코어 수)으로 두면 그 스폰들이 겹쳐, 리소스가 빠듯한
러너에서 `npm test`가 **hang**합니다(어서션 실패가 아니라 교착 — REQ-2026-044).

🔴 **왜 하필 2인가**: hang 조건은 `동시 워커 수 × 워커당 스폰`이고, GitHub 러너는 **4 vCPU**입니다.
워커 수가 코어 수에 닿으면 그 조건으로 되돌아가므로 **절반**에서 멈춥니다.
실측(로컬 12코어 · 47파일 2237 tests): 전면 직렬 **507초** → `maxWorkers: 2` **310초**(1.64배), 둘 다 통과.

되돌리려면 `maxWorkers`를 지우고 `fileParallelism: false`로 복귀하면 이전 동작과 정확히 같아집니다.

아래는 후속 범위입니다.

- Yarn PnP 지원, 워크스페이스 하위 패키지 독립 설치
- 자산↔런타임 버전 드리프트 탐지
- 비-git VCS 지원
- 더 다양한 설계문서 템플릿
