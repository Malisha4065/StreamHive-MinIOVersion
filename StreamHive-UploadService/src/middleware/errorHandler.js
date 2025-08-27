const logger = require('../utils/logger')

const errorHandler = (err, req, res, next) => {
  logger.error('Error occurred:', {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  })

  // Default error
  let error = {
    success: false,
    error: 'Internal server error'
  }

  // Multer errors (file upload)
  if (err.code === 'LIMIT_FILE_SIZE') {
    error.error = 'File too large'
    return res.status(413).json(error)
  }

  if (err.code === 'LIMIT_FILE_COUNT') {
    error.error = 'Too many files'
    return res.status(400).json(error)
  }

  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    error.error = 'Unexpected file field'
    return res.status(400).json(error)
  }

  // Validation errors
  if (err.name === 'ValidationError') {
    error.error = err.message
    return res.status(400).json(error)
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    error.error = 'Invalid token'
    return res.status(401).json(error)
  }

  if (err.name === 'TokenExpiredError') {
    error.error = 'Token expired'
    return res.status(401).json(error)
  }

  // MinIO errors
  if (err.code === 'NoSuchBucket') {
    error.error = 'Storage bucket not found'
    return res.status(500).json(error)
  }

  if (err.code === 'AccessDenied') {
    error.error = 'Storage access denied'
    return res.status(500).json(error)
  }

  // RabbitMQ errors
  if (err.message && err.message.includes('Channel closed')) {
    error.error = 'Message queue unavailable'
    return res.status(500).json(error)
  }

  // Custom application errors
  if (err.statusCode) {
    error.error = err.message
    return res.status(err.statusCode).json(error)
  }

  // Default 500 error
  res.status(500).json(error)
}

module.exports = errorHandler
