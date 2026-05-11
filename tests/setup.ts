// Setup global de tests.
// Forzamos un entorno de pruebas y variables mínimas para que `env.ts` no aborte el proceso.
process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_KEY = process.env.SUPABASE_KEY || 'test-service-role-key';
process.env.SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET || 'test-jwt-secret';
process.env.QR_SIGNING_SECRET = process.env.QR_SIGNING_SECRET || 'test-qr-signing-secret';
