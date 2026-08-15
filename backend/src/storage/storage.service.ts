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
  createdById: string;
  projectId: string;
  stageKey: string;
  fileName: string;
  content: Buffer;
  mimeType: string;
  version?: number;
}

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
      forcePathStyle: true,
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

    // S3 PUT is idempotent for the deterministic object key above. Remove the
    // previous metadata row for the same artifact key before inserting the new
    // snapshot so repeated retries cannot accumulate duplicate ArtifactObject
    // rows for one logical file/version.
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        Body: input.content,
        ContentType: input.mimeType,
      }),
    );

    await this.prisma.artifactObject.deleteMany({ where: { objectKey } });

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
    return result.Body;
  }

  async getPresignedDownloadUrl(bucket: string, objectKey: string, expiresInSeconds = 900) {
    const command = new GetObjectCommand({ Bucket: bucket, Key: objectKey });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }
}
