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
 * **OID 로** 배치 읽기(REQ-2026-169 DEC-4). 반환 Map 의 키는 요청한 oid.
 *
 * 🔴 **왜 `<ref>:<path>` 가 아니라 oid 인가**: `<ref>:<path>` 는 요청마다 트리를 되짚으므로 요청 수가
 *    많아지면 비용이 급격히 는다. 같은 저장소·같은 1,608 blob 을 읽는 데:
 *
 *    | 요청 형식 | `cat-file --batch` 소요 |
 *    |---|---|
 *    | `HEAD:<path>` (`readBlobsAtRef`) | 5,859 ms |
 *    | oid (`ls-tree -r` 가 준 값)      |   199 ms |
 *
 *    intake 스캔은 `ls-tree -r` 로 이미 oid 를 들고 있으므로 추가 비용 없이 이 경로를 쓴다.
 *
 * 🔴 **정정(REQ-2026-176)**: REQ-2026-169 당시 이 자리에 *"경로만 아는 호출부
 *    (`verify-range`·`report`·`integrate`)는 요청 집합이 작아 대상이 아니다"* 라고 적었다.
 *    **실측이 반증했다.** 그쪽이 요청하는 경로 수는 `누적 티켓 수 × 2`(manifest + state)이고
 *    범위 크기와 무관하다 — 이 저장소 166티켓에서 332경로, 581ms 대 88ms(6.6배·콜드 17.9배).
 *    그래서 `collectDeepInput` 도 OID 로 읽는다. 세지 않고 "작다"고 적으면 다음 사람이
 *    같은 오판을 물려받는다.
 *
 * 🔴 **중복 oid 는 미리 접는다.** 같은 내용의 파일이 여러 경로에 있으면 oid 가 같다. 접지 않아도
 *    프로토콜상 요청 수만큼 응답이 오므로 파싱은 맞지만, 같은 blob 을 여러 번 전송받을 이유가 없다.
 */
export function readBlobsByOid(cwd: string, oids: readonly string[]): Map<string, Buffer | null> {
  const unique = [...new Set(oids)]
  if (unique.length === 0) return new Map()
  const res = spawn.sync('git', ['cat-file', '--batch'], {
    cwd,
    input: `${unique.join('\n')}\n`,
    maxBuffer: 256 * 1024 * 1024,
  })
  if (res.error) throw res.error
  if (res.status !== 0) throw new Error(`git cat-file --batch 실패(exit=${res.status ?? 'null'})`)
  return parseCatFileBatchOutput(res.stdout as Buffer, unique)
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
