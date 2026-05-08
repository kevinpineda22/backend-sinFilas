import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  PORT: z.string().optional().default('3000'),
  NODE_ENV: z.string().optional().default('development'),
  SUPABASE_URL: z.string().min(1, 'SUPABASE_URL es requerido'),
  SUPABASE_KEY: z.string().min(1, 'SUPABASE_KEY es requerido'),
  SUPABASE_JWT_SECRET: z.string().optional(),
  QR_SIGNING_SECRET: z.string().optional().default('super-secret-key-123'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('Environment validation failed:', parsed.error.issues);
  throw new Error('Invalid environment configuration. Revisá tu .env o las variables del proyecto en Vercel.');
}

export const env = parsed.data;
