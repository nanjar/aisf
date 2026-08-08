import { Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RemindersService } from './reminders.service';

// Sengaja HANYA JwtAuthGuard (bukan RolesGuard) — endpoint ini tidak punya :organizationId
// atau :projectId di route, jadi RolesGuard (yang butuh salah satu untuk resolve membership)
// tidak bisa dipasang di sini tanpa restrukturisasi. Risikonya rendah: paling parah, user yang
// login memicu pengecekan reminder lebih awal dari jadwal cron — tidak membocorkan data siapa pun.
@Controller('reminders')
@UseGuards(JwtAuthGuard)
export class RemindersController {
  constructor(private readonly reminders: RemindersService) {}

  /** Untuk testing manual — jalankan pengecekan deadline sekarang juga, tanpa nunggu cron per jam. */
  @Post('check-now')
  async checkNow() {
    await this.reminders.checkDeadlines();
    return { ok: true };
  }
}
