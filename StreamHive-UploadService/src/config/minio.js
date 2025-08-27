const { Client } = require('minio')
const logger = require('../utils/logger')

let minioClient = null

const connectMinIO = async () => {
  try {
    minioClient = new Client({
      endPoint: process.env.MINIO_ENDPOINT || 'localhost',
      port: parseInt(process.env.MINIO_PORT) || 9000,
      useSSL: process.env.MINIO_USE_SSL === 'true',
      accessKey: process.env.MINIO_ACCESS_KEY,
      secretKey: process.env.MINIO_SECRET_KEY
    })

    // Check if bucket exists, create if not
    const bucketName = process.env.MINIO_BUCKET
    const bucketExists = await minioClient.bucketExists(bucketName)
    
    if (!bucketExists) {
      await minioClient.makeBucket(bucketName, 'us-east-1')
      logger.info(`Created bucket: ${bucketName}`)
    }

    // Set bucket policy for public read access to processed videos
    const policy = {
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: { AWS: ['*'] },
          Action: ['s3:GetObject'],
          Resource: [`arn:aws:s3:::${bucketName}/processed/*`]
        }
      ]
    }

    await minioClient.setBucketPolicy(bucketName, JSON.stringify(policy))
    logger.info('MinIO bucket policy set for public access to processed videos')

    return minioClient
  } catch (error) {
    logger.error('MinIO connection failed:', error)
    throw error
  }
}

const getMinIOClient = () => {
  if (!minioClient) {
    throw new Error('MinIO client not initialized')
  }
  return minioClient
}

module.exports = {
  connectMinIO,
  getMinIOClient
}
