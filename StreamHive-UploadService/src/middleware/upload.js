const multer = require('multer')
const path = require('path')
const mime = require('mime-types')

const storage = multer.memoryStorage()

const fileFilter = (req, file, cb) => {
  const allowedFormats = (process.env.ALLOWED_FORMATS || 'mp4,mov,avi,webm').split(',')
  const fileExtension = path.extname(file.originalname).toLowerCase().substring(1)
  const mimeType = mime.lookup(file.originalname)

  // Check file extension
  if (!allowedFormats.includes(fileExtension)) {
    return cb(new Error(`Invalid file format. Allowed formats: ${allowedFormats.join(', ')}`), false)
  }

  // Check MIME type for video files
  if (!mimeType || !mimeType.startsWith('video/')) {
    return cb(new Error('File must be a video'), false)
  }

  cb(null, true)
}

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 1024 * 1024 * 1024, // 1GB default
    files: 1 // Only one file per upload
  }
})

module.exports = upload
