import assert from 'node:assert/strict'
import test from 'node:test'
import { parseRemoteSource } from '../server/remote-download.js'

test('远程导入只接受一个 HTTP 或 HTTPS 地址', () => {
  assert.deepEqual(parseRemoteSource('https://example.com/assets/demo.mp4'), {
    source: 'https://example.com/assets/demo.mp4',
    url: 'https://example.com/assets/demo.mp4',
  })
  assert.equal(parseRemoteSource("curl -L 'https://example.com/assets/demo.png'").url, 'https://example.com/assets/demo.png')
  assert.throws(() => parseRemoteSource('file:///etc/passwd'), /HTTP 或 HTTPS/)
  assert.throws(() => parseRemoteSource('curl https://example.com/a.mp4 https://example.com/b.mp4'), /一个 HTTP 或 HTTPS/)
  assert.throws(() => parseRemoteSource('https://user:password@example.com/a.mp4'), /用户名或密码/)
})
