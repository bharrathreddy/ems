import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Patch, Post, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe';
import { clientMeta, CurrentUser, type AppRequest, type RequestUser } from '../common/request-user';
import { RequirePermission } from '../permissions/permission.guard';
import { InventoryService, type ItemBody, type MoveBody, type SaleBody, type SetBody } from './inventory.service';
import { renderSalePdf } from './sale-pdf';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date.');
const money = z.number().min(0).max(99_99_99_999).multipleOf(0.01);
const qty = z.number().positive('Enter a quantity.').max(1_000_000).multipleOf(0.01);
const method = z.enum(['cash', 'upi', 'cheque', 'bank_transfer', 'card']);
const Item = z.object({
  name: z.string().trim().min(2, 'Enter the item name.').max(120), category: z.string().trim().min(2, 'Choose or type a category.').max(60), unit: z.string().trim().min(1).max(20),
  salePrice: money.nullish(), trackStock: z.boolean(), lowStockAt: z.number().min(0).max(1_000_000).nullish(), isActive: z.boolean().optional(), openingQty: z.number().min(0).max(1_000_000).nullish(),
});
const Move = z.object({
  itemId: z.number().int().positive(), kind: z.enum(['purchase', 'issue', 'adjust']), qty: z.number().min(0).max(1_000_000).multipleOf(0.01), date, amount: money.nullish(),
  party: z.string().trim().max(150).nullish(), note: z.string().trim().max(255).nullish(),
  expense: z.object({ categoryId: z.number().int().positive(), method, reference: z.string().trim().max(100).nullish() }).nullish(),
}).refine((b) => b.kind === 'adjust' || b.qty > 0, { path: ['qty'], message: 'Enter a quantity.' });
const ItemsQ = z.object({ search: z.string().trim().max(100).optional(), category: z.string().trim().max(60).optional(), low: z.enum(['1', 'true']).optional(), forSale: z.enum(['1', 'true']).optional(), all: z.enum(['1', 'true']).optional() });
const SetB = z.object({ name: z.string().trim().min(2, 'Enter the set name.').max(120), classId: z.number().int().positive().nullish(), price: money.refine((v) => v > 0, 'Enter the set price.'), isActive: z.boolean().optional(),
  lines: z.array(z.object({ itemId: z.number().int().positive(), qty })).min(1, 'Add at least one item.').max(80) });
const Sale = z.object({
  studentId: z.string().max(40).nullish(), buyerName: z.string().trim().max(150).nullish(), date, method, reference: z.string().trim().max(100).nullish(),
  lines: z.array(z.object({ itemId: z.number().int().positive().nullish(), setId: z.number().int().positive().nullish(), qty })).min(1, 'Add an item or a set.').max(60),
});
const SalesQ = z.object({ from: date.optional(), to: date.optional(), search: z.string().trim().max(100).optional(), studentId: z.string().max(40).optional() });
const Reason = z.object({ reason: z.string().trim().min(3, 'Give a reason.').max(255) });

@ApiTags('Stock & sales')
@ApiBearerAuth()
@Controller()
export class InventoryController {
  constructor(private readonly inv: InventoryService) {}

  @Get('inventory/items') @RequirePermission('inventory', 'view')
  items(@Query(new ZodPipe(ItemsQ)) q: z.infer<typeof ItemsQ>) { return this.inv.items({ search: q.search, category: q.category, low: !!q.low, forSale: !!q.forSale, includeInactive: !!q.all }); }
  @Post('inventory/items') @RequirePermission('inventory', 'manage')
  addItem(@CurrentUser() u: RequestUser, @Body(new ZodPipe(Item)) b: ItemBody, @Req() r: AppRequest) { return this.inv.saveItem(u, null, b, clientMeta(r)); }
  @Patch('inventory/items/:id') @RequirePermission('inventory', 'manage')
  editItem(@CurrentUser() u: RequestUser, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(Item)) b: ItemBody, @Req() r: AppRequest) { return this.inv.saveItem(u, id, b, clientMeta(r)); }
  @Get('inventory/items/:id/history') @RequirePermission('inventory', 'view')
  history(@Param('id', ParseIntPipe) id: number) { return this.inv.history(id); }
  @Post('inventory/movements') @RequirePermission('inventory', 'manage')
  move(@CurrentUser() u: RequestUser, @Body(new ZodPipe(Move)) b: MoveBody, @Req() r: AppRequest) { return this.inv.move(u, b, clientMeta(r)); }
  @Post('inventory/movements/:id/undo') @HttpCode(200) @RequirePermission('inventory', 'manage')
  undo(@CurrentUser() u: RequestUser, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(Reason)) b: { reason: string }, @Req() r: AppRequest) { return this.inv.undoPurchase(u, id, b.reason, clientMeta(r)); }

  @Get('inventory/sets') @RequirePermission('inventory', 'view')
  sets() { return this.inv.sets(); }
  @Post('inventory/sets') @RequirePermission('inventory', 'manage')
  addSet(@CurrentUser() u: RequestUser, @Body(new ZodPipe(SetB)) b: SetBody, @Req() r: AppRequest) { return this.inv.saveSet(u, null, b, clientMeta(r)); }
  @Patch('inventory/sets/:id') @RequirePermission('inventory', 'manage')
  editSet(@CurrentUser() u: RequestUser, @Param('id', ParseIntPipe) id: number, @Body(new ZodPipe(SetB)) b: SetBody, @Req() r: AppRequest) { return this.inv.saveSet(u, id, b, clientMeta(r)); }

  @Get('sales') @RequirePermission('inventory', 'sell')
  sales(@Query(new ZodPipe(SalesQ)) q: z.infer<typeof SalesQ>) { return this.inv.sales(q); }
  @Post('sales') @RequirePermission('inventory', 'sell')
  sell(@CurrentUser() u: RequestUser, @Body(new ZodPipe(Sale)) b: SaleBody, @Req() r: AppRequest) { return this.inv.createSale(u, b, clientMeta(r)); }
  @Post('sales/:id/cancel') @HttpCode(200) @RequirePermission('inventory', 'manage')
  cancel(@CurrentUser() u: RequestUser, @Param('id') id: string, @Body(new ZodPipe(Reason)) b: { reason: string }, @Req() r: AppRequest) { return this.inv.cancelSale(u, id, b.reason, clientMeta(r)); }
  @Get('sales/:id/pdf') @RequirePermission('inventory', 'sell')
  async pdf(@Param('id') id: string, @Res() res: Response) {
    const s = await this.inv.sale(id);
    const buf = await renderSalePdf(s);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${s.receipt_no.replace(/[^\w-]+/g, '-')}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(buf);
  }
}
