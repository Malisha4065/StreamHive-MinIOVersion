#!/bin/bash

# Development setup script for StreamHive Upload Service

set -e

echo "🚀 Setting up StreamHive Upload Service for development..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js version 18+ is required. Current version: $(node --version)"
    exit 1
fi

echo "✅ Node.js version: $(node --version)"

# Check if Docker is installed and running
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    exit 1
fi

if ! docker info &> /dev/null; then
    echo "❌ Docker is not running. Please start Docker first."
    exit 1
fi

echo "✅ Docker is running"

# Check if Docker Compose is installed
if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose first."
    exit 1
fi

echo "✅ Docker Compose is available"

# Install npm dependencies
echo "📦 Installing npm dependencies..."
npm install

# Copy environment file
if [ ! -f .env ]; then
    echo "📝 Creating .env file from template..."
    cp .env.example .env
    echo "⚠️  Please edit .env file with your configuration before running the service"
else
    echo "✅ .env file already exists"
fi

# Create logs directory
mkdir -p logs

# Start infrastructure services
echo "🐳 Starting infrastructure services (Azurite & RabbitMQ)..."
docker-compose up -d azurite rabbitmq

# Wait for services to be ready
echo "⏳ Waiting for services to be ready..."
sleep 10

# Check if Azurite is ready
echo "🔍 Checking Azurite health..."
until nc -z localhost 10000 &> /dev/null; do
    echo "Waiting for Azurite to be ready..."
    sleep 5
done
echo "✅ Azurite is ready"

# Check if RabbitMQ is ready
echo "🔍 Checking RabbitMQ health..."
until docker-compose exec rabbitmq rabbitmq-diagnostics ping &> /dev/null; do
    echo "Waiting for RabbitMQ to be ready..."
    sleep 5
done
echo "✅ RabbitMQ is ready"

echo ""
echo "🎉 Setup complete! You can now:"
echo "   • Run 'npm run dev' to start the upload service in development mode"
echo "   • Access Azurite Blob Storage at: http://localhost:10000"
echo "   • Access RabbitMQ console at: http://localhost:15672 (admin/admin123)"
echo "   • Run 'npm test' to execute tests"
echo "   • Run 'npm run lint' to check code style"
echo ""
echo "📚 Don't forget to:"
echo "   • Update .env file with your Azure Storage configuration"
echo "   • Review README.md for API documentation"
echo "   • Check docker-compose.yml for service configuration"
