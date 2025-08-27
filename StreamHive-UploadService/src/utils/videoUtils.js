const ffmpeg = require('fluent-ffmpeg')
const { Readable } = require('stream')

const extractVideoMetadata = (buffer) => {
  return new Promise((resolve, reject) => {
    // Create a readable stream from buffer
    const stream = new Readable()
    stream.push(buffer)
    stream.push(null)

    ffmpeg(stream)
      .ffprobe((err, metadata) => {
        if (err) {
          reject(new Error(`Failed to extract video metadata: ${err.message}`))
          return
        }

        try {
          const videoStream = metadata.streams.find(stream => stream.codec_type === 'video')
          const audioStream = metadata.streams.find(stream => stream.codec_type === 'audio')

          const extractedMetadata = {
            duration: parseFloat(metadata.format.duration) || 0,
            fileSize: parseInt(metadata.format.size) || 0,
            bitrate: parseInt(metadata.format.bit_rate) || 0,
            format: metadata.format.format_name,
            
            // Video metadata
            width: videoStream?.width || 0,
            height: videoStream?.height || 0,
            videoCodec: videoStream?.codec_name || 'unknown',
            videoBitrate: parseInt(videoStream?.bit_rate) || 0,
            frameRate: videoStream?.r_frame_rate ? eval(videoStream.r_frame_rate) : 0,
            aspectRatio: videoStream?.display_aspect_ratio || 'unknown',
            
            // Audio metadata
            audioCodec: audioStream?.codec_name || 'unknown',
            audioBitrate: parseInt(audioStream?.bit_rate) || 0,
            audioChannels: audioStream?.channels || 0,
            audioSampleRate: parseInt(audioStream?.sample_rate) || 0,
            
            // Additional metadata
            hasVideo: !!videoStream,
            hasAudio: !!audioStream,
            isHD: videoStream?.height >= 720,
            is4K: videoStream?.height >= 2160
          }

          resolve(extractedMetadata)
        } catch (parseError) {
          reject(new Error(`Failed to parse video metadata: ${parseError.message}`))
        }
      })
  })
}

const validateVideoFile = async (buffer) => {
  try {
    const metadata = await extractVideoMetadata(buffer)
    
    const validation = {
      isValid: true,
      errors: [],
      warnings: [],
      metadata
    }

    // Check if file has video stream
    if (!metadata.hasVideo) {
      validation.isValid = false
      validation.errors.push('File does not contain a valid video stream')
    }

    // Check minimum duration (e.g., at least 1 second)
    if (metadata.duration < 1) {
      validation.isValid = false
      validation.errors.push('Video duration must be at least 1 second')
    }

    // Check maximum duration (e.g., max 4 hours)
    if (metadata.duration > 14400) { // 4 hours in seconds
      validation.isValid = false
      validation.errors.push('Video duration cannot exceed 4 hours')
    }

    // Check minimum resolution
    if (metadata.width < 240 || metadata.height < 180) {
      validation.isValid = false
      validation.errors.push('Video resolution too low (minimum 240x180)')
    }

    // Warnings for optimal streaming
    if (!metadata.hasAudio) {
      validation.warnings.push('Video does not contain audio track')
    }

    if (metadata.frameRate > 60) {
      validation.warnings.push('High frame rate detected (>60fps), may increase processing time')
    }

    if (metadata.videoBitrate > 50000000) { // 50 Mbps
      validation.warnings.push('Very high bitrate detected, consider compressing before upload')
    }

    return validation
  } catch (error) {
    return {
      isValid: false,
      errors: [`Failed to validate video file: ${error.message}`],
      warnings: [],
      metadata: null
    }
  }
}

const generateThumbnail = (buffer, timestamp = '00:00:05') => {
  return new Promise((resolve, reject) => {
    const stream = new Readable()
    stream.push(buffer)
    stream.push(null)

    const thumbnailBuffer = []

    ffmpeg(stream)
      .seekInput(timestamp)
      .frames(1)
      .format('image2')
      .outputOptions(['-vf', 'scale=320:240'])
      .on('error', (err) => {
        reject(new Error(`Failed to generate thumbnail: ${err.message}`))
      })
      .on('end', () => {
        resolve(Buffer.concat(thumbnailBuffer))
      })
      .pipe()
      .on('data', (chunk) => {
        thumbnailBuffer.push(chunk)
      })
  })
}

const getVideoQualityLevel = (width, height, bitrate) => {
  if (height >= 2160) return '4K'
  if (height >= 1080) return '1080p'
  if (height >= 720) return '720p'
  if (height >= 480) return '480p'
  if (height >= 360) return '360p'
  return '240p'
}

module.exports = {
  extractVideoMetadata,
  validateVideoFile,
  generateThumbnail,
  getVideoQualityLevel
}
