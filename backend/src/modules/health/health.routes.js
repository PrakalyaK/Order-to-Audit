import { Router } from 'express';
import { checkHealth } from './health.controller.js';

const router = Router();

// GET /api/v1/health and GET /health
router.get('/', checkHealth);

export default router;
