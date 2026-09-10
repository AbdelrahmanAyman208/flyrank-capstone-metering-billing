/**
 * Custom error classes for business-logic failures.
 * 
 * These are NOT unexpected errors — they represent expected conditions
 * (quota exceeded, payment required, bad input) that should produce
 * clean HTTP responses, never 500s.
 */

class AppError extends Error {
  constructor(message, statusCode, code) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.name = this.constructor.name;
  }
}

/**
 * 429 Too Many Requests — tenant has exceeded their plan quota.
 * Includes details about which quota, current usage, and limit.
 */
class QuotaExceededError extends AppError {
  constructor({ usageType, currentUsage, limit, requested }) {
    const message = `Quota exceeded for ${usageType}: ` +
      `current usage ${currentUsage} + requested ${requested} exceeds limit ${limit}`;
    super(message, 429, 'QUOTA_EXCEEDED');
    this.details = { usageType, currentUsage, limit, requested };
  }
}

/**
 * 402 Payment Required — tenant's subscription is not active (canceled, past_due, etc.).
 */
class PaymentRequiredError extends AppError {
  constructor(tenantId, status) {
    const message = `Subscription is ${status}. Please upgrade or renew your plan.`;
    super(message, 402, 'PAYMENT_REQUIRED');
    this.details = { tenantId, subscriptionStatus: status };
  }
}

/**
 * 400 Bad Request — invalid input from the client.
 */
class ValidationError extends AppError {
  constructor(message, details = {}) {
    super(message, 400, 'VALIDATION_ERROR');
    this.details = details;
  }
}

/**
 * 404 Not Found
 */
class NotFoundError extends AppError {
  constructor(resource, id) {
    super(`${resource} not found: ${id}`, 404, 'NOT_FOUND');
    this.details = { resource, id };
  }
}

/**
 * 409 Conflict — e.g. tenant already on Pro, can't checkout again.
 */
class ConflictError extends AppError {
  constructor(message) {
    super(message, 409, 'CONFLICT');
  }
}

module.exports = {
  AppError,
  QuotaExceededError,
  PaymentRequiredError,
  ValidationError,
  NotFoundError,
  ConflictError,
};
