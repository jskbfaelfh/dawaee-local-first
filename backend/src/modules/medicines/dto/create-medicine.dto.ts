import { IsNotEmpty, IsString, IsOptional, IsInt, Min, IsBoolean } from 'class-validator';

export class CreateMedicineDto {
  @IsString()
  @IsNotEmpty({ message: 'الاسم التجاري مطلوب' })
  tradeName: string;

  @IsString()
  @IsNotEmpty({ message: 'الاسم العلمي مطلوب' })
  scientificName: string;

  @IsString()
  @IsOptional()
  dosageForm?: string; // حبوب، كبسول، شراب، مرهم، حقن...

  @IsString()
  @IsOptional()
  strength?: string; // 500mg, 100ml, 1g...

  @IsString()
  @IsOptional()
  manufacturer?: string; // الشركة المصنعة

  @IsString()
  @IsOptional()
  barcode?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  defaultUnitsPerPack?: number; // الافتراضي: 1

  @IsBoolean()
  @IsOptional()
  isVerified?: boolean;
}

export class QueryMedicineDto {
  @IsString()
  @IsOptional()
  q?: string; // Search term (tradeName, scientificName, or barcode)

  @IsString()
  @IsOptional()
  search?: string; // Alias for q

  @IsString()
  @IsOptional()
  barcode?: string;

  @IsString()
  @IsOptional()
  updatedSince?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  limit?: number = 30;
}
