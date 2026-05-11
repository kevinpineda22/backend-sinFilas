import { describe, it, expect, vi, beforeEach } from 'vitest';
import express, { Request, Response } from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { requireAuth } from '../../../src/shared/middleware/auth';

const JWT_SECRET = process.env.SUPABASE_JWT_SECRET as string;

const buildApp = () => {
  const app = express();
  app.get('/protected', requireAuth, (req: Request, res: Response) => {
    res.json({ ok: true, user: req.user });
  });
  return app;
};

const sign = (payload: Record<string, unknown>, expiresIn: string | number = '1h') =>
  jwt.sign(payload, JWT_SECRET, { algorithm: 'HS256', expiresIn: expiresIn as any });

describe('requireAuth middleware', () => {
  it('responde 401 si no hay header Authorization', async () => {
    const res = await request(buildApp()).get('/protected');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('unauthorized');
  });

  it('responde 401 si el header no arranca con Bearer', async () => {
    const res = await request(buildApp())
      .get('/protected')
      .set('Authorization', 'Basic dXNlcjpwYXNz');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('unauthorized');
  });

  it('responde 401 si el token está firmado con otro secret', async () => {
    const fake = jwt.sign({ sub: 'user-1' }, 'otro-secret', { algorithm: 'HS256' });
    const res = await request(buildApp()).get('/protected').set('Authorization', `Bearer ${fake}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid-token');
  });

  it('responde 401 si el token está expirado', async () => {
    const expired = sign({ sub: 'user-1' }, -10);
    const res = await request(buildApp()).get('/protected').set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
  });

  it('responde 401 si el token no tiene sub', async () => {
    const noSub = sign({});
    const res = await request(buildApp()).get('/protected').set('Authorization', `Bearer ${noSub}`);
    expect(res.status).toBe(401);
  });

  it('responde 200 con token válido e inyecta req.user', async () => {
    const token = sign({
      sub: 'user-1',
      email: 'vip@merkahorrosas.com',
      role: 'sf_vip',
    });

    const res = await request(buildApp()).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.user).toEqual({
      id: 'user-1',
      email: 'vip@merkahorrosas.com',
      role: 'sf_vip',
    });
  });

  it('responde 200 con token válido sin email ni role (campos opcionales undefined)', async () => {
    const token = sign({ sub: 'user-2' });
    const res = await request(buildApp()).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({
      id: 'user-2',
      email: undefined,
      role: undefined,
    });
  });

  it('responde 500 si SUPABASE_JWT_SECRET no está configurado', async () => {
    vi.resetModules();
    const previous = process.env.SUPABASE_JWT_SECRET;
    delete process.env.SUPABASE_JWT_SECRET;

    try {
      const mod = await import('../../../src/shared/middleware/auth');
      const isolatedApp = express();
      isolatedApp.get('/protected', mod.requireAuth, (req, res) => res.json({ ok: true }));

      const token = jwt.sign({ sub: 'user-1' }, 'any-secret');
      const res = await request(isolatedApp).get('/protected').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('auth-not-configured');
    } finally {
      if (previous !== undefined) process.env.SUPABASE_JWT_SECRET = previous;
    }
  });
});
