/**
 * REGLAS DE CÓDIGOS DE BARRAS PARA EL QR DE CAJA.
 *
 * ══════════════════════════════════════════════════════════════════
 * ⚠️ ESTE ARCHIVO ES GEMELO DE `src/shared/qr/codigos.js` DEL FRONTEND
 * ══════════════════════════════════════════════════════════════════
 *
 * Repo del gemelo: `Pagina-web_React`, archivo `src/shared/qr/codigos.js`.
 *
 * **NO SE SINCRONIZAN SOLOS.** Si tocás una regla acá, tocá la de allá.
 * Los dos lados tienen un test de contrato (`tests/shared/qr/contrato.test.ts`
 * acá, `src/shared/qr/contratoBackend.test.js` allá) que corre LA MISMA tabla
 * de casos. Si una implementación cambia y la otra no, ese test falla — que es
 * exactamente para lo que está.
 *
 * Por qué existe la duplicación en vez de un paquete compartido: son dos repos
 * que se despliegan por separado (el front a Apache, este a Vercel). Un paquete
 * obligaría a versionar y desplegar coordinado; la tabla de casos compartida da
 * la misma garantía sin acoplar los despliegues.
 *
 * ══════════════════════════════════════════════════════════════════
 * QUÉ HACE ESTE MÓDULO Y QUÉ NO
 * ══════════════════════════════════════════════════════════════════
 *
 * El QR lo ARMA el frontend, porque es quien tiene el carrito. Este módulo no
 * arma nada: da las reglas para VERIFICAR que los códigos que el frontend va a
 * mandar a la caja existan de verdad en `siesa_codigos_barras`.
 *
 * El backend puede hacer esa verificación mejor que el frontend, porque tiene
 * la tabla delante. El frontend se apoya en la procedencia (el código salió de
 * `searchCatalog`); acá se puede consultar la fila.
 */

/** Motivo por el que un código no se pudo verificar. */
export const MOTIVO = {
  /** El ítem no trae código utilizable: hay que digitar el ítem en caja. */
  SIN_CODIGO: 'sin_codigo',
  /** Se mandó un código, pero no hay fila en `siesa_codigos_barras`. */
  NO_REGISTRADO: 'no_registrado',
  /** Etiqueta de báscula mal formada (dígito verificador o prefijo). */
  GS1_INVALIDO: 'gs1_invalido',
} as const;

export type Motivo = (typeof MOTIVO)[keyof typeof MOTIVO];

/** Marcadores internos que NO son códigos. */
const MARCADORES = new Set(['', 'N/A', 'ADMIN_OVERRIDE', 'NULL', 'UNDEFINED']);

/**
 * Unidades de medida que se facturan por peso.
 *
 * ⚠️ Gemela de `WEIGHABLE_UNITS` en `sinFilas/utils/unidades.js` (frontend).
 */
export const WEIGHABLE_UNITS = ['KL', 'LB', '500GR', '250GR', 'PZ'];

/**
 * ¿Esta unidad de medida es de peso?
 *
 * Compara en MAYÚSCULAS y sin espacios. La versión anterior de
 * `catalog.utils.ts` hacía `WEIGHABLE_UNITS.includes(um)` crudo: una unidad
 * guardada como `"kl"` o `" KL"` no se reconocía como pesable de este lado
 * mientras el frontend sí la reconocía, y las dos mitades del sistema
 * clasificaban el mismo producto distinto.
 */
export const esUnidadPesable = (unidadMedida: string | null | undefined): boolean => {
  if (!unidadMedida) return false;
  return WEIGHABLE_UNITS.includes(String(unidadMedida).trim().toUpperCase());
};

/**
 * Forma canónica de un código: sin espacios, en mayúsculas y sin el `+` final
 * que SIESA usa para venta abierta.
 *
 * Ese `+` no existe en ninguna etiqueta física. Mandarlo al QR es mandar un
 * código que la registradora no encuentra.
 */
export const normalizarCodigo = (code: unknown): string => {
  if (code === null || code === undefined) return '';
  return String(code).trim().toUpperCase().replace(/\+$/, '');
};

/**
 * Elimina el prefijo M/N: la caja registradora no los acepta.
 *
 * SIESA guarda códigos "master" con M adelante y algunos con N. El lector
 * físico nunca ve esa letra.
 *
 * Exige que después de la letra venga un DÍGITO. Sacarla siempre convertía el
 * marcador interno `"N/A"` en `"/A"`, que ya no parece vacío y pasaba por
 * código bueno.
 */
export const stripMN = (code: string | null | undefined): string => {
  if (!code || typeof code !== 'string') return code ?? '';
  const limpio = code.trim();
  return /^[MN]\d/.test(limpio.toUpperCase()) ? limpio.substring(1) : code;
};

/** Deja el código listo para comparar o emitir: sin M/N, sin `+`, en mayúsculas. */
export const limpiarCodigo = (code: unknown): string =>
  normalizarCodigo(stripMN(code as string));

/** Un código utilizable, no un marcador interno ni vacío. */
export const esCodigoUsable = (code: unknown): boolean => {
  if (code === null || code === undefined) return false;
  const s = String(code).trim();
  if (MARCADORES.has(s.toUpperCase())) return false;
  return s.replace(/\+$/, '').length > 0;
};

/** GS1 de peso variable ya armado (EAN-13/14 que arranca en 2). */
export const esGs1Pesable = (code: unknown): boolean => {
  const c = normalizarCodigo(code);
  return /^\d{13,14}$/.test(c) && c.startsWith('2');
};

/**
 * Dígito verificador GS1 estándar (módulo 10).
 * Acepta 12 dígitos (→ EAN-13) y 13 (→ EAN-14).
 *
 * Devuelve `null` cuando el input no sirve. NO devuelve `'0'`: un cero de
 * relleno se concatena igual que un dígito bueno y produce un código que la
 * caja rechaza sin que nadie se entere hasta tener al cliente delante.
 */
export const calcularDigitoVerificador = (codigo: string): string | null => {
  if (typeof codigo !== 'string') return null;
  if (codigo.length < 12 || codigo.length > 13) return null;
  if (!/^\d+$/.test(codigo)) return null;
  const n = codigo.length;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    // Desde la derecha: posición impar ×3, par ×1.
    const weight = (n - i) % 2 === 1 ? 3 : 1;
    sum += parseInt(codigo[i], 10) * weight;
  }
  return ((10 - (sum % 10)) % 10).toString();
};

/**
 * El dígito verificador del GS1 cuadra.
 *
 * No es cosmético: la caja calcula el mismo dígito y descarta la lectura si no
 * coincide. Un GS1 con check malo es una línea que se pierde.
 */
export const gs1TieneCheckValido = (codigo: unknown): boolean => {
  const c = normalizarCodigo(codigo);
  if (!/^\d{13,14}$/.test(c)) return false;
  const esperado = calcularDigitoVerificador(c.slice(0, -1));
  return esperado !== null && esperado === c.slice(-1);
};

/** Los 7 dígitos con los que SIESA guarda un pesable ("2900061"). */
export const prefijoGs1 = (codigo: unknown): string => normalizarCodigo(codigo).slice(0, 7);

/**
 * El prefijo tiene la forma que SIESA usa para pesables.
 *
 * Exige 7 dígitos exactos arrancando en 29. NO se rellena ni se recorta para
 * hacerlo entrar: el prefijo real de la Naranja (ítem 5073) es `2900061`, no
 * `2950730` — no se deduce del ítem, se lee de la tabla.
 */
export const esPrefijoGs1Valido = (prefijo: unknown): boolean =>
  /^29\d{5}$/.test(normalizarCodigo(prefijo));

/**
 * Las formas con las que hay que buscar un código en `siesa_codigos_barras`.
 *
 * La tabla guarda variantes internas del mismo código físico: el `+` de venta
 * abierta y el prefijo `M` de master. Buscar solo la forma limpia da "no
 * existe" sobre códigos perfectamente reales.
 */
export const variantesParaBuscar = (codigo: unknown): string[] => {
  const limpio = limpiarCodigo(codigo);
  if (!limpio) return [];
  return [limpio, `${limpio}+`, `M${limpio}`, `N${limpio}`];
};
