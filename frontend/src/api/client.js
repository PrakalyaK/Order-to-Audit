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

// In-memory response cache to make tab switches instantaneous (0ms)
const cache = new Map();
const CACHE_TTL_MS = 60000; // 60 seconds

export const clearApiCache = () => {
  cache.clear();
};

api.clearCache = clearApiCache;

// Transparent caching wrapper for GET requests
const originalGet = api.get.bind(api);
api.get = async function (url, config = {}) {
  // If caller requests a bypass or passes a cache-busting timestamp
  if (config.bypassCache || config.params?._t || config.headers?.['Cache-Control'] === 'no-cache') {
    const res = await originalGet(url, config);
    return res;
  }

  const cacheKey = `${url}?${JSON.stringify(config.params || {})}`;
  const cached = cache.get(cacheKey);
  const now = Date.now();

  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  const result = await originalGet(url, config);
  cache.set(cacheKey, { timestamp: now, data: result });
  return result;
};

// Automatically invalidate cache whenever a state-changing mutation occurs
['post', 'put', 'patch', 'delete'].forEach((method) => {
  const originalMethod = api[method].bind(api);
  api[method] = async function (...args) {
    clearApiCache();
    return originalMethod(...args);
  };
});

export default api;
