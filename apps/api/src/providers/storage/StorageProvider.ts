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
}
