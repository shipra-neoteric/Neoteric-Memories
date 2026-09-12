import { describe, expect, it } from 'vitest'
import { encryptSecret, decryptSecret } from '../../src/lib/tokenCrypto.js'
import { signOAuthState, verifyOAuthState } from '../../src/lib/oauthState.js'
import { extractFolderId } from '../../src/providers/drive/googleDriveClient.js'

describe('tokenCrypto', () => {
  it('round-trips a secret through encrypt/decrypt', () => {
    const encrypted = encryptSecret('1//0gSomeRefreshTokenValue')
    expect(encrypted).not.toContain('1//0g')
    expect(decryptSecret(encrypted)).toBe('1//0gSomeRefreshTokenValue')
  })

  it('produces a different ciphertext each time (random IV) but still decrypts correctly', () => {
    const a = encryptSecret('same-plaintext')
    const b = encryptSecret('same-plaintext')
    expect(a).not.toBe(b)
    expect(decryptSecret(a)).toBe('same-plaintext')
    expect(decryptSecret(b)).toBe('same-plaintext')
  })

  it('rejects a tampered ciphertext', () => {
    const encrypted = encryptSecret('secret-value')
    const tampered = encrypted.slice(0, -4) + 'AAAA'
    expect(() => decryptSecret(tampered)).toThrow()
  })
})

describe('oauthState', () => {
  it('round-trips eventId through sign/verify for the same user', () => {
    const state = signOAuthState('507f1f77bcf86cd799439011', 'user-1')
    const result = verifyOAuthState(state, 'user-1')
    expect(result.eventId).toBe('507f1f77bcf86cd799439011')
  })

  it('rejects state signed for a different user (CSRF-style binding)', () => {
    const state = signOAuthState('507f1f77bcf86cd799439011', 'user-1')
    expect(() => verifyOAuthState(state, 'user-2')).toThrow()
  })

  it('rejects a tampered state payload', () => {
    const state = signOAuthState('507f1f77bcf86cd799439011', 'user-1')
    const [json, sig] = state.split('.')
    const forged = Buffer.from(JSON.stringify({ eventId: 'attacker-event', userId: 'user-1', ts: Date.now() })).toString('base64url')
    expect(() => verifyOAuthState(`${forged}.${sig}`, 'user-1')).toThrow()
    void json
  })
})

describe('extractFolderId', () => {
  it('extracts the id from a full Drive folder URL', () => {
    expect(extractFolderId('https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp?usp=sharing')).toBe('1AbCdEfGhIjKlMnOp')
  })

  it('passes through a raw id unchanged', () => {
    expect(extractFolderId('1AbCdEfGhIjKlMnOp')).toBe('1AbCdEfGhIjKlMnOp')
  })
})
