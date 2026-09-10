import { Body, Controller, Post, HttpCode, HttpStatus, Get, UseGuards, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto, AdminLoginDto } from './dto/login.dto';
import { SwitchBranchDto } from '../chain/dto/chain.dto';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: (process.env.NODE_ENV === 'production' ? 'none' : 'lax') as 'none' | 'lax',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  path: '/',
};

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() loginDto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(loginDto);
    if (result?.accessToken) {
      res.cookie('dawaee_token', result.accessToken, COOKIE_OPTIONS);
    }
    return result;
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Post('admin/login')
  @HttpCode(HttpStatus.OK)
  async adminLogin(
    @Body() adminLoginDto: AdminLoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.adminLogin(adminLoginDto);
    if (result?.accessToken) {
      res.cookie('dawaee_token', result.accessToken, COOKIE_OPTIONS);
    }
    return result;
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie('dawaee_token', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: (process.env.NODE_ENV === 'production' ? 'none' : 'lax') as 'none' | 'lax',
      path: '/',
    });
    return { success: true, message: 'تم تسجيل الخروج بنجاح' };
  }

  @Get('me')
  @UseGuards(AuthGuard('jwt'))
  async getProfile(@CurrentUser() user: any) {
    return { user };
  }

  @Post('switch-branch')
  @UseGuards(AuthGuard('jwt'))
  @HttpCode(HttpStatus.OK)
  async switchBranch(
    @CurrentUser() user: any,
    @Body() body: SwitchBranchDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.switchBranch(body.targetTenantId, user);
    if (result?.accessToken) {
      res.cookie('dawaee_token', result.accessToken, COOKIE_OPTIONS);
    }
    return result;
  }
}
