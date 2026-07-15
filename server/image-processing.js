import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { extractImageMetadata } from './image-metadata.js'

export const imageOutputFormats = new Set(['original', 'jpg', 'png', 'webp', 'avif'])

export const defaultAllowedExtensions = Object.freeze(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'])

export const defaultImageProcessingSettings = Object.freeze({
  enabled: true,
  outputFormat: 'original',
  quality: 85,
  autoOrient: true,
  stripMetadata: false,
  allowedExtensions: defaultAllowedExtensions,
})

export class ImageProcessingError extends Error {
  constructor(message, status = 422) {
    super(message)
    this.name = 'ImageProcessingError'
    this.status = status
  }
}

const normalizeFormat = (value) => {
  const format = String(value || '').trim().toLowerCase().replace(/^image\//, '').replace(/^\./, '')
  if (format === 'jpeg' || format === 'jpe' || format === 'jfif') return 'jpg'
  if (format === 'tif') return 'tiff'
  return format
}

export const normalizeUploadExtension = (value) => String(value || '').trim().toLowerCase().replace(/^\.+/, '')

export const normalizeAllowedExtensions = (value, fallback = defaultAllowedExtensions) => {
  const extensions = value === undefined ? fallback : value
  if (!Array.isArray(extensions)) throw new ImageProcessingError('允许上传的文件类型必须是扩展名数组', 400)
  if (extensions.length > 32) throw new ImageProcessingError('允许上传的文件类型最多配置 32 项', 400)

  const normalized = []
  for (const item of extensions) {
    const extension = normalizeUploadExtension(item)
    if (!/^[a-z0-9]{1,12}$/.test(extension)) {
      throw new ImageProcessingError('文件扩展名只能包含 1 到 12 位字母或数字', 400)
    }
    if (!normalized.includes(extension)) normalized.push(extension)
  }
  if (!normalized.length) throw new ImageProcessingError('至少需要保留一种允许上传的文件类型', 400)
  return normalized
}

const allowedExtensionsText = (allowedExtensions) => allowedExtensions.map((extension) => extension.toUpperCase()).join('、')

export const validateUploadFilename = (filename, allowedExtensions) => {
  const normalizedFilename = String(filename || '')
  if (normalizedFilename.length > 255) throw new ImageProcessingError('文件名不能超过 255 个字符', 400)
  const extension = normalizeUploadExtension(path.extname(normalizedFilename))
  if (!extension || !allowedExtensions.includes(extension)) {
    const requested = extension ? `.${extension}` : '无扩展名'
    throw new ImageProcessingError(`不允许上传 ${requested} 文件，允许类型：${allowedExtensionsText(allowedExtensions)}`, 400)
  }
  return extension
}

const normalizeBooleanSetting = (value, fallback, label) => {
  if (value === undefined) return Boolean(fallback)
  if (typeof value !== 'boolean') throw new ImageProcessingError(`${label}必须是布尔值`, 400)
  return value
}

export const normalizeImageProcessingSettings = (input = {}, fallback = defaultImageProcessingSettings) => {
  const outputFormat = String(input.outputFormat ?? fallback.outputFormat).trim().toLowerCase()
  const quality = Number(input.quality ?? fallback.quality)
  if (!imageOutputFormats.has(outputFormat)) throw new ImageProcessingError('输出格式仅支持原格式、JPG、PNG、WebP 或 AVIF', 400)
  if (!Number.isInteger(quality) || quality < 1 || quality > 100) throw new ImageProcessingError('图片质量必须是 1 到 100 的整数', 400)
  return {
    enabled: normalizeBooleanSetting(input.enabled, fallback.enabled, 'enabled'),
    outputFormat,
    quality,
    autoOrient: normalizeBooleanSetting(input.autoOrient, fallback.autoOrient, 'autoOrient'),
    stripMetadata: normalizeBooleanSetting(input.stripMetadata, fallback.stripMetadata, 'stripMetadata'),
    allowedExtensions: normalizeAllowedExtensions(input.allowedExtensions, fallback.allowedExtensions || defaultAllowedExtensions),
  }
}

const outputExtension = (format) => `.${format === 'jpeg' ? 'jpg' : format}`

const configureOutput = (pipeline, format, quality) => {
  if (format === 'jpg') return pipeline.jpeg({ quality, mozjpeg: true })
  if (format === 'png') return pipeline.png({ compressionLevel: 9 })
  if (format === 'webp') return pipeline.webp({ quality })
  if (format === 'avif') return pipeline.avif({ quality })
  if (format === 'gif') return pipeline.gif()
  if (format === 'tiff') return pipeline.tiff({ quality })
  if (format === 'heif' || format === 'heic') return pipeline.heif({ quality })
  throw new ImageProcessingError(`当前版本不能重新编码 ${format.toUpperCase()} 原格式，请选择 JPG、PNG、WebP 或 AVIF`)
}

export const processUploadedImage = async (file, settings) => {
  const filenameExtension = validateUploadFilename(file.originalname, settings.allowedExtensions)
  const sourceMetadata = await extractImageMetadata(file.path)
  let detectedFormat = sourceMetadata.format
  if (!detectedFormat) {
    try {
      detectedFormat = (await sharp(file.path, { animated: true, failOn: 'none' }).metadata()).format
    } catch {
      // The validation below reports one consistent error for unsupported or forged files.
    }
  }
  const sourceFormat = normalizeFormat(detectedFormat)
  if (!sourceFormat) throw new ImageProcessingError('无法识别图片的真实格式，请确认文件内容完整且确实为图片', 400)
  if (normalizeFormat(filenameExtension) !== sourceFormat) {
    throw new ImageProcessingError(`文件扩展名 .${filenameExtension} 与实际图片格式 .${sourceFormat} 不一致`, 400)
  }

  const requestedFormat = settings.enabled ? settings.outputFormat : 'original'
  const targetFormat = requestedFormat === 'original' ? sourceFormat : requestedFormat
  let orientation = null
  try {
    orientation = (await sharp(file.path, { animated: true, failOn: 'none' }).metadata()).orientation || null
  } catch {
    // Unsupported Sharp inputs can still be saved unchanged when no processing is requested.
  }

  const shouldAutoOrient = settings.enabled && settings.autoOrient && Number(orientation || 1) > 1
  const shouldStripMetadata = settings.enabled && settings.stripMetadata && sourceFormat !== 'svg'
  const shouldConvert = settings.enabled && targetFormat !== sourceFormat
  const shouldReencode = shouldConvert || shouldAutoOrient || shouldStripMetadata

  if (shouldReencode) {
    const temporaryOutput = `${file.path}.processed`
    try {
      let pipeline = sharp(file.path, { animated: sourceFormat === 'gif' || sourceFormat === 'webp', failOn: 'none' })
      if (shouldAutoOrient) pipeline = pipeline.rotate()
      if (!shouldStripMetadata) {
        pipeline = pipeline.keepMetadata()
        if (shouldAutoOrient) pipeline = pipeline.withMetadata({ orientation: 1 })
      }
      pipeline = configureOutput(pipeline, targetFormat, settings.quality)
      await pipeline.toFile(temporaryOutput)
      fs.unlinkSync(file.path)
      fs.renameSync(temporaryOutput, file.path)
    } catch (error) {
      if (fs.existsSync(temporaryOutput)) fs.unlinkSync(temporaryOutput)
      if (error instanceof ImageProcessingError) throw error
      throw new ImageProcessingError(`图片处理失败：${error instanceof Error ? error.message : '无法转换图片'}`)
    }
  }

  const originalExtension = path.extname(file.originalname)
  const storedExtension = path.extname(file.filename)
  const extension = outputExtension(targetFormat)
  const originalStem = path.basename(file.originalname, originalExtension)
  const storedStem = path.basename(file.filename, storedExtension)
  file.originalname = `${originalStem}${extension}`
  file.filename = `${storedStem}${extension}`
  file.mimetype = targetFormat === 'jpg' ? 'image/jpeg' : `image/${targetFormat}`
  file.size = fs.statSync(file.path).size
  file.detectedFormat = targetFormat

  const metadata = shouldReencode ? await extractImageMetadata(file.path) : sourceMetadata
  return {
    metadata,
    processing: {
      applied: shouldReencode,
      converted: shouldConvert,
      sourceFormat,
      outputFormat: targetFormat,
      quality: settings.quality,
      autoOriented: shouldAutoOrient,
      metadataStripped: shouldStripMetadata,
    },
  }
}
