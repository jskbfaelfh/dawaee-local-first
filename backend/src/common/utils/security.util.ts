import * as crypto from 'crypto';
import { Logger, BadRequestException } from '@nestjs/common';

const logger = new Logger('SecurityUtil');

/**
 * Strict PostgreSQL schema identifier validator to prevent SQL injection and schema escaping.
 * Only allows alphanumeric characters and underscores, between 1 and 63 characters.
 */
const SCHEMA_NAME_REGEX = /^[a-zA-Z0-9_]{1,63}$/;

export function validateAndSanitizeSchemaName(schemaName?: string | null): string {
  if (!schemaName || typeof schemaName !== 'string') {
    throw new BadRequestException('معرف المخطط (Schema) مفقود أو غير صالح');
  }
  const clean = schemaName.trim();
  if (!SCHEMA_NAME_REGEX.test(clean)) {
    throw new BadRequestException('معرف المخطط (Schema) غير صالح ويحتوي على رموز أو أحرف غير مسموحة');
  }
  return clean;
}

/**
 * Common weak passwords that should be rejected
 */
const COMMON_WEAK_PASSWORDS = new Set([
  '123456',
  '1234567',
  '12345678',
  '123456789',
  'password',
  'admin',
  'admin123',
  'admin2026',
  'superadmin',
  'Admin@Dawaee2026',
  'qwerty',
  'dawaee',
  'dawaee123',
]);

/**
 * Generates a cryptographically secure, high-entropy, readable password
 * Example: Dw-9xK2m7P4
 */
export function generateSecurePassword(length = 12, prefix = 'Dw-'): string {
  // Safe character set excluding confusing characters (0/O, 1/l/I)
  const charset = '23456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
  const randomBytes = crypto.randomBytes(length);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += charset[randomBytes[i] % charset.length];
  }
  return `${prefix}${result}`;
}

/**
 * Verifies if a password meets minimum security standards:
 * - Minimum 8 characters
 * - Not in the common weak passwords dictionary
 */
export function isWeakPassword(password: string): { isWeak: boolean; reason?: string } {
  if (!password || password.length < 8) {
    return { isWeak: true, reason: 'كلمة المرور يجب أن لا تقل عن 8 أحرف وأرقام' };
  }
  if (COMMON_WEAK_PASSWORDS.has(password.toLowerCase())) {
    return { isWeak: true, reason: 'كلمة المرور ضعيفة جداً وشائعة، يرجى اختيار كلمة مرور أكثر تعقيداً' };
  }
  return { isWeak: false };
}

/**
 * Masks a secret access key for safe client display
 * e.g. "••••••••••••3f8a"
 */
export function maskSecretKey(secret?: string | null): string {
  if (!secret || typeof secret !== 'string') return '';
  const trimmed = secret.trim();
  if (trimmed.length <= 4) return '••••••••';
  const tail = trimmed.slice(-4);
  return '••••••••••••' + tail;
}

/**
 * Symmetric Encryption at Rest using AES-256-GCM
 * Used for securing R2 credentials, Gemini API Keys, and other database secrets.
 */
function getVaultKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET || getOrGenerateDevJwtSecret();
  return crypto.scryptSync(secret, 'dawaee-vault-salt-2026', 32);
}

/**
 * Encrypt a secret string using AES-256-GCM
 * Output format: enc:v1:<iv_hex>:<tag_hex>:<ciphertext_hex>
 */
export function encryptSecret(plaintext?: string | null): string {
  if (!plaintext || typeof plaintext !== 'string') return '';
  const trimmed = plaintext.trim();
  if (!trimmed) return '';
  // Avoid double-encryption
  if (trimmed.startsWith('enc:v1:')) return trimmed;

  try {
    const key = getVaultKey();
    const iv = crypto.randomBytes(12); // 96-bit IV recommended for GCM
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    let encrypted = cipher.update(trimmed, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');

    return `enc:v1:${iv.toString('hex')}:${authTag}:${encrypted}`;
  } catch (err: any) {
    logger.error(`Encryption error: ${err.message}`);
    return plaintext;
  }
}

/**
 * Decrypt a secret string encrypted with AES-256-GCM.
 * Seamless backward compatibility: if value does not start with enc:v1:, returns plaintext as-is.
 */
export function decryptSecret(ciphertext?: string | null): string {
  if (!ciphertext || typeof ciphertext !== 'string') return '';
  const trimmed = ciphertext.trim();
  if (!trimmed) return '';
  if (!trimmed.startsWith('enc:v1:')) {
    // Legacy plaintext string
    return trimmed;
  }

  try {
    const parts = trimmed.split(':');
    if (parts.length !== 5) {
      return trimmed;
    }
    const [, , ivHex, tagHex, encryptedHex] = parts;
    const key = getVaultKey();
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(tagHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err: any) {
    logger.error(`Decryption error: ${err.message}`);
    return '';
  }
}

/**
 * Sanitizes a Tenant record by stripping highly sensitive credentials (geminiApiKey, r2SecretAccessKey)
 * and masking storage credentials (r2AccessKeyId, r2AccountId).
 */
export function sanitizeTenantResponse(tenant: any): any {
  if (!tenant || typeof tenant !== 'object') return tenant;

  const {
    r2SecretAccessKey,
    geminiApiKey,
    ...safe
  } = tenant;

  const decryptedAccessKey = safe.r2AccessKeyId ? decryptSecret(safe.r2AccessKeyId) : null;
  const decryptedAccountId = safe.r2AccountId ? decryptSecret(safe.r2AccountId) : null;

  return {
    ...safe,
    hasR2SecretKey: Boolean(r2SecretAccessKey),
    hasGeminiApiKey: Boolean(geminiApiKey),
    r2AccessKeyId: decryptedAccessKey ? maskSecretKey(decryptedAccessKey) : null,
    r2AccountId: decryptedAccountId ? maskSecretKey(decryptedAccountId) : null,
  };
}

/**
 * Global in-memory dynamic fallback for development if JWT_SECRET is omitted.
 * This ensures that even in dev, the secret is random and cannot be forged from GitHub code!
 */
let inMemoryDevJwtSecret: string | null = null;

export function getOrGenerateDevJwtSecret(): string {
  if (!inMemoryDevJwtSecret) {
    inMemoryDevJwtSecret = crypto.randomBytes(32).toString('hex');
    logger.warn('⚠️ No JWT_SECRET set in environment! Generated dynamic ephemeral in-memory secret for this session.');
  }
  return inMemoryDevJwtSecret;
}

/**
 * Validate essential security environment variables on startup
 */
export function validateStartupSecurity() {
  const isProd = process.env.NODE_ENV === 'production';
  const jwtSecret = process.env.JWT_SECRET;
  const adminPass = process.env.ADMIN_PASSWORD;
  const adminUser = process.env.ADMIN_USERNAME;

  const INSECURE_DEFAULT_JWT = 'dawaee-jwt-dev-secret-key-2026';
  const INSECURE_DEFAULT_ADMIN = 'Admin@Dawaee2026';

  if (isProd) {
    // 1. Production JWT checks
    if (!jwtSecret || jwtSecret === INSECURE_DEFAULT_JWT || jwtSecret.length < 32) {
      throw new Error(
        'CRITICAL SECURITY FATAL: In production, JWT_SECRET must be set in environment variables and be at least 32 characters long. Insecure default secret is strictly prohibited.',
      );
    }

    // 2. Production Admin Password checks
    if (!adminPass || adminPass === INSECURE_DEFAULT_ADMIN || adminPass.length < 10) {
      throw new Error(
        'CRITICAL SECURITY FATAL: In production, ADMIN_PASSWORD must be configured in environment variables and be at least 10 characters long. Default password from GitHub is strictly prohibited.',
      );
    }

    if (!adminUser || adminUser === 'superadmin') {
      logger.warn('SECURITY RECOMMENDATION: In production, consider changing ADMIN_USERNAME from default "superadmin".');
    }
  } else {
    // Development warnings
    if (!jwtSecret || jwtSecret === INSECURE_DEFAULT_JWT) {
      logger.warn(
        '⚠️ SECURITY WARNING: Using default or missing JWT_SECRET in development. Set a strong custom secret in your local .env file before deployment.',
      );
    }
    if (!adminPass || adminPass === INSECURE_DEFAULT_ADMIN) {
      logger.warn(
        '⚠️ SECURITY WARNING: Default or missing ADMIN_PASSWORD in development. Ensure you set a strong secret in production environment variables (e.g. on Railway/Vercel).',
      );
    }
  }
}

/**
 * Standard development origins for frontend dev servers
 */
export const DEV_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:4173',
  'http://localhost:3000',
  'http://localhost:4000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:4173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:4000',
];

/**
 * Retrieves the normalized list of allowed CORS origins.
 * Strictly excludes wildcard '*' when credentials: true is required.
 */
export function getAllowedOriginsList(): string[] {
  const envOrigins = [process.env.ALLOWED_ORIGINS, process.env.FRONTEND_URL]
    .filter(Boolean)
    .join(',')
    .split(',')
    .map((o) => o.trim().toLowerCase())
    .filter((o) => o.length > 0 && o !== '*'); // Exclude wildcard '*'

  const isProd = process.env.NODE_ENV === 'production';
  const combined = isProd
    ? envOrigins
    : [...envOrigins, ...DEV_ORIGINS.map((o) => o.toLowerCase())];

  return Array.from(new Set(combined));
}

/**
 * Checks if a specific incoming HTTP or WebSocket origin is authorized.
 * - Allows requests without origin header (mobile apps, server-to-server, curl)
 * - Validates against strict origin whitelist
 */
export function isOriginAllowed(origin?: string | null): boolean {
  if (!origin) {
    return true; // Mobile apps, Postman, server-to-server
  }

  const normalized = origin.trim().toLowerCase();
  const allowedList = getAllowedOriginsList();

  // If no origins configured and in dev mode, fallback to dev origins
  if (allowedList.length === 0 && process.env.NODE_ENV !== 'production') {
    return DEV_ORIGINS.some((d) => d.toLowerCase() === normalized);
  }

  return allowedList.includes(normalized);
}
