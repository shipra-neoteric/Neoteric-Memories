import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { env } from '../../env.js'
import { assertNotTestRuntime } from '../../lib/testGuard.js'
import type { PutObjectInput, StorageProvider } from './StorageProvider.js'

/** Production storage adapter for AWS S3 or any S3-compatible endpoint (MinIO, R2, etc). */
export class S3StorageProvider implements StorageProvider {
  private client: S3Client
  private bucket: string

  constructor() {
    assertNotTestRuntime('S3StorageProvider')
    if (!env.S3_BUCKET || !env.S3_REGION) {
      throw new Error('S3_BUCKET and S3_REGION must be set when STORAGE_PROVIDER=s3')
    }
    this.bucket = env.S3_BUCKET
    this.client = new S3Client({
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: !!env.S3_ENDPOINT,
      credentials:
        env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
          ? { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY }
          : undefined,
    })
  }

  async putObject({ key, body, contentType }: PutObjectInput): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType })
    )
  }

  async getObject(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }))
    const chunks: Buffer[] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for await (const chunk of res.Body as any) chunks.push(Buffer.from(chunk))
    return Buffer.concat(chunks)
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }))
  }

  async deleteObjects(keys: string[]): Promise<void> {
    if (keys.length === 0) return
    const chunks: string[][] = []
    for (let i = 0; i < keys.length; i += 1000) chunks.push(keys.slice(i, i + 1000))
    for (const chunk of chunks) {
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: chunk.map((Key) => ({ Key })) },
        })
      )
    }
  }

  async objectExists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }))
      return true
    } catch {
      return false
    }
  }

  async getSignedDownloadUrl(key: string, ttlSeconds: number, opts?: { downloadFilename?: string }): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: opts?.downloadFilename
        ? `attachment; filename="${opts.downloadFilename.replace(/["\\]/g, '')}"`
        : undefined,
    })
    return getSignedUrl(this.client, command, { expiresIn: ttlSeconds })
  }

  async getSignedUploadUrl(key: string, ttlSeconds: number, contentType: string): Promise<{ url: string; headers: Record<string, string> }> {
    const command = new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType })
    const url = await getSignedUrl(this.client, command, { expiresIn: ttlSeconds })
    // The signature covers Content-Type, so the client's actual PUT must send exactly
    // this header or S3 will reject it with a signature mismatch.
    return { url, headers: { 'Content-Type': contentType } }
  }
}
