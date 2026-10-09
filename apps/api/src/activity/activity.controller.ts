import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe';
import { DeveloperOnly } from '../permissions/permission.guard';
import { ActivityService } from './activity.service';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date.');
const ListQ = z.object({
  from: date.optional(), to: date.optional(), type: z.enum(['signin', 'change', 'download']).optional(), userId: z.string().max(40).optional(),
  proxyOnly: z.enum(['1', 'true']).optional(), module: z.string().max(50).optional(), before: z.string().max(40).optional(), limit: z.coerce.number().int().min(1).max(500).optional(),
});
const UsersQ = z.object({ type: z.enum(['staff', 'driver', 'parent', 'student']).optional(), search: z.string().trim().max(100).optional() });

/** Developer only: the activity log and the people "Login as" can open. */
@ApiTags('Developer')
@ApiBearerAuth()
@Controller('developer')
export class ActivityController {
  constructor(private readonly a: ActivityService) {}

  @Get('activity') @DeveloperOnly()
  list(@Query(new ZodPipe(ListQ)) q: z.infer<typeof ListQ>) { return this.a.list({ ...q, proxyOnly: !!q.proxyOnly }); }

  @Get('activity/modules') @DeveloperOnly()
  modules() { return this.a.modules(); }

  @Get('proxy-users') @DeveloperOnly()
  users(@Query(new ZodPipe(UsersQ)) q: z.infer<typeof UsersQ>) { return this.a.proxyUsers(q); }
}
