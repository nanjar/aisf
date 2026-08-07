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

  /**
   * Single-admin app: seed the one operator account from env on boot if it
   * doesn't exist yet. Simpler than a signup flow for an internal tool.
   */
  async onModuleInit() {
    const email = this.config.get<string>('ADMIN_EMAIL');
    const password = this.config.get<string>('ADMIN_PASSWORD');
    if (!email || !password) return;

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) return;

    const passwordHash = await bcrypt.hash(password, 12);
    await this.prisma.user.create({ data: { email, passwordHash } });
  }

  async validateUser(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.passwordHash) {
      // passwordHash null = akun ini dibuat lewat Google dan tidak punya password lokal.
      throw new UnauthorizedException('Email atau password salah');
    }

    const matches = await bcrypt.compare(password, user.passwordHash);
    if (!matches) throw new UnauthorizedException('Email atau password salah');

    return user;
  }

  async login(email: string, password: string) {
    const user = await this.validateUser(email, password);
    const accessToken = await this.jwt.signAsync({ sub: user.id, email: user.email });
    return { accessToken, user: { id: user.id, email: user.email } };
  }

  // ===== V1.1: Google OAuth =====

  async loginWithGoogle(profile: GoogleProfile) {
    const user = await this.findOrCreateGoogleUser(profile);
    const accessToken = await this.jwt.signAsync({ sub: user.id, email: user.email });
    return { accessToken, user: { id: user.id, email: user.email, name: user.name } };
  }

  private async findOrCreateGoogleUser(profile: GoogleProfile) {
    // 1) Login berikutnya — sudah pernah login Google sebelumnya.
    let user = await this.prisma.user.findUnique({ where: { googleId: profile.googleId } });
    if (user) return user;

    // 2) Email sudah terdaftar (mis. akun admin lokal) — tautkan, jangan buat duplikat.
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

    // 3) Belum ada sama sekali -> auto create account (PRD V1.1 4.1).
    return this.prisma.user.create({
      data: {
        email: profile.email,
        name: profile.name,
        googleId: profile.googleId,
        authProvider: 'GOOGLE',
        passwordHash: null,
      },
    });
  }
}
