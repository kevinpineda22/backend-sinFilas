import { Router } from 'express';
import {
  deleteSession,
  getAnalytics,
  getCancelledSessions,
  getDashboardStats,
  getDeletedSessions,
  getSedeLayout,
  getSessionDetail,
  getSessionsHistory,
  getVipsList,
  saveSedeLayout,
} from './admin.controller';
import { requireAuth } from '../../shared/middleware/auth';
import { optionalSede } from '../../shared/middleware/sede';

const router = Router();

router.use(requireAuth);
router.use(optionalSede);

router.get('/stats', getDashboardStats);
router.get('/vips', getVipsList);
router.get('/sessions', getSessionsHistory);
router.get('/sessions/:id', getSessionDetail);
router.delete('/sessions/:id', deleteSession);
router.get('/cancelled', getCancelledSessions);
router.get('/deleted', getDeletedSessions);
router.get('/analytics', getAnalytics);
router.get('/sede-layout', getSedeLayout);
router.put('/sede-layout', saveSedeLayout);

export default router;
