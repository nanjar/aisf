import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';

@Injectable()
export class InvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  private async findValidOrThrow(token: string) {
    const member = await this.prisma.organizationMember.findUnique({
      where: { inviteToken: token },
      include: { organization: true, user: true },
    });

    if (!member || member.status !== 'INVITED') {
      throw new NotFoundException('Undangan tidak valid atau sudah dipakai.');
    }
    if (!member.inviteTokenExpiresAt || member.inviteTokenExpiresAt < new Date()) {
      throw new NotFoundException('Undangan sudah kedaluwarsa. Minta OWNER/ADMIN kirim ulang.');
    }

    return member;
  }

  async getByToken(token: string) {
    const member = await this.findValidOrThrow(token);
    return {
      email: member.user.email,
      role: member.role,
      organizationName: member.organization.name,
      // Sudah punya password/Google -> tidak perlu form buat password lagi, cukup tombol "Terima".
      needsCredentials: !member.user.passwordHash && !member.user.googleId,
    };
  }

  async accept(token: string, name?: string, password?: string) {
    const member = await this.findValidOrThrow(token);

    if (!member.user.passwordHash && !member.user.googleId) {
      if (!name || !password) {
        throw new BadRequestException('Nama dan password wajib diisi untuk akun baru.');
      }
      const passwordHash = await bcrypt.hash(password, 12);
      await this.prisma.user.update({
        where: { id: member.user.id },
        data: { name, passwordHash },
      });
    }

    const updatedMember = await this.prisma.organizationMember.update({
      where: { id: member.id },
      data: {
        status: 'ACTIVE',
        joinedAt: new Date(),
        inviteToken: null,
        inviteTokenExpiresAt: null,
      },
      include: { user: true },
    });

    return this.auth.issueTokenForUser(updatedMember.user);
  }
}
