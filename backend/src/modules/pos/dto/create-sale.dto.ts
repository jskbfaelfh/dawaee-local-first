import {
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum UnitTypeEnum {
  PACK = 'PACK',
  STRIP = 'STRIP',
}

export class CartItemDto {
  @IsUUID('all', { message: 'معرف المادة في المخزن يجب أن يكون UUID صالحاً' })
  @IsNotEmpty({ message: 'معرف المادة في المخزن مطلوب' })
  inventoryItemId: string;

  @IsUUID('all', { message: 'معرف تشغيلة الوجبة يجب أن يكون UUID صالحاً' })
  @IsOptional()
  inventoryBatchId?: string;

  @IsEnum(UnitTypeEnum, { message: 'نوع الوحدة يجب أن يكون PACK أو STRIP' })
  unitType: UnitTypeEnum;

  @IsInt()
  @Min(1, { message: 'الكمية يجب أن تكون 1 على الأقل' })
  quantity: number;
}

export class CheckoutDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CartItemDto)
  items: CartItemDto[];

  @IsNumber()
  @IsOptional()
  @Min(0)
  discountAmount?: number = 0; // خصم مبلغ مباشر (IQD)

  @IsString()
  @IsOptional()
  offlineId?: string; // معرف البيعة المحلي للأوفلاين لمنع تكرار الإرسال والخصم
}

export enum ItemConditionEnum {
  RESALEABLE = 'RESALEABLE',
  DAMAGED = 'DAMAGED',
}

export class CreateReturnDto {
  @IsUUID('all', { message: 'معرف الفاتورة الأصلية يجب أن يكون UUID صالحاً' })
  @IsOptional()
  saleId?: string; // رابط الفاتورة الأصلية (اختياري)

  @IsUUID('all', { message: 'معرف المادة مطلوب ويجب أن يكون UUID صالحاً' })
  @IsNotEmpty({ message: 'معرف المادة مطلوب' })
  inventoryItemId: string;

  @IsUUID('all', { message: 'معرف وجبة التشغيلة يجب أن يكون UUID صالحاً' })
  @IsOptional()
  inventoryBatchId?: string;

  @IsEnum(UnitTypeEnum)
  unitType: UnitTypeEnum;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  refundAmount?: number; // المبلغ المرجع (إذا تُرك فارغاً يُحسب تلقائياً)

  @IsString()
  @IsOptional()
  reason?: string;

  @IsEnum(ItemConditionEnum)
  @IsOptional()
  itemCondition?: ItemConditionEnum = ItemConditionEnum.RESALEABLE;

  @IsString()
  @IsOptional()
  paymentMethod?: string = 'CASH';

  @IsString()
  @IsOptional()
  notes?: string;
}

export class OfflineSaleItemDto {
  @IsString()
  @IsNotEmpty()
  offlineId: string;

  @IsString()
  @IsOptional()
  offlineInvoiceNumber?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CartItemDto)
  items: CartItemDto[];

  @IsNumber()
  @IsOptional()
  @Min(0)
  discountAmount?: number = 0;

  @IsString()
  @IsOptional()
  createdAt?: string;
}

export class SyncOfflineSalesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OfflineSaleItemDto)
  sales: OfflineSaleItemDto[];
}
