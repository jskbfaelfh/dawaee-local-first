import { IsOptional, IsString, IsNumber, Min, Max, MaxLength } from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class PublicSearchQueryDto {
  @IsString()
  @IsOptional()
  @MaxLength(200)
  q?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  governorate?: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  district?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  userLat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  userLng?: number;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  only24Hours?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 50;
}
