/**
 * 전송 전 secret scan(REQ-2026-120) — 패턴별 탐지·마스킹·오탐 무탐·게이트 정책.
 * 🔴 실제 비밀을 픽스처에 쓰지 않는다 — 형식만 맞는 합성 값이다.
 */
import { describe, it, expect } from 'vitest'
import { scanSecrets, secretScanGate } from '../../scripts/req/lib/secret-scan'
import { promptSizeGate } from '../../scripts/req/review-codex'

/**
 * 형식만 유효한 합성 픽스처(실제 자격증명 아님).
 * 🔴 전부 **분할 구성**이다 — 이 파일 자체가 리뷰 staged diff에 실리므로, 소스에 연접 리터럴을 쓰면
 *    새 스캔이 우리 자신의 리뷰를 차단한다(게이트가 자기를 막은 A-2a 도그푸딩 전례). 런타임 값만 형식을 만족한다.
 */
const FIXTURES: Record<string, string> = {
  'pem-private-key': ['-----BEGIN RSA', 'PRIVATE KEY-----'].join(' '),
  'aws-access-key(AKIA)': 'AKIA' + 'ABCDEFGH12345678',
  'aws-access-key(ASIA)': 'ASIA' + 'ABCDEFGH12345678', // temporary credential — 설계 r01 P1
  'github-token(ghp)': 'ghp_' + 'a'.repeat(36),
  'github-token(gho)': 'gho_' + 'b'.repeat(36), // OAuth — 설계 r01 P1
  'github-token(ghu)': 'ghu_' + 'c'.repeat(36),
  'github-token(ghs)': 'ghs_' + 'd'.repeat(36),
  'github-token(ghr)': 'ghr_' + 'e'.repeat(36),
  'github-token(pat)': 'github_pat_' + 'f'.repeat(30),
  'slack-token(xoxb)': 'xoxb-' + '1234567890-abcdef',
  'slack-token(xapp)': 'xapp-1-' + 'A1234567890-abc', // app-level — 설계 r02 P1
  'google-api-key': 'AIza' + 'A'.repeat(35),
  'openai-key': 'sk-' + 'a1B2'.repeat(10),
  jwt: 'eyJ' + 'hbGciOiJIUzI1NiJ9' + '.eyJ' + 'zdWIiOiIxIn0',
}

describe('scanSecrets — 패턴별 탐지(모든 접두 변형)', () => {
  for (const [label, value] of Object.entries(FIXTURES)) {
    it(`${label} 를 감지한다`, () => {
      const findings = scanSecrets(`diff --git a/x b/x\n+const key = "${value}"\n`)
      expect(findings.length).toBeGreaterThan(0)
    })
  }

  it('마스킹은 앞 6자 + … — 원문 전체를 담지 않는다', () => {
    const value = FIXTURES['github-token(ghp)']!
    const [f] = scanSecrets(value)
    expect(f!.masked).toBe(`${value.slice(0, 6)}…`)
    expect(f!.masked.length).toBeLessThan(10)
    expect(JSON.stringify(f)).not.toContain(value)
  })

  it('복수 매치를 전부 센다(위치 순)', () => {
    const text = `${FIXTURES['aws-access-key(AKIA)']} 중간 ${FIXTURES['github-token(ghp)']}`
    const findings = scanSecrets(text)
    expect(findings).toHaveLength(2)
    expect(findings[0]!.index).toBeLessThan(findings[1]!.index)
  })

  it('오탐하지 않는다 — hex SHA(40/64)·UUID·일반 코드·이 저장소류 문서 경로(완료 기준 4)', () => {
    const benign = [
      'a'.repeat(40), // git SHA-1
      'deadbeef'.repeat(8), // SHA-256 hex
      '123e4567-e89b-12d3-a456-426614174000', // UUID
      'const password = process.env.DB_PASSWORD', // 참조는 비밀이 아니다
      'skills/commitgate-quality/SKILL.md', // sk- 아님(경계)
      'export function ghost_writer(): void {}', // gh 접두 유사
      'AKIAlowercase1234567', // 소문자 섞임 — AWS 형식 아님
      'eyJustAWord.notjwt', // JWT 형식 미달
    ].join('\n')
    expect(scanSecrets(benign)).toEqual([])
  })
})

describe('secretScanGate — 정책(설계 DEC-2·DEC-3)', () => {
  const dirty = `+key = "${FIXTURES['aws-access-key(AKIA)']}"`

  it("block(기본): verdict=block + 메시지에 패턴명·마스킹·예산 미차감 명시·원문 부재", () => {
    const r = secretScanGate(dirty, 'block')
    expect(r.verdict).toBe('block')
    expect(r.message).toContain('aws-access-key')
    expect(r.message).toContain('예산도 차감되지 않았습니다')
    expect(r.message).not.toContain(FIXTURES['aws-access-key(AKIA)']!)
  })
  it("warn: verdict=warn — 배선은 경고 후 진행한다(완료 기준 3)", () => {
    const r = secretScanGate(dirty, 'warn')
    expect(r.verdict).toBe('warn')
    expect(r.message).toContain('전송을 계속')
  })
  it("off: 스캔하지 않는다 — findings 자체가 비어 있다", () => {
    const r = secretScanGate(dirty, 'off')
    expect(r).toEqual({ verdict: 'pass', findings: [], message: null })
  })
  it('깨끗한 프롬프트는 pass·메시지 없음', () => {
    expect(secretScanGate('regular diff content', 'block').verdict).toBe('pass')
  })
})

describe('promptSizeGate — 크기 표면(REQ-2026-120 phase-2·설계 DEC-4)', () => {
  const gate = (totalBytes: number, warnBytes: number, maxBytes: number | null) =>
    promptSizeGate({ totalBytes, personaBytes: 100, payloadBytes: 200, warnBytes, maxBytes })

  it('warn 경계: 임계와 같으면 pass, +1이면 warn(전송은 진행 — 완료 기준 5)', () => {
    expect(gate(1000, 1000, null).verdict).toBe('pass')
    expect(gate(1001, 1000, null).verdict).toBe('warn')
  })
  it('warn 메시지에 구성 분해가 있고 분해 합 = 전체(완료 기준 5)', () => {
    const r = promptSizeGate({ totalBytes: 300 * 1024, personaBytes: 50 * 1024, payloadBytes: 200 * 1024, warnBytes: 262144, maxBytes: null })
    expect(r.verdict).toBe('warn')
    // 분해: persona 50KB · 본문 200KB · 문맥 = 300-50-200 = 50KB
    expect(r.message).toContain('persona 50KB')
    expect(r.message).toContain('본문 200KB')
    expect(r.message).toContain('문맥 50KB')
  })
  it('max 초과 → block + 절단 없음·축소 안내(완료 기준 6)', () => {
    const r = gate(2000, 262144, 1000)
    expect(r.verdict).toBe('block')
    expect(r.message).toContain('절단하지 않습니다')
    expect(r.message).toContain('예산도 차감되지 않았습니다')
  })
  it('max < warn 조합은 유효한 정책이다 — max 우선 차단·설정 오류 아님(설계 r01 P1)', () => {
    // warn=256KiB(기본) 유지 + max=1KB의 작은 전송 예산: 2KB 프롬프트는 config 오류가 아니라 max 차단.
    expect(gate(2048, 262144, 1024).verdict).toBe('block')
    // max 이내면 pass(warn 임계 미달) — 두 정책이 독립적으로 동작한다.
    expect(gate(512, 262144, 1024).verdict).toBe('pass')
  })
  it('max 이내·warn 초과면 warn만(중복 신호 없음)', () => {
    expect(gate(1500, 1000, 4096).verdict).toBe('warn')
  })
})
