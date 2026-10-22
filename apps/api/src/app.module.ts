import {RealtimeController} from './realtime.controller';
import {WechatJoinController} from './activities/wechat-join.controller';
import {WechatJoinService} from './activities/wechat-join.service';
import {WechatCleanupService} from './activities/wechat-cleanup.service';
import { WechatConfigurationController } from './activities/wechat-configuration.controller';
import { DevelopmentJoinController } from './activities/join.controller';
import { Controller, Get, Module, Res, ServiceUnavailableException } from '@nestjs/common';
import type { Response } from 'express';
import { DatabaseService } from './database.service';
import { envelope } from './http';
import { ActivitiesController } from './activities/activities.controller';
import { ActivitiesService } from './activities/activities.service';
import { ConfigurationService } from './activities/configuration.service';
import { ConfigurationController } from './activities/configuration.controller';
import { ParticipantManagementService } from './activities/participant-management.service';
import { ParticipantManagementController } from './activities/participant-management.controller';
import { DrawService } from './activities/draw.service';
import { DrawController } from './activities/draw.controller';
import { RosterService } from './activities/roster.service';
import { RosterController } from './activities/roster.controller';
import { AuthService } from './auth/auth.service';
import { AuthController } from './auth/auth.controller';

@Controller('health')
class HealthController {
  constructor(private readonly database: DatabaseService) {}
  @Get('live')
  live(@Res({ passthrough: true }) response: Response) { return envelope({ status: 'ok' }, response); }
  @Get('ready')
  async ready(@Res({ passthrough: true }) response: Response) {
    try { await this.database.status(); return envelope({ status: 'ready' }, response); }
    catch { throw new ServiceUnavailableException(); }
  }
}
// Read-only development diagnostics, not registered in production.
@Controller('api/v1/system')
class DevelopmentController {
  constructor(private readonly database: DatabaseService) {}
  @Get('bootstrap')
  async bootstrap(@Res({ passthrough: true }) response: Response) {
    try { return envelope(await this.database.status(), response); }
    catch { throw new ServiceUnavailableException(); }
  }
}
@Module({
  controllers: [RealtimeController,WechatJoinController,WechatConfigurationController,DrawController,ParticipantManagementController,RosterController,ConfigurationController,AuthController, ActivitiesController, HealthController, ...(process.env.NODE_ENV === 'development' ? [DevelopmentController,DevelopmentJoinController] : [])],
  providers: [WechatCleanupService,WechatJoinService,DrawService,ParticipantManagementService,RosterService,ConfigurationService,DatabaseService, AuthService, ActivitiesService],
})
export class AppModule {}
