/**
 * Input validation middleware.
 * 
 * Validates request bodies/params at the boundary layer.
 * Bad input returns a clean 400, never an unhandled exception.
 */

const { ValidationError } = require('../utils/errors');

/**
 * Validate that required fields exist and have the expected types.
 * 
 * @param {Object} rules - { fieldName: { type: 'string'|'number', required: boolean } }
 * @param {string} source - 'body' | 'query'
 */
function validate(rules, source = 'body') {
  return (req, res, next) => {
    const data = source === 'body' ? req.body : req.query;
    const errors = [];

    for (const [field, rule] of Object.entries(rules)) {
      const value = data[field];

      // Check required
      if (rule.required && (value === undefined || value === null || value === '')) {
        errors.push(`${field} is required`);
        continue;
      }

      // Skip type check if field is optional and not provided
      if (value === undefined || value === null) continue;

      // Check type
      if (rule.type === 'string' && typeof value !== 'string') {
        errors.push(`${field} must be a string`);
      }
      if (rule.type === 'number') {
        const num = typeof value === 'string' ? Number(value) : value;
        if (isNaN(num) || !Number.isFinite(num)) {
          errors.push(`${field} must be a number`);
        }
      }
      if (rule.type === 'integer') {
        const num = typeof value === 'string' ? Number(value) : value;
        if (!Number.isInteger(num) || num < 0) {
          errors.push(`${field} must be a positive integer`);
        }
      }

      // Check enum
      if (rule.enum && !rule.enum.includes(value)) {
        errors.push(`${field} must be one of: ${rule.enum.join(', ')}`);
      }
    }

    if (errors.length > 0) {
      return next(new ValidationError('Invalid input', { errors }));
    }

    next();
  };
}

module.exports = { validate };
