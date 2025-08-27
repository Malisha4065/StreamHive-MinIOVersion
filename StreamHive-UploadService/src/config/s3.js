const { Client } = require('minio')
const logger = require('../utils/logger')
const fs = require('fs')

let minioClient = null

// Helper function to read secret from file or fallback to environment variable
const getSecret = (filePath, envVar) => {
  try {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf8').trim()
    }
  } catch (error) {
    logger.warn(`Failed to read secret from file ${filePath}: ${error.message}`)
  }
  return process.env[envVar]
}

const connectS3 = async () => {
  try {
    // Support both legacy AZURE_* env vars (from k8s secret mount) and MINIO_* env vars
    const endPoint = getSecret('/mnt/secrets-store/minio-endpoint', 'MINIO_ENDPOINT') || process.env.MINIO_ENDPOINT || 'minio'
    const port = parseInt(getSecret('/mnt/secrets-store/minio-port', 'MINIO_PORT')) || parseInt(process.env.MINIO_PORT) || 9000
    const useSSLRaw = getSecret('/mnt/secrets-store/minio-use-ssl', 'MINIO_USE_SSL') || process.env.MINIO_USE_SSL || 'false'
    const useSSL = String(useSSLRaw).toLowerCase() === 'true'
    const accessKey = getSecret('/mnt/secrets-store/minio-access-key', 'MINIO_ACCESS_KEY') || process.env.MINIO_ACCESS_KEY
    const secretKey = getSecret('/mnt/secrets-store/minio-secret-key', 'MINIO_SECRET_KEY') || process.env.MINIO_SECRET_KEY

    if (!accessKey || !secretKey) {
      throw new Error('MinIO credentials not provided. Set MINIO_ACCESS_KEY and MINIO_SECRET_KEY')
    }

    minioClient = new Client({
      endPoint,
      port,
      useSSL,
      accessKey,
      secretKey
    })

    // Determine bucket names (support legacy AZURE env var names used in k8s manifests)
    const rawBucket = getSecret('/mnt/secrets-store/azure-storage-raw-container', 'AZURE_STORAGE_RAW_CONTAINER') || process.env.MINIO_RAW_BUCKET || 'raw-videos'
    const processedBucket = getSecret('/mnt/secrets-store/azure-storage-processed-container', 'AZURE_STORAGE_PROCESSED_CONTAINER') || process.env.MINIO_PROCESSED_BUCKET || 'processed-videos'

    // Ensure buckets exist
    const ensureBucket = async (bucket) => {
      const exists = await minioClient.bucketExists(bucket)
      if (!exists) {
        await minioClient.makeBucket(bucket, 'us-east-1')
        logger.info(`Created bucket: ${bucket}`)
      }
    }

    await ensureBucket(rawBucket)
    await ensureBucket(processedBucket)

    logger.info('MinIO connection established')
    return minioClient
  } catch (error) {
    logger.error('MinIO connection failed:', error)
    throw error
  }
}

const getS3Client = () => {
  if (!minioClient) {
    throw new Error('MinIO client not initialized')
  }
  return minioClient
}

const uploadBlob = async (containerName, blobName, data, options = {}) => {
  try {
    if (!minioClient) {
      throw new Error('MinIO client not initialized')
    }

    const metaData = {}
    if (options.contentType) metaData['Content-Type'] = options.contentType
    // Attach any provided metadata (flatten to strings)
    if (options.metadata && typeof options.metadata === 'object') {
      for (const [k, v] of Object.entries(options.metadata)) {
        try { metaData[k] = String(v) } catch (e) { metaData[k] = '' }
      }
    }

    // minio.putObject supports Buffer directly. size argument required for Buffer
    const size = Buffer.isBuffer(data) ? data.length : undefined

    const putResult = await new Promise((resolve, reject) => {
      // If size is undefined (stream), omit; but uploadService passes Buffer
      if (size !== undefined) {
        minioClient.putObject(containerName, blobName, data, size, metaData, (err, etag) => {
          if (err) return reject(err)
          resolve({ etag })
        })
      } else {
        minioClient.putObject(containerName, blobName, data, metaData, (err, etag) => {
          if (err) return reject(err)
          resolve({ etag })
        })
      }
    })

    logger.info(`Object uploaded successfully: ${containerName}/${blobName}`)

    const url = `${minioClient.protocol || (minioClient.secure ? 'https' : 'http')}://${(minioClient.host || (minioClient.connection && minioClient.connection.host)) || ''}:${minioClient.port || ''}/${containerName}/${encodeURIComponent(blobName)}`

    return {
      url,
      etag: putResult.etag
    }
  } catch (error) {
    logger.error(`Failed to upload object ${blobName}:`, error)
    throw error
  }
}

const generateSASUrl = async (containerName, blobName, permissions = 'r', expiryHours = 24) => {
  try {
    if (!minioClient) throw new Error('MinIO client not initialized')
    const expires = Math.max(60, expiryHours * 60 * 60)
    if (permissions === 'r') {
      return await new Promise((resolve, reject) => {
        minioClient.presignedGetObject(containerName, blobName, expires, (err, presignedUrl) => {
          if (err) return reject(err)
          resolve(presignedUrl)
        })
      })
    }
    if (permissions === 'w' || permissions === 'put') {
      return await new Promise((resolve, reject) => {
        minioClient.presignedPutObject(containerName, blobName, expires, (err, presignedUrl) => {
          if (err) return reject(err)
          resolve(presignedUrl)
        })
      })
    }
    throw new Error('Unsupported permission for presigned URL')
  } catch (error) {
    logger.error('Failed to generate presigned URL:', error)
    throw error
  }
}

const deleteBlob = async (containerName, blobName) => {
  try {
    if (!minioClient) throw new Error('MinIO client not initialized')
    await minioClient.removeObject(containerName, blobName)
    logger.info(`Object deleted: ${containerName}/${blobName}`)
  } catch (error) {
    logger.error(`Failed to delete object ${blobName}:`, error)
    throw error
  }
}

const getBlobMetadata = async (containerName, blobName) => {
  try {
    if (!minioClient) throw new Error('MinIO client not initialized')
    const stat = await minioClient.statObject(containerName, blobName)
    return {
      size: stat.size,
      contentType: (stat.metaData && (stat.metaData['Content-Type'] || stat.metaData['content-type'])) || null,
      lastModified: stat.lastModified || null,
      etag: stat.etag || null,
      metadata: stat.metaData || {}
    }
  } catch (error) {
    logger.error(`Failed to get object metadata ${blobName}:`, error)
    throw error
  }
}

module.exports = {
  connectS3,
  getS3Client,
  uploadBlob,
  generateSASUrl,
  deleteBlob,
  getBlobMetadata
}
