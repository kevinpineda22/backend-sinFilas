import { Request, Response, NextFunction } from 'express';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Middleware que inyecta `req.sedeId` desde el header `X-Sede-ID`.
 *
 * - Si el header está presente y es un UUID válido → `req.sedeId = <uuid>` + `next()`.
 * - Si está presente pero NO es UUID → 400 `invalid-sede-id`.
 * - Si está ausente → 400 `missing-sede-id` (esta variante es **estricta**, pensada
 *   para los endpoints que necesitan saber a qué sede pertenece la sesión).
 *
 * Si en algún endpoint el header es opcional, usar `optionalSede` en su lugar.
 */
export const requireSede = (req: Request, res: Response, next: NextFunction): void => {
  const raw = req.headers['x-sede-id'];
  const value = Array.isArray(raw) ? raw[0] : raw;

  if (!value) {
    res.status(400).json({
      error: 'missing-sede-id',
      detail: 'Falta el header X-Sede-ID',
    });
    return;
  }

  if (!UUID_REGEX.test(value)) {
    res.status(400).json({
      error: 'invalid-sede-id',
      detail: 'X-Sede-ID debe ser un UUID',
    });
    return;
  }

  req.sedeId = value;
  next();
};

/**
 * Igual que `requireSede` pero NO falla si el header está ausente.
 * Útil para endpoints de lectura cross-sede (admin) o smoke tests.
 */
export const optionalSede = (req: Request, res: Response, next: NextFunction): void => {
  const raw = req.headers['x-sede-id'];
  const value = Array.isArray(raw) ? raw[0] : raw;

  if (!value) {
    next();
    return;
  }

  if (!UUID_REGEX.test(value)) {
    res.status(400).json({
      error: 'invalid-sede-id',
      detail: 'X-Sede-ID debe ser un UUID',
    });
    return;
  }

  req.sedeId = value;
  next();
};
