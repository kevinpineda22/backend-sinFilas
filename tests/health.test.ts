import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app';

describe('GET /api/sf/health', () => {
  it('responde 200 con el shape esperado', async () => {
    const res = await request(app).get('/api/sf/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', service: 'Sin Filas API' });
  });
});
