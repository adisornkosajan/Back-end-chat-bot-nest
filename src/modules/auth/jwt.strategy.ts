import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.get<string>('JWT_SECRET') || 'default-secret',
    });
  }

  async validate(payload: any) {
    console.log('JWT Payload:', payload);
    const userId = payload.sub || payload.id || payload.userId;
    console.log('Extracted userId:', userId);
    
    return {
      id: userId,
      userId: userId,
      sub: userId,
      organizationId: payload.organizationId,
      role: payload.role,
      platformRole: payload.platformRole || 'NONE',
    };
  }
}
