import { env } from '../../env.js'
import { NoopCaptchaProvider, UnconfiguredCaptchaProvider, type CaptchaProvider } from './CaptchaProvider.js'

export function getCaptchaProvider(): CaptchaProvider {
  if (!env.CAPTCHA_ENABLED || env.CAPTCHA_PROVIDER === 'none') return new NoopCaptchaProvider()
  return new UnconfiguredCaptchaProvider()
}
