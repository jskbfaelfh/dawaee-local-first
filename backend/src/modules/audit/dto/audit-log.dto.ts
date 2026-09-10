import { IsString, IsOptional, IsEnum, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';

export enum AuditAction {
  UPDATE_PRICE = 'UPDATE_PRICE',
  DELETE_PURCHASE = 'DELETE_PURCHASE',
  CREATE_PURCHASE = 'CREATE_PURCHASE',
  APPLY_EARLY_DISCOUNT = 'APPLY_EARLY_DISCOUNT',
  PROCESS_RETURN = 'PROCESS_RETURN',
  RETURN_TO_SUPPLIER = 'RETURN_TO_SUPPLIER',
  RECONCILE_STOCKTAKE = 'RECONCILE_STOCKTAKE',
  USER_CREATE = 'USER_CREATE',
  USER_DELETE = 'USER_DELETE',
  USER_PASSWORD_RESET = 'USER_PASSWORD_RESET',
  USER_ROLE_CHANGE = 'USER_ROLE_CHANGE',
  CHANGE_OWNER_PASSWORD = 'CHANGE_OWNER_PASSWORD',
  UPDATE_PHARMACY_PROFILE = 'UPDATE_PHARMACY_PROFILE',
  BACKUP_RESTORE = 'BACKUP_RESTORE',
}

export enum AuditEntityType {
  INVENTORY_ITEM = 'INVENTORY_ITEM',
  INVENTORY_BATCH = 'INVENTORY_BATCH',
  PURCHASE = 'PURCHASE',
  PURCHASE_INVOICE = 'PURCHASE_INVOICE',
  SALE = 'SALE',
  RETURN = 'RETURN',
  SUPPLIER = 'SUPPLIER',
  STOCKTAKE_SESSION = 'STOCKTAKE_SESSION',
  USER = 'USER',
  PHARMACY_PROFILE = 'PHARMACY_PROFILE',
  SYSTEM = 'SYSTEM',
}

export interface CreateAuditLogEntry {
  userId?: string | null;
  userName?: string | null;
  userRole?: string | null;
  action: AuditAction | string;
  entityType: AuditEntityType | string;
  entityId?: string | null;
  description: string;
  details?: Record<string, any> | null;
  ipAddress?: string | null;
}

export class AuditLogQueryDto {
  @IsOptional()
  @IsString()
  action?: string;

  @IsOptional()
  @IsString()
  entityType?: string;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  limit?: number = 50;
}
