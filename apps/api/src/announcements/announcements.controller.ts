import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe';
import { clientMeta, CurrentUser, type AppRequest, type RequestUser } from '../common/request-user';
import { RequirePermission } from '../permissions/permission.guard';
import { AnnouncementsService } from './announcements.service';

const ids = z.array(z.coerce.number().int().positive()).min(1, 'Choose at least one.');
const AudienceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('all') }), z.object({ type: z.literal('staff') }), z.object({ type: z.literal('families') }),
  z.object({ type: z.literal('classes'), ids }), z.object({ type: z.literal('sections'), ids }),
]);
const CreateBody = z.object({
  title: z.string().trim().min(3).max(200),
  body: z.string().trim().min(1).max(5000),
  audience: AudienceSchema,
  expireAt: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).nullish(),
  publish: z.boolean().optional(),
  isPublic: z.boolean().optional(),
});

@ApiTags('Announcements')
@ApiBearerAuth()
@Controller('announcements')
export class AnnouncementsController {
  constructor(private readonly svc: AnnouncementsService) {}

  @Get()
  @RequirePermission('announcements', 'view')
  list(@CurrentUser() u: RequestUser, @Query('drafts') drafts?: string) {
    return this.svc.list(u, { includeDrafts: drafts === '1' });
  }

  @Post()
  @RequirePermission('announcements', 'create')
  create(@CurrentUser() u: RequestUser, @Body(new ZodPipe(CreateBody)) b: z.infer<typeof CreateBody>, @Req() req: AppRequest) {
    return this.svc.create(u, b as any, clientMeta(req));
  }

  @Post(':id/publish')
  @HttpCode(200)
  @RequirePermission('announcements', 'publish')
  publish(@CurrentUser() u: RequestUser, @Param('id', ParseIntPipe) id: number, @Req() req: AppRequest) {
    return this.svc.publish(u, id, clientMeta(req));
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequirePermission('announcements', 'create')
  archive(@CurrentUser() u: RequestUser, @Param('id', ParseIntPipe) id: number, @Req() req: AppRequest) {
    return this.svc.archive(u, id, clientMeta(req));
  }
}
