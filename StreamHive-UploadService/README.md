# StreamHive Upload Service

A Node.js microservice for handling video uploads in the StreamHive platform.

## Features

- ✅ Video file upload (MP4, MOV, AVI, WebM)
- 🔐 JWT-based authentication
- 📁 MinIO (S3-compatible) storage integration for local Minikube deployments
- 🔄 RabbitMQ message queue (topic exchange) for transcoding pipeline
- 📊 Metadata extraction and validation
- 🛡️ Rate limiting and security headers
- 📝 Comprehensive logging
- 🐳 Docker support

## Quick Start

### Prerequisites

- Node.js 18+
- MinIO (local/minikube) or S3-compatible storage for production
- RabbitMQ
- FFmpeg (for metadata extraction)

### Installation

```bash
npm install
```

### Environment Configuration

Create a `.env` file:

```bash
cp .env.example .env
```

Edit the `.env` file with your configuration. When running on Minikube the deployment script mounts secrets at `/mnt/secrets-store` inside each pod. The service will prefer secrets from that path but will fall back to environment variables (see `.env.example`).

### Development

```bash
npm run dev
```

### Production

```bash
npm start
```

### Docker

```bash
npm run docker:build
npm run docker:run
```

## API Endpoints

### Upload Video

```http
POST /api/v1/upload
Authorization: Bearer <jwt_token>
Content-Type: multipart/form-data

{
  "video": <file>,
  "title": "My Video",
  "description": "Video description",
  "tags": "tag1,tag2,tag3",
  "isPrivate": false
}
```

### Get Upload Status

```http
GET /api/v1/upload/:uploadId/status
Authorization: Bearer <jwt_token>
```

### Health Check

```http
GET /health
```

## Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Client App    │────│  Upload Service │────│ Azure Blob Store│
└─────────────────┘    └─────────────────┘    └─────────────────┘
                              │
                              ▼
                       ┌─────────────────┐
                       │   RabbitMQ      │ (topic exchange 'streamhive')
                       └─────────────────┘
                              │ routing key: video.uploaded
                              ▼
                     ┌────────────────────┐
                     │  TranscoderService │ (publishes video.transcoded)
                     └────────────────────┘
                              │ routing key: video.transcoded
                              ▼
                     ┌────────────────────┐
                     │ VideoCatalogService│
                     └────────────────────┘
```

## Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `PORT` | Server port | No | 3001 |
| `NODE_ENV` | Environment | No | development |
| `JWT_SECRET` | JWT secret key | Yes | - |
| `MINIO_ENDPOINT` | MinIO host (service name in k8s) | No | minio |
| `MINIO_PORT` | MinIO port | No | 9000 |
| `MINIO_USE_SSL` | Use HTTPS for MinIO | No | false |
| `MINIO_ACCESS_KEY` | MinIO access key | Yes | - |
| `MINIO_SECRET_KEY` | MinIO secret key | Yes | - |
| `MINIO_RAW_BUCKET` | Bucket for raw videos | Yes | raw-videos |
| `MINIO_PROCESSED_BUCKET` | Bucket for processed videos | Yes | processed-videos |
| `RABBITMQ_URL` | RabbitMQ connection URL | Yes | - |
| `AMQP_EXCHANGE` | Topic exchange for events | No | streamhive |
| `AMQP_UPLOAD_ROUTING_KEY` | Routing key for upload events | No | video.uploaded |
| `MAX_FILE_SIZE` | Max upload size (bytes) | No | 1073741824 |
| `ALLOWED_FORMATS` | Allowed video formats | No | mp4,mov,avi,webm |

## License

MIT
