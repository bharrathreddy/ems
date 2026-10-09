import { Controller, Get, HttpCode, Param, ParseIntPipe, Post, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Errors } from '../common/app-error';
import { clientMeta, CurrentUser, type AppRequest, type RequestUser } from '../common/request-user';
import { RequirePermission } from '../permissions/permission.guard';
import { ImportsService, type ImportType } from './imports.service';

const TYPES: ImportType[] = ['families_students', 'staff', 'opening_fees'];
const parseType = (t: string) => {
  if (!TYPES.includes(t as ImportType)) throw Errors.notFound('Import type');
  return t as ImportType;
};

@ApiTags('Imports')
@ApiBearerAuth()
@Controller('imports')
export class ImportsController {
  constructor(private readonly svc: ImportsService) {}

  @Get()
  @RequirePermission('imports', 'view')
  history(@CurrentUser() u: RequestUser) {
    return this.svc.history(u);
  }

  @Get('templates/:type')
  @RequirePermission('imports', 'run')
  async template(@Param('type') t: string, @Res() res: Response) {
    const type = parseType(t);
    const buf = await this.svc.template(type);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const name = { staff: 'staff', families_students: 'families-students', opening_fees: 'opening-fee-balances' }[type];
    res.setHeader('Content-Disposition', `attachment; filename="${name}-template.xlsx"`);
    res.send(buf);
  }

  @Post(':type/validate')
  @HttpCode(200)
  @RequirePermission('imports', 'run')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  validate(@CurrentUser() u: RequestUser, @Param('type') t: string, @UploadedFile() file?: Express.Multer.File) {
    const type = parseType(t);
    this.svc.assertTypePermission(u, type);
    if (!file) throw Errors.badRequest('NO_FILE', 'Choose an Excel file to upload.');
    if (!/\.xlsx$/i.test(file.originalname)) throw Errors.badRequest('WRONG_FILE_TYPE', 'Upload an Excel .xlsx file (File > Save As > Excel Workbook).');
    return this.svc.validate(u, type, file);
  }

  @Post(':jobId/commit')
  @HttpCode(200)
  @RequirePermission('imports', 'run')
  commit(@CurrentUser() u: RequestUser, @Param('jobId', ParseIntPipe) id: number, @Req() req: AppRequest) {
    return this.svc.commit(u, id, clientMeta(req));
  }
}
