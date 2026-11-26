import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api/v1',
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 15000,
});

// Attach JWT token to requests if present
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('ota_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Intercept responses to handle auth expiry and normalize errors
api.interceptors.response.use(
  (response) => response.data,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('ota_token');
      localStorage.removeItem('ota_user');
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    const message =
      error.response?.data?.message ||
      error.response?.data?.error ||
      error.message ||
      'An unexpected error occurred';
    return Promise.reject(new Error(message));
  }
);

// ============================================================================
// Multi-Tier Cache & Stale-While-Revalidate (SWR) Engine for Instant Tab Navigation
// ============================================================================

const memCache = new Map();
const FRESH_TTL_MS = 30000;   // 30s: completely fresh (zero network call)
const STALE_TTL_MS = 300000;  // 5m: stale-while-revalidate (0ms instant return + silent background sync)

const buildCacheKey = (url, params) => `${url}?${JSON.stringify(params || {})}`;

export const getCachedData = (url, params = {}) => {
  const key = buildCacheKey(url, params);
  const now = Date.now();

  // 1. Check memory cache (fastest)
  const mem = memCache.get(key);
  if (mem && now - mem.timestamp < STALE_TTL_MS) {
    return mem.data;
  }

  // 2. Check session storage cache fallback
  try {
    const item = sessionStorage.getItem(`ota_swr_${key}`);
    if (item) {
      const parsed = JSON.parse(item);
      if (now - parsed.timestamp < STALE_TTL_MS) {
        memCache.set(key, parsed);
        return parsed.data;
      }
    }
  } catch (_) {}

  return null;
};

export const setCachedData = (url, params, data) => {
  const key = buildCacheKey(url, params);
  const entry = { timestamp: Date.now(), data };
  memCache.set(key, entry);
  try {
    sessionStorage.setItem(`ota_swr_${key}`, JSON.stringify(entry));
  } catch (_) {}
};

export const clearApiCache = () => {
  memCache.clear();
  try {
    Object.keys(sessionStorage).forEach((k) => {
      if (k.startsWith('ota_swr_')) {
        sessionStorage.removeItem(k);
      }
    });
  } catch (_) {}
};

api.getCached = getCachedData;
api.clearCache = clearApiCache;

// Transparent caching wrapper for GET requests
const originalGet = api.get.bind(api);

api.get = async function (url, config = {}) {
  // If explicitly bypassing cache
  if (config.bypassCache || config.params?._t || config.headers?.['Cache-Control'] === 'no-cache') {
    const res = await originalGet(url, config);
    setCachedData(url, config.params, res);
    return res;
  }

  const key = buildCacheKey(url, config.params);
  const now = Date.now();
  const cachedMem = memCache.get(key);

  // If memory cache is fresh (< 30s), return immediately without touching network
  if (cachedMem && now - cachedMem.timestamp < FRESH_TTL_MS) {
    return cachedMem.data;
  }

  // If stale cache exists in memory or sessionStorage (< 5m), return immediately for 0ms instant UI,
  // and trigger a silent background revalidation
  const staleData = cachedMem?.data || getCachedData(url, config.params);
  if (staleData) {
    // Background revalidation (silent, non-blocking)
    originalGet(url, config)
      .then((fresh) => {
        setCachedData(url, config.params, fresh);
      })
      .catch(() => {});
    return staleData;
  }

  // No cache available: perform synchronous network call
  const freshResult = await originalGet(url, config);
  setCachedData(url, config.params, freshResult);
  return freshResult;
};

// Auto-invalidate cache on data-modifying mutations
['post', 'put', 'patch', 'delete'].forEach((method) => {
  const originalMethod = api[method].bind(api);
  api[method] = async function (...args) {
    const res = await originalMethod(...args);
    clearApiCache();
    return res;
  };
});

/**
 * Pre-warm commonly used ERP endpoints in the background so all tab clicks are 0ms instant
 */
export const prefetchCommonData = async () => {
  const token = localStorage.getItem('ota_token');
  if (!token) return;

  const endpoints = [
    '/reports/dashboard',
    '/boms',
    '/items',
    '/units',
    '/warehouses',
    '/parties',
    '/inventory/stock',
    '/batches',
    '/production/runs',
    '/sales/orders',
    '/accounting/overview',
    '/sales/invoices',
    '/users',
  ];

  for (const url of endpoints) {
    // Only fetch if not already fresh in memory
    const existing = getCachedData(url);
    if (!existing) {
      try {
        await api.get(url);
      } catch (_) {}
    }
  }
};

api.prefetchCommonData = prefetchCommonData;

export default api;
