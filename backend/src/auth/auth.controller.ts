import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { GoogleProfile } from './strategies/google.strategy';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto.email, dto.password);
  }

  @Post('me')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  me(@Req() req: Request & { user: { userId: string; email: string } }) {
    return req.user;
  }

  // ===== V1.1: Google OAuth =====

  @Get('google')
  @UseGuards(GoogleAuthGuard)
  googleLogin() {
    // Kosong dengan sengaja — GoogleAuthGuard yang melakukan redirect ke halaman consent Google.
  }

  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  async googleCallback(@Req() req: { user: GoogleProfile }, @Res() res: Response) {
    const { accessToken } = await this.authService.loginWithGoogle(req.user);

    // Redirect balik ke frontend dengan token di URL fragment (bukan cookie httpOnly) —
    // konsisten dengan pola auth existing (JWT disimpan di localStorage, lihat dokumentasi V1).
    const frontendOrigin = this.config.get<string>('FRONTEND_ORIGIN') ?? '';
    res.redirect(`${frontendOrigin}/auth/callback#accessToken=${accessToken}`);
  }
}
