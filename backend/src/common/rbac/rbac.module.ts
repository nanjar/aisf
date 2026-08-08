import { Module } from '@nestjs/common';
import { MembershipResolverService } from './membership-resolver.service';
import { RolesGuard } from './roles.guard';

@Module({
  providers: [MembershipResolverService, RolesGuard],
  exports: [MembershipResolverService, RolesGuard],
})
export class RbacModule {}
