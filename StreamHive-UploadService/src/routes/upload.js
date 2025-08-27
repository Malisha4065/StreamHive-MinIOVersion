const express = require('express')
const { v4: uuidv4 } = require('uuid')
const path = require('path')
const { authenticateToken, authorizeUpload } = require('../middleware/auth')
const { validateUploadData } = require('../middleware/validation')
const upload = require('../middleware/upload')
const { uploadVideo, getUploadStatus } = require('../services/uploadService')
const logger = require('../utils/logger')

const router = express.Router()

// Upload video endpoint
router.post('/', 
  authenticateToken,
  authorizeUpload,
  upload.single('video'),
  validateUploadData,
  async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: 'No video file provided'
        })
      }

      const { id: userId, email: username } = req.user

      const uploadId = uuidv4()
      const fileExtension = path.extname(req.file.originalname).toLowerCase()

      const uploadData = {
        uploadId,
        userId,
        username,
        originalFilename: req.file.originalname,
        fileExtension,
        fileSize: req.file.size,
        mimeType: req.file.mimetype,
        buffer: req.file.buffer,
        ...req.validatedData
      }

      logger.info(`Upload initiated by user ${userId}: ${uploadId}`)

      const result = await uploadVideo(uploadData)

      res.status(202).json({
        success: true,
        message: 'Video upload initiated successfully',
        data: {
          uploadId: result.uploadId,
          status: 'processing',
          estimatedProcessingTime: result.estimatedProcessingTime
        }
      })

    } catch (error) {
      next(error)
    }
  }
)

// Get upload status endpoint
router.get('/:uploadId/status',
  authenticateToken,
  async (req, res, next) => {
    try {
      const { uploadId } = req.params
      const userId = req.user.id

      const status = await getUploadStatus(uploadId, userId)

      if (!status) {
        return res.status(404).json({
          success: false,
          error: 'Upload not found or access denied'
        })
      }

      res.json({
        success: true,
        data: status
      })

    } catch (error) {
      next(error)
    }
  }
)

// Get user's uploads
router.get('/my-uploads',
  authenticateToken,
  async (req, res, next) => {
    try {
      const userId = req.user.id
      const page = parseInt(req.query.page) || 1
      const limit = Math.min(parseInt(req.query.limit) || 10, 50)
      const status = req.query.status // filter by status

      // This would typically fetch from a database
      // For now, we'll return a placeholder response
      res.json({
        success: true,
        data: {
          uploads: [],
          pagination: {
            page,
            limit,
            total: 0,
            totalPages: 0
          }
        }
      })

    } catch (error) {
      next(error)
    }
  }
)

module.exports = router
