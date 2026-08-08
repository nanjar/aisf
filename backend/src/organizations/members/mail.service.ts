import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

export interface SendMailInput {
  to: string;
  subject: string;
  body: string;
}

/**
 * V1.2: implementasi asli menggantikan stub log-only sebelumnya.
 * Defensif — kalau env var SMTP_* belum lengkap, TIDAK melempar error di constructor
 * (yang bisa menjatuhkan seluruh aplikasi saat boot, seperti insiden GOOGLE_CLIENT_ID/S3
 * sebelumnya). Kalau tidak dikonfigurasi, fallback ke perilaku lama: log warning saja.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter | null = null;

  constructor(private readonly config: ConfigService) {
    const host = this.config.get<string>('SMTP_HOST');
    const port = this.config.get<string>('SMTP_PORT');
    const user = this.config.get<string>('SMTP_USER');
    const pass = this.config.get<string>('SMTP_PASS');

    if (!host || !port || !user || !pass) {
      this.logger.warn(
        'SMTP_* env var belum lengkap — email undangan akan di-log saja, tidak benar-benar terkirim.',
      );
      return;
    }

    this.transporter = nodemailer.createTransport({
      host,
      port: Number(port),
      secure: Number(port) === 465,
      auth: { user, pass },
    });
  }

  get configured(): boolean {
    return this.transporter !== null;
  }

  async send(input: SendMailInput): Promise<void> {
    if (!this.transporter) {
      this.logger.warn(
        `[MailService — SMTP belum dikonfigurasi] to=${input.to} subject="${input.subject}" — email TIDAK benar-benar terkirim.`,
      );
      return;
    }

    const from = this.config.get<string>('SMTP_FROM') ?? 'no-reply@nanjarbudiman.com';

    try {
      await this.transporter.sendMail({
        from,
        to: input.to,
        subject: input.subject,
        text: input.body,
        html: `<p>${input.body.replace(/\n/g, '<br/>')}</p>`,
      });
    } catch (err) {
      // Jangan gagalkan operasi utama (invite/resend) hanya karena SMTP error sesaat —
      // member/invitation-nya tetap tercatat di database, cuma email-nya yang gagal.
      this.logger.error(`Gagal kirim email ke ${input.to}: ${(err as Error).message}`, err as Error);
    }
  }
}
