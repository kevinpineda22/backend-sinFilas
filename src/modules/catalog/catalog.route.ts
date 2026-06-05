import { Router } from 'express';
import { searchProduct } from './catalog.controller';
import { optionalSede } from '../../shared/middleware/sede';

const router = Router();

// GET /api/sf/catalog/search?query=...
router.get('/search', optionalSede, searchProduct);

export default router;