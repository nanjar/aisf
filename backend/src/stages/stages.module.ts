import { Module } from '@nestjs/common';
import { StagesController } from './stages.controller';
import { StagesService } from './stages.service';
import { RbacModule } from '../common/rbac/rbac.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [RbacModule, StorageModule],
  controllers: [StagesController],
  providers: [StagesService],
})
export class StagesModule {}
