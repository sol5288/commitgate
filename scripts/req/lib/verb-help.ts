/**
 * `req:*` verb 의 사용법 — 정본 등록부 + 공용 렌더러 (REQ-2026-166 DEC-2).
 *
 * 🔴 **왜 필요한가**: 실측하면 `req:*` verb 12개 중 11개가 `--help` 를 *"알 수 없는 옵션"* 으로 거부했다
 *    (`bin/*` verb 9종은 전부 낸다). 하필 그 안에 사람 전용 통제점 명령이 있다 — `req:confirm`(HIGH 확인)·
 *    `req:rebind`·`req:review-exception`. 사람이 `--help` 를 칠 가능성이 가장 높은 자리에서 사용법 대신
 *    오류가 나왔다.
 *
 * 🔴 **옵션을 산문이 아니라 구조로 든다.** 본문 문자열에서 `--flag` 를 정규식으로 긁으면 가드가 검사할
 *    목록 자체가 추정이 된다. 구조로 두면 가드가 **등록된 그대로**를 파서에 넣어 확인한다(G3).
 *
 * 🔴 **적힌 플래그는 파서가 실제로 해석하는 것만이다.** 없는 플래그를 안내하는 것은 이 저장소가 반복해
 *    고쳐온 *"실행 불가능한 안내"* 와 같은 결함이다. `tests/unit/verb-help.test.ts` 가 각 플래그를
 *    그 verb 의 `parseArgs` 에 넣어 **파싱 결과가 바뀌는지**로 확인한다.
 */

import { PLACEHOLDER_REASON } from './placeholders'
import { DEFAULT_TTL_HOURS, MAX_TTL_HOURS } from './delegation'

/** 옵션 한 줄. `value` 가 있으면 값을 받는 플래그다(가드가 표본값으로 그 모양까지 검증한다). */
export interface VerbOption {
  flag: string
  /** 값 자리 표기(예: `<path>`). 값을 받지 않는 플래그면 생략. */
  value?: string
  /**
   * G3 가 파서에 넣을 **표본값**. 값 자리 표기가 그대로 통과하지 못하는 플래그(열거형·접두 필수 등)에만
   * 적는다 — 생략하면 가드가 중립값을 쓴다. 사용자에게 보이지 않는다.
   */
  sample?: string
  desc: string
}

export interface VerbHelp {
  /** 한 줄 요약 — 제목 줄에 붙는다. */
  summary: string
  /** 제목 바로 아래 자유 서술(가장 먼저 읽혀야 하는 것). */
  intro?: string[]
  /**
   * `사용법:` 아래 줄들(명령 형태).
   *
   * 🔴 **공백으로 시작하는 줄은 앞 줄의 이어짐**이다(POSIX `\` 연결). 렌더러는 그런 줄에 명령 접두어를
   *    붙이지 않는다 — 붙이면 사용자가 두 줄을 그대로 붙여넣었을 때 명령 중간에 `npx commitgate` 가
   *    끼어들어 **실행 불가능한 안내**가 된다(phase-2 r01 P1).
   */
  usage: string[]
  options: VerbOption[]
  /** 맨 아래 자유 서술(주의·계약). */
  notes?: string[]
}

const ROOT: VerbOption = { flag: '--root', value: '<path>', desc: '대상 repo 루트(기본: 현재 디렉터리)' }
const RUN: VerbOption = { flag: '--run', desc: '실제 실행(기본은 DRY-RUN)' }

/**
 * verb → 사용법. **정본은 여기 하나**다.
 *
 * 🔴 새 `req:*` verb 를 `VERB_MODULES` 에 더하고 여기를 빠뜨리면 G1 이 red 가 된다 — 조용히 빠지지 않는다.
 */
export const REQ_VERB_HELP: Record<string, VerbHelp> = {
  'req:new': {
    summary: '새 REQ 티켓 생성(브랜치·스캐폴드)',
    usage: ['req:new <slug> [--run] [--risk LOW|HIGH] [--title "..."]'],
    options: [
      RUN,
      { flag: '--risk', value: 'LOW|HIGH', sample: 'HIGH', desc: '위험도(기본 LOW). HIGH 는 커밋 전 사람 확인이 추가로 필요' },
      { flag: '--title', value: '"<제목>"', desc: '티켓 제목(생략 시 slug 사용)' },
      { flag: '--successor-of', value: '<REQ-id>', desc: '종료된 티켓을 대체하는 후속 티켓으로 표시' },
      ROOT,
    ],
  },

  'req:next': {
    summary: '지금 무엇을 해야 하는지 알려준다(RUN/AGENT/AWAIT_HUMAN/DONE/BLOCKED)',
    usage: ['req:next <REQ-id> [--json]'],
    options: [
      { flag: '--json', desc: '기계용 JSON 출력' },
      { flag: '--ticket', value: '<dir>', desc: 'REQ id 대신 티켓 디렉터리로 지정' },
      ROOT,
    ],
    notes: ['읽기 전용이다 — 상태를 바꾸지 않는다.'],
  },

  'req:review-codex': {
    summary: '리뷰어(codex) 호출 — design/phase 승인 증거를 만든다',
    usage: [
      'req:review-codex <REQ-id> --kind design --run',
      'req:review-codex <REQ-id> --phase <phase-id> --run',
    ],
    options: [
      RUN,
      { flag: '--dry-run', desc: '호출 없이 프롬프트만 미리보기(기본)' },
      { flag: '--kind', value: 'design|phase', sample: 'design', desc: '리뷰 종류(기본 phase)' },
      { flag: '--phase', value: '<phase-id>', desc: 'phase 리뷰 대상(02-plan.md·state.json 의 phases[] id)' },
      { flag: '--fresh-thread', desc: 'blocked 회복 — 마커를 초기화하고 새 스레드로 시작' },
      { flag: '--handoff', value: '<path>', desc: '인계 문서를 프롬프트에 포함' },
      { flag: '--ticket', value: '<dir>', desc: 'REQ id 대신 티켓 디렉터리로 지정' },
      ROOT,
    ],
    notes: [
      '`--run` 은 실제 리뷰어 호출이다 — 예산(호출 수)을 소비한다.',
      '리뷰 전 워킹트리에 unstaged/untracked 가 있으면 막힌다(D10) — 의도한 변경은 먼저 git add.',
    ],
  },

  'req:doctor': {
    summary: '티켓 진단(D2~D34) — 커밋을 막는 축을 미리 보여준다',
    usage: ['req:doctor <REQ-id>', 'req:doctor --ticket <dir>'],
    options: [
      { flag: '--ticket', value: '<dir>', desc: 'REQ id 대신 티켓 디렉터리로 지정' },
      { flag: '--finalize', desc: 'D9 를 finalize(source tree) 기준으로 판정' },
      ROOT,
    ],
    notes: ['읽기 전용이다.'],
  },

  'req:commit': {
    summary: '승인된 phase 를 커밋한다(게이트 통과 시)',
    usage: ['req:commit <REQ-id> --run -m "<conventional 커밋 메시지>"'],
    options: [
      RUN,
      { flag: '--message', value: '"<한 줄>"', desc: '커밋 메시지(`-m` 동일)' },
      { flag: '--message-file', value: '<path>', desc: '여러 줄 메시지는 파일로(`-F` 동일)' },
      { flag: '--finalize', desc: '증거 finalize 경로' },
      { flag: '--finalize-design', desc: 'design 증거 아카이브를 함께 확정' },
      { flag: '--ticket', value: '<dir>', desc: 'REQ id 대신 티켓 디렉터리로 지정' },
      ROOT,
    ],
    notes: [
      '여러 줄 메시지를 `-m` 으로 넘기지 마세요 — npm/pnpm/npx 가 argv 의 개행을 잘라냅니다(Windows 실측).',
      '`--message-file` 을 쓰세요.',
    ],
  },

  'req:reconstruct': {
    summary: '유실·손상된 티켓 상태를 저장소 증거로부터 재구성',
    usage: ['req:reconstruct <REQ-id> [--confirm] [--run]'],
    options: [RUN, { flag: '--confirm', desc: '재구성 결과를 실제로 기록(확인 표시)' }, ROOT],
  },

  'req:close': {
    summary: '티켓 종결 — 완료 이관 또는 폐기',
    usage: [
      'req:close <REQ-id> --migrate [--run]',
      'req:close <REQ-id> --abandon --reason "<사유>" --confirm "<확인 문장>" [--run]',
    ],
    options: [
      RUN,
      { flag: '--migrate', desc: '완료된 티켓을 이관 종결' },
      { flag: '--abandon', desc: '미완 티켓을 폐기 종결(탈출구)' },
      { flag: '--reason', value: '"<사유>"', desc: '폐기 사유(기록에 남는다)' },
      { flag: '--confirm', value: '"<문장>"', desc: '사람 확인 문장' },
      ROOT,
    ],
  },

  'req:review-exception': {
    summary: '리뷰 예외 승인 — 사람이 책임지고 게이트를 통과시킨다',
    usage: [
      'req:review-exception <REQ-id> --kind design --method "<승인문장>" --rationale-file <path> --run',
      'req:review-exception <REQ-id> --close-orphan <series-id> --reason "<사유>" --run',
    ],
    options: [
      RUN,
      { flag: '--kind', value: 'design|phase', sample: 'design', desc: '예외를 적용할 리뷰 종류' },
      { flag: '--phase', value: '<phase-id>', desc: '`--kind phase` 의 대상' },
      { flag: '--method', value: '"<승인문장>"', desc: '사람 승인 문장' },
      { flag: '--rationale-file', value: '<path>', desc: '사유 문서(파일로 남긴다)' },
      { flag: '--close-stale', value: '<series-id>', desc: '열린 채 남은 attempt 를 닫는다' },
      { flag: '--close-orphan', value: '<series-id>', desc: '판정이 없는 고아 series 를 닫는다' },
      { flag: '--reason', value: '"<사유>"', desc: '`--close-*` 의 사유' },
      { flag: '--resolve', value: '<resolution>', sample: 'replace', desc: '종결 방식' },
      { flag: '--series', value: '<series-id>', desc: '대상 series 지정' },
      { flag: '--confirm', value: '"<문장>"', desc: '사람 확인 문장' },
      ROOT,
    ],
    notes: ['예외는 기록에 남고 감사 대상이다 — 정상 경로가 막혔을 때만 쓴다.'],
  },

  'req:rebind': {
    summary: '티켓의 phase 결속을 다시 맞춘다(재진입 탈출구)',
    usage: ['req:rebind <REQ-id> --phase <phase-id> --confirm "<문장>" [--run]'],
    options: [
      RUN,
      { flag: '--phase', value: '<phase-id>', desc: '다시 결속할 phase' },
      { flag: '--confirm', value: '"<문장>"', desc: '사람 확인 문장(필수)' },
      ROOT,
    ],
  },

  'req:confirm': {
    summary: 'HIGH 위험 커밋·통합의 사람 확인을 기록한다',
    usage: ['req:confirm <REQ-id> --scope phase|req|delivery --method "<승인 문장>" [--run]'],
    options: [
      RUN,
      { flag: '--scope', value: 'phase|req|delivery', sample: 'req', desc: '확인의 적용 범위' },
      { flag: '--method', value: '"<승인 문장>"', desc: '사람 승인 문장' },
      { flag: '--note', value: '"<메모>"', desc: '부가 메모' },
      ROOT,
    ],
    notes: ['확인은 **다음 통제점으로 이월되지 않는다** — 통제점마다 새로 받는다.'],
  },

  'req:repolicy': {
    summary: '진행 중 티켓의 정책 스냅샷을 현재 설정으로 다시 찍는다',
    usage: ['req:repolicy <REQ-id> [--reason "<왜 바꾸는가>"] [--run]'],
    options: [RUN, { flag: '--reason', value: '"<사유>"', desc: '변경 사유(기록에 남는다)' }, ROOT],
    notes: ['정책이 바뀌어도 진행 중 티켓이 옛 정책에 갇히지 않게 하는 탈출구다.'],
  },

  // 🔴 본문은 `req-delegate.ts` 가 갖고 있던 것을 **내용 그대로** 옮긴 것이다(REQ-2026-166 DEC-2).
  //    문구 개선이 아니라 정본 일원화가 목적이다. 줄 정렬만 공용 렌더러를 따른다.
  'req:delegate': {
    summary: 'stopGate:"auto" 의 사전 위임 발급·철회·조회',
    intro: [
      '🔴 판단은 사람이 하고 실행은 도구가 합니다. 승인 문장을 그대로 --sentence 에 넘기세요.',
      '   시각·SHA·만료는 도구가 읽습니다(사람이 적을 자리가 없습니다).',
    ],
    usage: [
      'req:delegate --scope ticket:<REQ> --source <branch> --sentence "<승인 문장>" \\',
      '    [--allow-push] [--allow-bypass] [--high-risk] [--allow-attested] [--ttl-hours N] [--run]',
      `req:delegate --revoke <id> --reason "${PLACEHOLDER_REASON}" [--run]`,
      'req:delegate --status [--scope ticket:<REQ>]',
    ],
    options: [
      { flag: '--scope', value: 'ticket:<REQ>', sample: 'ticket:REQ-2026-000', desc: 'ticket:<REQ> 또는 delivery:<slug> — 위임 대상(접두 필수)' },
      { flag: '--source', value: '<branch>', desc: '통합 소스 브랜치. 이 브랜치에서만 통합할 수 있습니다' },
      { flag: '--sentence', value: '"<승인 문장>"', desc: '사람이 말한 승인 문장 그대로. 비면 발급하지 않습니다' },
      { flag: '--revoke', value: '<id>', desc: '발급된 위임 철회(--reason 과 함께)' },
      { flag: '--reason', value: '"<사유>"', desc: '철회 사유(기록에 남습니다)' },
      { flag: '--status', desc: '발급된 위임 조회(읽기 전용)' },
      { flag: '--allow-push', desc: 'origin push 를 함께 위임(기본 불허)' },
      { flag: '--allow-bypass', desc: 'branch protection 우회를 함께 위임(기본 불허 — 사용 시 원장·보고에 남습니다)' },
      { flag: '--high-risk', desc: 'HIGH 위험 티켓의 별도 위임(없으면 HIGH 는 통합이 막힙니다)' },
      { flag: '--ttl-hours', value: 'N', sample: '24', desc: `만료(기본 ${DEFAULT_TTL_HOURS}시간 · 최대 ${MAX_TTL_HOURS}시간)` },
      { flag: '--run', desc: '실제 기록(기본은 DRY-RUN)' },
      ROOT,
    ],
    notes: [
      '권한은 **정확히 한 번** 소비됩니다. 소비·철회·만료된 위임은 되살릴 수 없고 다시 발급해야 합니다.',
      'hardCap 도달·HIGH 미위임·BLOCKED 리뷰·증거 불일치는 위임이 있어도 통합을 막습니다.',
    ],
  },
}

/** `-h` / `--help` 를 요청했는가. */
export function wantsHelp(argv: readonly string[]): boolean {
  return argv.includes('-h') || argv.includes('--help')
}

/** 앞 줄의 이어짐인가(공백으로 시작). */
export function isContinuation(usageLine: string): boolean {
  return /^\s/.test(usageLine)
}

/** 이어짐 줄 들여쓰기 — 명령 접두어(`  npx commitgate `) 아래로 정렬한다. */
const CONT_INDENT = '      '

/** 등록부 한 항목을 사람이 읽는 본문으로. 형태는 `req:delegate` 의 현행 출력을 따른다. */
export function renderVerbHelp(verb: string): string {
  const h = REQ_VERB_HELP[verb]
  if (!h) throw new Error(`사용법이 등록되지 않은 verb: ${verb}`)
  const width = Math.max(0, ...h.options.map((o) => `${o.flag}${o.value ? ` ${o.value}` : ''}`.length))
  const lines = [
    `commitgate ${verb} — ${h.summary}`,
    ...(h.intro?.length ? ['', ...h.intro] : []),
    '',
    '사용법:',
    ...h.usage.map((u) => (isContinuation(u) ? `${CONT_INDENT}${u.trim()}` : `  npx commitgate ${u}`)),
  ]
  if (h.options.length) {
    lines.push('', '옵션:')
    for (const o of h.options) lines.push(`  ${`${o.flag}${o.value ? ` ${o.value}` : ''}`.padEnd(width)}  ${o.desc}`)
  }
  if (h.notes?.length) lines.push('', ...h.notes)
  return lines.join('\n')
}

/**
 * verb 의 `main` **첫 줄**에서 부른다: `if (helpGate('req:confirm', argv)) return`.
 *
 * 🔴 어떤 파싱·설정 읽기보다 **앞**이어야 한다. `req:review-codex` 는 옵션 파싱 前 인자 검사에서 죽으므로
 *    그 뒤에 두면 `--help` 가 여전히 오류가 된다(실측).
 */
export function helpGate(verb: string, argv: readonly string[]): boolean {
  if (!wantsHelp(argv)) return false
  console.log(renderVerbHelp(verb))
  return true
}
