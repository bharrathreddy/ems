import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe';
import { clientMeta, CurrentUser, type AppRequest, type RequestUser } from '../common/request-user';
import { RequirePermission } from '../permissions/permission.guard';
import { normalizeMobile } from '../auth/passwords';
import { StaffService } from './staff.service';

const mobile = z.string().transform((v, ctx) => {
  const m = normalizeMobile(v);
  if (!m) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid 10-digit mobile number.' });
  return m ?? '';
});
const StaffBody = z.object({
  name: z.string().trim().min(2).max(150),
  email: z.string().trim().email().max(190),
  mobile,
  employeeCode: z.string().trim().min(1).max(30),
  designation: z.string().trim().max(100).nullish(),
  department: z.string().trim().max(100).nullish(),
  qualification: z.string().trim().max(200).nullish(),
  joiningDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
  gender: z.enum(['male', 'female', 'other']).nullish(),
  roleKeys: z.array(z.string()).min(1, 'Choose at least one role.'),
});
const ListQuery = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

@ApiTags('Staff')
@ApiBearerAuth()
@Controller()
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get('roles/staff')
  @RequirePermission('staff', 'view')
  roles() {
    return this.staff.listStaffRoles();
  }

  @Get('staff')
  @RequirePermission('staff', 'view')
  list(@Query(new ZodPipe(ListQuery)) q: z.infer<typeof ListQuery>) {
    return this.staff.list(q);
  }

  @Get('staff/:id')
  @RequirePermission('staff', 'view')
  get(@Param('id') id: string) {
    return this.staff.get(id);
  }

  @Post('staff')
  @RequirePermission('staff', 'create')
  create(@CurrentUser() u: RequestUser, @Body(new ZodPipe(StaffBody)) b: z.infer<typeof StaffBody>, @Req() req: AppRequest) {
    return this.staff.create(u, b, clientMeta(req));
  }

  @Patch('staff/:id')
  @RequirePermission('staff', 'edit')
  update(@CurrentUser() u: RequestUser, @Param('id') id: string, @Body(new ZodPipe(StaffBody.partial())) b: Partial<z.infer<typeof StaffBody>>, @Req() req: AppRequest) {
    return this.staff.update(u, id, b, clientMeta(req));
  }

  @Post('users/:id/credentials')
  @HttpCode(200)
  @RequirePermission('users', 'issue_credentials')
  credentials(@CurrentUser() u: RequestUser, @Param('id') id: string, @Req() req: AppRequest) {
    return this.staff.issueCredentials(u, id, clientMeta(req));
  }

  @Post('users/:id/disable')
  @HttpCode(200)
  @RequirePermission('users', 'disable')
  disable(@CurrentUser() u: RequestUser, @Param('id') id: string, @Req() req: AppRequest) {
    return this.staff.setAccountStatus(u, id, false, clientMeta(req));
  }

  @Post('users/:id/enable')
  @HttpCode(200)
  @RequirePermission('users', 'disable')
  enable(@CurrentUser() u: RequestUser, @Param('id') id: string, @Req() req: AppRequest) {
    return this.staff.setAccountStatus(u, id, true, clientMeta(req));
  }
}
