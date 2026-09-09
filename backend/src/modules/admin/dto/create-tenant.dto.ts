import {
  IsNotEmpty,
  IsString,
  IsNumber,
  IsOptional,
  MinLength,
  IsInt,
  Min,
  IsBoolean,
  IsArray,
  ValidateNested,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateTenantDto {
  @IsString()
  @IsNotEmpty({ message: 'اسم الصيدلية مطلوب' })
  name: string;

  @IsString()
  @IsOptional()
  @Matches(/^[a-z0-9-_]+$/, { message: 'المعرف اللطيف (slug) يجب أن يحتوي فقط على أحرف إنجليزية وأرقام وشخطات' })
  slug?: string;

  @IsString()
  @IsNotEmpty({ message: 'المحافظة مطلوبة' })
  governorate: string;

  @IsString()
  @IsNotEmpty({ message: 'المنطقة / الحي مطلوب' })
  district: string;

  @IsString()
  @IsOptional()
  addressDetails?: string;

  @IsString()
  @IsOptional()
  googleMapsUrl?: string;

  @IsNumber()
  @IsOptional()
  latitude?: number;

  @IsNumber()
  @IsOptional()
  longitude?: number;

  @IsString()
  @IsOptional()
  phone?: string; // Optional

  @IsInt()
  @Min(1, { message: 'مدة الاشتراك يجب أن تكون شهراً واحداً على الأقل' })
  subscriptionMonths: number; // e.g. 1, 6, 12, 24 months

  // Owner Account Info
  @IsString()
  @IsNotEmpty({ message: 'اسم صاحب الصيدلية مطلوب' })
  ownerName: string;

  @IsString()
  @IsNotEmpty({ message: 'اسم مستخدم المالك مطلوب' })
  ownerUsername: string;

  @IsString()
  @IsOptional()
  @MinLength(8, { message: 'كلمة مرور صاحب الصيدلية يجب أن لا تقل عن 8 أحرف وأرقام' })
  ownerPassword?: string;

  @IsString()
  @IsOptional()
  ownerUserId?: string;

  @IsString()
  @IsOptional()
  ownerPasswordHash?: string;

  // Auto Create Cashier Account
  @IsBoolean()
  @IsOptional()
  createCashier?: boolean;

  @IsInt()
  @IsOptional()
  @Min(0)
  cashierCount?: number; // e.g. 1, 2, 3, 5

  @IsString()
  @IsOptional()
  cashierName?: string;

  @IsString()
  @IsOptional()
  cashierUsername?: string;

  @IsString()
  @IsOptional()
  @MinLength(8, { message: 'كلمة مرور الكاشير يجب أن لا تقل عن 8 أحرف وأرقام' })
  cashierPassword?: string;

  // Multi-Branch Chain Options
  @IsBoolean()
  @IsOptional()
  isChain?: boolean;

  @IsString()
  @IsOptional()
  chainName?: string;

  @IsString()
  @IsOptional()
  chainId?: string;

  @IsString()
  @IsOptional()
  chainRole?: string;
}

export class AddBranchDto {
  @IsString()
  @IsNotEmpty({ message: 'اسم الفرع مطلوب' })
  name: string;

  @IsString()
  @IsOptional()
  @Matches(/^[a-z0-9-_]+$/, { message: 'المعرف اللطيف (slug) يجب أن يحتوي فقط على أحرف إنجليزية وأرقام وشخطات' })
  slug?: string;

  @IsString()
  @IsNotEmpty({ message: 'المحافظة مطلوبة' })
  governorate: string;

  @IsString()
  @IsNotEmpty({ message: 'المنطقة / الحي مطلوب' })
  district: string;

  @IsString()
  @IsOptional()
  addressDetails?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsInt()
  @Min(1, { message: 'مدة الاشتراك يجب أن تكون شهراً واحداً على الأقل' })
  subscriptionMonths: number;

  @IsString()
  @IsOptional()
  ownerName?: string;

  @IsString()
  @IsOptional()
  ownerUsername?: string;

  @IsString()
  @IsOptional()
  ownerPassword?: string;

  @IsInt()
  @IsOptional()
  @Min(0)
  cashierCount?: number;

  @IsString()
  @IsOptional()
  @MinLength(8, { message: 'كلمة مرور الكاشير يجب أن لا تقل عن 8 أحرف وأرقام' })
  cashierPassword?: string;
}

export class LinkTenantsDto {
  @IsString({ each: true })
  @IsNotEmpty({ message: 'يجب تحديد معرفات الصيدليات المراد ربطها' })
  tenantIds: string[];

  @IsString()
  @IsNotEmpty({ message: 'اسم السلسلة مطلوب' })
  chainName: string;
}

export class BulkBranchItemDto {
  @IsString()
  @IsNotEmpty({ message: 'اسم الفرع مطلوب' })
  name: string;

  @IsString()
  @IsOptional()
  @Matches(/^[a-z0-9-_]+$/, { message: 'المعرف اللطيف (slug) يجب أن يحتوي فقط على أحرف إنجليزية وأرقام وشخطات' })
  slug?: string;

  @IsBoolean()
  @IsOptional()
  isHQ?: boolean;

  @IsString()
  @IsNotEmpty({ message: 'المحافظة مطلوبة' })
  governorate: string;

  @IsString()
  @IsNotEmpty({ message: 'المنطقة / الحي مطلوب' })
  district: string;

  @IsString()
  @IsOptional()
  addressDetails?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsInt()
  @Min(1, { message: 'مدة الاشتراك يجب أن تكون شهراً واحداً على الأقل' })
  subscriptionMonths: number;

  @IsInt()
  @IsOptional()
  @Min(0)
  cashierCount?: number;

  @IsString()
  @IsOptional()
  @MinLength(8, { message: 'كلمة مرور الكاشير يجب أن لا تقل عن 8 أحرف وأرقام' })
  cashierPassword?: string;
}

export class BulkChainOnboardingDto {
  @IsString()
  @IsNotEmpty({ message: 'اسم السلسلة مطلوب' })
  chainName: string;

  @IsString()
  @IsNotEmpty({ message: 'اسم صاحب الصيدليات مطلوب' })
  ownerName: string;

  @IsString()
  @IsOptional()
  ownerPhone?: string;

  @IsString()
  @IsNotEmpty({ message: 'اسم مستخدم المالك الموحد مطلوب' })
  ownerUsername: string;

  @IsString()
  @MinLength(8, { message: 'كلمة مرور المالك يجب أن لا تقل عن 8 أحرف وأرقام' })
  ownerPassword: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkBranchItemDto)
  branches: BulkBranchItemDto[];
}

export class MergeChainsDto {
  @IsString()
  @IsNotEmpty({ message: 'اسم السلسلة الموحدة مطلوب' })
  chainName: string;

  @IsString()
  @IsNotEmpty({ message: 'يجب تحديد الصيدلية الرئيسية (HQ)' })
  hqTenantId: string;

  @IsString({ each: true })
  @IsNotEmpty({ message: 'يجب تحديد الفروع التابعة' })
  branchTenantIds: string[];
}

export class UpdateTenantDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  governorate?: string;

  @IsString()
  @IsOptional()
  district?: string;

  @IsString()
  @IsOptional()
  addressDetails?: string;

  @IsString()
  @IsOptional()
  googleMapsUrl?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  subscriptionStatus?: 'ACTIVE' | 'EXPIRED' | 'SUSPENDED';

  @IsString()
  @IsOptional()
  subscriptionEndsAt?: string;
}

export class UpdateSubscriptionDto {
  @IsInt()
  @Min(1, { message: 'عدد أشهر التمديد يجب أن يكون 1 على الأقل' })
  extendMonths: number;
}

export class UpdateStatusDto {
  @IsString()
  @IsNotEmpty()
  status: 'ACTIVE' | 'EXPIRED' | 'SUSPENDED';
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(8, { message: 'كلمة المرور الجديدة يجب أن لا تقل عن 8 أحرف وأرقام' })
  newPassword: string;
}
