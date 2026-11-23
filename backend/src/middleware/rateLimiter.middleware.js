/**
 * In-Memory Sliding-Window Rate Limiter Middleware
 * 
 * Specifically protects sensitive endpoints (e.g. login) against repeated brute-force attempts.
 * Tracks client IP and request timestamps in memory.
 */
export const createRateLimiter = ({
  windowMs = 15 * 60 * 1000, // 15 minutes
  max = 5,                    // 5 attempts per window
  message = 'Too many login attempts. Please try again after 15 minutes.',
} = {}) => {
  const store = new Map();

  const limiter = (req, res, next) => {
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '127.0.0.1';
    const now = Date.now();
    const windowStart = now - windowMs;

    let timestamps = store.get(ip) || [];
    // Filter out timestamps outside current sliding window
    timestamps = timestamps.filter((t) => t > windowStart);

    if (timestamps.length >= max) {
      const oldestAttempt = timestamps[0];
      const retryAfterSec = Math.ceil((oldestAttempt + windowMs - now) / 1000);

      res.setHeader('Retry-After', retryAfterSec > 0 ? retryAfterSec : 1);
      res.setHeader('X-RateLimit-Limit', max);
      res.setHeader('X-RateLimit-Remaining', 0);
      res.setHeader('X-RateLimit-Reset', Math.ceil((oldestAttempt + windowMs) / 1000));

      return res.status(429).json({
        success: false,
        statusCode: 429,
        message,
      });
    }

    timestamps.push(now);
    store.set(ip, timestamps);

    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', max - timestamps.length);

    next();
  };

  // Helper for tests to reset state
  limiter.reset = () => {
    store.clear();
  };

  return limiter;
};

// Default login rate limiter: 5 attempts per 15 minutes
export const loginRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many login attempts. Please try again after 15 minutes.',
});
