import { Injectable, Logger } from '@nestjs/common';
import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

/**
 * §11.3 PRD V1.2 — validasi WAJIB jalan di lingkungan terisolasi/ephemeral,
 * tidak pernah di container produksi backend/frontend. Service ini cuma
 * urus materialize file ke direktori sementara; sandboxing docker run yang
 * sesungguhnya ada di validator per-bahasa.
 */
@Injectable()
export class SandboxService {
  private readonly logger = new Logger(SandboxService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async materialize(artifactStageId: string, version: number): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'asf-validate-'));
    const files = await this.prisma.artifactObject.findMany({ where: { artifactStageId, version } });

    for (const file of files) {
      const targetPath = join(dir, file.fileName);
      await mkdir(dirname(targetPath), { recursive: true });

      const stream = await this.storage.getObjectStream(file.bucket, file.objectKey);
      const chunks: Buffer[] = [];
      for await (const chunk of stream as any) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      await writeFile(targetPath, Buffer.concat(chunks));
    }

    this.logger.log(`Materialized ${files.length} file ke ${dir}`);
    return dir;
  }

  async cleanup(dir: string) {
    await rm(dir, { recursive: true, force: true });
  }
}
