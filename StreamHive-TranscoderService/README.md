# TranscoderService (StreamHive)

A Go worker that consumes upload events from RabbitMQ, downloads raw videos from S3-compatible storage (MinIO), transcodes them to HLS renditions (1080p/720p/480p/360p) using FFmpeg, uploads outputs back to storage, and publishes a "video.transcoded" event.

## Features
- RabbitMQ consumer with prefetch and retry/DLQ strategy
- Azure Blob I/O (download raw, upload HLS + thumbnail)
- FFmpeg-based HLS ladder generation
- Master playlist generation
- Structured logging and basic Prometheus metrics on :9090/metrics

## Env
- AMQP_URL
- AMQP_EXCHANGE (default: streamhive)
- AMQP_UPLOAD_ROUTING_KEY (default: video.uploaded)
- AMQP_TRANSCODED_ROUTING_KEY (default: video.transcoded)
- AMQP_QUEUE (default: transcoder.video.uploaded)
-- MINIO_ENDPOINT
-- MINIO_ACCESS_KEY
-- MINIO_SECRET_KEY
-- MINIO_RAW_BUCKET (e.g., uploadservicecontainer)
-- MINIO_PUBLIC_BASE (optional public base URL for served objects)
- TMPDIR (optional) working dir
- CONCURRENCY (default: 1)
- LOG_LEVEL (info|debug)

## Run locally
1. Install FFmpeg.
2. `make deps && make run`

## Docker
- `docker build -t streamhive/transcoder:dev .`

## K8s
- See k8s/deployment.yaml and k8s/configmap.yaml
