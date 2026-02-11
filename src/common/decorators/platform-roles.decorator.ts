import { SetMetadata } from '@nestjs/common';

export enum PlatformRoleName {
  OWNER = 'OWNER',
  SUPPORT_ADMIN = 'SUPPORT_ADMIN',
}

export const PLATFORM_ROLES_KEY = 'platform_roles';
export const PlatformRoles = (...roles: PlatformRoleName[]) =>
  SetMetadata(PLATFORM_ROLES_KEY, roles);

