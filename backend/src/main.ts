import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { validateStartupSecurity, isOriginAllowed, getAllowedOriginsList } from './common/utils/security.util';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // Verify critical security configuration
  validateStartupSecurity();

  const app = await NestFactory.create(AppModule, { bodyParser: false });

  // Parse cookies for secure HttpOnly session tokens
  app.use(cookieParser());

  // Helmet HTTP Security Headers (X-Frame-Options, HSTS, CSP, etc.)
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
          connectSrc: ["'self'", 'https:', 'wss:', 'ws:'],
        },
      },
    }),
  );

  // Tiered body size limits to prevent Denial of Service (DoS) attacks
  // Standard routes get 2MB limit; image upload/OCR routes get up to 20MB.
  app.use((req: any, res: any, next: any) => {
    const url = req.originalUrl || req.url || '';
    const isImageUpload =
      url.includes('/purchases/ai-scan-invoice') ||
      url.includes('/purchases/upload-invoice-image') ||
      url.includes('/purchases/ai-invoice') ||
      url.includes('/inventory/suppliers/payments') ||
      url.includes('/backup/restore');

    const limit = isImageUpload ? '20mb' : '2mb';
    json({ limit })(req, res, (err) => {
      if (err) return next(err);
      urlencoded({ limit, extended: true })(req, res, next);
    });
  });

  // CORS Configuration: Whitelist authorized origins without wildcard '*' when credentials: true
  const allowedOrigins = getAllowedOriginsList();
  logger.log(`Initialized CORS with allowed origins: [${allowedOrigins.join(', ')}]`);

  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (such as mobile apps, server-to-server, curl)
      if (!origin) return callback(null, true);

      if (isOriginAllowed(origin)) {
        return callback(null, true);
      }

      logger.warn(`Blocked unauthorized CORS request from origin: ${origin}`);
      return callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  // Global Validation Pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Set API prefix with root exclusion
  app.setGlobalPrefix('api', {
    exclude: ['/'],
  });

  const port = process.env.PORT || 4000;
  await app.listen(port, '0.0.0.0');
  logger.log(`🚀 Dawaee Backend API is running on port ${port}`);
}
bootstrap();
