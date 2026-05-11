import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../../supabaseClient';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SF_SEDE_KEY = 'sf_sede_id';
const SF_SEDE_NAME_KEY = 'sf_sede_nombre';
const ECOMMERCE_SEDE_KEY = 'ecommerce_sede_id';
const ECOMMERCE_SEDE_NAME_KEY = 'ecommerce_sede_nombre';

const isValidSedeId = (value) =>
  typeof value === 'string' && value !== 'todas' && UUID_RE.test(value);

/**
 * Hook que gobierna qué sede está activa en Sin Filas.
 *
 * Fuente de verdad: localStorage.sf_sede_id (independiente del módulo ecommerce).
 * Si no existe, intenta tomar ecommerce_sede_id como semilla — útil para
 * empleados con sede asignada que ya la tenían cargada desde el ecommerce.
 *
 * Estados que expone:
 *  - sedeId / sedeName: la sede activa (null si todavía no se eligió).
 *  - sedes: lista de sedes activas para mostrar en el selector.
 *  - loading: cargando lista de sedes.
 *  - error: error cargando sedes.
 *  - selectSede(sede): persiste la sede en localStorage y actualiza el estado.
 *  - clearSede(): borra la sede activa (para volver a forzar selección).
 */
export const useSFSede = () => {
  const [sedes, setSedes] = useState([]);
  const [sedeId, setSedeId] = useState(null);
  const [sedeName, setSedeName] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const load = async () => {
      try {
        const { data, error: err } = await supabase
          .from('wc_sedes')
          .select('id, nombre, slug, activa')
          .eq('activa', true)
          .order('nombre', { ascending: true });

        if (err) throw err;
        setSedes(data || []);

        // Resolver sede inicial: sf_sede_id > ecommerce_sede_id > nada.
        const storedSf = localStorage.getItem(SF_SEDE_KEY);
        const storedEcom = localStorage.getItem(ECOMMERCE_SEDE_KEY);
        const seedCandidate = isValidSedeId(storedSf)
          ? storedSf
          : isValidSedeId(storedEcom)
            ? storedEcom
            : null;

        if (seedCandidate) {
          const match = (data || []).find((s) => s.id === seedCandidate);
          if (match) {
            setSedeId(match.id);
            setSedeName(match.nombre);
            localStorage.setItem(SF_SEDE_KEY, match.id);
            localStorage.setItem(SF_SEDE_NAME_KEY, match.nombre);
          }
        }
      } catch (err) {
        console.error('[useSFSede] error cargando sedes:', err);
        setError(err);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, []);

  const selectSede = useCallback((sede) => {
    if (!sede?.id) return;
    setSedeId(sede.id);
    setSedeName(sede.nombre || null);
    localStorage.setItem(SF_SEDE_KEY, sede.id);
    if (sede.nombre) localStorage.setItem(SF_SEDE_NAME_KEY, sede.nombre);
  }, []);

  const clearSede = useCallback(() => {
    setSedeId(null);
    setSedeName(null);
    localStorage.removeItem(SF_SEDE_KEY);
    localStorage.removeItem(SF_SEDE_NAME_KEY);
  }, []);

  return {
    sedeId,
    sedeName,
    sedes,
    loading,
    error,
    selectSede,
    clearSede,
  };
};
