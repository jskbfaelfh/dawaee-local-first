import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  Max,
  MaxLength,
  ArrayMaxSize,
  ArrayMinSize,
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

  @IsNumber({}, { message: 'الكمية يجب أن تكون رقماً صالحاً' })
  @Min(0.01, { message: 'الكمية يجب أن تكون أكبر من صفر' })
  @Max(10000, { message: 'الكمية لا يمكن أن تتجاوز 10,000 في العملية الواحدة' })
  quantity: number;
}

export class OfflineBatchAllocationDto {
  @IsUUID('all')
  inventoryItemId: string;

  @IsUUID('all')
  @IsOptional()
  batchId?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  batchNumber?: string;

  @IsNumber()
  @Min(0.01)
  units: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  unitPrice?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  costPricePack?: number;
}

export class CheckoutDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'يجب تضمين مادة واحدة على الأقل في الفاتورة' })
  @ArrayMaxSize(500, { message: 'عدد المواد في الفاتورة لا يمكن أن يتجاوز 500 مادة' })
  @ValidateNested({ each: true })
  @Type(() => CartItemDto)
  items: CartItemDto[];

  @IsNumber()
  @IsOptional()
  @Min(0)
  discountAmount?: number = 0; // خصم مبلغ مباشر (IQD)

  @IsString()
  @IsOptional()
  @MaxLength(100)
  offlineId?: string; // معرف البيعة المحلي للأوفلاين لمنع تكرار الإرسال والخصم

  @IsString()
  @IsOptional()
  @MaxLength(100)
  offlineInvoiceNumber?: string; // رقم الفاتورة المحلي المطبوع للمريض للاعتماد السحابي الموحد

  @IsString()
  @IsOptional()
  @MaxLength(150)
  customerName?: string; // اسم الزبون / المشتري (اختياري)

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => OfflineBatchAllocationDto)
  allocatedBatches?: OfflineBatchAllocationDto[];
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

  @IsNumber()
  @Min(0.01)
  @Max(10000)
  quantity: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  refundAmount?: number; // المبلغ المرجع (إذا تُرك فارغاً يُحسب تلقائياً)

  @IsString()
  @IsNotEmpty({ message: 'سبب الإرجاع مطلوب إلزامياً للتدقيق والرقابة المخزنية' })
  @MaxLength(255, { message: 'سبب الإرجاع يجب ألا يتجاوز 255 حرفاً' })
  reason: string;

  @IsEnum(ItemConditionEnum)
  @IsOptional()
  itemCondition?: ItemConditionEnum = ItemConditionEnum.RESALEABLE;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  paymentMethod?: string = 'CASH';

  @IsString()
  @IsOptional()
  @MaxLength(500)
  notes?: string;
}

export class OfflineSaleItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  offlineId: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  offlineInvoiceNumber?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => CartItemDto)
  items: CartItemDto[];

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => OfflineBatchAllocationDto)
  allocatedBatches?: OfflineBatchAllocationDto[];

  @IsNumber()
  @IsOptional()
  @Min(0)
  discountAmount?: number = 0;

  @IsString()
  @IsOptional()
  @MaxLength(150)
  customerName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  createdAt?: string;
}

export class SyncOfflineSalesDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'يجب إرسال فاتورة واحدة على الأقل للمزامنة' })
  @ArrayMaxSize(1000, { message: 'الحد الأقصى لحزمة المزامنة الواحدة هو 1000 فاتورة' })
  @ValidateNested({ each: true })
  @Type(() => OfflineSaleItemDto)
  sales: OfflineSaleItemDto[];
}
