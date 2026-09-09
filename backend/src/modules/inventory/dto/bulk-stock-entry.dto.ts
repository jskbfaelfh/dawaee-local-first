import {
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
  Min,
  Max,
  IsInt,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CreateMedicineDto } from '../../medicines/dto/create-medicine.dto';

export enum PaymentStatusEnum {
  PAID = 'PAID',
  UNPAID = 'UNPAID',
  PARTIAL = 'PARTIAL',
}

export class BulkStockItemDto {
  @IsString()
  @IsOptional()
  medicineId?: string;

  @IsString()
  @IsOptional()
  customName?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CreateMedicineDto)
  newMedicineData?: CreateMedicineDto;

  @IsInt()
  @Min(1)
  unitsPerPack: number;

  @IsInt()
  @Min(1, { message: 'الكمية يجب أن تكون علبة واحدة على الأقل' })
  quantityPacks: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  bonusPacks?: number;

  @IsOptional()
  amortizeBonus?: boolean;

  @IsString()
  @IsOptional()
  bonusBatchNumber?: string;

  @IsInt()
  @Min(1)
  @Max(12)
  @IsOptional()
  bonusExpiryMonth?: number;

  @IsInt()
  @Min(2024)
  @Max(2050)
  @IsOptional()
  bonusExpiryYear?: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  discountPercent?: number;

  @IsNumber()
  @Min(250, { message: 'أقل سعر شراء للعلبة هو 250 د.ع' })
  purchasePricePack: number;

  @IsNumber()
  @Min(250, { message: 'أقل سعر بيع للعلبة هو 250 د.ع' })
  sellingPricePack: number;

  @IsNumber()
  @Min(250, { message: 'أقل سعر بيع للشريط هو 250 د.ع' })
  sellingPriceUnit: number;

  @IsInt()
  @Min(1)
  @Max(12)
  expiryMonth: number;

  @IsInt()
  @Min(2024)
  @Max(2050)
  expiryYear: number;

  @IsString()
  @IsOptional()
  batchNumber?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  minAlertUnits?: number;

  @IsString()
  @IsOptional()
  shelfLocation?: string;
}

export class BulkStockEntryDto {
  @IsString()
  @IsOptional()
  supplierId?: string;

  @IsString()
  @IsOptional()
  supplierName?: string;

  @IsString()
  @IsOptional()
  supplierPhone?: string;

  @IsString()
  @IsOptional()
  supplierInvoiceNumber?: string;

  @IsString()
  @IsOptional()
  paymentStatus?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  paidAmount?: number;

  @IsString()
  @IsOptional()
  dueDate?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  directDiscountAmount?: number;

  @IsString()
  @IsOptional()
  directDiscountType?: 'AMOUNT' | 'PERCENT';

  @IsNumber()
  @Min(0)
  @IsOptional()
  directDiscountPercent?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkStockItemDto)
  items: BulkStockItemDto[];
}

export class UpdateItemPriceDto {
  @IsString()
  @IsOptional()
  customName?: string;

  @IsNumber()
  @Min(250, { message: 'أقل سعر بيع للعلبة هو 250 د.ع' })
  sellingPricePack: number;

  @IsNumber()
  @Min(250, { message: 'أقل سعر بيع للشريط هو 250 د.ع' })
  sellingPriceUnit: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  minAlertUnits?: number;

  @IsString()
  @IsOptional()
  shelfLocation?: string;
}

export class CreateSupplierDto {
  @IsString()
  @IsNotEmpty({ message: 'اسم المذخر / المورد مطلوب' })
  name: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class UpdateSupplierDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  address?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class RecordSupplierPaymentDto {
  @IsNumber()
  @Min(0, { message: 'مبلغ الدفعة لا يمكن أن يكون سالباً' })
  amount: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  discountPercent?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  discountAmount?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  netPaidAmount?: number;

  @IsString()
  @IsOptional()
  paymentDate?: string;

  @IsString()
  @IsOptional()
  paymentMethod?: string;

  @IsString()
  @IsOptional()
  receiptNumber?: string;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsString()
  @IsOptional()
  receiptImage?: string;
}

export class ReturnToSupplierDto {
  @IsNumber()
  @Min(1, { message: 'الكمية المرتجعة يجب أن تكون وحدة واحدة على الأقل' })
  quantityUnits!: number;

  @IsString()
  @IsOptional()
  reason?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  unitRefundPrice?: number;

  @IsOptional()
  deductFromSupplierDebt?: boolean;
}
