const Joi = require('joi')

const uploadValidation = Joi.object({
  title: Joi.string()
    .min(1)
    .max(255)
    .required()
    .messages({
      'string.empty': 'Title is required',
      'string.max': 'Title must be less than 255 characters'
    }),
  
  description: Joi.string()
    .max(5000)
    .allow('')
    .optional()
    .messages({
      'string.max': 'Description must be less than 5000 characters'
    }),
  
  tags: Joi.string()
    .pattern(/^[a-zA-Z0-9,\s-_]+$/)
    .max(500)
    .allow('')
    .optional()
    .messages({
      'string.pattern.base': 'Tags can only contain letters, numbers, commas, spaces, hyphens and underscores',
      'string.max': 'Tags must be less than 500 characters'
    }),
  
  isPrivate: Joi.boolean()
    .default(false)
    .optional(),
  
  category: Joi.string()
    .valid('entertainment', 'education', 'music', 'sports', 'gaming', 'news', 'technology', 'other')
    .default('other')
    .optional()
})

const validateUploadData = (req, res, next) => {
  const { error, value } = uploadValidation.validate(req.body, {
    abortEarly: false,
    allowUnknown: false,
    stripUnknown: true
  })

  if (error) {
    const errorMessages = error.details.map(detail => detail.message)
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errorMessages
    })
  }

  req.validatedData = value
  next()
}

module.exports = {
  uploadValidation,
  validateUploadData
}
