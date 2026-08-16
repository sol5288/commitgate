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
