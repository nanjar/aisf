import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PrismaService } from '../prisma/prisma.service';

export interface UploadArtifactInput {
  artifactStageId: string;
  createdById: string; // pemilik project — root folder, sesuai laporan bug
  projectId: string;
  stageKey: string; // lowercase, mis. "backend" — dipakai sebagai namespace nama file, bukan folder utama
  fileName: string; // mis. "src/main.ts" atau "PRD.md"
  content: Buffer;
  mimeType: string;
  version?: number;
}

/**
 * S3-compatible object storage (§10 PRD V1.2). Bekerja dengan AWS S3, MinIO,
 * R2, atau Wasabi lewat endpoint yang bisa dikonfigurasi — jangan hard-code
 * ke satu provider.
 *
 * Struktur folder SESUAI LAPORAN BUG: users/{userId}/projects/{projectId}/artifacts/...
 * (bukan organizations/{orgId}/projects/{projectId}/stages/...). stageKey
 * tetap direkam sebagai prefix nama file supaya dua stage yang kebetulan
 * menghasilkan nama file sama (mis. dua-duanya bikin "README.md") tidak
 * saling timpa.
 */
@Injectable()
export class StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly provider: string;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.bucket = this.config.getOrThrow<string>('STORAGE_BUCKET');
    this.provider = this.config.get<string>('STORAGE_PROVIDER', 'minio');

    this.client = new S3Client({
      endpoint: this.config.getOrThrow<string>('STORAGE_ENDPOINT'),
      region: this.config.get<string>('STORAGE_REGION', 'us-east-1'),
      forcePathStyle: true, // wajib untuk MinIO
      credentials: {
        accessKeyId: this.config.getOrThrow<string>('STORAGE_ACCESS_KEY'),
        secretAccessKey: this.config.getOrThrow<string>('STORAGE_SECRET_KEY'),
      },
    });
  }

  buildKey(createdById: string, projectId: string, version: number, namespacedFileName: string) {
    return `asf/users/${createdById}/projects/${projectId}/artifacts/v${version}/${namespacedFileName}`;
  }

  async uploadArtifact(input: UploadArtifactInput) {
    const version = input.version ?? 1;
    const namespacedFileName = `${input.stageKey}/${input.fileName}`;
    const objectKey = this.buildKey(input.createdById, input.projectId, version, namespacedFileName);
    const checksum = createHash('sha256').update(input.content).digest('hex');

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        Body: input.content,
        ContentType: input.mimeType,
      }),
    );

    return this.prisma.artifactObject.create({
      data: {
        artifactStageId: input.artifactStageId,
        fileName: input.fileName,
        storageProvider: this.provider,
        bucket: this.bucket,
        objectKey,
        size: input.content.byteLength,
        mimeType: input.mimeType,
        checksum,
        version,
      },
    });
  }

  async getObjectStream(bucket: string, objectKey: string) {
    const result = await this.client.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey }));
    return result.Body; // Readable stream
  }

  async getPresignedDownloadUrl(bucket: string, objectKey: string, expiresInSeconds = 900) {
    const command = new GetObjectCommand({ Bucket: bucket, Key: objectKey });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }
}
