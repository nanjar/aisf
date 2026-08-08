import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { N8nWebhookGuard } from './n8n-webhook.guard';
import { StorageModule } from '../storage/storage.module';
import { GenerationModule } from '../generation/generation.module';

@Module({
  imports: [StorageModule, GenerationModule],
  controllers: [WebhooksController],
  providers: [WebhooksService, N8nWebhookGuard],
})
export class WebhooksModule {}
