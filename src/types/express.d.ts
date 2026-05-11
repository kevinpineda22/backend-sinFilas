// Augmentación global del tipo Request de Express
// para inyectar `req.user` (auth) y `req.sedeId` (sede middleware).
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email?: string;
        role?: string;
      };
      sedeId?: string;
    }
  }
}

export {};
