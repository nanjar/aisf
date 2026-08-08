import { Module } from '@nestjs/common';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';
import { MailService } from './mail.service';
import { RbacModule } from '../../common/rbac/rbac.module';

@Module({
  imports: [RbacModule],
  controllers: [MembersController],
  providers: [MembersService, MailService],
  exports: [MailService],
})
export class MembersModule {}
