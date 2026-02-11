import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FEATURE_KEY } from '../decorators/feature.decorator';
import { LicensingService } from '../../modules/licensing/licensing.service';

@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly licensingService: LicensingService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredFeature = this.reflector.getAllAndOverride<string>(
      FEATURE_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredFeature) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const orgId = request?.user?.organizationId;
    if (!orgId) {
      throw new ForbiddenException('Organization not found in request');
    }

    const allowed = await this.licensingService.hasFeatureAccess(
      orgId,
      requiredFeature,
    );
    if (!allowed) {
      throw new ForbiddenException(
        `Current plan does not include feature: ${requiredFeature}`,
      );
    }

    return true;
  }
}

