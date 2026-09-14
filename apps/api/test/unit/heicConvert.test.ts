import { describe, expect, it } from 'vitest'
import { convertHeicToJpeg } from '../../src/lib/heicConvert.js'

describe('convertHeicToJpeg', () => {
  it('returns null (does not throw) for a buffer that is not actually a valid HEIC file', async () => {
    const garbage = Buffer.from('this is not an image at all')
    const result = await convertHeicToJpeg(garbage)
    expect(result).toBeNull()
  })

  it('returns null for an empty buffer', async () => {
    const result = await convertHeicToJpeg(Buffer.alloc(0))
    expect(result).toBeNull()
  })
})
