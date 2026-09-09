import { Controller, Get, Post, Body, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { BackupService } from "./backup.service";
import { SubscriptionGuard } from "../../common/guards/subscription.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { Roles } from "../../common/decorators/roles.decorator";

@Controller("backup")
@UseGuards(AuthGuard("jwt"), SubscriptionGuard, RolesGuard)
@Roles("OWNER")
export class BackupController {
  constructor(private readonly backupService: BackupService) {}

  @Get("export")
  async exportBackup() {
    return this.backupService.exportPharmacyBackup();
  }

  @Post("restore")
  async restoreBackup(@Body() payload: any) {
    return this.backupService.restorePharmacyBackup(payload);
  }
}
