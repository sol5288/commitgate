# 개발·현재 범위

현재 버전은 **런타임 패키지 모델**입니다. 실행 코드와 런타임 의존성은 `node_modules/commitgate`에만 있고, 프로젝트에는 거버넌스·감사 데이터와 `req:* = commitgate <verb>` 스크립트만 남습니다. (예전 vendored scaffold 설치본은 [`migrate`](./upgrade.md#예전-설치본에서-옮겨오기-migrate)로 전환합니다.)

현재 운영 중인 검증입니다.

- GitHub Actions에서 `ubuntu-latest`, `macos-latest`, `windows-latest` × Node 18/20/22 매트릭스를 실행합니다.
- `npm run smoke`는 pack tarball을 임시 프로젝트에 실제로 설치해, 대상에 `scripts/req/`가 **없고** `tsx`·`ajv`·`cross-spawn`이 **주입되지 않으며** 다섯 `req:*`가 패키지 bin을 가리키는지, 그리고 `npm run req:doctor`가 실제로 패키지 안의 모듈까지 dispatch되는지 확인합니다. `migrate` 비파괴성도 같은 방식으로 검증합니다.
- Windows `.cmd` 래퍼 주입 회귀 테스트가 패키지 매니저와 Codex wrapper 경로를 보호합니다.

아래는 후속 범위입니다.

- Yarn PnP 지원, 워크스페이스 하위 패키지 독립 설치
- 자산↔런타임 버전 드리프트 탐지
- 비-git VCS 지원
- 더 다양한 설계문서 템플릿
