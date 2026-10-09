import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe';
import { clientMeta, CurrentUser, type AppRequest, type RequestUser } from '../common/request-user';
import { DeveloperOnly } from '../permissions/permission.guard';
import { AccessService, type Grants, type Override } from './access.service';

const workspace = z.enum(['staff', 'parent', 'student']);
const scope = z.enum(['all', 'class', 'section', 'subject', 'assigned_students', 'own_records', 'own_children', 'assigned_route']);
const NewRole = z.object({ name: z.string().trim().min(2, 'Enter a role name.').max(100), workspace, copyFrom: z.number().int().positive().nullish(), description: z.string().trim().max(255).nullish() });
const EditRole = z.object({ name: z.string().trim().min(2).max(100).optional(), description: z.string().trim().max(255).nullish(), isActive: z.boolean().optional() });
const GrantsB = z.object({ grants: z.record(z.string().max(80), scope) });
const OverridesB = z.object({ workspace, overrides: z.array(z.object({ perm: z.string().max(80), effect: z.enum(['grant', 'deny']), scope: scope.nullish() })).max(300) });

/** Developer only: what every role and person may see and do. */
@ApiTags('Developer')
@ApiBearerAuth()
@Controller('developer/access')
export class AccessController {
  constructor(private readonly a: AccessService) {}

  @Get() @DeveloperOnly()
  overview() { return this.a.overview(); }

  @Post('roles') @DeveloperOnly()
  create(@CurrentUser() u: RequestUser, @Body(new ZodPipe(NewRole)) b: z.infer<typeof NewRole>, @Req() r: AppRequest) { return this.a.createRole(u, b, clientMeta(r)); }
  @Patch('roles/:id') @DeveloperOnly()
  update(@CurrentUser() u: RequestUser, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(EditRole)) b: z.infer<typeof EditRole>, @Req() r: AppRequest) { return this.a.updateRole(u, id, b, clientMeta(r)); }
  @Delete('roles/:id') @HttpCode(200) @DeveloperOnly()
  remove(@CurrentUser() u: RequestUser, @Param('id', ParseIntPipe) id: number, @Req() r: AppRequest) { return this.a.deleteRole(u, id, clientMeta(r)); }
  @Put('roles/:id/grants') @DeveloperOnly()
  grants(@CurrentUser() u: RequestUser, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(GrantsB)) b: { grants: Grants }, @Req() r: AppRequest) { return this.a.setGrants(u, id, b.grants, clientMeta(r)); }

  @Get('people/:id') @DeveloperOnly()
  person(@Param('id') id: string) { return this.a.person(id); }
  @Put('people/:id/exceptions') @DeveloperOnly()
  exceptions(@CurrentUser() u: RequestUser, @Param('id') id: string, @Body(new ZodPipe(OverridesB)) b: { workspace: 'staff' | 'parent' | 'student'; overrides: Override[] }, @Req() r: AppRequest) {
    return this.a.setOverrides(u, id, b.workspace, b.overrides, clientMeta(r));
  }
}
