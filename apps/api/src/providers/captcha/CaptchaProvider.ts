export interface CaptchaProvider {
  verify(token: string | undefined, remoteIp: string): Promise<boolean>
}

/** Always passes — CAPTCHA is disabled by default per the L1 spec (compensating controls are rate limiting + session/device counters instead). Flip CAPTCHA_ENABLED + CAPTCHA_PROVIDER when a real key is available; the guest routes already call through this interface so no route code changes when it's turned on. */
export class NoopCaptchaProvider implements CaptchaProvider {
  async verify(): Promise<boolean> {
    return true
  }
}

/** Skeleton for Google reCAPTCHA / Cloudflare Turnstile — implement the HTTP verify call when CAPTCHA_ENABLED=true and a secret key is configured. Left unimplemented intentionally rather than half-wired. */
export class UnconfiguredCaptchaProvider implements CaptchaProvider {
  async verify(): Promise<boolean> {
    throw new Error('CAPTCHA_ENABLED is true but no concrete provider implementation is wired up yet.')
  }
}
