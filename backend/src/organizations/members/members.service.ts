import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { MailService } from './mail.service';
import { InviteMemberDto, UpdateMemberDto } from './dto/member.dto';
import { MemberStatus, OrgRole } from '@prisma/client';

const INVITE_EXPIRY_DAYS = 7;

@Injectable()
export class MembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  list(organizationId: string) {
    return this.prisma.organizationMember.findMany({
      where: { organizationId },
      include: { user: { select: { id: true, email: true, name: true } } },
      orderBy: { invitedAt: 'asc' },
    });
  }

  private buildInviteUrl(token: string): string {
    const frontendOrigin = this.config.get<string>('FRONTEND_ORIGIN') ?? '';
    return `${frontendOrigin}/invite/${token}`;
  }

  /** FR-602 Invite Member — find-or-create User by email, buat membership INVITED + token asli. */
  async invite(organizationId: string, invitedBy: string, dto: InviteMemberDto) {
    const existing = await this.prisma.organizationMember.findFirst({
      where: { organizationId, user: { email: dto.email } },
    });
    if (existing) throw new BadRequestException('User ini sudah jadi member organisasi ini');

    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });

    const user = await this.prisma.user.upsert({
      where: { email: dto.email },
      update: {},
      create: { email: dto.email },
    });

    const inviteToken = crypto.randomBytes(32).toString('hex');
    const inviteTokenExpiresAt = new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    const member = await this.prisma.organizationMember.create({
      data: {
        organizationId,
        userId: user.id,
        role: dto.role,
        status: MemberStatus.INVITED,
        invitedBy,
        inviteToken,
        inviteTokenExpiresAt,
      },
    });

    const inviteUrl = this.buildInviteUrl(inviteToken);
    await this.mail.send({
      to: dto.email,
      subject: `Undangan bergabung ke ${org.name}`,
      body: `Anda diundang bergabung ke "${org.name}" sebagai ${dto.role}.\n\nKlik link berikut untuk menerima undangan (berlaku ${INVITE_EXPIRY_DAYS} hari):\n${inviteUrl}`,
    });

    return member;
  }

  /** FR-603 Resend Invitation — regenerate token baru (yang lama jadi tidak valid lagi). */
  async resendInvite(organizationId: string, memberId: string) {
    const member = await this.findOrThrow(organizationId, memberId);
    if (member.status !== MemberStatus.INVITED) {
      throw new BadRequestException('Member ini sudah bergabung, tidak perlu diundang ulang');
    }

    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: member.userId } });

    const inviteToken = crypto.randomBytes(32).toString('hex');
    const inviteTokenExpiresAt = new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

    await this.prisma.organizationMember.update({
      where: { id: memberId },
      data: { inviteToken, inviteTokenExpiresAt },
    });

    const inviteUrl = this.buildInviteUrl(inviteToken);
    await this.mail.send({
      to: user.email,
      subject: `Undangan bergabung ke ${org.name} (kirim ulang)`,
      body: `Anda diundang bergabung ke "${org.name}" sebagai ${member.role}.\n\nKlik link berikut untuk menerima undangan (berlaku ${INVITE_EXPIRY_DAYS} hari):\n${inviteUrl}`,
    });

    return { resent: true };
  }

  /** FR-604 Activate / Deactivate Member, dan ubah role */
  async update(organizationId: string, memberId: string, dto: UpdateMemberDto) {
    const member = await this.findOrThrow(organizationId, memberId);

    if (member.role === OrgRole.OWNER && dto.role && dto.role !== OrgRole.OWNER) {
      throw new BadRequestException('Owner organisasi tidak bisa di-demote lewat endpoint ini');
    }

    return this.prisma.organizationMember.update({
      where: { id: memberId },
      data: {
        role: dto.role,
        status: dto.status,
        joinedAt: dto.status === MemberStatus.ACTIVE && !member.joinedAt ? new Date() : undefined,
      },
    });
  }

  /** FR-605 Remove Member */
  async remove(organizationId: string, memberId: string) {
    const member = await this.findOrThrow(organizationId, memberId);
    if (member.role === OrgRole.OWNER) throw new BadRequestException('Owner organisasi tidak bisa dihapus');
    await this.prisma.organizationMember.delete({ where: { id: memberId } });
    return { removed: true };
  }

  private async findOrThrow(organizationId: string, memberId: string) {
    const member = await this.prisma.organizationMember.findFirst({ where: { id: memberId, organizationId } });
    if (!member) throw new NotFoundException('Member tidak ditemukan');
    return member;
  }
}
