/**
 * git blob 배치 리더 (REQ-2026-127 DEC-2) — `git cat-file --batch` **프로세스 1개**로 여러 경로를 읽는다.
 *
 * 존재 이유: 경로당 `git show` 1프로세스(N+1)가 report 실측 ~29초의 원인이었다(REQ-2026-124 관측 →
 * REQ-2026-128이 이 모듈을 재사용한다). verify-range 심층 검증(아카이브 해시 대조)도 같은 접근을 쓴다.
 *
 * 🔴 프레이밍은 **Buffer 기준**이다 — 응답 JSON에 한글(멀티바이트)이 실재하므로 utf8 문자열 인덱스로
 *    size를 세면 깨진다. 파서는 순수 함수로 분리해 단위 테스트한다.
 */
import spawn from 'cross-spawn'

/**
 * `git cat-file --batch` 출력 파싱(순수). 요청 순서대로 결과가 온다는 프로토콜 전제를 그대로 쓴다.
 *
 * 프레임: `<oid> <type> <size>\n<raw bytes><\n>` 또는 `<object-name> missing\n`
 * (ambiguous 등 오류 행도 missing과 같은 "한 줄" 형태 — 값 null로 처리).
 */
export function parseCatFileBatchOutput(out: Buffer, requests: readonly string[]): Map<string, Buffer | null> {
  const result = new Map<string, Buffer | null>()
  let off = 0
  for (const req of requests) {
    if (off >= out.length) {
      result.set(req, null) // 출력 조기 종료 — 읽기 실패로 취급(단정 금지)
      continue
    }
    const nl = out.indexOf(0x0a, off)
    if (nl === -1) {
      result.set(req, null)
      off = out.length
      continue
    }
    const header = out.subarray(off, nl).toString('utf8')
    off = nl + 1
    const m = /^([0-9a-f]{40,64}) (\S+) (\d+)$/.exec(header)
    if (m === null) {
      // `<name> missing` / `<name> ambiguous` 등 — 본문 없음.
      result.set(req, null)
      continue
    }
    const size = Number(m[3])
    if (off + size > out.length) {
      result.set(req, null)
      off = out.length
      continue
    }
    result.set(req, out.subarray(off, off + size))
    off += size + 1 // 본문 뒤 LF 1바이트
  }
  return result
}

/**
 * `<ref>:<path>`들을 배치로 읽는다. 반환 Map의 키는 **요청한 path**(repo-상대·POSIX 구분자).
 * missing·오류 경로는 null. spawn 실패(git 부재 등)는 throw(호출부가 검증 불가로 처리).
 */
export function readBlobsAtRef(cwd: string, ref: string, paths: readonly string[]): Map<string, Buffer | null> {
  if (paths.length === 0) return new Map()
  const requests = paths.map((p) => `${ref}:${p}`)
  const res = spawn.sync('git', ['cat-file', '--batch'], {
    cwd,
    input: `${requests.join('\n')}\n`,
    maxBuffer: 256 * 1024 * 1024,
  })
  if (res.error) throw res.error
  if (res.status !== 0) throw new Error(`git cat-file --batch 실패(exit=${res.status ?? 'null'})`)
  const byRequest = parseCatFileBatchOutput(res.stdout as Buffer, requests)
  const byPath = new Map<string, Buffer | null>()
  paths.forEach((p, i) => byPath.set(p, byRequest.get(requests[i] as string) ?? null))
  return byPath
}
