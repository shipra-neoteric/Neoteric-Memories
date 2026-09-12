import { describe, expect, it } from 'vitest'
import { signKey, verifySignedKey } from '../../src/providers/storage/LocalStorageProvider.js'

describe('Signed URL verification', () => {
  it('accepts a signature that has not expired', () => {
    const exp = Date.now() + 60_000
    const sig = signKey('events/e1/photos/p1/preview.jpg', exp)
    expect(verifySignedKey('events/e1/photos/p1/preview.jpg', exp, sig)).toBe(true)
  })

  it('rejects a signature past its expiry', () => {
    const exp = Date.now() - 1000
    const sig = signKey('events/e1/photos/p1/preview.jpg', exp)
    expect(verifySignedKey('events/e1/photos/p1/preview.jpg', exp, sig)).toBe(false)
  })

  it('rejects a tampered key (signature does not match)', () => {
    const exp = Date.now() + 60_000
    const sig = signKey('events/e1/photos/p1/preview.jpg', exp)
    expect(verifySignedKey('events/e1/photos/OTHER/preview.jpg', exp, sig)).toBe(false)
  })

  it('rejects a tampered expiry', () => {
    const exp = Date.now() + 60_000
    const sig = signKey('events/e1/photos/p1/preview.jpg', exp)
    expect(verifySignedKey('events/e1/photos/p1/preview.jpg', exp + 100_000, sig)).toBe(false)
  })
})
