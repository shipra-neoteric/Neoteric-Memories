export type SniffedImageType = 'jpeg' | 'png' | 'heic' | 'unknown'

/**
 * Magic-byte sniffing — never trust the client-supplied MIME type or file extension
 * alone (a classic upload-validation bypass). HEIC is detected and explicitly
 * rejected with an actionable message rather than silently mis-processed — see
 * docs/ARCHITECTURE.md for why HEIC->JPEG conversion isn't wired up in L1.
 */
export function sniffImageType(buffer: Buffer): SniffedImageType {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg'
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'png'
  }
  if (buffer.length >= 12) {
    const boxType = buffer.subarray(4, 8).toString('ascii')
    const brand = buffer.subarray(8, 12).toString('ascii')
    if (boxType === 'ftyp' && ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand)) return 'heic'
  }
  return 'unknown'
}

export function extensionForType(type: SniffedImageType): string {
  return type === 'png' ? 'png' : 'jpg'
}
