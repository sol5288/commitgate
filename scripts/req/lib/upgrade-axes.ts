/**
 * 업그레이드 시 **조치가 필요한 축**의 등록부 (REQ-2026-164).
 *
 * 🔴 **왜 코드에 두는가**: 축은 진단(`check` C5·C6 · `doctor` D19~D33)과 조치(`sync` 4축 · `quickstart` ·
 *    `migrate` · 수동)에 흩어져 있고, 어느 문서도 그것을 한 자리에서 열거하지 않았다. 목록을 문서에만
 *    적으면 축을 늘린 사람이 문서 네 곳을 전부 기억해야 한다 — REQ-2026-161 이 `docs/upgrade.*` 만
 *    고치고 README 를 빠뜨린 것이 정확히 그 실패다(*새 절 추가는 갱신이 아니다* — REQ-2026-073).
 *
 * 🔴 **소비처는 가드 하나다.** 진단·조치 동작은 이미 각 체크가 하고 있고, 여기서 또 판정하면 같은
 *    사실을 두 곳이 말하게 된다. 이 저장소는 소비처 없는 신호를 "죽은 기능"으로 취급해 왔으므로
 *    (REQ-2026-031), 그 소비처가 `tests/unit/upgrade-axes.test.ts` 임을 여기 적어 둔다.
 */

/**
 * 축을 알려 주는 수단.
 *
 * 🔴 **체크 id 만이 아니다.** persona drift 는 `sync` 계획 출력으로만 드러나고 **안정 id 가 없다**.
 *    그것을 체크 id 배열에 억지로 넣으면 실재 가드가 깨지고, 빈 배열로 두면 표가 "진단 없음"이라고
 *    **거짓을 말한다**. 세 종류를 타입으로 구분한다(설계 DEC-1 · design r02 P1).
 */
export type AxisDiagnosis =
  /** `D20` · `C6` … — 가드가 `D_CHECK_IDS`/`check` 항목에서 **실재**를 검사한다. */
  | { kind: 'check'; id: string }
  /** id 가 없고 명령 출력으로만 드러난다(예: `sync` 계획의 persona 상태). */
  | { kind: 'command'; command: string }
  /**
   * 진단 수단이 **없다**. 사람이 확인해야 한다.
   * 🔴 표에는 언어 독립 토큰 `n/a` 로 적는다 — "진단 없음"/"no diagnosis" 는 언어를 타서 가드가 못 쓴다.
   */
  | { kind: 'none' }

export interface UpgradeAxis {
  /** 안정 식별자 — 정본 표의 행 키다. 바꾸면 문서도 함께 바꿔야 한다(가드가 잡는다). */
  id: string
  /** 무엇이 어긋나는가(한 줄). */
  what: string
  /**
   * 이 축을 알려 주는 수단.
   * 🔴 **비지 않는다** — 빈 배열은 "진단이 없다"와 "아직 안 적었다"를 구분하지 못한다. `none` 을 명시한다.
   */
  diagnostics: readonly AxisDiagnosis[]
  /**
   * 표 행이 담아야 하는 **언어 독립 토큰**. 대부분 실행 명령이고, 수동 축은 참조 경로다.
   *
   * 🔴 산문을 토큰으로 쓰지 않는다 — 한/영 문서가 각자 번역하므로 **정확 비교가 불가능**해진다.
   *    가드가 고정하는 것은 언어를 타지 않는 문자열뿐이다.
   */
  remedyToken: string
  /** 사람이 읽는 조치(등록부의 한국어 표현). 문서는 언어별로 옮긴다 — 가드 대상이 아니다. */
  remedy: string
}

/**
 * **정본 요약 명령**(설계 DEC-3). README 한/영이 이것을 **그대로** 담는다 — 문자열이 한 곳에서만 나오므로
 * 갈라질 자리가 없다.
 *
 * 🔴 **README 구역에는 이 명령 하나뿐이다.** `check` 로 남은 축을 확인하는 절차까지 README 에 적으면
 *    그것이 곧 절차 복제이고, 축이 늘 때 또 갈라진다 — 확인 절차와 축 표는 **정본 문서**가 갖는다.
 *    (phase-2 r01 P1: 이 계약을 임의로 넓혔다가 되돌렸다.)
 */
export const UPGRADE_SUMMARY_COMMAND = 'npx commitgate sync --apply --scripts --gitignore'

/** README 가 가리켜야 하는 정본 문서(절차를 복제하지 않고 여기로 보낸다). */
export const UPGRADE_CANONICAL_DOC = {
  ko: 'docs/upgrade.md',
  en: 'docs/upgrade.en.md',
} as const

/** 정본 표를 감싸는 마커 — 가드가 이 구역 **안에서** 축별 행을 찾는다. */
export const AXES_TABLE_MARKER = { open: '<!-- commitgate:upgrade-axes -->', close: '<!-- /commitgate:upgrade-axes -->' } as const

/** README 업그레이드 구역 마커 — 가드가 이 구역의 **구조**(표 없음·명령 하나)를 본다. */
export const SUMMARY_MARKER = { open: '<!-- commitgate:upgrade-summary -->', close: '<!-- /commitgate:upgrade-summary -->' } as const

/**
 * 업그레이드 축 8종.
 *
 * 🔴 순서가 정본 표의 행 순서다(가드는 순서를 강제하지 않지만, 읽는 사람에게는 순서가 절차다).
 */
export const UPGRADE_AXES: readonly UpgradeAxis[] = [
  {
    id: 'caret-range',
    what: '설치된 버전이 caret 범위(^0.x)에 갇혀 minor 를 넘지 못함',
    // 🔴 소비자 package.json 에서 PM 이 강제한다 — 코드로 감지·수정할 수 없다. 없는 진단을 있다고 적지 않는다.
    diagnostics: [{ kind: 'none' }],
    remedyToken: 'npm i -D commitgate@<version>',
    remedy: 'npm i -D commitgate@<version>',
  },
  {
    id: 'req-scripts',
    what: '릴리스가 추가한 req:* verb 가 package.json 에 없음',
    diagnostics: [
      { kind: 'check', id: 'C6' },
      { kind: 'check', id: 'D33' },
    ],
    remedyToken: 'npx commitgate sync --apply --scripts',
    remedy: 'npx commitgate sync --apply --scripts',
  },
  {
    id: 'vendored-schema',
    what: 'vendored 스키마가 설치된 패키지 사본과 다름',
    diagnostics: [{ kind: 'check', id: 'D20' }],
    remedyToken: 'npx commitgate sync --apply',
    remedy: 'npx commitgate sync --apply',
  },
  {
    id: 'workflow-gitignore',
    what: 'workflow/.gitignore 에 kit 규칙이 빠져 다음 리뷰가 D10 에서 막힘',
    diagnostics: [{ kind: 'check', id: 'D22' }],
    remedyToken: 'npx commitgate sync --apply --gitignore',
    remedy: 'npx commitgate sync --apply --gitignore',
  },
  {
    id: 'managed-blocks',
    what: 'always-loaded 파일의 commitgate 관리 블록이 설치된 버전과 다름',
    diagnostics: [{ kind: 'check', id: 'D21' }],
    remedyToken: 'npx commitgate quickstart --apply',
    remedy: 'npx commitgate quickstart --apply',
  },
  {
    id: 'review-persona',
    what: 'review-persona.md 가 부재하거나 배포본과 달라 리뷰 정책이 도달하지 않음',
    // 🔴 안정 id 가 없다 — `sync` 계획 출력으로만 드러난다(설계 DEC-4).
    diagnostics: [{ kind: 'command', command: 'npx commitgate sync --persona' }],
    remedyToken: 'npx commitgate sync --apply --persona --persona-apply',
    remedy: 'npx commitgate sync --apply --persona --persona-apply',
  },
  {
    id: 'mixed-install',
    what: 'req:* 에 Stage A(tsx …)와 Stage B(commitgate <verb>) 형태가 섞임',
    // 🔴 D19 는 **mixed 만** WARN 한다. 순수 Stage A 는 지원되는 형태라 OK 다 — 축 이름을 사실에 맞춘다.
    diagnostics: [{ kind: 'check', id: 'D19' }],
    remedyToken: 'npx commitgate migrate --apply',
    remedy: 'npx commitgate migrate --apply',
  },
  {
    id: 'contract-claims',
    what: 'AGENTS.md 에 폐기된 CommitGate 서술이 남아 에이전트가 옛 계약을 따름',
    diagnostics: [{ kind: 'check', id: 'C5' }],
    // 🔴 도구가 고치지 않는다 — AGENTS.md 는 사용자 소유이고 프로젝트 고유 내용이 섞여 있다.
    remedyToken: 'node_modules/commitgate/AGENTS.template.md',
    remedy: '수동 병합(node_modules/commitgate/AGENTS.template.md 와 대조)',
  },
]

/** 축이 표에 적어야 하는 토큰들(진단 표현 포함). 가드와 문서 생성이 같은 규칙을 쓴다. */
export function diagnosisTokens(d: AxisDiagnosis): string {
  return d.kind === 'check' ? d.id : d.kind === 'command' ? d.command : NO_DIAGNOSIS_TOKEN
}

/** 진단이 없는 축이 표에 적는 **언어 독립** 토큰. */
export const NO_DIAGNOSIS_TOKEN = 'n/a'

// ───────────────────────────────────────── 업그레이드 절차 정본 (REQ-2026-167) ──

/**
 * 절차 구역을 감싸는 마커. 절차는 문서 여기저기 흩어져 있었고 그래서 어긋났다 —
 * `check` 가 "정리" 줄의 **맨 뒤**에 있었고(진단인데), 반복·수용 기준·companion 확인은 아예 없었다.
 */
export const PROCEDURE_MARKER = {
  open: '<!-- commitgate:upgrade-procedure -->',
  close: '<!-- /commitgate:upgrade-procedure -->',
} as const

/**
 * 절차 구역에 **이 순서로** 나와야 하는 명령.
 *
 * 🔴 첫 항목이 `check` 인 것이 요점이다 — 무엇을 실행할지는 축마다 다르고 **그것을 아는 것은 도구다**.
 *    마지막도 `check` 다: 고친 뒤 **다시 물어** 조치가 0 인지 확인한다. 첫 `check` 만 강제하면
 *    고치고 나서 다시 묻지 않는 문서가 통과하고, 조치가 남아도 사용자는 끝났다고 읽는다.
 *    순서 검사가 커서를 전진시키므로 이 마지막 항목은 **companion 대조 뒤의 또 다른 출현**이어야 한다.
 */
export const PROCEDURE_STEPS: readonly string[] = [
  'npx commitgate check',
  'npx commitgate sync --apply --scripts --gitignore',
  'npx commitgate quickstart --apply',
  'diff -rq .claude/skills node_modules/commitgate/skills',
  'npx commitgate check',
]

export type ProcedureAnchor = 'repeat' | 'search' | 'acceptance' | 'companion'

/**
 * 규범 서술을 여는 앵커. 가드는 **이 앵커가 여는 블록 안**을 본다 — 토큰이 구역 어딘가에만 있으면
 * 통과하는 느슨한 검사가 아니다.
 */
export const PROCEDURE_ANCHORS: Record<ProcedureAnchor, string> = {
  repeat: '<!-- procedure:repeat -->',
  search: '<!-- procedure:search -->',
  acceptance: '<!-- procedure:acceptance -->',
  companion: '<!-- procedure:companion -->',
}

/**
 * 🔴 **규범 문장** — 문서가 **글자 그대로** 실어야 하는 한 줄들. 정본은 여기 하나다.
 *
 * 왜 문장까지 고정하나(design r02 P1): 앵커 뒤 블록에 `C5`·`C7` 같은 토큰만 요구하면
 * *"`C5` 를 확인하고 `check` 를 다시 실행"* · *"`C7` 을 확인"* 처럼 **종료 조건과 수용 기준이 빠진**
 * 문장으로 바꿔도 통과한다. 그러면 첫 병합 뒤 조치가 남은 사용자가 다시 완료로 오인한다 —
 * 이 REQ 가 고치려는 바로 그 상태다.
 *
 * 왜 문서 전체를 고정하지 않나: 한/영 두 벌의 산문이라 사소한 수정마다 red 가 되면 사람이 가드를 끈다.
 * 그래서 **문장만** 고정하고 주변 설명은 자유롭게 둔다.
 */
export const PROCEDURE_ASSERTIONS: Record<ProcedureAnchor, { ko: readonly string[]; en: readonly string[] }> = {
  repeat: {
    ko: ['`C5` 가 아무것도 지적하지 않을 때까지 이 과정을 **반복합니다** — 한 번 고치고 끝내지 마십시오.'],
    en: ['**Repeat** this until `C5` reports nothing — do not stop after a single fix.'],
  },
  search: {
    ko: ['인용된 문장을 **그대로 검색하면 찾지 못할 수 있습니다** — 강조·코드 표시 문자를 뺀 짧은 조각으로 찾으십시오.'],
    en: ['**Searching for the quoted sentence verbatim may find nothing** — search for a short fragment with the emphasis/code characters removed.'],
  },
  acceptance: {
    ko: ['`C7` 의 **조치가 0** 이면 끝입니다(`caret-range` 의 "사람 확인"은 남아도 됩니다).'],
    en: ['You are done when `C7` reports **0 actions** (the `caret-range` "human check" may remain).'],
  },
  companion: {
    ko: [
      '이 축은 `check` 도 `sync` 도 보지 않습니다 — **직접 대조**해야 합니다.',
      '직접 수정한 파일은 **그대로 두십시오** — 이 대조는 무엇이 달라졌는지 알기 위한 것이지 덮어쓰기가 아닙니다.',
    ],
    en: [
      'Neither `check` nor `sync` looks at this axis — you must **compare it yourself**.',
      'Leave files you edited yourself **as they are** — this comparison tells you what changed; it is not an overwrite.',
    ],
  },
}

/**
 * companion 자산의 대조 쌍(실측으로 확인). "대조하라"만 적으면 무엇을 무엇과 비교하는지 사람마다 다르다.
 *
 * 🔴 `req.config.json` 은 **여기 없다** — 사용자 소유 설정이라 `req.config.json.sample` 과 다른 것이
 *    정상이다(실측에서도 다르다). 새 설정 축은 버전별 절이 알린다.
 */
export const COMPANION_PAIRS: readonly { consumer: string; packaged: string }[] = [
  { consumer: '.claude/skills', packaged: 'skills' },
  { consumer: '.claude/commands/req.md', packaged: 'templates/claude-command.md' },
  { consumer: '.claude/skills/commitgate/SKILL.md', packaged: 'templates/claude-skill.md' },
  { consumer: '.cursor/rules/commitgate.mdc', packaged: 'templates/cursor-rule.mdc' },
]

/** 소비 프로젝트가 문서에서 보는 형태(설치된 패키지 기준 경로). */
export function packagedPathForDocs(packaged: string): string {
  return `node_modules/commitgate/${packaged}`
}

/**
 * `diff -rq .claude/skills …` 를 돌리면 **정상인데도** 나오는 비대칭 둘. 문서가 이 둘을 적지 않으면
 * 사용자가 결함으로 읽는다(실측).
 */
export const COMPANION_EXPECTED_ASYMMETRY: readonly string[] = ['ATTRIBUTION.md', '.claude/skills/commitgate']

/** 대조 대상이 **아닌** 것 — 사용자 소유라 다른 것이 정상이다. */
export const COMPANION_NOT_COMPARED: readonly string[] = ['req.config.json']

/**
 * 폐기 서술 대조 전에 도는 정규화 함수의 이름(`lib/retired-claims`).
 * 🔴 문서가 이 이름을 적고, 가드가 **그 심볼의 실재**까지 확인한다 — 죽은 심볼을 가리키는 문서를 만들지 않는다.
 */
export const CLAIM_SCAN_FN = 'normalizeForClaimScan'
