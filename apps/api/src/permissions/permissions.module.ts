import { Global, Module } from '@nestjs/common';
import { PermissionsService } from './permissions.service';
import { PermissionGuard } from './permission.guard';

@Global()
@Module({ providers: [PermissionsService, PermissionGuard], exports: [PermissionsService, PermissionGuard] })
export class PermissionsModule {}
