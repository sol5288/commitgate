/**
 * 전송 전 secret scan (REQ-2026-120) — **조립 프롬프트 전체를 고신뢰 결정적 패턴으로 검사**.
 *
 * `req:review-codex`는 staged diff·설계 문서 전문을 외부(OpenAI)로 전송한다. 유출은 비가역이므로
 * 전송 직전의 **최종 문자열 하나**를 검사한다 — diff·문서·persona를 따로 스캔하면 조립 경로가
 * 늘 때마다 구멍이 생기지만, 최종 문자열을 보면 "전송되는 것 = 스캔된 것"이 구조적으로 보장된다
 * (설계 DEC-1).
 *
 * 🔴 **고신뢰 패턴만** — 오탐 근접 0이 선정 기준이다. 엔트로피·`password=` 류 휴리스틱은 경고
 *    피로를 만들므로 제외(확장은 데이터 후). 이 목록이 못 잡는 비밀은 얼마든지 있다 — 육안 확인
 *    의무(AGENTS §6)는 그대로다. 보호를 과대 서술하지 말 것.
 * 🔴 본문을 재작성·마스킹해서 전송하지 않는다 — 검사는 **전송 여부**만 정한다(승인 바인딩 보존).
 * 🔴 순수 모듈 — fs·git·config를 모른다.
 */

export interface SecretFinding {
  pattern: string
  /** 매치 앞 6자 + '…' — 차단 메시지가 비밀을 재출력하는 표면이 되지 않게 한다. */
  masked: string
  index: number
}

/**
 * 고신뢰 패턴(설계 DEC-1 — r01·r02 P1로 AWS temporary(ASIA)·GitHub 전 접두(gho/ghu/ghs/ghr)·
 * Slack app-level(xapp) 포함). 전부 `g` 플래그 — 한 프롬프트의 복수 매치를 모두 센다.
 */
const PATTERNS: readonly { name: string; re: RegExp }[] = [
  { name: 'pem-private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { name: 'aws-access-key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { name: 'github-token', re: /\b(?:gh[opsur]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{22,})\b/g },
  { name: 'slack-token', re: /\b(?:xox[baprs]-[A-Za-z0-9-]{10,}|xapp-[0-9]-[A-Za-z0-9-]{10,})\b/g },
  { name: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: 'openai-key', re: /\bsk-[A-Za-z0-9_-]{32,}\b/g },
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\b/g },
]

export function scanSecrets(text: string): SecretFinding[] {
  const findings: SecretFinding[] = []
  for (const { name, re } of PATTERNS) {
    re.lastIndex = 0 // g 플래그 정규식은 상태를 가진다 — 호출 간 오염 방지.
    for (const m of text.matchAll(re)) {
      findings.push({ pattern: name, masked: `${m[0].slice(0, 6)}…`, index: m.index ?? 0 })
    }
  }
  return findings.sort((a, b) => a.index - b.index)
}

export type SecretScanPolicy = 'block' | 'warn' | 'off'

export interface SecretScanGateResult {
  verdict: 'pass' | 'warn' | 'block'
  findings: SecretFinding[]
  /** 사용자에게 보여줄 메시지(pass면 null). block 메시지는 예산 미차감 사실을 명시한다. */
  message: string | null
}

/**
 * 전송 게이트 판정(순수 — 설계 DEC-2·DEC-3). 배선은 이 결과의 `verdict`만 해석한다:
 * `block` → throw(원장 attempt-opened **전** — 예산 미차감) · `warn` → 경고 출력 후 진행 · `pass` → 진행.
 */
export function secretScanGate(prompt: string, policy: SecretScanPolicy): SecretScanGateResult {
  if (policy === 'off') return { verdict: 'pass', findings: [], message: null }
  const findings = scanSecrets(prompt)
  if (findings.length === 0) return { verdict: 'pass', findings, message: null }
  const list = findings.map((f) => `  - ${f.pattern}: ${f.masked}`).join('\n')
  const head = `리뷰 프롬프트에서 고신뢰 secret 패턴 ${findings.length}건 감지:\n${list}`
  if (policy === 'block')
    return {
      verdict: 'block',
      findings,
      message:
        `${head}\n리뷰를 실행하지 않았고 예산도 차감되지 않았습니다. staged에서 비밀을 제거하십시오.` +
        ` 오탐이라면 req.config.json 의 secretScan 을 'warn' 또는 'off' 로 바꿀 수 있습니다.`,
    }
  return { verdict: 'warn', findings, message: `${head}\nsecretScan:'warn' 설정이라 전송을 계속합니다.` }
}
