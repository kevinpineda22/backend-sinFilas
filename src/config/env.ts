import { z } from 'zod';

const envSchema = z.object({
  PORT: z.string().default('4000'),
  SUPABASE_URL: z.string().url(),
  SUPABASE_KEY: z.string(), // Service role key
});

const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  console.error('❌ Error en variables de entorno:', _env.error.format());
  process.exit(1);
}

export const env = _env.data;