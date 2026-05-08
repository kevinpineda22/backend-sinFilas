import { createClient } from '@supabase/supabase-js';
import { env } from '../../config/env';

// Cliente con Service Role para saltarse RLS y tener acceso total interno.
// No exponer este cliente hacia el exterior de forma insegura.
export const supabaseAdmin = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_KEY
);