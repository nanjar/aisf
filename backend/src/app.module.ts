import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { RemindersModule } from './reminders/reminders.module';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { ProjectsModule } from './projects/projects.module';
import { StagesModule } from './stages/stages.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { I18nModule } from './i18n/i18n.module';
import { TeamsModule } from './organizations/teams/teams.module';
import { MembersModule } from './organizations/members/members.module';
import { InvitationsModule } from './invitations/invitations.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    RemindersModule,
    ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 60 }] }),
    PrismaModule,
    AuthModule,
    ProjectsModule,
    StagesModule,
    WebhooksModule,
    I18nModule,
    TeamsModule, // V1.2
    MembersModule, // V1.2
    InvitationsModule, // V1.2
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
