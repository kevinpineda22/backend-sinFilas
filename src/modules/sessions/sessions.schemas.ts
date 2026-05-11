import { z } from 'zod';

const itemSchema = z.object({
  codigo_barras: z.string().trim().min(1, 'codigo_barras requerido'),
  nombre: z.string().trim().min(1, 'nombre requerido'),
  cantidad: z
    .number({ message: 'cantidad debe ser numérica' })
    .positive('cantidad debe ser > 0'),
  unidad_medida: z.string().trim().min(1, 'unidad_medida requerida').default('UND'),
});

export const checkoutDirectBodySchema = z.object({
  items: z.array(itemSchema).min(1, 'El carrito no puede estar vacío'),
  vip_user_id: z.string().uuid('vip_user_id debe ser uuid').optional(),
  sede_id: z.string().uuid('sede_id debe ser uuid').optional(),
  raw_qr_string: z.string().optional(),
});

export type CheckoutDirectBody = z.infer<typeof checkoutDirectBodySchema>;
export type CheckoutItem = z.infer<typeof itemSchema>;

export const redeemParamsSchema = z.object({
  id: z.string().uuid('id debe ser uuid'),
});

export type RedeemParams = z.infer<typeof redeemParamsSchema>;
