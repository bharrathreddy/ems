import { Controller, Get, HttpCode, Inject, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { KYSELY, type Database } from '../database/database.module';
import { CurrentUser, type RequestUser } from '../common/request-user';

/** In-app notification centre. Every user sees only their own notifications for the active workspace. */
@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(@Inject(KYSELY) private readonly db: Database) {}

  private mine(u: RequestUser) {
    return this.db.selectFrom('notifications').where('user_id', '=', u.id).where('workspace', '=', u.workspace);
  }

  @Get()
  async list(@CurrentUser() u: RequestUser, @Query('unread') unread?: string) {
    let q = this.mine(u).select(['id', 'category', 'title', 'body', 'link_path', 'read_at', 'created_at']);
    if (unread === '1') q = q.where('read_at', 'is', null);
    return q.orderBy('id', 'desc').limit(100).execute();
  }

  @Get('unread-count')
  async count(@CurrentUser() u: RequestUser) {
    const r = await this.mine(u).select((eb) => eb.fn.countAll<number>().as('n')).where('read_at', 'is', null).executeTakeFirstOrThrow();
    return { unread: Number(r.n) };
  }

  @Post(':id/read')
  @HttpCode(200)
  async read(@CurrentUser() u: RequestUser, @Param('id', ParseIntPipe) id: number) {
    await this.db.updateTable('notifications').set({ read_at: new Date() })
      .where('id', '=', id).where('user_id', '=', u.id).where('read_at', 'is', null).execute();
    return { id };
  }

  @Post('read-all')
  @HttpCode(200)
  async readAll(@CurrentUser() u: RequestUser) {
    await this.db.updateTable('notifications').set({ read_at: new Date() })
      .where('user_id', '=', u.id).where('workspace', '=', u.workspace).where('read_at', 'is', null).execute();
    return { done: true };
  }
}
