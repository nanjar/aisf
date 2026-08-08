import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import type { Readable } from 'stream';

// V1.1.2: wrapper generik untuk object storage S3-compatible. Bekerja dengan AWS S3 asli
// maupun provider S3-compatible lain (Biznet Gio NEO Object Storage, MinIO, Cloudflare R2,
// dst) selama endpoint + forcePathStyle diisi benar di .env.
@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(private readonly config: ConfigService) {
    this.bucket = this.config.getOrThrow<string>('S3_BUCKET');
    this.client = new S3Client({
      region: this.config.get<string>('S3_REGION') ?? 'us-east-1',
      endpoint: this.config.getOrThrow<string>('S3_ENDPOINT'),
      // Kebanyakan provider S3-compatible non-AWS (termasuk Biznet Gio NEO) butuh path-style
      // (https://endpoint/bucket/key), bukan virtual-hosted-style (https://bucket.endpoint/key).
      forcePathStyle: this.config.get<string>('S3_FORCE_PATH_STYLE') !== 'false',
      credentials: {
        accessKeyId: this.config.getOrThrow<string>('S3_ACCESS_KEY_ID'),
        secretAccessKey: this.config.getOrThrow<string>('S3_SECRET_ACCESS_KEY'),
      },
    });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
      if (status === 404 || (err as { name?: string })?.name === 'NotFound') return false;
      this.logger.error(`Gagal cek keberadaan object "${key}"`, err as Error);
      throw err;
    }
  }

  async upload(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async getBuffer(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const stream = res.Body as Readable;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
}
