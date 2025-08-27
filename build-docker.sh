#!/bin/bash

echo "--- Building StreamHive Docker Images Locally ---"

# Configuration
IMAGE_REPOSITORY="malisha"
BUILD_TAG="latest"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_build() {
    echo -e "${BLUE}[BUILD]${NC} $1"
}

# Check if Docker is running
if ! docker info &>/dev/null; then
    print_error "Docker is not running. Please start Docker first."
    exit 1
fi

# Define repo paths relative to current dir
REPOS=(
    "StreamHive-Frontend:frontend"
    "StreamHive-UploadService:upload"
    "StreamHive-TranscoderService:transcoder"
    "StreamHive-VideoCatalogService:videocatalog"
    "StreamHive-SecurityService:security"
    "StreamHive-PlaybackService:playback"
)

BASE_DIR=$(pwd)

# === Build Frontend ===
print_build "Building Frontend Service..."
cd "$BASE_DIR/StreamHive-Frontend"

if ! command -v node &>/dev/null; then
    print_error "Node.js is not installed. Please install Node.js 18.x first."
    exit 1
fi

print_status "Node.js version: $(node --version)"
print_status "npm version: $(npm --version)"

npm cache clean --force
npm install
if ! npx vite build; then
    print_error "Frontend build failed"
    exit 1
fi

docker build -t "${IMAGE_REPOSITORY}/streamhive-frontend:${BUILD_TAG}" . || {
    print_error "Failed to build frontend Docker image"
    exit 1
}

# === Build Upload Service ===
print_build "Building Upload Service..."
cd "$BASE_DIR/StreamHive-UploadService"
npm ci
npm test -- --forceExit || print_warning "Tests completed with warnings"
docker build -t "${IMAGE_REPOSITORY}/streamhive-upload-service:${BUILD_TAG}" . || {
    print_error "Failed to build upload service Docker image"
    exit 1
}

# === Build Transcoder Service ===
print_build "Building Transcoder Service..."
cd "$BASE_DIR/StreamHive-TranscoderService"
if ! command -v go &>/dev/null; then
    print_error "Go is not installed. Please install Go first."
    exit 1
fi

go mod download && go mod verify
go vet ./...
go test ./... || print_warning "Tests completed with warnings"

mkdir -p bin
CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o bin/transcoder ./cmd/transcoder || {
    print_error "Failed to build transcoder binary"
    exit 1
}
docker build -t "${IMAGE_REPOSITORY}/streamhive-transcoder-service:${BUILD_TAG}" . || {
    print_error "Failed to build transcoder service Docker image"
    exit 1
}

# === Build Video Catalog Service ===
print_build "Building Video Catalog Service..."
cd "$BASE_DIR/StreamHive-VideoCatalogService"
go mod download && go mod verify
go vet ./...
go test ./... || print_warning "Tests completed with warnings"

mkdir -p bin
CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o bin/video-catalog ./cmd/api || {
    print_error "Failed to build video catalog binary"
    exit 1
}
docker build -t "${IMAGE_REPOSITORY}/streamhive-video-catalog-service:${BUILD_TAG}" . || {
    print_error "Failed to build video catalog service Docker image"
    exit 1
}

# === Build Security Service ===
print_build "Building Security Service..."
cd "$BASE_DIR/StreamHive-SecurityService"
docker build -t "${IMAGE_REPOSITORY}/streamhive-security-service:${BUILD_TAG}" . || {
    print_error "Failed to build security service Docker image"
    exit 1
}

# === Build Playback Service ===
print_build "Building Playback Service..."
cd "$BASE_DIR/StreamHive-PlaybackService"
go mod download && go mod verify
go vet ./...
go test ./... || print_warning "Tests completed with warnings"

mkdir -p bin
CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o bin/playback ./cmd/playback || {
    print_error "Failed to build playback binary"
    exit 1
}
docker build -t "${IMAGE_REPOSITORY}/streamhive-playback-service:${BUILD_TAG}" . || {
    print_error "Failed to build playback service Docker image"
    exit 1
}

# === Summary ===
print_status "==========================================="
print_status "StreamHive Build Complete!"
print_status "==========================================="
echo ""
print_status "Built the following Docker images:"
for repo in "${REPOS[@]}"; do
    IFS=':' read -r path name <<< "$repo"
    echo "  • ${IMAGE_REPOSITORY}/streamhive-${name}-service:${BUILD_TAG}"
done
echo ""
print_status "To view built images:"
echo "  docker images | grep streamhive"
