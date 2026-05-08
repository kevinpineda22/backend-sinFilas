import { Router } from 'express';
import { getDashboardStats, getSessionsHistory, getVipUsers } from './admin.controller';

const router = Router();

router.get('/stats', getDashboardStats);
router.get('/sessions', getSessionsHistory);
router.get('/users', getVipUsers);

export default router;
