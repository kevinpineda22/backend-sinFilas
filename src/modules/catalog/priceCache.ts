import { env } from '../../config/env';

/**
 * Precios de SIESA por ítem, cacheados en memoria con TTL.
 *
 * Problema que resuelve: `searchProduct` pedía el precio a SIESA con UNA llamada
 * HTTP por producto (N+1). Una búsqueda por texto puede devolver decenas de
 * productos → decenas de requests a SIESA por búsqueda, con riesgo de timeout en
 * Vercel (maxDuration). Es el endpoint más caliente de la app (cada escaneo pasa
 * por acá), así que repetir el mismo producto una y otra vez es puro desperdicio.
 *
 * SIESA devuelve, para un `f120_id`, TODAS sus listas de precio (P01, P02, ...) y
 * todas sus unidades (UND, P15, KL...). Cacheamos ese mapa completo por ítem, de
 * modo que cualquier sede se sirve del mismo entry sin volver a pegarle a SIESA.
 *
 * Límite conocido: en serverless el cache es por instancia y se pierde en cold
 * start, así que la PRIMERA búsqueda de productos nuevos sigue golpeando SIESA.
 * Para eliminar eso del todo haría falta o un cache compartido (Redis/tabla) o
 * que la consulta de SIESA acepte varios `item` por request (batch) — eso último
 * depende de cómo esté registrada la query en Connekta y hay que confirmarlo.
 */

// ListaPrecio -> Unidad -> Precio
export type PricesByList = Record<string, Record<string, number>>;

type CacheEntry = { data: PricesByList; expiresAt: number };

const TTL_MS = 5 * 60 * 1000; // 5 minutos: los precios no cambian intradía.
const cache = new Map<number, CacheEntry>();

const fetchPricesFromSiesa = async (f120Id: number): Promise<PricesByList> => {
  // NOTA: `descripcion` NO es un texto cosmético — es el nombre con el que la
  // consulta está registrada en Connekta. Renombrarlo rompe la búsqueda de
  // precios. Si molesta el "pruebas", hay que re-registrar la query en SIESA
  // con otro nombre y recién ahí cambiarlo acá.
  const encodedParams = encodeURIComponent(`item=${f120Id}`);
  const encodedPagination = encodeURIComponent('numPag=1|tamPag=100');
  const url = `https://servicios.siesacloud.com/api/connekta/v3/ejecutarconsulta?idCompania=7375&descripcion=merkahorro_pruebas_query_francisco_precios&paginacion=${encodedPagination}&parametros=${encodedParams}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      ConniKey: env.SIESA_CONNI_KEY,
      ConniToken: env.SIESA_CONNI_TOKEN,
    },
  });

  if (!response.ok) {
    throw new Error(`SIESA HTTP ${response.status}`);
  }

  const json = await response.json();
  if (json.codigo !== 0 || !Array.isArray(json.detalle?.Datos)) {
    return {};
  }

  // SIESA trae `ListaPrecio`/`Unidad` con espacios → trim (+ upper en unidad).
  const map: PricesByList = {};
  for (const d of json.detalle.Datos) {
    const lista = String(d.ListaPrecio ?? '').trim();
    const um = String(d.Unidad ?? '').trim().toUpperCase();
    if (!lista || !um) continue;
    if (!map[lista]) map[lista] = {};
    map[lista][um] = Number(d.Precio);
  }
  return map;
};

/**
 * Devuelve el mapa de precios (lista → unidad → precio) de un ítem.
 * Sirve de cache si está fresco; si no, consulta SIESA y cachea el resultado.
 * Ante error de SIESA NO cachea: devuelve lo que haya en cache vencida (mejor un
 * precio viejo que ninguno) o `{}`. Nunca lanza: el catálogo debe responder
 * igual aunque SIESA esté caída.
 */
export const getItemPrices = async (f120Id: number): Promise<PricesByList> => {
  const now = Date.now();
  const cached = cache.get(f120Id);
  if (cached && cached.expiresAt > now) return cached.data;

  try {
    const data = await fetchPricesFromSiesa(f120Id);
    cache.set(f120Id, { data, expiresAt: now + TTL_MS });
    return data;
  } catch (err) {
    console.warn(
      `SIESA precio falló para ítem ${f120Id}:`,
      err instanceof Error ? err.message : err,
    );
    return cached?.data ?? {};
  }
};
