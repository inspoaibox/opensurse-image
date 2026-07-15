import assert from 'node:assert/strict'
import test from 'node:test'
import {
  defaultImageProcessingSettings,
  normalizeAllowedExtensions,
  normalizeImageProcessingSettings,
  validateUploadFilename,
} from '../server/image-processing.js'
import { endpointFor } from '../server/storage.js'

test('图片处理设置会规范化扩展名并拒绝伪布尔值', () => {
  assert.deepEqual(normalizeAllowedExtensions(['.PNG', 'png', 'webp']), ['png', 'webp'])
  assert.throws(
    () => normalizeImageProcessingSettings({ enabled: 'false' }, defaultImageProcessingSettings),
    /enabled必须是布尔值/,
  )
  assert.equal(validateUploadFilename('中文图片.png', ['png']), 'png')
  assert.throws(() => validateUploadFilename(`${'a'.repeat(256)}.png`, ['png']), /255/)
})

test('对象存储 Endpoint 会区分公网与内网', () => {
  assert.equal(endpointFor('tencent-cos', { region: 'ap-guangzhou', useInternalEndpoint: true }), 'https://cos-internal.ap-guangzhou.tencentcos.cn')
  assert.equal(endpointFor('aliyun-oss', { region: 'cn-hangzhou', useInternalEndpoint: false }), 'https://s3.oss-cn-hangzhou.aliyuncs.com')
  assert.throws(() => endpointFor('s3-compatible', { endpoint: 'file:///tmp/data' }), /HTTP 或 HTTPS/)
})
