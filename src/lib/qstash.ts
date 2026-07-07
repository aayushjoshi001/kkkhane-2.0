import { Client } from "@upstash/qstash";

// Only initialize if the token exists, otherwise fail gracefully during dev
export const qstash = process.env.QSTASH_TOKEN 
  ? new Client({ 
      token: process.env.QSTASH_TOKEN,
      baseUrl: process.env.QSTASH_URL || "https://qstash.upstash.io",
    }) 
  : null;

/**
 * Example usage:
 * 
 * await qstash?.publishJSON({
 *   url: "https://your-domain.com/api/webhooks/daily-rollup",
 *   body: { restaurantId: "123" },
 *   delay: "1d", // optional delay
 * });
 */
