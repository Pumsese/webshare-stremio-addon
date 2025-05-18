const { RateLimiterRedis } = require('rate-limiter-flexible');
const Redis = require('ioredis');

// Inicializace Redis (musí být stejná jako v helpers.js)
const redis = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: 2,
  retryStrategy: times => {
    if (times > 5) return null;
    return Math.min(times * 200, 2000);
  }
});
redis.on('error', (err) => {
  console.error('[REDIS ERROR]', err);
});

// ZVÝŠENÝ LIMIT pro jednoho uživatele/vývoj
const rateLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'ws:ratelimit',
  points: 1000,      // POVOLENO 200 požadavků
  duration: 60      // ...za 60 sekund (1 minuta)
});

async function checkRateLimit(ip) {
  try {
    await rateLimiter.consume(ip);
    return true;
  } catch (err) {
    return false;
  }
}

module.exports = { checkRateLimit };
