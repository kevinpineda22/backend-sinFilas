import { describe, it, expect } from 'vitest';
import express, { Request, Response } from 'express';
import request from 'supertest';
import { requireSede, optionalSede } from '../../../src/shared/middleware/sede';

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';

describe('requireSede middleware', () => {
  const app = express();
  app.get('/test', requireSede, (req: Request, res: Response) => {
    res.json({ sedeId: req.sedeId });
  });

  it('responde 400 si no hay X-Sede-ID', async () => {
    const res = await request(app).get('/test');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('missing-sede-id');
  });

  it('responde 400 si X-Sede-ID no es UUID', async () => {
    const res = await request(app).get('/test').set('X-Sede-ID', 'not-a-uuid');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid-sede-id');
  });

  it('responde 200 e inyecta req.sedeId si UUID válido', async () => {
    const res = await request(app).get('/test').set('X-Sede-ID', VALID_UUID);
    expect(res.status).toBe(200);
    expect(res.body.sedeId).toBe(VALID_UUID);
  });
});

describe('optionalSede middleware', () => {
  const app = express();
  app.get('/test', optionalSede, (req: Request, res: Response) => {
    res.json({ sedeId: req.sedeId ?? null });
  });

  it('pasa sin error si no hay X-Sede-ID', async () => {
    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
    expect(res.body.sedeId).toBeNull();
  });

  it('responde 400 si X-Sede-ID está pero no es UUID', async () => {
    const res = await request(app).get('/test').set('X-Sede-ID', 'not-a-uuid');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid-sede-id');
  });

  it('inyecta req.sedeId si UUID válido', async () => {
    const res = await request(app).get('/test').set('X-Sede-ID', VALID_UUID);
    expect(res.status).toBe(200);
    expect(res.body.sedeId).toBe(VALID_UUID);
  });
});
