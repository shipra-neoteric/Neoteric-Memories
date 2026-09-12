import { getPrisma } from '../../db.js'
import { verifyPassword } from '../../lib/password.js'
import { signAccessToken } from '../../lib/jwt.js'
import { generateSecureToken, hashToken } from '../../lib/hash.js'
import { env } from '../../env.js'
import { Errors } from '../../lib/errors.js'
import { writeAuditLog, writeSecurityEvent } from '../audit/service.js'

export interface LoginResult {
  accessToken: string
  refreshToken: string
  csrfToken: string
  user: { id: string; name: string; email: string; role: string }
}

export async function login(
  email: string,
  password: string,
  ctx: { ipHash: string; userAgent?: string }
): Promise<LoginResult> {
  const prisma = getPrisma()
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } })
  if (!user || !user.isActive) {
    await writeSecurityEvent({ type: 'AUTH_FAILURE', ipHash: ctx.ipHash, detail: { email } })
    throw Errors.unauthorized('Invalid email or password')
  }
  const valid = await verifyPassword(password, user.passwordHash)
  if (!valid) {
    await writeSecurityEvent({ type: 'AUTH_FAILURE', ipHash: ctx.ipHash, detail: { email } })
    throw Errors.unauthorized('Invalid email or password')
  }

  const refreshTokenRaw = generateSecureToken()
  await prisma.adminSession.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(refreshTokenRaw),
      userAgent: ctx.userAgent,
      ipHash: ctx.ipHash,
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_HOURS * 60 * 60 * 1000),
      // Explicitly null (not omitted) — logout()'s `revokedAt: null` filter below
      // only matches documents where the field is actually present, per Prisma's
      // MongoDB connector (see the same fix/reasoning in photos/service.ts).
      revokedAt: null,
    },
  })

  const accessToken = signAccessToken({ sub: user.id, role: user.role, name: user.name })
  await writeAuditLog({ actorId: user.id, actorRole: user.role, action: 'auth.login', entityType: 'User', entityId: user.id, ipHash: ctx.ipHash })

  return {
    accessToken,
    refreshToken: refreshTokenRaw,
    csrfToken: generateSecureToken(16),
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  }
}

export async function refresh(
  rawRefreshToken: string,
  ctx: { ipHash: string; userAgent?: string }
): Promise<LoginResult> {
  const prisma = getPrisma()
  const tokenHash = hashToken(rawRefreshToken)
  const session = await prisma.adminSession.findUnique({ where: { tokenHash } })
  if (!session || session.revokedAt || session.expiresAt < new Date()) {
    throw Errors.unauthorized('Session expired, please sign in again')
  }
  const user = await prisma.user.findUnique({ where: { id: session.userId } })
  if (!user || !user.isActive) throw Errors.unauthorized()

  // Rotate: revoke the old refresh token, issue a new one.
  await prisma.adminSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } })
  const newRefreshRaw = generateSecureToken()
  await prisma.adminSession.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(newRefreshRaw),
      userAgent: ctx.userAgent,
      ipHash: ctx.ipHash,
      expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_TTL_HOURS * 60 * 60 * 1000),
      // Explicitly null (not omitted) — logout()'s `revokedAt: null` filter below
      // only matches documents where the field is actually present, per Prisma's
      // MongoDB connector (see the same fix/reasoning in photos/service.ts).
      revokedAt: null,
    },
  })

  const accessToken = signAccessToken({ sub: user.id, role: user.role, name: user.name })
  return {
    accessToken,
    refreshToken: newRefreshRaw,
    csrfToken: generateSecureToken(16),
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  }
}

export async function logout(rawRefreshToken: string | undefined): Promise<void> {
  if (!rawRefreshToken) return
  const prisma = getPrisma()
  const tokenHash = hashToken(rawRefreshToken)
  await prisma.adminSession.updateMany({ where: { tokenHash, revokedAt: null }, data: { revokedAt: new Date() } })
}
