import { SetMetadata } from '@nestjs/common';
import { OrgRole } from '@prisma/client';

export const ROLES_KEY = 'roles';

/**
 * Menandai endpoint sebagai butuh salah satu role organisasi ini. Dipakai
 * bersama RolesGuard. §7 PRD V1.2.
 *
 * Permission approval per-stage (MEMBER hanya boleh approve jika di-assign)
 * TIDAK dicek di sini — itu logic bisnis di StagesService.decide(), karena
 * butuh konteks stageKey/project yang tidak tersedia di level route.
 */
export const Roles = (...roles: OrgRole[]) => SetMetadata(ROLES_KEY, roles);
