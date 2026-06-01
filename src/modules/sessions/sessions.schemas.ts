import { z } from 'zod';

const itemSchema = z.object({
  codigo_barras: z.string().trim().min(1, 'codigo_barras requerido'),
  nombre: z.string().trim().min(1, 'nombre requerido'),
  cantidad: z
    .number({ message: 'cantidad debe ser numérica' })
    .positive('cantidad debe ser > 0'),
  unidad_medida: z.string().trim().min(1, 'unidad_medida requerida').default('UND'),
  // f120_id (id de producto SIESA) — lo manda el carrito y lo usamos para
  // resolver el pasillo desde sf_producto_pasillos. Opcional: si falta, el ítem
  // queda sin pasillo (no rompe el checkout).
  f120_id: z.coerce.number().int().positive().optional(),
});

export const checkoutDirectBodySchema = z.object({
  items: z.array(itemSchema).min(1, 'El carrito no puede estar vacío'),
  vip_user_id: z.string().uuid('vip_user_id debe ser uuid').optional(),
  sede_id: z.string().uuid('sede_id debe ser uuid').optional(),
  raw_qr_string: z.string().optional(),
});

export type CheckoutDirectBody = z.infer<typeof checkoutDirectBodySchema>;
export type CheckoutItem = z.infer<typeof itemSchema>;
