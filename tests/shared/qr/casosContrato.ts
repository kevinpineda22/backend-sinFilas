/**
 * TABLA DE CASOS DEL CONTRATO FRONT ↔ BACK PARA CÓDIGOS DE BARRAS.
 *
 * ══════════════════════════════════════════════════════════════════
 * ⚠️ ESTE ARCHIVO ES GEMELO. MANTENER IDÉNTICO A:
 *    `Pagina-web_React` → `src/shared/qr/casosContrato.js`
 * ══════════════════════════════════════════════════════════════════
 *
 * Los dos repos se despliegan por separado (el front a Apache, este a Vercel),
 * así que no comparten un paquete. Lo que comparten es esta tabla: cada lado
 * corre SU implementación contra ELLA. Si alguien cambia una regla de un lado
 * y no del otro, el test de ese lado falla antes de llegar a producción.
 *
 * Agregar un caso acá es agregarlo allá. Esa es toda la disciplina que pide.
 *
 * Por qué importa: el frontend arma el QR y el backend lo verifica contra
 * `siesa_codigos_barras`. Si los dos no limpian el código igual, el backend
 * reporta como "no registrado" un código que la caja sí lee, o —peor— deja
 * pasar uno que no.
 */

export const CASOS_CODIGO = [
  // ── Códigos normales ────────────────────────────────────────────
  { entrada: '7702001012345', limpio: '7702001012345', usable: true, gs1: false },
  { entrada: '185325P25', limpio: '185325P25', usable: true, gs1: false },

  // ── Marcadores internos de SIESA que la caja NO acepta ──────────
  // El `+` de venta abierta y el prefijo M/N de master no existen en ninguna
  // etiqueta física.
  { entrada: '7702001012345+', limpio: '7702001012345', usable: true, gs1: false },
  { entrada: 'M7702001012345', limpio: '7702001012345', usable: true, gs1: false },
  { entrada: 'N7702001012345', limpio: '7702001012345', usable: true, gs1: false },
  { entrada: 'M185325+', limpio: '185325', usable: true, gs1: false },

  // ── Forma canónica: espacios y minúsculas ───────────────────────
  { entrada: '  185325p25  ', limpio: '185325P25', usable: true, gs1: false },

  // ── La letra solo se saca si la sigue un DÍGITO ─────────────────
  // Sacarla siempre convertía "N/A" en "/A", que ya no parece vacío y pasaba
  // por código bueno.
  { entrada: 'MANZANA', limpio: 'MANZANA', usable: true, gs1: false },
  { entrada: 'N/A', limpio: 'N/A', usable: false, gs1: false },

  // ── Nada que emitir ─────────────────────────────────────────────
  { entrada: '', limpio: '', usable: false, gs1: false },
  { entrada: '+', limpio: '', usable: false, gs1: false },
  { entrada: 'ADMIN_OVERRIDE', limpio: 'ADMIN_OVERRIDE', usable: false, gs1: false },
  { entrada: null, limpio: '', usable: false, gs1: false },
  { entrada: undefined, limpio: '', usable: false, gs1: false },

  // ── GS1 de peso variable ────────────────────────────────────────
  { entrada: '2900061012500', limpio: '2900061012500', usable: true, gs1: true },
  { entrada: '2900061', limpio: '2900061', usable: true, gs1: false }, // el prefijo solo
];

/** Dígito verificador: la caja calcula el mismo y descarta si no coincide. */
export const CASOS_CHECK_GS1 = [
  { codigo: '2900061012500', valido: true }, // Naranja, 1,250 kg
  { codigo: '2900061012501', valido: false }, // mismo código, dígito cambiado
  { codigo: '2950730012508', valido: true }, // forma válida (prefijo irreal, pero eso es otra pregunta)
  { codigo: '2900061', valido: false }, // no tiene largo de GS1
  { codigo: '', valido: false },
];

/**
 * Prefijo de pesable: 7 dígitos EXACTOS arrancando en 29.
 * No se rellena ni se recorta para hacerlo entrar.
 */
export const CASOS_PREFIJO_GS1 = [
  { prefijo: '2900061', valido: true },
  { prefijo: '290006', valido: false }, // 6 dígitos: rellenarlo inventa el prefijo
  { prefijo: '29000612', valido: false }, // 8 dígitos
  { prefijo: '2800061', valido: false }, // no arranca en 29
  { prefijo: '', valido: false },
];

/** Unidades de medida que se facturan por peso. */
export const CASOS_UNIDAD_PESABLE = [
  { um: 'KL', pesable: true },
  { um: 'LB', pesable: true },
  { um: 'PZ', pesable: true },
  { um: '500GR', pesable: true },
  { um: '250GR', pesable: true },
  // La comparación va en forma canónica: guardado como "kl" o con espacios,
  // sigue siendo pesable. Comparar crudo hacía que el backend dijera "no" y el
  // frontend "sí" sobre el mismo producto.
  { um: 'kl', pesable: true },
  { um: ' KL ', pesable: true },
  { um: 'UND', pesable: false },
  { um: 'P15', pesable: false },
  { um: '', pesable: false },
  { um: null, pesable: false },
];
