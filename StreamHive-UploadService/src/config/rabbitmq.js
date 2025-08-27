const amqp = require('amqplib')
const logger = require('../utils/logger')

let connection = null
let channel = null

const connectRabbitMQ = async () => {
  try {
    connection = await amqp.connect(process.env.RABBITMQ_URL)
    channel = await connection.createChannel()

    // Declare topic exchange for event routing
    const exchange = process.env.AMQP_EXCHANGE || 'streamhive'
    await channel.assertExchange(exchange, 'topic', { durable: true })

    // (Optional) declare upload queue for local diagnostics (transcoder will declare its own)
    const uploadRoutingKey = process.env.AMQP_UPLOAD_ROUTING_KEY || 'video.uploaded'
    logger.info(`RabbitMQ connected. Using exchange='${exchange}', routingKey='${uploadRoutingKey}'`)

    connection.on('error', (error) => {
      logger.error('RabbitMQ connection error:', error)
    })

    connection.on('close', () => {
      logger.warn('RabbitMQ connection closed')
    })

    return { connection, channel }
  } catch (error) {
    logger.error('RabbitMQ connection failed:', error)
    throw error
  }
}

const publishToTranscodeQueue = async (message) => {
  try {
    if (!channel) {
      throw new Error('RabbitMQ channel not initialized')
    }

    const exchange = process.env.AMQP_EXCHANGE || 'streamhive'
    const uploadRoutingKey = process.env.AMQP_UPLOAD_ROUTING_KEY || 'video.uploaded'

    const payload = Buffer.from(JSON.stringify(message))
    channel.publish(exchange, uploadRoutingKey, payload, {
      contentType: 'application/json',
      persistent: true,
      timestamp: Date.now(),
      messageId: message.uploadId
    })

    logger.info(`Published upload event: ${message.uploadId}`)
  } catch (error) {
    logger.error('Failed to publish upload event:', error)
    throw error
  }
}

const getRabbitMQChannel = () => {
  if (!channel) {
    throw new Error('RabbitMQ channel not initialized')
  }
  return channel
}

const closeRabbitMQ = async () => {
  try {
    if (channel) await channel.close()
    if (connection) await connection.close()
    logger.info('RabbitMQ connection closed')
  } catch (error) {
    logger.error('Error closing RabbitMQ connection:', error)
  }
}

module.exports = {
  connectRabbitMQ,
  publishToTranscodeQueue,
  getRabbitMQChannel,
  closeRabbitMQ
}
