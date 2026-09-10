/**
 * Global error handler middleware.
 * 
 * Catches all errors thrown in route handlers and services.
 * Custom AppError subclasses produce clean JSON responses with the right status code.
 * Unknown errors produce 500 — but never expose internal details to the client.
 */

const { AppError } = require('../utils/errors');

function errorHandler(err, req, res, next) {
  // Custom business-logic errors → clean JSON response
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details || {},
      },
    });
  }

  // Unknown/unexpected errors → 500, log internally, don't expose details
  console.error('[ErrorHandler] Unexpected error:', err);

  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    },
  });
}

module.exports = errorHandler;
