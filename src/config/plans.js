/**
 * Plan definitions — these match the seed data in the plans table.
 * 
 * Free:  1,000 API calls / 100,000 AI tokens per month
 * Pro:  50,000 API calls / 5,000,000 AI tokens per month (50× Free)
 */

module.exports = {
  FREE: {
    name: 'free',
    displayName: 'Free',
    apiCallLimit: 1_000,
    aiTokenLimit: 100_000,
    priceCents: 0,
  },
  PRO: {
    name: 'pro',
    displayName: 'Pro',
    apiCallLimit: 50_000,
    aiTokenLimit: 5_000_000,
    priceCents: 4900,  // $49.00/month
  },
};
