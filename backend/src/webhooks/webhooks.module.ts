import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { N8nWebhookGuard } from './n8n-webhook.guard';

@Module({
  controllers: [WebhooksController],
  providers: [WebhooksService, N8nWebhookGuard],
})
export class WebhooksModule {}
