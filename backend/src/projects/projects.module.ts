import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { RbacModule } from '../common/rbac/rbac.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [RbacModule, StorageModule],
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
