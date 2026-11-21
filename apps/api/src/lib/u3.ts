import {
  S3Client,
  HeadObjectCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { U3Config } from '../config.js'

/**
 * U3 (S3-compatible) helpers (§8, §14.4, §17.4).
 *
 * - Media is uploaded directly to a quarantine prefix with a presigned PUT that
 *   is constrained by content-length and content-type.
 * - The server then HEADs and streams the object to validate magic bytes, size
 *   and pixel caps before promoting it (§8.5).
 * - Logs and exports use separate buckets.
 *
 * The client is lazy so the API can boot and serve /health even when U3 env is
 * not yet configured; /ready reports U3 status.
 */

export interface PresignPutInput {
  bucket: string
  key: string
  contentType: string
  contentLength: number
  expiresSeconds?: number
}

export interface PresignGetInput {
  bucket: string
  key: string
  expiresSeconds?: number
  responseContentDisposition?: string
}

export class U3Client {
  readonly #config: U3Config
  readonly #client: S3Client | null

  constructor(config: U3Config) {
    this.#config = config
    const configured =
      config.endpoint.length > 0 && config.accessKeyId.length > 0 && config.secretAccessKey.length > 0
    this.#client = configured
      ? new S3Client({
          region: config.region,
          endpoint: config.endpoint,
          forcePathStyle: config.forcePathStyle,
          credentials: {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
          },
        })
      : null
  }

  get configured(): boolean {
    return this.#client !== null
  }

  get buckets(): { media: string; logs: string; exports: string } {
    return {
      media: this.#config.mediaBucket,
      logs: this.#config.logBucket,
      exports: this.#config.exportBucket,
    }
  }

  #require(): S3Client {
    if (!this.#client) throw new Error('U3 is not configured')
    return this.#client
  }

  async presignPut(input: PresignPutInput): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: input.bucket,
      Key: input.key,
      ContentType: input.contentType,
      ContentLength: input.contentLength,
    })
    return getSignedUrl(this.#require(), command, {
      expiresIn: input.expiresSeconds ?? this.#config.presignExpirySeconds,
    })
  }

  async presignGet(input: PresignGetInput): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: input.bucket,
      Key: input.key,
      ...(input.responseContentDisposition
        ? { ResponseContentDisposition: input.responseContentDisposition }
        : {}),
    })
    return getSignedUrl(this.#require(), command, {
      expiresIn: input.expiresSeconds ?? this.#config.presignExpirySeconds,
    })
  }

  async head(bucket: string, key: string): Promise<{ contentLength: number; contentType: string | null } | null> {
    try {
      const result = await this.#require().send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
      return {
        contentLength: result.ContentLength ?? 0,
        contentType: result.ContentType ?? null,
      }
    } catch {
      return null
    }
  }

  /** Stream an object's body for validation. Caller must consume or cancel it. */
  async getObjectStream(bucket: string, key: string): Promise<ReadableStream<Uint8Array> | null> {
    try {
      const result = await this.#require().send(new GetObjectCommand({ Bucket: bucket, Key: key }))
      const body = result.Body
      if (!body) return null
      return body.transformToWebStream()
    } catch {
      return null
    }
  }

  async putObject(
    bucket: string,
    key: string,
    body: Uint8Array | string,
    contentType: string,
  ): Promise<void> {
    await this.#require().send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    )
  }

  async deleteObject(bucket: string, key: string): Promise<void> {
    await this.#require().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
  }

  async headBucket(bucket: string): Promise<boolean> {
    try {
      await this.#require().send(new HeadBucketCommand({ Bucket: bucket }))
      return true
    } catch {
      return false
    }
  }
}
