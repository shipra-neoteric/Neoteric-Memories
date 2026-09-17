export interface PutObjectInput {
  key: string
  body: Buffer
  contentType: string
}

/**
 * Storage abstraction so the rest of the app never talks to S3 or the filesystem
 * directly. Objects are always private — there is no public-URL mode. Every read
 * goes through a short-lived signed URL.
 */
export interface StorageProvider {
  putObject(input: PutObjectInput): Promise<void>
  getObject(key: string): Promise<Buffer>
  deleteObject(key: string): Promise<void>
  deleteObjects(keys: string[]): Promise<void>
  objectExists(key: string): Promise<boolean>
  /** Returns a time-limited URL a guest's browser can fetch directly. */
  getSignedDownloadUrl(key: string, ttlSeconds: number, opts?: { downloadFilename?: string }): Promise<string>
  /**
   * Returns a time-limited URL an admin's browser can PUT a file's bytes to directly
   * — used so an upload never has to pass through the API's own serverless function,
   * which (on Vercel) hard-rejects any request body over ~4.5MB regardless of our own
   * code (see modules/photos/router.ts's presign/finalize routes for the flow this
   * enables). `headers` are whatever the caller must set on that PUT request for the
   * signature to validate (at minimum Content-Type).
   */
  getSignedUploadUrl(key: string, ttlSeconds: number, contentType: string): Promise<{ url: string; headers: Record<string, string> }>
}
