import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ArtifactStage, MemberStatus, OrgRole, Project, ReminderType, StageKey, StageStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../organizations/members/mail.service';

type StageWithProject = ArtifactStage & { project: Project };

/**
 * V1.2 §12 — Deadline Reminder. Jalan tiap jam (cron), cek dua kondisi:
 *   1. T_MINUS_24H — stage berstatus GENERATED (menunggu keputusan) dan deadlineAt
 *      jatuh dalam 24 jam ke depan.
 *   2. OVERDUE — stage berstatus GENERATED dan deadlineAt sudah lewat.
 * Tiap kombinasi (stage, jenis reminder) cuma dikirim SEKALI — dicatat di ReminderLog
 * (unique constraint [artifactStageId, reminderType] mencegah duplikat walau cron
 * jalan berkali-kali sebelum statusnya berubah).
 */
@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async checkDeadlines() {
    const now = new Date();
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const approaching = await this.prisma.artifactStage.findMany({
      where: { status: StageStatus.GENERATED, deadlineAt: { gte: now, lte: in24h } },
      include: { project: true },
    });
    for (const stage of approaching) {
      await this.sendReminderIfNeeded(stage, ReminderType.T_MINUS_24H);
    }

    const overdue = await this.prisma.artifactStage.findMany({
      where: { status: StageStatus.GENERATED, deadlineAt: { lt: now } },
      include: { project: true },
    });
    for (const stage of overdue) {
      await this.sendReminderIfNeeded(stage, ReminderType.OVERDUE);
    }

    this.logger.log(
      `Reminder check selesai — ${approaching.length} mendekati deadline, ${overdue.length} overdue.`,
    );
  }

  private async sendReminderIfNeeded(stage: StageWithProject, type: ReminderType) {
    const already = await this.prisma.reminderLog.findUnique({
      where: { artifactStageId_reminderType: { artifactStageId: stage.id, reminderType: type } },
    });
    if (already) return;

    const recipients = await this.resolveRecipients(stage.projectId, stage.stageKey, stage.project.organizationId);
    if (recipients.length === 0) {
      this.logger.warn(`Tidak ada penerima untuk reminder stage ${stage.id} (${type}) — dilewati.`);
      return;
    }

    const deadlineStr = stage.deadlineAt
      ? new Date(stage.deadlineAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
      : '-';

    const subject =
      type === ReminderType.OVERDUE
        ? `[Overdue] "${stage.project.name}" — tahap ${stage.stageKey} sudah lewat deadline`
        : `[Pengingat] "${stage.project.name}" — tahap ${stage.stageKey} jatuh tempo besok`;

    const body =
      type === ReminderType.OVERDUE
        ? `Tahap ${stage.stageKey} pada project "${stage.project.name}" sudah melewati deadline (${deadlineStr}) dan masih menunggu keputusan. Mohon segera ditindaklanjuti.`
        : `Tahap ${stage.stageKey} pada project "${stage.project.name}" akan jatuh tempo besok (${deadlineStr}). Mohon segera direview.`;

    for (const email of recipients) {
      try {
        await this.mail.send({ to: email, subject, body });
      } catch (err) {
        this.logger.error(`Gagal kirim reminder ke ${email} untuk stage ${stage.id}`, err as Error);
      }
    }

    await this.prisma.reminderLog.create({
      data: { artifactStageId: stage.id, reminderType: type, sentTo: recipients.join(', ') },
    });
  }

  /** Prioritas: assignee langsung -> semua anggota team yang di-assign -> fallback ke semua OWNER organisasi. */
  private async resolveRecipients(
    projectId: string,
    stageKey: StageKey,
    organizationId: string | null,
  ): Promise<string[]> {
    const assignment = await this.prisma.stageAssignment.findUnique({
      where: { projectId_stageKey: { projectId, stageKey } },
      include: {
        assignedMember: { include: { user: true } },
        assignedTeam: { include: { members: { include: { member: { include: { user: true } } } } } },
      },
    });

    if (assignment?.assignedMember) {
      return [assignment.assignedMember.user.email];
    }
    if (assignment?.assignedTeam) {
      return assignment.assignedTeam.members.map((tm) => tm.member.user.email);
    }

    if (!organizationId) return [];
    const owners = await this.prisma.organizationMember.findMany({
      where: { organizationId, role: OrgRole.OWNER, status: MemberStatus.ACTIVE },
      include: { user: true },
    });
    return owners.map((o) => o.user.email);
  }
}
