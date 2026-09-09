import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminService } from './admin.service';
import {
  CreateTenantDto,
  UpdateTenantDto,
  UpdateSubscriptionDto,
  UpdateStatusDto,
  ResetPasswordDto,
  AddBranchDto,
  LinkTenantsDto,
  BulkChainOnboardingDto,
  MergeChainsDto,
} from './dto/create-tenant.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { R2BackupService } from '../backup/r2-backup.service';

@Controller('admin')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('SUPER_ADMIN')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly r2BackupService: R2BackupService,
  ) {}

  @Post('tenants')
  async createTenant(@Body() dto: CreateTenantDto) {
    return this.adminService.createTenant(dto);
  }

  @Post('chains/onboard-bulk')
  async onboardBulkChain(@Body() dto: BulkChainOnboardingDto) {
    return this.adminService.onboardBulkChain(dto);
  }

  @Post('chains/merge-existing')
  async mergeExistingIntoChain(@Body() dto: MergeChainsDto) {
    return this.adminService.mergeExistingIntoChain(dto);
  }

  @Post('tenants/:id/add-branch')
  async addBranchToTenant(
    @Param('id') id: string,
    @Body() dto: AddBranchDto,
  ) {
    return this.adminService.addBranchToTenant(id, dto);
  }

  @Post('chains/link-tenants')
  async linkTenantsIntoChain(@Body() dto: LinkTenantsDto) {
    return this.adminService.linkTenantsIntoChain(dto);
  }

  @Get('tenants')
  async getAllTenants(@Query() query: { status?: string; search?: string }) {
    return this.adminService.getAllTenants(query);
  }

  @Get('tenants/:id')
  async getTenantById(@Param('id') id: string) {
    return this.adminService.getTenantById(id);
  }

  @Get('tenants/:id/users')
  async getTenantUsers(@Param('id') id: string) {
    return this.adminService.getTenantUsers(id);
  }

  @Patch('tenants/:id/users/:userId/password')
  async resetTenantUserPassword(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body() dto: ResetPasswordDto,
  ) {
    return this.adminService.resetTenantUserPassword(id, userId, dto);
  }

  @Patch('tenants/:id')
  async updateTenant(
    @Param('id') id: string,
    @Body() dto: UpdateTenantDto,
  ) {
    return this.adminService.updateTenant(id, dto);
  }

  @Delete('tenants/:id')
  async deleteTenant(@Param('id') id: string) {
    return this.adminService.deleteTenant(id);
  }

  @Patch('tenants/:id/subscription')
  async extendSubscription(
    @Param('id') id: string,
    @Body() dto: UpdateSubscriptionDto,
  ) {
    return this.adminService.extendSubscription(id, dto);
  }

  @Patch('tenants/:id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateStatusDto,
  ) {
    return this.adminService.updateTenantStatus(id, dto);
  }

  @Get('dashboard')
  async getDashboard() {
    return this.adminService.getDashboardMetrics();
  }

  @Get('backups/status')
  async getBackupsStatus() {
    return this.r2BackupService.getBackupsMonitoringSummary();
  }

  @Post('backups/run-job')
  async runBackupsJob() {
    return this.r2BackupService.runDailyBackupJob();
  }

  @Patch('tenants/:id/r2-config')
  async updateTenantR2Config(
    @Param('id') id: string,
    @Body() dto: { r2BucketName?: string; r2AccountId?: string; r2AccessKeyId?: string; r2SecretAccessKey?: string },
  ) {
    return this.adminService.updateTenantR2Config(id, dto);
  }

  @Get('settings/master-r2')
  async getMasterR2Config() {
    return this.r2BackupService.getMasterR2PublicConfig();
  }

  @Post('settings/master-r2')
  async saveMasterR2Config(
    @Body()
    dto: {
      r2BucketName: string;
      r2AccountId: string;
      r2AccessKeyId: string;
      r2SecretAccessKey: string;
    },
  ) {
    return this.r2BackupService.saveMasterR2Config(dto);
  }
}
