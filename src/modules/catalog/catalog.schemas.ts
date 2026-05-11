import { z } from 'zod';

export const searchQuerySchema = z.object({
  query: z
    .string({ message: 'El parámetro "query" es requerido' })
    .trim()
    .min(2, 'La búsqueda requiere al menos 2 caracteres')
    .max(100, 'La búsqueda no puede superar 100 caracteres'),
});

export type SearchQuery = z.infer<typeof searchQuerySchema>;
