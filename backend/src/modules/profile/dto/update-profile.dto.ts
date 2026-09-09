import {
  IsOptional,
  IsString,
  IsBoolean,
  IsNotEmpty,
  MinLength,
} from 'class-validator';

export class UpdatePharmacyProfileDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  governorate?: string;

  @IsOptional()
  @IsString()
  district?: string;

  @IsOptional()
  @IsString()
  addressDetails?: string;

  @IsOptional()
  @IsString()
  googleMapsUrl?: string;

  @IsOptional()
  @IsString()
  logoUrl?: string;

  @IsOptional()
  @IsString()
  receiptHeader?: string;

  @IsOptional()
  @IsString()
  receiptFooter?: string;

  @IsOptional()
  @IsBoolean()
  isSearchVisible?: boolean;

  @IsOptional()
  @IsBoolean()
  showSellingPrices?: boolean;

  @IsOptional()
  @IsBoolean()
  showPhoneNumber?: boolean;

  @IsOptional()
  @IsBoolean()
  showWhatsapp?: boolean;

  @IsOptional()
  @IsBoolean()
  is24Hours?: boolean;

  @IsOptional()
  @IsString()
  geminiApiKey?: string;
}

export class ChangeOwnerPasswordDto {
  @IsString()
  @IsNotEmpty({ message: 'كلمة المرور الحالية مطلوبة' })
  currentPassword: string;

  @IsString()
  @MinLength(8, { message: 'كلمة المرور الجديدة يجب أن لا تقل عن 8 أحرف وأرقام' })
  newPassword: string;
}

export class CreateCashierDto {
  @IsString()
  @IsNotEmpty({ message: 'اسم الكاشير مطلوب' })
  name: string;

  @IsString()
  @IsNotEmpty({ message: 'اسم المستخدم مطلوب' })
  username: string;

  @IsString()
  @MinLength(8, { message: 'كلمة المرور يجب أن لا تقل عن 8 أحرف وأرقام' })
  password: string;
}

export class ResetCashierPasswordDto {
  @IsString()
  @MinLength(8, { message: 'كلمة المرور يجب أن لا تقل عن 8 أحرف وأرقام' })
  newPassword: string;
}
