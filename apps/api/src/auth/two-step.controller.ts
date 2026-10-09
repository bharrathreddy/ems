import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe';
import { clientMeta, CurrentUser, type AppRequest, type RequestUser } from '../common/request-user';
import { DeveloperOnly } from '../permissions/permission.guard';
import { TwoStepService } from './two-step.service';

const Code = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code from the email.') });

/** Developer console: switch two-step login on (after a test email arrives) or off. */
@ApiTags('Developer')
@ApiBearerAuth()
@Controller('developer/two-step')
export class TwoStepController {
  constructor(private readonly t: TwoStepService) {}

  @Get() @DeveloperOnly()
  status() { return this.t.status(); }

  @Post('test') @HttpCode(200) @DeveloperOnly()
  test(@CurrentUser() u: RequestUser) { return this.t.sendTest(u); }

  @Post('enable') @HttpCode(200) @DeveloperOnly()
  enable(@CurrentUser() u: RequestUser, @Body(new ZodPipe(Code)) b: { code: string }, @Req() r: AppRequest) { return this.t.enable(u, b.code, clientMeta(r)); }

  @Post('disable') @HttpCode(200) @DeveloperOnly()
  disable(@CurrentUser() u: RequestUser, @Req() r: AppRequest) { return this.t.disable(u, clientMeta(r)); }
}
