const express = require('express')
const cors = require('cors')
const helmet = require('helmet')
const rateLimit = require('express-rate-limit')
require('dotenv').config()

const logger = require('./utils/logger')
const { connectS3 } = require('./config/s3')
const { connectRabbitMQ } = require('./config/rabbitmq')
const uploadRoutes = require('./routes/upload')
const healthRoutes = require('./routes/health')
const errorHandler = require('./middleware/errorHandler')

const app = express()
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3001

// Security middleware
app.use(helmet())
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  credentials: true
}))

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX) || 50, // limit each IP to 50 requests per windowMs
  message: {
    error: 'Too many upload requests, please try again later'
  }
})

app.use('/api/v1/upload', limiter)

// Body parsing middleware
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// Routes
app.use('/health', healthRoutes)
app.use('/api/v1/upload', uploadRoutes)

// Error handling
app.use(errorHandler)

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found'
  })
})

// Initialize connections and start server
async function startServer() {
  try {
    // Initialize S3 connection
    await connectS3()
    logger.info('S3 connection established')

    // Initialize RabbitMQ connection
    await connectRabbitMQ()
    logger.info('RabbitMQ connection established')

    // Start server
    app.listen(PORT, () => {
      logger.info(`Upload Service running on port ${PORT}`)
      logger.info(`Environment: ${process.env.NODE_ENV}`)
    })
  } catch (error) {
    logger.error('Failed to start server:', error)
    process.exit(1)
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully')
  process.exit(0)
})

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully')
  process.exit(0)
})

startServer()

module.exports = app
