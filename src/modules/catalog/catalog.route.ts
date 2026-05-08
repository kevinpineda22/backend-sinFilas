import { Router } from 'express';
import { searchProduct } from './catalog.controller';

const router = Router();

// GET /api/sf/catalog/search?query=...
router.get('/search', searchProduct);

export default router;