import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { config } from '../config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

@Module({
  imports: [JwtModule.register({ secret: config.jwtAccessSecret, signOptions: { algorithm: 'HS256' }, verifyOptions: { algorithms: ['HS256'] } })],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard],
  exports: [AuthService, JwtAuthGuard, JwtModule],
})
export class AuthModule {}
