import { Injectable, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { GoogleProfile } from './strategies/google.strategy';

@Injectable()
export class AuthService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    const email = this.config.get<string>('ADMIN_EMAIL');
    const password = this.config.get<string>('ADMIN_PASSWORD');
    if (!email || !password) return;

    let admin = await this.prisma.user.findUnique({ where: { email } });
    if (!admin) {
      const passwordHash = await bcrypt.hash(password, 12);
      admin = await this.prisma.user.create({ data: { email, passwordHash } });
    }

    await this.ensureOwnerOrganization(admin.id, email);
  }

  private async ensureOwnerOrganization(userId: string, email: string) {
    const existing = await this.prisma.organization.findFirst({ where: { ownerId: userId } });
    if (existing) return existing;

    return this.prisma.organization.create({
      data: {
        name: `${email.split('@')[0]}'s Organization`,
        ownerId: userId,
        members: {
          create: { userId, role: 'OWNER', status: 'ACTIVE', joinedAt: new Date() },
        },
      },
    });
  }

  /**
   * V1.2 (invite flow): kalau user ini punya membership berstatus INVITED di organisasi
   * mana pun (dari flow undangan lama tanpa token, atau dari akun yang login duluan lewat
   * jalur lain sebelum sempat klik link undangan), aktifkan otomatis saat mereka berhasil
   * login — supaya tidak perlu bergantung 100% pada halaman /invite/:token.
   */
  private async activatePendingMemberships(userId: string) {
    await this.prisma.organizationMember.updateMany({
      where: { userId, status: 'INVITED' },
      data: { status: 'ACTIVE', joinedAt: new Date() },
    });
  }

  async validateUser(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException('Email atau password salah');
    }

    const matches = await bcrypt.compare(password, user.passwordHash);
    if (!matches) throw new UnauthorizedException('Email atau password salah');

    return user;
  }

  async login(email: string, password: string) {
    const user = await this.validateUser(email, password);
    await this.activatePendingMemberships(user.id);
    return this.issueTokenForUser(user);
  }

  // ===== V1.1: Google OAuth =====

  async loginWithGoogle(profile: GoogleProfile) {
    const user = await this.findOrCreateGoogleUser(profile);
    await this.activatePendingMemberships(user.id);
    return this.issueTokenForUser(user);
  }

  private async findOrCreateGoogleUser(profile: GoogleProfile) {
    let user = await this.prisma.user.findUnique({ where: { googleId: profile.googleId } });
    if (user) return user;

    user = await this.prisma.user.findUnique({ where: { email: profile.email } });
    if (user) {
      return this.prisma.user.update({
        where: { id: user.id },
        data: {
          googleId: profile.googleId,
          authProvider: 'GOOGLE',
          name: user.name ?? profile.name,
        },
      });
    }

    const created = await this.prisma.user.create({
      data: {
        email: profile.email,
        name: profile.name,
        googleId: profile.googleId,
        authProvider: 'GOOGLE',
        passwordHash: null,
      },
    });
    await this.ensureOwnerOrganization(created.id, created.email);
    return created;
  }

  async updatePreferredLanguage(userId: string, lang: 'id' | 'en') {
    return this.prisma.user.update({
      where: { id: userId },
      data: { preferredLanguage: lang },
      select: { id: true, preferredLanguage: true },
    });
  }

  async getMeWithOrganization(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, email: true, name: true, preferredLanguage: true },
    });

    const membership = await this.prisma.organizationMember.findFirst({
      where: { userId, status: 'ACTIVE' },
      orderBy: { invitedAt: 'asc' },
      select: { organizationId: true, role: true },
    });

    return { ...user, organizationId: membership?.organizationId ?? null, role: membership?.role ?? null };
  }

  /** V1.2 (invite flow): dipakai bersama oleh login biasa, Google OAuth, dan penerimaan undangan. */
  async issueTokenForUser(user: { id: string; email: string; name?: string | null }) {
    const accessToken = await this.jwt.signAsync({ sub: user.id, email: user.email });
    return { accessToken, user: { id: user.id, email: user.email, name: user.name ?? null } };
  }
}
