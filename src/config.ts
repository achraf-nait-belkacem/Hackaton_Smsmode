import dotenv from 'dotenv';
import { randomBytes, timingSafeEqual } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

dotenv.config();
dotenv.config({ path: './env/.env.keys' });

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return value ? value.trim() : undefined;
}

function getEnv(name: string, fallback?: string): string {
  return readEnv(name) ?? fallback ?? '';
}

function loadWebhookSecret(): string {
  const configuredSecret = readEnv('RCS_WEBHOOK_SECRET');
  if (configuredSecret) return configuredSecret;

  const secretPath = join(process.cwd(), 'env', '.webhook-token');
  mkdirSync(dirname(secretPath), { recursive: true });
  if (existsSync(secretPath)) return readFileSync(secretPath, 'utf-8').trim();

  const secret = randomBytes(32).toString('hex');
  try {
    writeFileSync(secretPath, `${secret}\n`, { flag: 'wx', mode: 0o600 });
    return secret;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    return readFileSync(secretPath, 'utf-8').trim();
  }
}

export const config = {
  rcsApiKey: getEnv('RCS_API_KEY'),
  smsApiKey: getEnv('SMS_API_KEY') || getEnv('SMSMODE_SMS_API_KEY') || getEnv('SMS_FALLBACK_API_KEY'),
  phoneNumber: getEnv('PHONE_NUMBER'),
  companyName: getEnv('COMPANY_NAME', 'Cabinet Médical'),
  companyAddress: getEnv('COMPANY_ADDRESS', '12 rue Exemple, Paris'),
  rcsCallbackUrl: getEnv('RCS_CALLBACK_URL') || getEnv('WEBHOOK_URL'),
  rcsWebhookSecret: loadWebhookSecret(),
  rcsWebhookRoute: '/webhook/rcs/:token',
};

export function requireRcsConfig(): { apiKey: string; callbackUrl: string } {
  const apiKey = config.rcsApiKey;

  if (!apiKey) {
    throw new Error('RCS_API_KEY manquante: configurez la clé RCS SMSMode dans env/.env.keys ou .env');
  }

  return { apiKey, callbackUrl: requireRcsCallbackUrl() };
}

export function requireRcsCallbackUrl(): string {
  const callbackUrl = config.rcsCallbackUrl;
  if (!callbackUrl) {
    throw new Error('RCS_CALLBACK_URL manquante: configurez l’URL publique du webhook ngrok');
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(callbackUrl);
  } catch {
    throw new Error('RCS_CALLBACK_URL doit être une URL HTTPS valide terminant par /webhook/rcs');
  }
  if (parsedUrl.protocol !== 'https:' || parsedUrl.pathname !== '/webhook/rcs') {
    throw new Error('RCS_CALLBACK_URL doit être une URL HTTPS valide terminant par /webhook/rcs');
  }
  parsedUrl.pathname = `${parsedUrl.pathname}/${config.rcsWebhookSecret}`;
  return parsedUrl.toString();
}

export function isValidRcsWebhookSecret(candidate: string | undefined): boolean {
  if (!candidate) return false;
  const expected = Buffer.from(config.rcsWebhookSecret);
  const received = Buffer.from(candidate);
  return expected.length === received.length && timingSafeEqual(expected, received);
}
