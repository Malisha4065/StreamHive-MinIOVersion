BINARY=transcoder

.PHONY: deps build run docker

deps:
	go mod tidy

build:
	CGO_ENABLED=0 go build -o bin/$(BINARY) ./cmd/transcoder

run:
	AMQP_URL?=amqp://guest:guest@localhost:5672/
	MINIO_ENDPOINT?=127.0.0.1
	MINIO_ACCESS_KEY?=
	MINIO_SECRET_KEY?=
	MINIO_RAW_BUCKET?=uploadservicecontainer
	CONCURRENCY?=1
	LOG_LEVEL?=info
	FFREPORT=file=ffmpeg.log:level=32 \
		AMQP_URL=$(AMQP_URL) MINIO_ENDPOINT=$(MINIO_ENDPOINT) MINIO_ACCESS_KEY=$(MINIO_ACCESS_KEY) MINIO_SECRET_KEY=$(MINIO_SECRET_KEY) MINIO_RAW_BUCKET=$(MINIO_RAW_BUCKET) CONCURRENCY=$(CONCURRENCY) LOG_LEVEL=$(LOG_LEVEL) \
		go run ./cmd/transcoder

docker:
	docker build -t streamhive/transcoder:dev .
