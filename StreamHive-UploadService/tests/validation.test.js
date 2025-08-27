const { uploadValidation } = require('../src/middleware/validation')

describe('Upload Validation', () => {
  test('should validate correct upload data', () => {
    const validData = {
      title: 'Test Video',
      description: 'A test video description',
      tags: 'test,video,sample',
      isPrivate: false,
      category: 'education'
    }

    const { error, value } = uploadValidation.validate(validData)
    expect(error).toBeUndefined()
    expect(value).toEqual(validData)
  })

  test('should reject empty title', () => {
    const invalidData = {
      title: '',
      description: 'A test video description'
    }

    const { error } = uploadValidation.validate(invalidData)
    expect(error).toBeDefined()
    expect(error.details[0].message).toContain('Title is required')
  })

  test('should reject invalid tags format', () => {
    const invalidData = {
      title: 'Test Video',
      tags: 'invalid@tags#format'
    }

    const { error } = uploadValidation.validate(invalidData)
    expect(error).toBeDefined()
    expect(error.details[0].message).toContain('Tags can only contain')
  })

  test('should set default values', () => {
    const minimalData = {
      title: 'Test Video'
    }

    const { error, value } = uploadValidation.validate(minimalData)
    expect(error).toBeUndefined()
    expect(value.isPrivate).toBe(false)
    expect(value.category).toBe('other')
  })
})
