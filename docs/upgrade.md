# 업그레이드 (0.x)

런타임을 새 버전으로 올릴 때 **두 가지**를 챙겨야 합니다. `npm update`만으로는 부족합니다.

**① 캐럿 범위가 0.x minor를 막습니다.** `npm install -D commitgate`는 `^0.y.z` 범위를 씁니다. npm semver에서
`^0.7.0`은 `>=0.7.0 <0.8.0`을 뜻하므로 `npm update`/`pnpm update`는 **0.x minor를 넘지 않습니다**(0.7.x 안에 머뭅니다).
minor를 넘으려면 범위를 명시적으로 올려야 합니다:

```sh
npm install -D commitgate@latest     # 또는 특정 버전: commitgate@^0.8.0
```

**② vendored 자산은 런타임과 별개로 갱신됩니다.** 런타임(`node_modules/commitgate`)은 위 명령이 갱신하지만,
프로젝트 `workflow/`에 깔린 계약 자산(`machine.schema.json`·`req.config.schema.json`)은 **그대로 남습니다**.
런타임만 올리고 자산을 두면, 새 런타임이 **옛 계약을 읽어** 새 기능(예: design delta 리뷰의 full-review
에스컬레이션)이 조용히 비활성화될 수 있습니다. `commitgate sync`가 이 자산을 설치된 패키지 사본으로 되돌립니다:

```sh
npx commitgate sync                  # 계획만 출력(dry-run — 무엇이 바뀔지 확인)
npx commitgate sync --apply          # 스키마 축 재동기화
npx commitgate sync --apply --persona  # 페르소나도 함께(부재면 복원, 다르면 diff만 보여주고 보존)
npx commitgate sync --apply --persona --persona-apply  # 위 diff 확인 후 페르소나를 shipped 로 교체(.bak 백업)
```

- `sync`는 **스키마 축만** 되돌립니다(계약이라 항상 최신으로). companion skills·`workflow/.gitignore`·
  `package.json`·`req:*`는 건드리지 않습니다.
- **페르소나(`review-persona.md`)는 `--persona`에서만** 다룹니다. 부재면 복원하고, 내용이 다르면
  **적용 전에 실제 내용 diff를 출력한 뒤 기본적으로는 보존**합니다(dry-run 에서도 diff 를 봅니다).
- **리뷰 정책 업데이트를 받으려면** diff 를 확인한 뒤 `--persona-apply` 를 `--persona` 와 **함께** 주십시오.
  교체 전에 `workflow/review-persona.md.bak` 을 남기며(직전 1세대), **백업이나 diff 생성이 실패하면 교체하지
  않습니다**(fail-closed). 0.9.8 이하가 깐 페르소나에는 kit 마커가 없어 "직접 작성분일 수 있음" 경고가
  붙지만, 교체 경로는 동일합니다 — 무엇을 잃는지는 diff 로 확인하고 판단하십시오.
- 페르소나를 계속 직접 관리하려면 `req.config.json`의 `reviewPersonaPath`를 별도 파일로 지정하세요
  (그 경우 `sync`는 완전히 미접촉입니다).
- `req:doctor`의 **D20**이 vendored 스키마가 설치 사본과 어긋나면 **WARN**으로 알려 줍니다(커밋은 막지 않습니다).

**③ 예전(vendored) 설치본이면** 이어서 아래 `migrate`로 Stage B 전환까지 하세요.

**④ Quick Start 블록도 기존 파일엔 자동으로 안 닿습니다(0.9.2+).** 신규 설치는 `CLAUDE.md`/`AGENTS.md` 앞에
온보딩 Quick Start를 넣지만, init은 seed-once라 **이미 있던 파일**엔 반영되지 않습니다. 업그레이드 후 기존
파일에 넣으려면 `commitgate quickstart`로 백필하세요:

```sh
npx commitgate quickstart              # 계획만 출력(dry-run — 무엇이 바뀔지 확인)
npx commitgate quickstart --apply      # 관리 블록만 주입(블록 밖 내용 보존·멱등)
```

- `AGENTS.md`는 CommitGate 계약 마커가 있을 때만 대상입니다. 부재 파일은 건드리지 않습니다.
- `req:doctor`의 **D21**이 기존 파일에 Quick Start 블록이 없으면 **WARN**으로 알려 줍니다(커밋은 막지 않습니다).

> 정리: `commitgate@latest` 설치 → `commitgate sync --apply` → `commitgate quickstart --apply` → (필요 시) `commitgate migrate`.

## 예전 설치본에서 옮겨오기 (`migrate`)

`scripts/req/`가 프로젝트에 복사돼 있고 `req:*`가 `tsx scripts/req/*.ts`를 가리킨다면 **예전(vendored) 설치본**입니다. `init`은 이 상태를 감지하면 조용히 섞이지 않도록 **중단하고** 이 명령을 안내합니다.

```sh
npm install -D commitgate      # 아직 devDependency가 아니라면 먼저
npx commitgate migrate         # 계획만 출력 — 아무것도 쓰지 않습니다
npx commitgate migrate --apply # package.json 의 req:* 만 전환
```

`migrate`가 하는 일은 **하나**입니다: `req:*` 중 **현재 값이 정확히 예전 주입값인 키만** `commitgate <verb>`로 바꿉니다.

- **아무것도 삭제하지 않습니다.** `scripts/req/`·스키마·persona·설정·진입점·`workflow/REQ-*` 증거를 전부 그대로 둡니다. 남은 `scripts/req/`는 더 이상 실행되지 않으니, 정리하려면 `npx commitgate uninstall` 계획을 먼저 확인하세요.
- **직접 고친 스크립트는 덮어쓰지 않습니다.** 값이 한 글자라도 다르면 사용자 값으로 보고 보존한 뒤 수동 조치를 안내합니다.
- **커밋하지 않습니다.** `package.json` 한 파일만 쓰고, 검토는 사용자 몫입니다.

`req:doctor`도 설치 모드(예전/현재/혼합)를 진단해 알려 줍니다.
