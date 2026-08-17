import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PROCEDURE_MARKER,
  PROCEDURE_STEPS,
  PROCEDURE_ANCHORS,
  PROCEDURE_ASSERTIONS,
  COMPANION_PAIRS,
  COMPANION_EXPECTED_ASYMMETRY,
  COMPANION_NOT_COMPARED,
  CLAIM_SCAN_FN,
  UPGRADE_CANONICAL_DOC,
  packagedPathForDocs,
  type ProcedureAnchor,
} from '../../scripts/req/lib/upgrade-axes'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), 'utf8')

/**
 * REQ-2026-167 — 업그레이드 **절차**의 정본.
 *
 * 🔴 **왜 필요한가**(실측): 0.22.0 → 0.25.1 을 문서대로 수행했더니 `contract-claims` 를 한 번 병합한
 *    뒤에도 조치가 남았다. 폐기 서술이 `AGENTS.md` 의 **두 자리**에 있었고, 문서는 한 번이면 끝나는
 *    것처럼 적혀 있었다. 게다가 `check` 가 인용한 문장을 그대로 grep 하면 찾을 수 없다(정규화).
 *    문서 어디에도 "언제 끝났는가"가 없었다.
 *
 * 🔴 **문구 전체를 고정하지 않는다.** 한/영 두 벌의 산문이라 사소한 수정마다 red 가 되면 사람이 가드를
 *    끈다. 고정하는 것은 **명령·순서**, 그리고 앵커마다 **규범 문장 한 줄**뿐이다.
 */

const DOCS: { rel: string; lang: 'ko' | 'en' }[] = [
  { rel: UPGRADE_CANONICAL_DOC.ko, lang: 'ko' },
  { rel: UPGRADE_CANONICAL_DOC.en, lang: 'en' },
]

const ANCHOR_IDS = Object.keys(PROCEDURE_ANCHORS) as ProcedureAnchor[]

/** 절차 구역(마커 사이). 없으면 빈 문자열. */
function procedureRegion(body: string): string {
  const i = body.indexOf(PROCEDURE_MARKER.open)
  const j = body.indexOf(PROCEDURE_MARKER.close)
  return i < 0 || j < 0 || j < i ? '' : body.slice(i + PROCEDURE_MARKER.open.length, j)
}

/**
 * 앵커가 여는 **블록** — 앵커 다음부터 **다음 앵커 또는 구역 끝**까지.
 *
 * 🔴 구역 어딘가에만 토큰이 있으면 통과하는 느슨한 검사를 하지 않기 위해서다. 토큰은 그 서술이
 *    실제로 있는 자리에 있어야 한다.
 */
function anchorBlock(region: string, anchor: ProcedureAnchor): string {
  const start = region.indexOf(PROCEDURE_ANCHORS[anchor])
  if (start < 0) return ''
  const after = start + PROCEDURE_ANCHORS[anchor].length
  const nextStarts = ANCHOR_IDS.map((a) => region.indexOf(PROCEDURE_ANCHORS[a], after)).filter((i) => i >= 0)
  const end = nextStarts.length ? Math.min(...nextStarts) : region.length
  return region.slice(after, end)
}

/** 앵커별 필수 토큰 — 규범 문장이 가리키는 대상이 그 블록 안에 실제로 있는가. */
const REQUIRED_TOKENS: Record<ProcedureAnchor, string[]> = {
  repeat: ['C5', 'npx commitgate check'],
  search: [CLAIM_SCAN_FN],
  acceptance: ['C7', 'caret-range'],
  companion: [
    ...COMPANION_PAIRS.flatMap((p) => [p.consumer, packagedPathForDocs(p.packaged)]),
    ...COMPANION_EXPECTED_ASYMMETRY,
    ...COMPANION_NOT_COMPARED,
  ],
}

describe('[upgrade-procedure] 🔴 G7 — 등록부 자체가 비어 있지 않다', () => {
  it('오라클이 공허하지 않다 — 앵커·단계가 실재한다', () => {
    expect(ANCHOR_IDS.length).toBeGreaterThan(3)
    expect(PROCEDURE_STEPS.length).toBeGreaterThan(3)
    expect(COMPANION_PAIRS.length).toBeGreaterThan(2)
  })

  it('🔴 앵커마다 규범 문장이 ko·en 둘 다 있다 — 문장을 지워 가드를 비우는 경로 차단', () => {
    for (const a of ANCHOR_IDS)
      for (const lang of ['ko', 'en'] as const) {
        const lines = PROCEDURE_ASSERTIONS[a][lang]
        expect(lines.length, `${a}.${lang}`).toBeGreaterThan(0)
        for (const l of lines) expect(l.trim().length, `${a}.${lang}`).toBeGreaterThan(20)
      }
  })

  /**
   * 🔴 design r06 P1 — 순서만 검사하면 **등록부 자체를 줄여** 가드를 비울 수 있다.
   *    `['npx commitgate check', 'npx commitgate check']` 로 등록해도 G2·G2b 는 통과하고,
   *    그 문서를 따라간 사용자는 고치는 명령을 하나도 실행하지 않는다.
   *
   * 🔴 여기서 값을 한 번 더 적는 것은 중복이 아니라 **의도한 카나리아**다. 등록부(SSOT)를 줄이거나
   *    순서를 바꾸면 이 줄이 red 가 된다 — 그때 "정말 줄여도 되는가"를 사람이 판단한다.
   */
  it('🔴 PROCEDURE_STEPS 가 규범 값과 동일하다 — 등록부를 줄여 가드를 비울 수 없다', () => {
    expect(PROCEDURE_STEPS).toEqual([
      'npx commitgate check',
      'npx commitgate sync --apply --scripts --gitignore',
      'npx commitgate quickstart --apply',
      'diff -rq .claude/skills node_modules/commitgate/skills',
      'npx commitgate check',
    ])
  })

  it('앵커 문자열이 서로 다르다(블록 경계가 겹치지 않는다)', () => {
    const vals = ANCHOR_IDS.map((a) => PROCEDURE_ANCHORS[a])
    expect(new Set(vals).size).toBe(vals.length)
  })
})

describe('[upgrade-procedure] 🔴 G4·G5 — 문서가 가리키는 것이 실재한다', () => {
  it('🔴 G4: CLAIM_SCAN_FN 이 lib/retired-claims 에서 실제로 export 된다', () => {
    expect(read('scripts/req/lib/retired-claims.ts')).toContain(`export function ${CLAIM_SCAN_FN}(`)
  })

  it('🔴 G5: companion 패키지 경로가 이 저장소에 실재한다', () => {
    for (const p of COMPANION_PAIRS) expect(existsSync(join(REPO_ROOT, p.packaged)), p.packaged).toBe(true)
  })

  it('🔴 G5: 그 경로가 npm 패키지로 배포된다 — 소비자에게 없는 경로를 비교시키지 않는다', () => {
    const files = (JSON.parse(read('package.json')) as { files: string[] }).files
    for (const p of COMPANION_PAIRS) {
      const top = p.packaged.split('/')[0] as string
      expect(files.includes(top) || files.includes(p.packaged), `${p.packaged} (files 에 없음)`).toBe(true)
    }
  })
})

describe.each(DOCS)('[upgrade-procedure] $rel', ({ rel, lang }) => {
  const body = read(rel)
  const region = procedureRegion(body)

  it('🔴 G1: 마커 쌍과 비어 있지 않은 절차 구역이 있다', () => {
    expect(body).toContain(PROCEDURE_MARKER.open)
    expect(body).toContain(PROCEDURE_MARKER.close)
    expect(region.trim().length).toBeGreaterThan(200)
  })

  it('🔴 G1: 절차 구역이 문서당 **정확히 하나**다 — 낡은 두 번째 구역을 남길 수 없다', () => {
    const count = (needle: string) => body.split(needle).length - 1
    expect(count(PROCEDURE_MARKER.open), '여는 마커').toBe(1)
    expect(count(PROCEDURE_MARKER.close), '닫는 마커').toBe(1)
  })

  it('🔴 G2: 절차 명령이 등록부 **순서 그대로** 나온다 — 진단을 뒤로 미루면 red', () => {
    let cursor = 0
    for (const step of PROCEDURE_STEPS) {
      const at = region.indexOf(step, cursor)
      expect(at, `"${step}" 가 순서대로 나오지 않는다(cursor=${cursor})`).toBeGreaterThanOrEqual(0)
      cursor = at + step.length
    }
  })

  it('🔴 G2: 첫 명령이 진단이다 — 무엇을 실행할지는 도구가 안다', () => {
    expect(PROCEDURE_STEPS[0]).toBe('npx commitgate check')
    const first = PROCEDURE_STEPS.map((s) => region.indexOf(s)).filter((i) => i >= 0)
    expect(Math.min(...first)).toBe(region.indexOf(PROCEDURE_STEPS[0] as string))
  })

  /**
   * 🔴 G2b(design r05 P1-a) — 첫 `check` 만 강제하면 **고치고 나서 다시 묻지 않는** 문서가 통과한다.
   *    그러면 조치가 남아도 사용자는 명령을 다 쳤으니 끝났다고 읽는다 — 이 REQ 를 만든 상태 그대로다.
   */
  it('🔴 G2b: 마지막 단계가 다시 `check` 이고, companion 대조 **뒤**에 온다', () => {
    const last = PROCEDURE_STEPS[PROCEDURE_STEPS.length - 1]
    expect(last).toBe('npx commitgate check')
    const companionAt = region.indexOf('diff -rq .claude/skills node_modules/commitgate/skills')
    expect(companionAt, 'companion 대조가 없다').toBeGreaterThanOrEqual(0)
    const finalCheckAt = region.indexOf('npx commitgate check', companionAt)
    expect(finalCheckAt, '고친 뒤 다시 묻는 check 가 없다').toBeGreaterThan(companionAt)
  })

  describe.each(ANCHOR_IDS)('🔴 G3 — 앵커 %s', (anchor) => {
    const block = anchorBlock(region, anchor)

    it('앵커가 구역 안에 있다', () => {
      expect(region).toContain(PROCEDURE_ANCHORS[anchor])
      expect(block.trim().length, '블록이 비어 있다').toBeGreaterThan(0)
    })

    it('🔴 규범 문장을 **글자 그대로** 싣는다', () => {
      for (const sentence of PROCEDURE_ASSERTIONS[anchor][lang])
        expect(block, `${anchor}/${lang} 규범 문장이 없다`).toContain(sentence)
    })

    it('🔴 규범 문장이 가리키는 대상이 같은 블록 안에 있다', () => {
      for (const token of REQUIRED_TOKENS[anchor]) expect(block, `${anchor} 토큰 ${token}`).toContain(token)
    })
  })
})

/**
 * REQ-2026-167 DEC-4 — 리뷰어 출력 스키마의 **안내 공백**.
 *
 * 🔴 실측: 이 REQ 의 phase-3 리뷰가 자기모순 응답 3회로 BLOCKED 됐다 —
 *    `status=STEP_COMPLETE` 인데 `merge_ready=yes`. 교차 규칙(`review-codex.ts` 의 `validateVerdict`)은
 *    있었지만 **리뷰어가 받는 스키마에 그 규칙이 없었다**. `merge_ready` 만 `description` 이 없었다.
 *
 * 🔴 검증 규칙은 손대지 않는다. 게이트는 옳게 거부했다 — 바뀌는 것은 규칙이 **전달되는가**뿐이다.
 */
describe('[machine-schema] 🔴 판정에 쓰이는 필드는 리뷰어에게 규칙을 알려 준다', () => {
  const schema = JSON.parse(read('workflow/machine.schema.json')) as {
    properties: Record<string, { description?: string; enum?: string[] }>
  }

  it('오라클이 공허하지 않다 — 스키마에 필드가 실재한다', () => {
    expect(Object.keys(schema.properties).length).toBeGreaterThan(5)
  })

  it('🔴 교차 검사에 쓰이는 필드에 description 이 있다', () => {
    // `validateVerdict` 가 서로 모순을 보는 세 필드. 규칙을 아는 쪽과 답하는 쪽이 갈리면 안 된다.
    for (const field of ['commit_approved', 'merge_ready', 'status'])
      expect(schema.properties[field]?.description?.trim().length ?? 0, `${field} description`).toBeGreaterThan(40)
  })

  it('🔴 merge_ready 설명이 교차 규칙과 "마지막 phase 여도 no" 를 말한다', () => {
    const d = schema.properties['merge_ready']?.description ?? ''
    expect(d).toContain('COMPLETE')
    expect(d).toContain('commit_approved')
    // 이 REQ 를 막은 정확한 상황 — 마지막 phase 의 STEP_COMPLETE.
    expect(d).toContain('STEP_COMPLETE')
    expect(d.toLowerCase()).toContain('last phase')
  })

  it('🔴 그 규칙이 도구의 실제 검사와 같은 것을 말한다', () => {
    const src = read('scripts/req/review-codex.ts')
    expect(src).toContain("v.merge_ready === 'yes' && v.status !== 'COMPLETE'")
    expect(src).toContain("v.merge_ready === 'yes' && v.commit_approved !== 'yes'")
  })
})
