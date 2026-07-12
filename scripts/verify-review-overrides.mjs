#!/usr/bin/env node
/**
 * REQ-2026-013 P1 — 리뷰 모델·추론강도 override **실효성** live 검증(수동/smoke).
 *
 * arg-캡처 단위 테스트(tests/unit/req-adapters.test.ts)는 도구가 `-c` 를 **넘기는지**만 본다.
 * codex가 그 override를 **존중하는지**(무시하고 전역 상속하지 않는지)는 live로만 확인된다 —
 * 자기-리뷰 성공은 "적용"과 "무시하고 ultra 상속"을 구분 못 하기 때문(설계 D7).
 *
 * 그래서 **bogus 값**을 주고 codex가 **거부**하면 override가 codex에 도달·해석됐다는 증거다:
 *   - bogus model → `... model is not supported` / `Model metadata for ... not found`
 *   - bogus effort → `[reasoning.effort] [invalid_enum_value]`
 * exec·resume 두 경로 각각에 대해 확인한다(어댑터가 `-c` 를 양쪽에 주입하므로).
 *
 * ⚠️ 실제 codex CLI + 인증이 필요하다(CI 게이트 아님 — 로컬/수동 실행). exit 0 = 4/4 통과.
 * 사용: `node scripts/verify-review-overrides.mjs`
 */
import spawn from 'cross-spawn'

const BOGUS_MODEL = '__bogus_model_xyz__'
const BOGUS_EFFORT = '__bogus_effort_xyz__'
const VALID_MODEL = 'gpt-5.6-terra'
const VALID_EFFORT = 'high'

/** 어댑터(adapters.ts:review)와 동일한 `-c` 오버라이드 조립. */
function overrideArgs(model, effort) {
  const a = []
  if (model) a.push('-c', `model="${model}"`)
  if (effort) a.push('-c', `model_reasoning_effort="${effort}"`)
  return a
}

/** codex 한 번 실행(exec 또는 resume) → { text: 합쳐진 오류 메시지, code }. cross-spawn(어댑터와 동일 spawn). */
function runCodex({ resumeThreadId, model, effort }) {
  const base = resumeThreadId
    ? ['exec', 'resume', resumeThreadId, '-c', 'sandbox_mode="read-only"', ...overrideArgs(model, effort), '--json', '-']
    : ['exec', ...overrideArgs(model, effort), '--json', '--sandbox', 'read-only', '-']
  const r = spawn.sync('codex', base, { input: 'reply with the single word ok', encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const out = (r.stdout || '') + '\n' + (r.stderr || '')
  // JSONL에서 turn.failed/error/item.completed(error)의 message를 모은다(실측 계약).
  let msgs = ''
  let threadId = null
  for (const line of out.split('\n')) {
    const t = line.trim()
    if (!t) continue
    try {
      const ev = JSON.parse(t)
      if (ev.type === 'thread.started' && typeof ev.thread_id === 'string') threadId = ev.thread_id
      if (ev.type === 'error' && typeof ev.message === 'string') msgs += ev.message + '\n'
      if (ev.type === 'turn.failed' && ev.error?.message) msgs += ev.error.message + '\n'
      if (ev.type === 'item.completed' && ev.item?.type === 'error' && ev.item?.message) msgs += ev.item.message + '\n'
    } catch {
      msgs += t + '\n' // 비-JSONL(에러 텍스트)도 포함
    }
  }
  return { text: msgs + out, code: r.status, threadId }
}

let pass = 0
let fail = 0
function check(label, cond, detail) {
  if (cond) {
    pass++
    console.log(`PASS  ${label}`)
  } else {
    fail++
    console.log(`FAIL  ${label}\n      ${detail}`)
  }
}

const modelRejected = (t) => /not supported|not found|invalid.*model|unknown model/i.test(t)
const effortRejected = (t) => /reasoning.?effort|invalid_enum_value/i.test(t)

console.log('REQ-2026-013 P1 override 실효성 live 검증 (codex CLI 필요)\n')

// 1) 유효 override로 throwaway 스레드 확보(resume 검증용).
const seed = runCodex({ resumeThreadId: null, model: VALID_MODEL, effort: VALID_EFFORT })
if (!seed.threadId) {
  console.log(`FAIL  seed exec가 thread_id를 반환하지 못함 — 유효 model/effort(${VALID_MODEL}/${VALID_EFFORT})로 실행 실패?\n      ${seed.text.slice(0, 400)}`)
  process.exit(1)
}
console.log(`(seed thread = ${seed.threadId})\n`)

// 2) exec — bogus model / bogus effort
const em = runCodex({ resumeThreadId: null, model: BOGUS_MODEL, effort: VALID_EFFORT })
check('exec  + bogus model  → codex 거부', modelRejected(em.text), em.text.slice(0, 300))
const ee = runCodex({ resumeThreadId: null, model: VALID_MODEL, effort: BOGUS_EFFORT })
check('exec  + bogus effort → codex 거부', effortRejected(ee.text), ee.text.slice(0, 300))

// 3) resume — bogus model / bogus effort (override가 resume에서도 재적용됨을 확인)
const rm = runCodex({ resumeThreadId: seed.threadId, model: BOGUS_MODEL, effort: VALID_EFFORT })
check('resume + bogus model  → codex 거부', modelRejected(rm.text), rm.text.slice(0, 300))
const re = runCodex({ resumeThreadId: seed.threadId, model: VALID_MODEL, effort: BOGUS_EFFORT })
check('resume + bogus effort → codex 거부', effortRejected(re.text), re.text.slice(0, 300))

console.log(`\n${pass}/${pass + fail} 통과`)
process.exit(fail === 0 ? 0 : 1)
