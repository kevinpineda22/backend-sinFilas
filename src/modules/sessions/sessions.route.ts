import { Router } from 'express';
import { createDirectCheckout, redeemSession } from './sessions.controller';
import { requireAuth } from '../../shared/middleware/auth';
import { requireSede } from '../../shared/middleware/sede';

const router = Router();

// POST /api/sf/sessions/checkout-direct
// Requiere JWT válido (req.user) y header X-Sede-ID (req.sedeId).
router.post('/checkout-direct', requireAuth, requireSede, createDirectCheckout);

// POST /api/sf/sessions/:id/redeem
// Llamado por el POS al cobrar la sesión. Sin auth por ahora (el POS no maneja JWTs Supabase).
// Idempotente: si la sesión ya está cobrada → 409.
router.post('/:id/redeem', redeemSession);

export default router;
