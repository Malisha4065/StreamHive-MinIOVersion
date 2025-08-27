const axios = require('axios')
const FormData = require('form-data')
const fs = require('fs')
const path = require('path')

class UploadServiceClient {
  constructor(baseURL, authToken) {
    this.baseURL = baseURL || 'http://localhost:3001'
    this.authToken = authToken
    this.client = axios.create({
      baseURL: this.baseURL,
      headers: {
        'Authorization': `Bearer ${this.authToken}`
      }
    })
  }

  /**
   * Upload a video file
   * @param {string} filePath - Path to video file
   * @param {object} metadata - Video metadata
   * @returns {Promise<object>} Upload response
   */
  async uploadVideo(filePath, metadata = {}) {
    try {
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`)
      }

      const form = new FormData()
      form.append('video', fs.createReadStream(filePath))
      form.append('title', metadata.title || path.basename(filePath))
      
      if (metadata.description) {
        form.append('description', metadata.description)
      }
      
      if (metadata.tags) {
        form.append('tags', Array.isArray(metadata.tags) ? metadata.tags.join(',') : metadata.tags)
      }
      
      if (metadata.isPrivate !== undefined) {
        form.append('isPrivate', metadata.isPrivate.toString())
      }
      
      if (metadata.category) {
        form.append('category', metadata.category)
      }

      const response = await this.client.post('/api/v1/upload', form, {
        headers: {
          ...form.getHeaders(),
          'Content-Length': form.getLengthSync()
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: 300000 // 5 minutes
      })

      return response.data
    } catch (error) {
      throw this.handleError(error)
    }
  }

  /**
   * Get upload status
   * @param {string} uploadId - Upload ID
   * @returns {Promise<object>} Status response
   */
  async getUploadStatus(uploadId) {
    try {
      const response = await this.client.get(`/api/v1/upload/${uploadId}/status`)
      return response.data
    } catch (error) {
      throw this.handleError(error)
    }
  }

  /**
   * Get user's uploads
   * @param {object} options - Query options
   * @returns {Promise<object>} Uploads list
   */
  async getMyUploads(options = {}) {
    try {
      const params = new URLSearchParams()
      
      if (options.page) params.append('page', options.page)
      if (options.limit) params.append('limit', options.limit)
      if (options.status) params.append('status', options.status)

      const response = await this.client.get(`/api/v1/upload/my-uploads?${params}`)
      return response.data
    } catch (error) {
      throw this.handleError(error)
    }
  }

  /**
   * Check service health
   * @returns {Promise<object>} Health status
   */
  async getHealth() {
    try {
      const response = await axios.get(`${this.baseURL}/health`)
      return response.data
    } catch (error) {
      throw this.handleError(error)
    }
  }

  /**
   * Wait for upload to complete
   * @param {string} uploadId - Upload ID
   * @param {number} timeout - Timeout in milliseconds
   * @returns {Promise<object>} Final status
   */
  async waitForCompletion(uploadId, timeout = 600000) { // 10 minutes default
    const startTime = Date.now()
    const pollInterval = 5000 // 5 seconds

    while (Date.now() - startTime < timeout) {
      const status = await this.getUploadStatus(uploadId)
      
      if (status.data.status === 'completed') {
        return status
      }
      
      if (status.data.status === 'failed') {
        throw new Error(`Upload failed: ${status.data.error || 'Unknown error'}`)
      }
      
      console.log(`Upload ${uploadId} status: ${status.data.status} (${status.data.progress || 0}%)`)
      
      await new Promise(resolve => setTimeout(resolve, pollInterval))
    }
    
    throw new Error(`Upload ${uploadId} did not complete within ${timeout}ms`)
  }

  /**
   * Handle API errors
   * @param {Error} error - Axios error
   * @returns {Error} Formatted error
   */
  handleError(error) {
    if (error.response) {
      const { status, data } = error.response
      const message = data.error || data.message || `HTTP ${status} error`
      const apiError = new Error(message)
      apiError.status = status
      apiError.details = data.details
      return apiError
    } else if (error.request) {
      return new Error('Network error: No response received')
    } else {
      return error
    }
  }
}

module.exports = UploadServiceClient

// Example usage
if (require.main === module) {
  async function example() {
    const client = new UploadServiceClient('http://localhost:3001', 'your-jwt-token')
    
    try {
      // Check service health
      console.log('Checking service health...')
      const health = await client.getHealth()
      console.log('Service status:', health.status)
      
      // Upload a video
      console.log('Uploading video...')
      const uploadResult = await client.uploadVideo('./test-video.mp4', {
        title: 'My Test Video',
        description: 'This is a test upload using the client library',
        tags: ['test', 'demo', 'client'],
        isPrivate: false,
        category: 'education'
      })
      
      console.log('Upload initiated:', uploadResult.data.uploadId)
      
      // Wait for completion
      console.log('Waiting for processing to complete...')
      const finalStatus = await client.waitForCompletion(uploadResult.data.uploadId)
      console.log('Upload completed:', finalStatus.data)
      
    } catch (error) {
      console.error('Error:', error.message)
      if (error.details) {
        console.error('Details:', error.details)
      }
    }
  }
  
  example()
}
