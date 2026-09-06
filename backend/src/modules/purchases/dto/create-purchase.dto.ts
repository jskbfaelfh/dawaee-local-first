import { IsString, IsNotEmpty, IsOptional, IsNumber, IsArray, ValidateNested, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class PurchaseItemDto {
  @IsString()
  @IsOptional()
  medicineId?: string;

  @IsString()
  @IsOptional()
  tradeName?: string;

  @IsString()
  @IsOptional()
  customTradeName?: string;

  @IsString()
  @IsOptional()
  scientificName?: string;

  @IsString()
  @IsOptional()
  barcode?: string;

  @IsString()
  @IsOptional()
  batchNumber?: string;

  @IsString()
  @IsOptional()
  expiryDate?: string;

  @IsNumber()
  @Min(0.01)
  quantityPacks!: number;

  @IsNumber()
  @IsOptional()
  bonusPacks?: number;

  @IsNumber()
  @Min(1)
  unitsPerPack!: number;

  @IsNumber()
  @Min(0)
  purchasePricePack!: number;

  @IsNumber()
  @IsOptional()
  discountPercent?: number;

  @IsNumber()
  @Min(0)
  sellingPricePack!: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  sellingPriceUnit?: number;

  @IsString()
  @IsOptional()
  shelfLocation?: string;
}

export class CreatePurchaseDto {
  @IsString()
  @IsNotEmpty()
  invoiceNumber!: string;

  @IsString()
  @IsOptional()
  supplierId?: string;

  @IsString()
  @IsOptional()
  supplierName?: string;

  @IsString()
  @IsOptional()
  invoiceDate?: string;

  @IsNumber()
  @Min(0)
  totalAmount!: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  paidAmount?: number;

  @IsNumber()
  @IsOptional()
  earlyDiscountDays?: number;

  @IsNumber()
  @IsOptional()
  earlyDiscountPercent?: number;

  @IsArray()
  @IsOptional()
  discountTiers?: any[];

  @IsString()
  @IsOptional()
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PurchaseItemDto)
  items!: PurchaseItemDto[];
}
