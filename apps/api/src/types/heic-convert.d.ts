declare module 'heic-convert' {
  interface ConvertOptions {
    buffer: Buffer | ArrayBuffer | ArrayBufferView
    format: 'JPEG' | 'PNG'
    quality?: number
  }
  function convert(options: ConvertOptions): Promise<Buffer>
  export default convert
}
