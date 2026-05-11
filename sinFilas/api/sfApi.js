import axios from 'axios';
import { obtenerToken } from '../../../data/funciones';

const BASE_URL = import.meta.env.VITE_SF_API_URL || 'https://backend-sin-filas.vercel.app/api/sf';

export const sfApi = axios.create({
  baseURL: BASE_URL,
});

sfApi.interceptors.request.use((config) => {
  const token = obtenerToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  // Fuente de verdad para Sin Filas: sf_sede_id (la setea el SFSedeSelector).
  // Fallback: ecommerce_sede_id, para empleados con sede asignada que ya la
  // tenían cargada desde el módulo ecommerce. Nunca enviamos "todas".
  const sfSedeId = localStorage.getItem('sf_sede_id');
  const ecommerceSedeId = localStorage.getItem('ecommerce_sede_id');
  const sedeId = sfSedeId || ecommerceSedeId;
  if (sedeId && sedeId !== 'todas') {
    config.headers['X-Sede-ID'] = sedeId;
  }

  return config;
});

export const searchCatalog = async (query) => {
  const { data } = await sfApi.get(`/catalog/search?query=${encodeURIComponent(query)}`);
  return data;
};

export const finalizeCheckoutDirect = async (items, rawQrString) => {
  const { data } = await sfApi.post('/sessions/checkout-direct', {
    items,
    raw_qr_string: rawQrString,
  });
  return data;
};

export const getAdminStats = async () => {
  const { data } = await sfApi.get('/admin/stats');
  return data;
};

export const getAdminSessions = async () => {
  const { data } = await sfApi.get('/admin/sessions');
  return data;
};

export const getAdminUsers = async () => {
  const { data } = await sfApi.get('/admin/users');
  return data;
};

export const getUserSessions = async () => {
  const { data } = await sfApi.get('/sessions');
  return data.data;
};
