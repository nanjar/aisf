import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class N8nWebhookGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const provided = request.headers['x-webhook-secret'];
    const expected = this.config.get<string>('N8N_WEBHOOK_SECRET');

    if (!expected || provided !== expected) {
      throw new UnauthorizedException('Invalid or missing webhook secret');
    }
    return true;
  }
}
