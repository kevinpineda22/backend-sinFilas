import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env';

/**
 * Middleware que valida el JWT firmado por Supabase usando `SUPABASE_JWT_SECRET`.
 *
 * Inyecta `req.user = { id, email, role }` cuando el token es válido.
 * Responde 401 si:
 *  - Falta el header `Authorization`.
 *  - El header no tiene el formato `Bearer <token>`.
 *  - El token está expirado o tiene firma inválida.
 *
 * Responde 500 si el server no fue configurado con `SUPABASE_JWT_SECRET`.
 */
export const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'unauthorized',
      detail: 'Falta el header Authorization Bearer',
    });
    return;
  }

  if (!env.SUPABASE_JWT_SECRET) {
    res.status(500).json({
      error: 'auth-not-configured',
      detail: 'SUPABASE_JWT_SECRET no está configurado en el servidor',
    });
    return;
  }

  const token = authHeader.slice(7).trim();

  try {
    const decoded = jwt.verify(token, env.SUPABASE_JWT_SECRET) as jwt.JwtPayload;

    if (!decoded.sub) {
      res.status(401).json({ error: 'invalid-token', detail: 'Token sin sub' });
      return;
    }

    req.user = {
      id: decoded.sub as string,
      email: typeof decoded.email === 'string' ? decoded.email : undefined,
      role:
        typeof decoded.role === 'string'
          ? decoded.role
          : typeof decoded.user_role === 'string'
            ? decoded.user_role
            : undefined,
    };

    next();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Token inválido';
    res.status(401).json({ error: 'invalid-token', detail: message });
  }
};
