#!/usr/bin/env tsx
/**
 * commitgate quickstart — 기존 CLAUDE.md/AGENTS.md에 Quick Start 블록을 opt-in·멱등 백필 (REQ-2026-040).
 *
 * REQ-2026-039가 템플릿에 Quick Start를 넣었지만 init은 **seed-once**라 기존 파일엔 닿지 않는다. 이 모듈은
 * 마커(`<!-- commitgate:quickstart -->`) 기반으로 **관리 블록만** 삽입/치환하고 나머지 내용은 보존한다.
 * sync(whole-file copy)와 달리 read-merge-write이므로 별도 verb다(설계 D1).
 *
 * phase-1(REQ-2026-040): 순수 함수(extract/inject). CLI verb·confinement·doctor D21 배선은 phase-2.
 */

export const QUICKSTART_MARKER_OPEN = '<!-- commitgate:quickstart -->'
export const QUICKSTART_MARKER_CLOSE = '<!-- /commitgate:quickstart -->'
/** 마커 쌍(포함) 매칭. 비탐욕 — 첫 close에서 끝난다. */
const QS_RE = /<!-- commitgate:quickstart -->[\s\S]*?<!-- \/commitgate:quickstart -->/

const toLf = (s: string): string => s.replace(/\r\n/g, '\n')

/** 템플릿 본문에서 마커 포함 Quick Start 블록을 뽑는다. 부재면 null. */
export function extractQuickstartBlock(templateBody: string): string | null {
  const m = templateBody.match(QS_RE)
  return m ? m[0] : null
}

export type InjectAction = 'noop' | 'updated' | 'inserted'
export interface InjectResult {
  content: string
  action: InjectAction
  /** action==='inserted'일 때만: 삽입 위치(plan 표시용). */
  insertAt?: 'after-heading' | 'top'
}

/**
 * 파일의 **dominant** EOL(CRLF 개수 vs standalone LF 개수 비교). CRLF가 한 번 섞였다고 CRLF로 보지
 * 않는다(design-r01 P1 — LF 우세 파일에 CRLF 블록을 넣으면 혼합 줄바꿈이 된다).
 */
function dominantEol(s: string): '\r\n' | '\n' {
  const crlf = (s.match(/\r\n/g) ?? []).length
  const standaloneLf = (s.match(/\n/g) ?? []).length - crlf
  return crlf > standaloneLf ? '\r\n' : '\n'
}

/** block의 줄바꿈을 dominant EOL에 맞춘다(혼합 줄바꿈 방지). */
function matchEol(block: string, eol: '\r\n' | '\n'): string {
  const lf = toLf(block)
  return eol === '\r\n' ? lf.replace(/\n/g, '\r\n') : lf
}

/**
 * 첫 top-level `# ` heading **줄 종결자 뒤**의 오프셋. **fenced code block 안의 `# `는 제외**한다
 * (design-r01 P1). 펜스 판정은 CommonMark를 따른다(design-r02 P1): 여는 펜스의 **문자(`` ` `` / `~`)와
 * 길이**를 기억하고, **같은 문자·opening 이상 길이·info string 없는** 줄만 닫기로 본다 — 그래서
 * `` ``` `` 펜스 안의 `~~~`(또는 더 짧은 펜스)는 닫기가 아니라 코드 내용이다. heading이 없으면 null.
 */
function afterFirstHeadingOffset(s: string): number | null {
  let fenceChar: '`' | '~' | null = null // null = 펜스 밖
  let fenceLen = 0
  let i = 0
  while (i < s.length) {
    const nl = s.indexOf('\n', i)
    const lineEnd = nl === -1 ? s.length : nl
    const nextStart = nl === -1 ? s.length : nl + 1
    let line = s.slice(i, lineEnd)
    if (line.endsWith('\r')) line = line.slice(0, -1)
    if (fenceChar === null) {
      const open = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
      const fence = open?.[1]
      if (fence !== undefined) {
        // CommonMark: backtick 펜스의 info string엔 backtick이 올 수 없다(인라인 코드 오인 방지). tilde는 무관.
        const invalidBacktick = fence.charAt(0) === '`' && (open?.[2] ?? '').includes('`')
        if (!invalidBacktick) {
          fenceChar = fence.charAt(0) as '`' | '~'
          fenceLen = fence.length
        }
        // invalidBacktick이면 유효 opening 아님 — 일반 줄(``` 로 시작하니 heading도 아님).
      } else if (/^# /.test(line)) {
        return nextStart
      }
    } else {
      // 펜스 안: 같은 문자·opening 이상 길이·(trailing 공백 외)info string 없는 닫기만 닫는다.
      const close = /^ {0,3}([`~]{3,})[ \t]*$/.exec(line)?.[1]
      if (close !== undefined && close === fenceChar.repeat(close.length) && close.length >= fenceLen) {
        fenceChar = null
        fenceLen = 0
      }
    }
    i = nextStart
  }
  return null
}

/**
 * 기존 파일에 Quick Start 블록을 주입한다(순수 — IO 없음). **관리 블록(마커 사이)만** 건드리고
 * 블록 밖 내용은 바이트 보존한다.
 *   - 마커 有 & (줄바꿈 정규화 후) 동일 → `noop`.
 *   - 마커 有 & 다름 → in-place 치환(`updated`).
 *   - 마커 無 → 삽입(`inserted`). 첫 top-level `# ` heading(코드펜스 밖) **바로 뒤**, 없으면 **파일 맨 앞**.
 * 삽입 블록의 줄바꿈은 파일 dominant EOL을 따른다.
 */
export function injectQuickstart(fileContent: string, block: string): InjectResult {
  const existing = fileContent.match(QS_RE)
  const eol = dominantEol(fileContent)
  const eolBlock = matchEol(block, eol)
  if (existing) {
    if (toLf(existing[0]) === toLf(block)) return { content: fileContent, action: 'noop' }
    // 함수 replacer — block 안의 `$`가 특수치환으로 해석되지 않게 한다.
    return { content: fileContent.replace(QS_RE, () => eolBlock), action: 'updated' }
  }
  const at = afterFirstHeadingOffset(fileContent)
  if (at !== null) {
    const content = fileContent.slice(0, at) + eol + eolBlock + eol + eol + fileContent.slice(at)
    return { content, action: 'inserted', insertAt: 'after-heading' }
  }
  return { content: eolBlock + eol + eol + fileContent, action: 'inserted', insertAt: 'top' }
}
