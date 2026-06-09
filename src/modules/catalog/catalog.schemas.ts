import { z } from 'zod';

export const searchQuerySchema = z.object({
  query: z
    .string({ message: 'El parámetro "query" es requerido' })
    .trim()
    // Mínimo 1: hay ítems (sobre todo en fruver) con código de 1 solo dígito
    // (ej: "1", "2"). Con un mínimo mayor nunca aparecerían al buscarlos.
    .min(1, 'La búsqueda requiere al menos 1 carácter')
    .max(100, 'La búsqueda no puede superar 100 caracteres'),
});

export type SearchQuery = z.infer<typeof searchQuerySchema>;
