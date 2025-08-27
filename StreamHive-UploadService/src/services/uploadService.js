const { uploadBlob } = require('../config/s3')
const { publishToTranscodeQueue } = require('../config/rabbitmq')
const { extractVideoMetadata } = require('../utils/videoUtils')
const logger = require('../utils/logger')
const fs = require('fs')

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

// In-memory storage for upload status (in production, use Redis or database)
const uploadStatus = new Map()

const uploadVideo = async (uploadData) => {
  try {
    const {
      uploadId,
      userId,
      username,
      originalFilename,
      fileExtension,
      fileSize,
      mimeType,
      buffer,
      title,
      description,
      tags,
      isPrivate,
      category
    } = uploadData

    // Store initial status
    uploadStatus.set(uploadId, {
      uploadId,
      userId,
      status: 'uploading',
      progress: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    })

    // Generate storage paths
    const rawVideoPath = `raw/${userId}/${uploadId}${fileExtension}`
    const containerName = getSecret('/mnt/secrets-store/minio-raw-bucket', 'MINIO_RAW_BUCKET')

    // Extract video metadata
    logger.info(`Extracting metadata for upload: ${uploadId}`)
    const metadata = await extractVideoMetadata(buffer)

    // Upload raw video to MinIO
    logger.info(`Uploading raw video to MinIO: ${uploadId}`)
    
    const blobMetadata = {
      'upload-id': uploadId,
      'user-id': userId.toString(),
      'original-filename': originalFilename,
      'title': title,
      'description': description || '',
      'tags': tags || '',
      'is-private': isPrivate.toString(),
      'category': category,
      'duration': metadata.duration?.toString() || '0',
      'width': metadata.width?.toString() || '0',
      'height': metadata.height?.toString() || '0',
      'bitrate': metadata.bitrate?.toString() || '0'
    }

    const uploadResult = await uploadBlob(
      containerName,
      rawVideoPath,
      buffer,
      {
        contentType: mimeType,
        metadata: blobMetadata
      }
    )

    // Update status
    uploadStatus.set(uploadId, {
      ...uploadStatus.get(uploadId),
      status: 'uploaded',
      progress: 50,
      rawVideoPath,
      containerName,
      blobUrl: uploadResult.url,
      metadata,
      updatedAt: new Date()
    })

    // Prepare uploaded event for video catalog service
    const uploadedEvent = {
      uploadId,
      userId: userId.toString(),
      username,
      originalFilename,
      title,
      description,
      tags: tags ? tags.split(',').map(tag => tag.trim()) : [],
      isPrivate,
      category,
      rawVideoPath,
      containerName,
      blobUrl: uploadResult.url
    }

    // Publish uploaded event to catalog service
    logger.info(`Publishing uploaded event for catalog: ${uploadId}`)
    await publishToTranscodeQueue(uploadedEvent)

    // Update status
    uploadStatus.set(uploadId, {
      ...uploadStatus.get(uploadId),
      status: 'queued_for_transcoding',
      progress: 60,
      updatedAt: new Date()
    })

    // Estimate processing time based on video duration and file size
    const estimatedProcessingTime = calculateProcessingTime(metadata.duration, fileSize)

    logger.info(`Upload completed successfully: ${uploadId}`)

    return {
      uploadId,
      status: 'queued_for_transcoding',
      estimatedProcessingTime
    }

  } catch (error) {
    logger.error(`Upload failed: ${uploadData.uploadId}`, error)
    
    // Update status with error
    if (uploadData.uploadId) {
      uploadStatus.set(uploadData.uploadId, {
        ...uploadStatus.get(uploadData.uploadId),
        status: 'failed',
        error: error.message,
        updatedAt: new Date()
      })
    }
    
    throw error
  }
}

const getUploadStatus = async (uploadId, userId) => {
  try {
    const status = uploadStatus.get(uploadId)
    
    if (!status) {
      return null
    }

    // Check if user has access to this upload
    if (status.userId !== userId) {
      return null
    }

    return status
  } catch (error) {
    logger.error(`Failed to get upload status: ${uploadId}`, error)
    throw error
  }
}

const updateUploadStatus = (uploadId, statusUpdate) => {
  const currentStatus = uploadStatus.get(uploadId)
  if (currentStatus) {
    uploadStatus.set(uploadId, {
      ...currentStatus,
      ...statusUpdate,
      updatedAt: new Date()
    })
  }
}

const calculateProcessingTime = (duration, fileSize) => {
  // Basic estimation: 2x video duration + file size factor
  const durationFactor = (duration || 60) * 2 // 2 seconds processing per 1 second of video
  const sizeFactor = Math.ceil(fileSize / (100 * 1024 * 1024)) * 30 // 30 seconds per 100MB
  
  return Math.max(durationFactor + sizeFactor, 60) // Minimum 1 minute
}

module.exports = {
  uploadVideo,
  getUploadStatus,
  updateUploadStatus
}
