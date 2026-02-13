import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  PLATFORM_ROLES_KEY,
  PlatformRoleName,
} from '../decorators/platform-roles.decorator';

@Injectable()
export class PlatformRolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<PlatformRoleName[]>(
      PLATFORM_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request?.user;
    if (!user) {
      throw new ForbiddenException('User not authenticated');
    }

    if (String(user.role || '').toUpperCase() === 'SUPER_ADMIN') {
      return true;
    }

    if (!user.platformRole || user.platformRole === 'NONE') {
      throw new ForbiddenException('Platform role is required');
    }

    const allowed = requiredRoles.includes(user.platformRole);
    if (!allowed) {
      throw new ForbiddenException(
        `Platform access denied. Required: ${requiredRoles.join(', ')}`,
      );
    }

    return true;
  }
}
