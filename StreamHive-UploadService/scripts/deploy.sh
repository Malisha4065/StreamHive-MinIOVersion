#!/bin/bash

# Deployment script for StreamHive Upload Service

set -e

NAMESPACE=${NAMESPACE:-streamhive}
IMAGE_TAG=${IMAGE_TAG:-latest}
REGISTRY=${REGISTRY:-your-registry.com}

echo "🚀 Deploying StreamHive Upload Service..."
echo "   Namespace: $NAMESPACE"
echo "   Image Tag: $IMAGE_TAG"
echo "   Registry: $REGISTRY"

# Create namespace if it doesn't exist
kubectl create namespace $NAMESPACE --dry-run=client -o yaml | kubectl apply -f -

# Apply secrets (only if they don't exist)
if ! kubectl get secret streamhive-secrets -n $NAMESPACE &> /dev/null; then
    echo "📝 Creating secrets..."
    kubectl apply -f k8s/secrets.yaml -n $NAMESPACE
else
    echo "✅ Secrets already exist"
fi

# Apply ConfigMap
echo "📝 Applying ConfigMap..."
kubectl apply -f k8s/configmap.yaml -n $NAMESPACE

# Update deployment with new image tag
echo "📦 Updating deployment..."
sed "s|streamhive/upload-service:latest|$REGISTRY/streamhive/upload-service:$IMAGE_TAG|g" k8s/deployment.yaml | kubectl apply -f - -n $NAMESPACE

# Wait for rollout to complete
echo "⏳ Waiting for deployment to complete..."
kubectl rollout status deployment/upload-service -n $NAMESPACE --timeout=300s

# Check if pods are running
echo "🔍 Checking pod status..."
kubectl get pods -l app=upload-service -n $NAMESPACE

# Check service status
echo "🔍 Checking service status..."
kubectl get service upload-service -n $NAMESPACE

echo "✅ Deployment complete!"

# Show logs from one pod
echo "📋 Recent logs from upload service:"
kubectl logs -l app=upload-service -n $NAMESPACE --tail=20
