/**
 * Mock encadenable del cliente de Supabase, **sin** depender de `vi`.
 * Eso permite usarlo dentro de la factory de `vi.mock()` sin caer en problemas
 * de hoisting / TDZ (Temporal Dead Zone).
 *
 * Uso típico:
 *
 * ```ts
 * vi.mock('../../../src/shared/db/supabaseClient', async () => {
 *   const { createSupabaseMock } = await import('../../helpers/supabaseMock');
 *   return { supabaseAdmin: createSupabaseMock() };
 * });
 *
 * import { supabaseAdmin } from '../../../src/shared/db/supabaseClient';
 * const supabaseMock = supabaseAdmin as unknown as MockedSupabase;
 *
 * // En cada test:
 * beforeEach(() => supabaseMock.reset());
 * supabaseMock.setNextResult({ data: [...], error: null });
 * ```
 *
 * Cualquier llamada (`from`, `select`, `eq`, ...) devuelve el mismo `chain`.
 * Al hacer `await chain` o `chain.single()` se desencola el próximo resultado.
 */

export type SupabaseResult<T = unknown> = {
  data?: T | null;
  error?: { message: string; code?: string } | null;
  count?: number | null;
};

export type MockedSupabase = {
  from: (...args: unknown[]) => MockedSupabase;
  select: (...args: unknown[]) => MockedSupabase;
  insert: (...args: unknown[]) => MockedSupabase;
  update: (...args: unknown[]) => MockedSupabase;
  delete: (...args: unknown[]) => MockedSupabase;
  eq: (...args: unknown[]) => MockedSupabase;
  or: (...args: unknown[]) => MockedSupabase;
  like: (...args: unknown[]) => MockedSupabase;
  ilike: (...args: unknown[]) => MockedSupabase;
  limit: (...args: unknown[]) => MockedSupabase;
  order: (...args: unknown[]) => MockedSupabase;
  single: () => Promise<SupabaseResult>;
  then: (onFulfilled: (v: SupabaseResult) => unknown) => Promise<unknown>;
  setNextResult: (result: SupabaseResult) => void;
  setNextResults: (results: SupabaseResult[]) => void;
  reset: () => void;
  calls: { method: string; args: unknown[] }[];
};

export const createSupabaseMock = (): MockedSupabase => {
  let queue: SupabaseResult[] = [];
  const calls: { method: string; args: unknown[] }[] = [];

  const nextResult = (): SupabaseResult => {
    if (queue.length === 0) {
      return { data: null, error: null, count: 0 };
    }
    return queue.shift() as SupabaseResult;
  };

  const chain: any = {};

  const register = (method: string) => {
    chain[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return chain;
    };
  };

  ['from', 'select', 'insert', 'update', 'delete', 'eq', 'or', 'like', 'ilike', 'limit', 'order'].forEach(
    register,
  );

  // `await chain` resuelve usando next result
  chain.then = (onFulfilled: (v: SupabaseResult) => unknown) => {
    return Promise.resolve(nextResult()).then(onFulfilled);
  };

  chain.single = () => {
    calls.push({ method: 'single', args: [] });
    return Promise.resolve(nextResult());
  };

  chain.setNextResult = (result: SupabaseResult) => {
    queue.push(result);
  };

  chain.setNextResults = (results: SupabaseResult[]) => {
    queue.push(...results);
  };

  chain.reset = () => {
    queue = [];
    calls.length = 0;
  };

  chain.calls = calls;

  return chain as MockedSupabase;
};
