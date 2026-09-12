import type { Request } from 'express'
import { hashDeviceFingerprint, hashIp } from './hash.js'

export function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? '0.0.0.0'
}

export function clientIpHash(req: Request): string {
  return hashIp(clientIp(req))
}

/** Device fingerprint is client-supplied (header) + IP + UA, hashed together — good enough to rate-limit/correlate abuse in L1 without any invasive fingerprinting library. */
export function clientDeviceHash(req: Request): string {
  const supplied = req.header('x-device-id') ?? ''
  const ua = req.header('user-agent') ?? ''
  return hashDeviceFingerprint(`${supplied}:${ua}:${clientIp(req)}`)
}
