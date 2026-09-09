import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ProfileService } from './profile.service';
import {
  UpdatePharmacyProfileDto,
  ChangeOwnerPasswordDto,
  CreateCashierDto,
  ResetCashierPasswordDto,
} from './dto/update-profile.dto';
import { SubscriptionGuard } from '../../common/guards/subscription.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('pharmacy/profile')
@UseGuards(AuthGuard('jwt'), SubscriptionGuard, RolesGuard)
export class ProfileController {
  constructor(private readonly profileService: ProfileService) {}

  @Get()
  @Roles('OWNER')
  async getPharmacyProfile() {
    return this.profileService.getPharmacyProfile();
  }

  @Patch()
  @Roles('OWNER')
  async updatePharmacyProfile(@Body() dto: UpdatePharmacyProfileDto) {
    return this.profileService.updatePharmacyProfile(dto);
  }

  @Patch('owner-password')
  @Roles('OWNER')
  async changeOwnerPassword(@Body() dto: ChangeOwnerPasswordDto) {
    return this.profileService.changeOwnerPassword(dto);
  }

  @Post('cashiers')
  @Roles('OWNER')
  async createCashier(@Body() dto: CreateCashierDto) {
    return this.profileService.createCashier(dto);
  }

  @Patch('cashiers/:id/password')
  @Roles('OWNER')
  async resetCashierPassword(
    @Param('id') id: string,
    @Body() dto: ResetCashierPasswordDto,
  ) {
    return this.profileService.resetCashierPassword(id, dto);
  }

  @Delete('cashiers/:id')
  @Roles('OWNER')
  async deleteCashier(@Param('id') id: string) {
    return this.profileService.deleteCashier(id);
  }
}
