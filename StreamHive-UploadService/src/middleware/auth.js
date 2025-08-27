const logger = require('../utils/logger')

const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers.authorization
  const token = authHeader && authHeader.split(' ')[1]

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Access token required'
    })
  }

  try {
    // Define the URL for the security service
    const securityServiceUrl = process.env.SECURITY_SERVICE_URL || 'http://security-service:8080/auth/validate';

    // Use fetch to validate the token with the SecurityService
    const response = await fetch(securityServiceUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json' // Required for fetch with a JSON body
      },
      body: JSON.stringify({}) // The body must be a string
    })

    // CRITICAL: fetch does NOT throw an error for bad HTTP statuses (like 4xx or 5xx).
    // You must check the 'ok' status and throw an error manually to trigger the catch block.
    if (!response.ok) {
      // Create an error to be caught by the catch block below
      throw new Error(`Token validation failed with status: ${response.status}`);
    }

    // Parse the JSON response from the security service
    const responseData = await response.json();

    req.user = responseData.user;
    next();
  } catch (err) {
    // This will now catch both network errors from fetch and the manual error thrown above
    logger.warn(`Invalid token attempt from IP: ${req.ip} - ${err.message}`);
    return res.status(403).json({
      success: false,
      error: 'Invalid or expired token'
    })
  }
}

const authorizeUpload = (req, res, next) => {
  // Check if user has upload permissions
  if (!req.user || !req.user.permissions || !req.user.permissions.includes('upload')) {
    return res.status(403).json({
      success: false,
      error: 'Insufficient permissions for upload'
    })
  }

  next()
}

module.exports = {
  authenticateToken,
  authorizeUpload
}
