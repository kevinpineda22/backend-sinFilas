import { describe, it, expect } from 'vitest';
import { searchQuerySchema } from '../../../src/modules/catalog/catalog.schemas';

describe('catalog.schemas.searchQuerySchema', () => {
  it('acepta una query válida', () => {
    const r = searchQuerySchema.safeParse({ query: 'mango' });
    expect(r.success).toBe(true);
    expect(r.success && r.data.query).toBe('mango');
  });

  it('hace trim a espacios extra', () => {
    const r = searchQuerySchema.safeParse({ query: '   mango   ' });
    expect(r.success).toBe(true);
    expect(r.success && r.data.query).toBe('mango');
  });

  it('rechaza query ausente', () => {
    const r = searchQuerySchema.safeParse({});
    expect(r.success).toBe(false);
  });

  it('acepta query de 1 carácter (ítems con código de 1 dígito, ej fruver)', () => {
    const r = searchQuerySchema.safeParse({ query: '2' });
    expect(r.success).toBe(true);
    expect(r.success && r.data.query).toBe('2');
  });

  it('rechaza query vacía (o solo espacios)', () => {
    expect(searchQuerySchema.safeParse({ query: '' }).success).toBe(false);
    expect(searchQuerySchema.safeParse({ query: '   ' }).success).toBe(false);
  });

  it('rechaza query mayor a 100 chars', () => {
    const r = searchQuerySchema.safeParse({ query: 'a'.repeat(101) });
    expect(r.success).toBe(false);
  });

  it('rechaza tipos no string', () => {
    const r = searchQuerySchema.safeParse({ query: 123 });
    expect(r.success).toBe(false);
  });
});
