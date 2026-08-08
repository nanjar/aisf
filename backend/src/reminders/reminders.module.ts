import { Module } from '@nestjs/common';
import { RemindersService } from './reminders.service';
import { RemindersController } from './reminders.controller';
import { MembersModule } from '../organizations/members/members.module';

@Module({
  imports: [MembersModule], // dipakai untuk MailService yang sudah di-export dari sana
  controllers: [RemindersController],
  providers: [RemindersService],
})
export class RemindersModule {}
