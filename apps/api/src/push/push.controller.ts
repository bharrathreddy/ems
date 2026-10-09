import { Body, Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe';
import { CurrentUser, type RequestUser } from '../common/request-user';
import { PushService } from './push.service';

const endpoint = z.string().url().max(1000);
const Sub = z.object({ endpoint, keys: z.object({ p256dh: z.string().min(10).max(255), auth: z.string().min(4).max(255) }), device: z.string().max(120).nullish() });
const Device = z.object({ endpoint });
const Prefs = z.object({ endpoint, absence: z.boolean().optional(), notices: z.boolean().optional(), results: z.boolean().optional(), approvals: z.boolean().optional() });

/** Phone notifications for the signed-in person, per phone (each phone keeps its own choices). */
@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('push')
export class PushController {
  constructor(private readonly push: PushService) {}

  @Get('key')
  key(@CurrentUser() u: RequestUser) { return this.push.publicKey(u); }

  @Post('subscribe') @HttpCode(200)
  subscribe(@CurrentUser() u: RequestUser, @Body(new ZodPipe(Sub)) b: z.infer<typeof Sub>) { return this.push.subscribe(u, b); }

  @Post('device') @HttpCode(200)
  device(@CurrentUser() u: RequestUser, @Body(new ZodPipe(Device)) b: { endpoint: string }) { return this.push.device(u, b.endpoint); }

  @Patch('device')
  prefs(@CurrentUser() u: RequestUser, @Body(new ZodPipe(Prefs)) b: z.infer<typeof Prefs>) {
    const { endpoint: e, ...prefs } = b;
    return this.push.setPrefs(u, e, prefs);
  }

  @Post('test') @HttpCode(200)
  test(@CurrentUser() u: RequestUser, @Body(new ZodPipe(Device)) b: { endpoint: string }) { return this.push.test(u, b.endpoint); }

  @Post('unsubscribe') @HttpCode(200)
  unsubscribe(@CurrentUser() u: RequestUser, @Body(new ZodPipe(Device)) b: { endpoint: string }) { return this.push.unsubscribe(u, b.endpoint); }
}
