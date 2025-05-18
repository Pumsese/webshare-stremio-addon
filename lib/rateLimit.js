const { RateLimiterRedis } = require('rate-limiter-flexible');
const Redis = require('ioredis');

const redis = process.env.REDIS_URL 
  ? new Redis(process.env.REDIS_URL)
  : new Redis();

const rateLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'ws:ratelimit',
  points: 30, // požadavků
  duration: 60, // za minutu
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
