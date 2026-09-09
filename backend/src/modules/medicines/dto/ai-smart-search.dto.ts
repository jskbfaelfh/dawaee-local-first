import { IsNotEmpty, IsOptional, IsString, IsBoolean } from 'class-validator';

export class AiSmartSearchDto {
  @IsString({ message: 'نص البحث يجب أن يكون نصاً صالحاً' })
  @IsNotEmpty({ message: 'يرجى إدخال نص البحث المطلوب' })
  query: string;

  @IsOptional()
  @IsBoolean()
  inStockOnly?: boolean;
}
