import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OrgRole } from '@prisma/client';
import { ROLES_KEY } from './roles.decorator';
import { MembershipResolverService } from './membership-resolver.service';

/**
 * RBAC level organisasi (§7 PRD V1.2). Jalan SETELAH JwtAuthGuard — pakai
 * bersama: @UseGuards(JwtAuthGuard, RolesGuard).
 *
 * Meng-resolve OrganizationMember dari :organizationId ATAU :projectId di
 * route, lalu menempelkannya ke req.member supaya controller/service bisa
 * pakai tanpa query ulang.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly membership: MembershipResolverService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<OrgRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const req = context.switchToHttp().getRequest();
    const userId: string = req.user?.userId;
    const organizationId = req.params.organizationId;
    const projectId = req.params.projectId ?? req.params.id;

    const member = organizationId
      ? await this.membership.resolveByOrganization(userId, organizationId)
      : await this.membership.resolveByProject(userId, projectId);

    req.member = member;

    if (!requiredRoles || requiredRoles.length === 0) return true;

    if (!requiredRoles.includes(member.role)) {
      throw new ForbiddenException(`Butuh salah satu role: ${requiredRoles.join(', ')}`);
    }

    return true;
  }
}
