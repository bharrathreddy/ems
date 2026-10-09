import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe';
import { clientMeta, CurrentUser, type AppRequest, type RequestUser } from '../common/request-user';
import { RequirePermission } from '../permissions/permission.guard';
import { normalizeMobile } from '../auth/passwords';
import { StudentsService } from './students.service';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.');
const opt = (s: z.ZodTypeAny) => s.nullish().transform((v: any) => (v === '' ? null : v));
export const mobileSchema = z.string().transform((v, ctx) => {
  const m = normalizeMobile(v);
  if (!m) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid 10-digit mobile number.' });
  return m ?? '';
});
const optMobile = z.string().nullish().transform((v, ctx) => {
  if (!v) return null;
  const m = normalizeMobile(v);
  if (!m) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid 10-digit mobile number.' });
  return m;
});
const FamilyBody = z.object({
  familyName: z.string().trim().min(2).max(150),
  fatherName: opt(z.string().trim().max(150)), motherName: opt(z.string().trim().max(150)), guardianName: opt(z.string().trim().max(150)),
  mobile: mobileSchema, altMobile: optMobile,
  email: z.string().trim().toLowerCase().email().or(z.literal('')).nullish().transform((v) => v || null),
  address: opt(z.string().trim().max(500)),
});
const StudentFields = z.object({
  admissionNo: opt(z.string().trim().max(30)),
  firstName: z.string().trim().min(1).max(100),
  lastName: opt(z.string().trim().max(100)),
  dob: opt(date), gender: z.enum(['male', 'female', 'other']).nullish(),
  bloodGroup: opt(z.string().trim().max(5)), admissionDate: opt(date), address: opt(z.string().trim().max(500)),
  classId: z.coerce.number().int().positive(), sectionId: z.coerce.number().int().positive(),
  rollNo: opt(z.string().trim().max(10)),
});
const CreateBody = StudentFields.extend({ family: z.union([z.object({ familyId: z.string().length(26) }), FamilyBody]) });
const ListQuery = z.object({
  search: z.string().trim().max(100).optional(),
  classId: z.coerce.number().int().positive().optional(),
  sectionId: z.coerce.number().int().positive().optional(),
  status: z.enum(['active', 'inactive']).default('active'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
const StatusBody = z.object({ reason: z.string().trim().max(255).nullish() });

@ApiTags('Students')
@ApiBearerAuth()
@Controller()
export class StudentsController {
  constructor(private readonly students: StudentsService) {}

  @Get('students')
  @RequirePermission('students', 'view')
  list(@CurrentUser() u: RequestUser, @Query(new ZodPipe(ListQuery)) q: z.infer<typeof ListQuery>) {
    return this.students.list(u, q);
  }

  @Get('students/:id')
  @RequirePermission('students', 'view')
  get(@CurrentUser() u: RequestUser, @Param('id') id: string) {
    return this.students.get(u, id);
  }

  @Post('students')
  @RequirePermission('students', 'create')
  create(@CurrentUser() u: RequestUser, @Body(new ZodPipe(CreateBody)) b: z.infer<typeof CreateBody>, @Req() req: AppRequest) {
    return this.students.create(u, b as any, clientMeta(req));
  }

  @Patch('students/:id')
  @RequirePermission('students', 'edit')
  update(@CurrentUser() u: RequestUser, @Param('id') id: string, @Body(new ZodPipe(StudentFields.partial())) b: any, @Req() req: AppRequest) {
    return this.students.update(u, id, b, clientMeta(req));
  }

  @Post('students/:id/deactivate')
  @HttpCode(200)
  @RequirePermission('students', 'deactivate')
  deactivate(@CurrentUser() u: RequestUser, @Param('id') id: string, @Body(new ZodPipe(StatusBody)) b: z.infer<typeof StatusBody>, @Req() req: AppRequest) {
    return this.students.setStatus(u, id, false, b.reason ?? null, clientMeta(req));
  }

  @Post('students/:id/activate')
  @HttpCode(200)
  @RequirePermission('students', 'deactivate')
  activate(@CurrentUser() u: RequestUser, @Param('id') id: string, @Req() req: AppRequest) {
    return this.students.setStatus(u, id, true, null, clientMeta(req));
  }

  @Get('families/lookup')
  @RequirePermission('families', 'view')
  lookup(@Query(new ZodPipe(z.object({ mobile: mobileSchema }))) q: { mobile: string }) {
    return this.students.searchFamily(q.mobile);
  }

  @Patch('families/:id')
  @RequirePermission('families', 'edit')
  updateFamily(@CurrentUser() u: RequestUser, @Param('id') id: string, @Body(new ZodPipe(FamilyBody.partial())) b: any, @Req() req: AppRequest) {
    return this.students.updateFamily(u, id, b, clientMeta(req));
  }
}
