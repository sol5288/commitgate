import { describe, it, expect } from 'vitest'
import { summarizeLockfileDiff, isLockfilePath, LOCKFILE_NAMES } from '../../scripts/req/lib/lockfile-diff'

/** REQ-2026-056 phase-1 — lockfile diff 요약(순수). */
const pkgJsonSection = `diff --git a/package.json b/package.json
index aaa1111..bbb2222 100644
--- a/package.json
+++ b/package.json
@@ -1,3 +1,3 @@
 {
-  "version": "1.0.0",
+  "version": "1.0.1",
   "name": "x"
 }`

const lockSection = (name: string): string => `diff --git a/${name} b/${name}
index ccc3333..ddd4444 100644
--- a/${name}
+++ b/${name}
@@ -1,5 +1,5 @@
 {
-  "lockfileVersion": 2,
+  "lockfileVersion": 3,
   "packages": {}
 }`

describe('[lockfile-diff] isLockfilePath', () => {
  it('정확 basename만 lockfile', () => {
    expect(isLockfilePath('package-lock.json')).toBe(true)
    expect(isLockfilePath('sub/dir/pnpm-lock.yaml')).toBe(true)
    expect(isLockfilePath('my-package-lock.json')).toBe(false) // basename 부분문자열 오탐 아님
    expect(isLockfilePath('src/index.ts')).toBe(false)
    for (const n of LOCKFILE_NAMES) expect(isLockfilePath(n)).toBe(true)
  })
})

describe('[lockfile-diff] summarizeLockfileDiff', () => {
  it('① lockfile 구획 → hunk 요약(헤더 보존·+N/-M·sha256)', () => {
    const out = summarizeLockfileDiff(lockSection('package-lock.json'), { full: false })
    expect(out).toContain('diff --git a/package-lock.json b/package-lock.json') // 헤더 보존
    expect(out).toContain('--- a/package-lock.json')
    expect(out).not.toContain('"lockfileVersion": 2') // hunk 본문 생략
    expect(out).toContain('[lockfile 전문 생략 — 요약 모드]')
    expect(out).toContain('+1/-1 lines')
    expect(/sha256\(생략분\)=[0-9a-f]{12}/.test(out)).toBe(true)
  })
  it('② 非lockfile(package.json) → 원문 그대로', () => {
    // 혼합 diff에서 package.json 부분이 그대로여야 한다(단독이면 lockfile 없어 no-op).
    const mixed = `${pkgJsonSection}\n${lockSection('package-lock.json')}`
    const out = summarizeLockfileDiff(mixed, { full: false })
    expect(out).toContain('"version": "1.0.1"') // package.json 전문 유지
  })
  it('③ 혼합 diff → package.json 전문·lockfile만 요약', () => {
    const mixed = `${pkgJsonSection}\n${lockSection('package-lock.json')}`
    const out = summarizeLockfileDiff(mixed, { full: false })
    expect(out).toContain('"version": "1.0.1"')
    expect(out).not.toContain('"lockfileVersion": 3')
    expect(out).toContain('[lockfile 전문 생략 — 요약 모드]')
  })
  it('④ full=true → 전체 passthrough', () => {
    const mixed = `${pkgJsonSection}\n${lockSection('package-lock.json')}`
    expect(summarizeLockfileDiff(mixed, { full: true })).toBe(mixed)
  })
  it('⑤ lockfile 없는 diff → 완전 no-op(입력===출력)', () => {
    expect(summarizeLockfileDiff(pkgJsonSection, { full: false })).toBe(pkgJsonSection)
    expect(summarizeLockfileDiff('', { full: false })).toBe('')
    expect(summarizeLockfileDiff('그냥 텍스트\n두 줄', { full: false })).toBe('그냥 텍스트\n두 줄')
  })
  it('⑥ binary lockfile → binary 요약', () => {
    const bin = `diff --git a/bun.lockb b/bun.lockb
index e69de29..1111111 100644
Binary files a/bun.lockb and b/bun.lockb differ`
    const out = summarizeLockfileDiff(bin, { full: false })
    expect(out).toContain('diff --git a/bun.lockb b/bun.lockb') // 헤더 보존
    expect(out).toContain('[lockfile binary 변경 — 요약 모드]')
    expect(out).not.toContain('Binary files')
  })
  it('⑦ pnpm-lock.yaml·yarn.lock·npm-shrinkwrap.json 인식', () => {
    for (const n of ['pnpm-lock.yaml', 'yarn.lock', 'npm-shrinkwrap.json']) {
      const out = summarizeLockfileDiff(lockSection(n), { full: false })
      expect(out).toContain('[lockfile 전문 생략 — 요약 모드]')
      expect(out).toContain(n)
    }
  })
  it('⑧ 하위 경로 lockfile도 요약·유사 이름은 미요약', () => {
    expect(summarizeLockfileDiff(lockSection('packages/a/package-lock.json'), { full: false })).toContain('[lockfile 전문 생략 — 요약 모드]')
    // basename이 lockfile이 아니면 요약 안 함(원문 유지).
    const notLock = lockSection('my-package-lock.json.bak')
    expect(summarizeLockfileDiff(notLock, { full: false })).toBe(notLock)
  })
  it('⑧b (r01 P1) rename — a-path만 lockfile이어도 요약(b-path 비-lockfile)', () => {
    const renamed = `diff --git a/package-lock.json b/package-lock.old
similarity index 95%
rename from package-lock.json
rename to package-lock.old
index ccc3333..ddd4444 100644
--- a/package-lock.json
+++ b/package-lock.old
@@ -1,3 +1,3 @@
 {
-  "lockfileVersion": 2,
+  "lockfileVersion": 3
 }`
    const out = summarizeLockfileDiff(renamed, { full: false })
    expect(out).toContain('[lockfile 전문 생략 — 요약 모드]')
    expect(out).toContain('rename from package-lock.json') // 헤더 보존
    expect(out).not.toContain('"lockfileVersion": 2')
  })
  it('⑧c (r01 P1) 공백/따옴표 경로 lockfile 인식', () => {
    const quoted = `diff --git "a/my dir/package-lock.json" "b/my dir/package-lock.json"
index ccc3333..ddd4444 100644
--- "a/my dir/package-lock.json"
+++ "b/my dir/package-lock.json"
@@ -1,3 +1,3 @@
 {
-  "lockfileVersion": 2,
+  "lockfileVersion": 3
 }`
    const out = summarizeLockfileDiff(quoted, { full: false })
    expect(out).toContain('[lockfile 전문 생략 — 요약 모드]')
    expect(out).not.toContain('"lockfileVersion": 2')
  })
})
