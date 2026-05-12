import { Router } from 'express';
import { createDirectCheckout, getUserSessions } from './sessions.controller';
import { requireAuth } from '../../shared/middleware/auth';
import { requireSede } from '../../shared/middleware/sede';

const router = Router();

// GET /api/sf/sessions
// Historial de sesiones del usuario VIP autenticado.
router.get('/', requireAuth, getUserSessions);

// POST /api/sf/sessions/checkout-direct
// Requiere JWT (req.user) y header X-Sede-ID (req.sedeId).
router.post('/checkout-direct', requireAuth, requireSede, createDirectCheckout);

export default router;
