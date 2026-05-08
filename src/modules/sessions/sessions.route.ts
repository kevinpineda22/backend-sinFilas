import { Router } from 'express';
import { createDirectCheckout } from './sessions.controller';

const router = Router();

// Endpoint directo que recibe todo el carrito, lo inserta en bd y devuelve el QR
router.post('/checkout-direct', createDirectCheckout);

export default router;
