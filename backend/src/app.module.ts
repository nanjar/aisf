import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { ProjectsModule } from './projects/projects.module';
import { StagesModule } from './stages/stages.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { I18nModule } from './i18n/i18n.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 60 }] }),
    PrismaModule,
    AuthModule,
    ProjectsModule,
    StagesModule,
    WebhooksModule,
    I18nModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
