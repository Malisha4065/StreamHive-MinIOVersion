# Dockerfile for StreamHive Upload Service

FROM node:18-alpine

# Install FFmpeg for video processing
RUN apk add ffmpeg

# Create app directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies (prefer ci when possible, fallback to install if lockfile is out of sync)
RUN if [ -f package-lock.json ]; then \
      npm ci --omit=dev --loglevel=verbose || npm install --omit=dev --loglevel=verbose; \
    else \
      npm install --omit=dev --loglevel=verbose; \
    fi

# Copy source code
COPY src/ ./src/

# Create logs directory
RUN mkdir -p logs

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S uploadservice -u 1001

# Change ownership of the app directory
RUN chown -R uploadservice:nodejs /usr/src/app

# Switch to non-root user
USER uploadservice

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "const http = require('http'); \
    const options = { hostname: 'localhost', port: 3001, path: '/health/live', timeout: 2000 }; \
    const req = http.request(options, (res) => { \
      if (res.statusCode === 200) process.exit(0); \
      else process.exit(1); \
    }); \
    req.on('error', () => process.exit(1)); \
    req.on('timeout', () => process.exit(1)); \
    req.end();"

# Start the application
CMD ["npm", "start"]
