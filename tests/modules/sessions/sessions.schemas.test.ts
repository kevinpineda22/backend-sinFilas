import { describe, it, expect } from 'vitest';
import { checkoutDirectBodySchema } from '../../../src/modules/sessions/sessions.schemas';

const validItem = {
  codigo_barras: '7700001234567',
  nombre: 'ARROZ 500G',
  cantidad: 1,
  unidad_medida: 'UND',
};

describe('sessions.schemas.checkoutDirectBodySchema', () => {
  it('acepta body válido con un item', () => {
    const r = checkoutDirectBodySchema.safeParse({ items: [validItem] });
    expect(r.success).toBe(true);
  });

  it('rechaza items vacíos', () => {
    const r = checkoutDirectBodySchema.safeParse({ items: [] });
    expect(r.success).toBe(false);
  });

  it('rechaza items ausentes', () => {
    const r = checkoutDirectBodySchema.safeParse({});
    expect(r.success).toBe(false);
  });

  it('rechaza cantidad <= 0', () => {
    const r = checkoutDirectBodySchema.safeParse({
      items: [{ ...validItem, cantidad: 0 }],
    });
    expect(r.success).toBe(false);
  });

  it('rechaza cantidad negativa', () => {
    const r = checkoutDirectBodySchema.safeParse({
      items: [{ ...validItem, cantidad: -1 }],
    });
    expect(r.success).toBe(false);
  });

  it('rechaza codigo_barras vacío', () => {
    const r = checkoutDirectBodySchema.safeParse({
      items: [{ ...validItem, codigo_barras: '' }],
    });
    expect(r.success).toBe(false);
  });

  it('acepta vip_user_id como UUID válido', () => {
    const r = checkoutDirectBodySchema.safeParse({
      items: [validItem],
      vip_user_id: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(r.success).toBe(true);
  });

  it('rechaza vip_user_id que no es UUID', () => {
    const r = checkoutDirectBodySchema.safeParse({
      items: [validItem],
      vip_user_id: 'not-a-uuid',
    });
    expect(r.success).toBe(false);
  });

  it('aplica el default UND a unidad_medida ausente', () => {
    const r = checkoutDirectBodySchema.safeParse({
      items: [{ codigo_barras: '7700001234567', nombre: 'X', cantidad: 1 }],
    });
    expect(r.success).toBe(true);
    expect(r.success && r.data.items[0].unidad_medida).toBe('UND');
  });
});
