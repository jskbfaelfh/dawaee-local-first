import { IsString, IsNotEmpty, IsOptional, IsEnum, IsNumber, Min } from 'class-validator';

export enum StocktakeType {
  ANNUAL = 'ANNUAL',
  SEMI_ANNUAL = 'SEMI_ANNUAL',
  PARTIAL = 'PARTIAL',
}

export enum StocktakeStatus {
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export class CreateStocktakeSessionDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsEnum(StocktakeType)
  @IsOptional()
  type?: StocktakeType;

  @IsString()
  @IsOptional()
  shelfFilter?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class RecordItemCountDto {
  @IsString()
  @IsOptional()
  stocktakeItemId?: string;

  @IsString()
  @IsOptional()
  barcode?: string;

  @IsString()
  @IsOptional()
  medicineId?: string;

  @IsNumber()
  @Min(0)
  countedPacks: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  countedLoose?: number;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class ReconcileStocktakeDto {
  @IsString()
  @IsOptional()
  notes?: string;
}
