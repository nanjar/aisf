import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import axios from 'axios';
import { OrgRole, ProjectStatus, StageKey, StageStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { DecideStageDto, AssignStageDto, SetDeadlineDto } from './dto/decide-stage.dto';

interface CallerContext {
  userId: string;
  email: string;
  memberId: string;
  role: OrgRole;
}

// Stage yang generate-nya masih pola "1 blob text per stage" (V1.1/V1.2,
// belum dimigrasikan ke file-by-file). Rollback cuma didukung untuk ini —
// UIUX/BACKEND punya puluhan file per version, restore-nya jauh lebih
// kompleks (perlu re-link banyak GenerationFile sekaligus), belum dibangun.
const BLOB_STAGES: StageKey[] = [
  StageKey.PRD,
  StageKey.ARCHITECTURE,
  StageKey.ESTIMATION,
  StageKey.DATABASE,
  StageKey.QA,
  StageKey.PACKAGE,
];

@Injectable()
export class StagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** V1.2 FR-801 — Assign Approver per Stage, sekarang ke member ATAU ke team. */
  async assign(projectId: string, stageKey: StageKey, dto: AssignStageDto, assignedBy: string) {
    const hasMember = Boolean(dto.assignedMemberId);
    const hasTeam = Boolean(dto.assignedTeamId);

    if (hasMember === hasTeam) {
      throw new BadRequestException(
        'Isi tepat satu: assignedMemberId ATAU assignedTeamId (tidak boleh dua-duanya atau kosong).',
      );
    }

    if (hasMember) {
      await this.assertMemberBelongsToProjectOrg(projectId, dto.assignedMemberId!);
    } else {
      await this.assertTeamBelongsToProjectOrg(projectId, dto.assignedTeamId!);
    }

    return this.prisma.stageAssignment.upsert({
      where: { projectId_stageKey: { projectId, stageKey } },
      update: {
        assignedMemberId: dto.assignedMemberId ?? null,
        assignedTeamId: dto.assignedTeamId ?? null,
        assignedBy,
        assignedAt: new Date(),
      },
      create: {
        projectId,
        stageKey,
        assignedMemberId: dto.assignedMemberId,
        assignedTeamId: dto.assignedTeamId,
        assignedBy,
      },
    });
  }

  /** V1.2 FR-803 — Set Stage Deadline */
  setDeadline(projectId: string, stageKey: StageKey, dto: SetDeadlineDto) {
    return this.prisma.artifactStage.update({
      where: { projectId_stageKey: { projectId, stageKey } },
      data: { deadlineAt: new Date(dto.deadlineAt) },
    });
  }

  /** V1.2 FR-1203 — revision history untuk satu stage */
  async revisions(projectId: string, stageKey: StageKey) {
    const stage = await this.prisma.artifactStage.findUniqueOrThrow({
      where: { projectId_stageKey: { projectId, stageKey } },
    });
    return this.prisma.revisionRequest.findMany({
      where: { artifactStageId: stage.id },
      orderBy: { requestedAt: 'desc' },
    });
  }

  /**
   * §Version History — daftar semua versi yang pernah ter-generate untuk
   * satu stage (baik lewat regenerate revision, maupun retry file-by-file).
   * ArtifactObject.version SUDAH otomatis increment tiap kali stage
   * regenerate (lihat webhooks.service.ts handleStageReady dan
   * uiux/backend-gen service) — fitur ini murni permukaan baca, tidak ada
   * data baru yang perlu disimpan.
   */
  async listVersions(projectId: string, stageKey: StageKey) {
    const stage = await this.prisma.artifactStage.findUniqueOrThrow({
      where: { projectId_stageKey: { projectId, stageKey } },
    });

    const [objects, revisionRequests] = await Promise.all([
      this.prisma.artifactObject.findMany({
        where: { artifactStageId: stage.id },
        orderBy: [{ version: 'desc' }, { fileName: 'asc' }],
      }),
      this.prisma.revisionRequest.findMany({ where: { artifactStageId: stage.id } }),
    ]);

    const byVersion = new Map<number, { version: number; createdAt: Date; files: { id: string; fileName: string; size: number }[] }>();
    for (const obj of objects) {
      const entry = byVersion.get(obj.version) ?? { version: obj.version, createdAt: obj.createdAt, files: [] };
      entry.files.push({ id: obj.id, fileName: obj.fileName, size: obj.size });
      if (obj.createdAt < entry.createdAt) entry.createdAt = obj.createdAt; // paling awal di antara file 1 version
      byVersion.set(obj.version, entry);
    }

    // Comment revisi (kalau ada) yang MEMICU pembuatan version berikutnya —
    // best-effort match berdasarkan urutan waktu, bukan foreign key eksplisit
    // (RevisionRequest tidak menyimpan target version secara langsung).
    const sortedRevisions = [...revisionRequests].sort((a, b) => a.requestedAt.getTime() - b.requestedAt.getTime());

    const versions = [...byVersion.values()].sort((a, b) => b.version - a.version);
    return versions.map((v, idx) => {
      // Version N dipicu oleh revision request ke- (N-2) secara berurutan (version 1 = generate pertama, tanpa revision request).
      const triggeringRevision = sortedRevisions[v.version - 2] ?? null;
      return {
        version: v.version,
        createdAt: v.createdAt,
        files: v.files,
        isCurrent: idx === 0,
        canRollback: BLOB_STAGES.includes(stageKey) && idx !== 0,
        revisionComment: triggeringRevision?.comment ?? null,
      };
    });
  }

  /** Isi (teks) semua file di satu version — dipakai UI buat "lihat"/"bandingkan". */
  async getVersionContent(projectId: string, stageKey: StageKey, version: number) {
    const stage = await this.prisma.artifactStage.findUniqueOrThrow({
      where: { projectId_stageKey: { projectId, stageKey } },
    });
    const objects = await this.prisma.artifactObject.findMany({
      where: { artifactStageId: stage.id, version },
    });
    if (objects.length === 0) throw new NotFoundException(`Version ${version} tidak ditemukan`);

    const files = await Promise.all(
      objects.map(async (obj) => {
        const stream = await this.storage.getObjectStream(obj.bucket, obj.objectKey);
        const content = await this.streamToString(stream);
        return { fileName: obj.fileName, content };
      }),
    );
    return { version, files };
  }

  /**
   * Rollback = restore isi version lama sebagai version BARU (bukan hapus
   * history) — history tetap utuh, forward-only, konsisten dengan prinsip
   * audit trail §18. Cuma didukung untuk BLOB_STAGES (lihat komentar di atas).
   *
   * PENTING (batasan yang belum ditangani): rollback stage ini TIDAK
   * otomatis invalidate/regenerate stage-stage SETELAHNYA yang sudah
   * ter-approve berdasarkan konten lama. Kalau stage yang di-rollback
   * bukan stage TERAKHIR yang aktif di pipeline, ada risiko downstream
   * jadi tidak konsisten dengan versi yang di-rollback. Paling aman
   * dipakai untuk stage yang statusnya masih GENERATED (belum di-approve
   * downstream manapun).
   */
  async rollback(projectId: string, stageKey: StageKey, version: number, actor: string) {
    if (!BLOB_STAGES.includes(stageKey)) {
      throw new BadRequestException(
        `Rollback belum didukung untuk stage ${stageKey} (file-by-file, banyak file per version).`,
      );
    }

    const stage = await this.prisma.artifactStage.findUniqueOrThrow({
      where: { projectId_stageKey: { projectId, stageKey } },
    });
    if (stage.status === StageStatus.GENERATING) {
      throw new ConflictException('Stage ini sedang generating, tidak bisa rollback sekarang.');
    }

    const objects = await this.prisma.artifactObject.findMany({
      where: { artifactStageId: stage.id, version },
    });
    if (objects.length === 0) throw new NotFoundException(`Version ${version} tidak ditemukan`);
    if (objects.length > 1) {
      // Seharusnya tidak pernah kejadian untuk BLOB_STAGES (selalu 1 file), tapi jaga-jaga.
      throw new BadRequestException(`Version ${version} punya ${objects.length} file — tidak bisa rollback stage blob.`);
    }

    const source = objects[0];
    const stream = await this.storage.getObjectStream(source.bucket, source.objectKey);
    const content = await this.streamToString(stream);

    const project = await this.prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    if (!project.createdById) {
      throw new BadRequestException('Project belum punya createdById — tidak bisa tentukan folder S3.');
    }

    const newVersion = stage.revisionCount + 1;
    const artifactObject = await this.storage.uploadArtifact({
      artifactStageId: stage.id,
      createdById: project.createdById,
      projectId,
      stageKey: stageKey.toLowerCase(),
      fileName: source.fileName,
      content: Buffer.from(content, 'utf-8'),
      mimeType: source.mimeType,
      version: newVersion,
    });

    const updated = await this.prisma.artifactStage.update({
      where: { id: stage.id },
      data: {
        content,
        status: StageStatus.GENERATED,
        revisionCount: newVersion,
        comment: `Rollback ke version ${version} oleh ${actor}`,
        decidedBy: null,
        decidedById: null,
        decidedAt: null,
        generatedAt: new Date(),
      },
    });

    return { stage: updated, restoredFromVersion: version, newVersion, artifactObjectId: artifactObject.id };
  }

  private streamToString(stream: any): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('error', reject);
      stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    });
  }

  /**
   * §9 PRD V1.2 — Approve / Reject / Request Revision. Satu-satunya tempat
   * yang boleh memanggil resumeUrl n8n, sekarang juga satu-satunya tempat
   * yang menegakkan permission per-stage (§7.1), termasuk assignment ke team.
   */
  async decide(projectId: string, stageKey: StageKey, dto: DecideStageDto, caller: CallerContext) {
    const stage = await this.prisma.artifactStage.findUnique({
      where: { projectId_stageKey: { projectId, stageKey } },
    });
    if (!stage) throw new NotFoundException('Stage tidak ditemukan');

    if (stage.status !== StageStatus.GENERATED) {
      throw new ConflictException(
        `Stage ini berstatus "${stage.status}" — tidak bisa diputuskan lagi.`,
      );
    }
    if (!stage.resumeUrl) {
      throw new ConflictException('Stage ini belum punya resume URL dari n8n. Coba lagi sebentar.');
    }

    await this.assertCanDecide(projectId, stageKey, caller);

    if (dto.decision === 'revision_requested') {
      if (!dto.comment) throw new BadRequestException('comment wajib diisi untuk request revision');

      try {
        await axios.post(stage.resumeUrl, { decision: 'revision', note: dto.comment, approver: caller.email });
      } catch (err) {
        throw new BadGatewayException(`Gagal mengirim keputusan ke n8n: ${(err as Error).message}`);
      }

      const nextRevisionNumber = stage.revisionCount + 1;
      return this.prisma.$transaction(async (tx) => {
        await tx.revisionRequest.create({
          data: {
            artifactStageId: stage.id,
            comment: dto.comment!,
            requestedBy: caller.email,
            revisionNumber: nextRevisionNumber,
          },
        });
        return tx.artifactStage.update({
          where: { id: stage.id },
          data: { status: StageStatus.REVISION_REQUESTED, revisionCount: nextRevisionNumber, resumeUrl: null },
        });
      });
    }

    try {
      await axios.post(stage.resumeUrl, {
        decision: dto.decision,
        comment: dto.comment ?? '',
        approver: caller.email,
      });
    } catch (err) {
      throw new BadGatewayException(`Gagal mengirim keputusan ke n8n: ${(err as Error).message}`);
    }

    const updated = await this.prisma.artifactStage.update({
      where: { projectId_stageKey: { projectId, stageKey } },
      data: {
        status: dto.decision === 'approved' ? StageStatus.APPROVED : StageStatus.REJECTED,
        comment: dto.comment,
        decidedBy: caller.email,
        decidedById: caller.userId,
        decidedAt: new Date(),
        resumeUrl: null,
      },
    });

    if (dto.decision === 'rejected') {
      await this.prisma.project.update({ where: { id: projectId }, data: { status: ProjectStatus.REJECTED } });
    }

    return updated;
  }

  /**
   * §7.1 permission check:
   *  - OWNER/ADMIN: selalu boleh (fallback approver).
   *  - MEMBER: boleh kalau (a) di-assign langsung sebagai member, ATAU
   *            (b) dia anggota dari TEAM yang di-assign ke stage ini.
   *  - VIEWER: tidak pernah boleh.
   */
  private async assertCanDecide(projectId: string, stageKey: StageKey, caller: CallerContext) {
    if (caller.role === OrgRole.OWNER || caller.role === OrgRole.ADMIN) return;
    if (caller.role === OrgRole.VIEWER) {
      throw new ForbiddenException('Viewer tidak bisa approve/reject/request revision');
    }

    const assignment = await this.prisma.stageAssignment.findUnique({
      where: { projectId_stageKey: { projectId, stageKey } },
    });
    if (!assignment) {
      throw new ForbiddenException('Belum ada yang di-assign untuk memutuskan stage ini');
    }

    if (assignment.assignedMemberId && assignment.assignedMemberId === caller.memberId) {
      return;
    }

    if (assignment.assignedTeamId) {
      const isInTeam = await this.prisma.teamMember.findFirst({
        where: { teamId: assignment.assignedTeamId, organizationMemberId: caller.memberId },
      });
      if (isInTeam) return;
    }

    throw new ForbiddenException('Anda tidak di-assign (langsung atau lewat team) sebagai approver untuk stage ini');
  }

  private async assertMemberBelongsToProjectOrg(projectId: string, memberId: string) {
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { organizationId: true },
    });
    const member = await this.prisma.organizationMember.findFirst({
      where: { id: memberId, organizationId: project.organizationId ?? undefined },
    });
    if (!member) throw new BadRequestException('Member ini bukan bagian dari organisasi project ini');
  }

  private async assertTeamBelongsToProjectOrg(projectId: string, teamId: string) {
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { organizationId: true },
    });
    const team = await this.prisma.team.findFirst({
      where: { id: teamId, organizationId: project.organizationId ?? undefined },
    });
    if (!team) throw new BadRequestException('Team ini bukan bagian dari organisasi project ini');
  }
}
