#!/bin/bash

echo "--- Deploying StreamHive to local Minikube cluster ---"

# Configuration
NAMESPACE="streamhive"
IMAGE_REPOSITORY="malisha"
DOCKER_REGISTRY="docker.io"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
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

# Check if minikube is running
if ! minikube status &>/dev/null; then
    print_error "Minikube is not running. Please start minikube first with 'minikube start'"
    exit 1
fi

print_status "Using Minikube context"
kubectl config use-context minikube

# Enable Istio if not already enabled
print_status "Checking Istio installation..."
if ! kubectl get namespace istio-system &>/dev/null; then
    print_status "Installing Istio..."
    # Install Istio
    curl -L https://istio.io/downloadIstio | sh -
    cd istio-*
    export PATH=$PWD/bin:$PATH
    istioctl install --set values.defaultRevision=default -y
    cd ..
else
    print_status "Istio is already installed"
fi

print_status "Creating namespace '$NAMESPACE'..."
kubectl create namespace $NAMESPACE --dry-run=client -o yaml | kubectl apply -f -

print_status "Enabling Istio injection on namespace '$NAMESPACE'..."
kubectl label namespace $NAMESPACE istio-injection=enabled --overwrite

print_status "Exposing Istio Ingress Gateway via NodePort..."
kubectl patch service istio-ingressgateway -n istio-system --type merge -p '{
  "spec": {
    "type": "NodePort",
    "ports": [
      {"name": "http2", "port": 80, "protocol": "TCP", "targetPort": 8080, "nodePort": 30080},
      {"name": "https", "port": 443, "protocol": "TCP", "targetPort": 8443, "nodePort": 30443}
    ]
  }
}'

print_status "Creating secrets..."
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: Secret
metadata:
  name: streamhive-secrets
  namespace: $NAMESPACE
type: Opaque
stringData:
  DB_PASSWORD: "streamhive_dev_password"
  JWT_SECRET: "your-super-secret-jwt-key-for-development-only"
  REDIS_PASSWORD: ""
  RABBITMQ_PASSWORD: "guest"
  MINIO_ACCESS_KEY: "minioadmin"
  MINIO_SECRET_KEY: "minioadmin"
  MINIO_ENDPOINT: "minio"
  MINIO_RAW_BUCKET: "raw-videos"
  MINIO_PROCESSED_BUCKET: "processed-videos"
EOF

print_status "Creating PostgreSQL init scripts ConfigMap..."
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: ConfigMap
metadata:
  name: postgres-init-scripts
  namespace: $NAMESPACE
data:
  init-db.sh: |
    #!/bin/bash
    set -e
    psql -v ON_ERROR_STOP=1 --username "\$POSTGRES_USER" --dbname "\$POSTGRES_DB" <<-EOSQL
        SELECT 'CREATE DATABASE streamhive_security'
        WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'streamhive_security')\gexec
        GRANT ALL PRIVILEGES ON DATABASE streamhive_security TO "\$POSTGRES_USER";
    EOSQL
EOF

print_status "Deploying MinIO..."
cat <<EOF | kubectl apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: minio
  namespace: $NAMESPACE
  labels:
    app: minio
spec:
  replicas: 1
  selector:
    matchLabels:
      app: minio
  template:
    metadata:
      labels:
        app: minio
    spec:
      containers:
      - name: minio
        image: minio/minio:latest
        ports:
        - containerPort: 9000
          name: api
        - containerPort: 9001
          name: console
        env:
        - name: MINIO_ROOT_USER
          value: "minioadmin"
        - name: MINIO_ROOT_PASSWORD
          value: "minioadmin"
        command:
        - minio
        - server
        - /data
        - --console-address
        - ":9001"
        volumeMounts:
        - name: minio-storage
          mountPath: /data
        livenessProbe:
          httpGet:
            path: /minio/health/live
            port: 9000
          initialDelaySeconds: 30
          periodSeconds: 20
        readinessProbe:
          httpGet:
            path: /minio/health/ready
            port: 9000
          initialDelaySeconds: 10
          periodSeconds: 10
      volumes:
      - name: minio-storage
        emptyDir: {}
---
apiVersion: v1
kind: Service
metadata:
  name: minio
  namespace: $NAMESPACE
  labels:
    app: minio
spec:
  selector:
    app: minio
  ports:
  - port: 9000
    targetPort: 9000
    name: api
  - port: 9001
    targetPort: 9001
    name: console
  type: ClusterIP
EOF

print_status "Deploying PostgreSQL and Redis..."
cat <<EOF | kubectl apply -f -
# PostgreSQL Database for StreamHive
apiVersion: apps/v1
kind: Deployment
metadata:
  name: postgres
  namespace: $NAMESPACE
  labels:
    app: postgres
spec:
  replicas: 1
  selector:
    matchLabels:
      app: postgres
  template:
    metadata:
      labels:
        app: postgres
    spec:
      containers:
      - name: postgres
        image: postgres:15-alpine
        ports:
        - containerPort: 5432
          name: postgres
        env:
        - name: POSTGRES_DB
          value: "video_catalog"
        - name: POSTGRES_USER
          value: "postgres"
        - name: POSTGRES_PASSWORD
          value: "streamhive_dev_password"
        - name: PGDATA
          value: "/var/lib/postgresql/data/pgdata"
        volumeMounts:
        - name: postgres-storage
          mountPath: /var/lib/postgresql/data
        - name: postgres-init-scripts
          mountPath: /docker-entrypoint-initdb.d
        livenessProbe:
          exec:
            command:
            - pg_isready
            - -U
            - postgres
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          exec:
            command:
            - pg_isready
            - -U
            - postgres
          initialDelaySeconds: 5
          periodSeconds: 5
      volumes:
      - name: postgres-storage
        emptyDir: {}
      - name: postgres-init-scripts
        configMap:
          name: postgres-init-scripts
---
apiVersion: v1
kind: Service
metadata:
  name: postgres
  namespace: $NAMESPACE
  labels:
    app: postgres
spec:
  selector:
    app: postgres
  ports:
  - port: 5432
    targetPort: 5432
    name: postgres
  type: ClusterIP

---
# Redis for caching and session management
apiVersion: apps/v1
kind: Deployment
metadata:
  name: redis
  namespace: $NAMESPACE
  labels:
    app: redis
spec:
  replicas: 1
  selector:
    matchLabels:
      app: redis
  template:
    metadata:
      labels:
        app: redis
    spec:
      containers:
      - name: redis
        image: redis:7-alpine
        ports:
        - containerPort: 6379
          name: redis
        command:
        - redis-server
        - --appendonly
        - "yes"
        volumeMounts:
        - name: redis-storage
          mountPath: /data
        livenessProbe:
          exec:
            command:
            - redis-cli
            - ping
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          exec:
            command:
            - redis-cli
            - ping
          initialDelaySeconds: 5
          periodSeconds: 5
      volumes:
      - name: redis-storage
        emptyDir: {}

---
apiVersion: v1
kind: Service
metadata:
  name: redis
  namespace: $NAMESPACE
  labels:
    app: redis
spec:
  selector:
    app: redis
  ports:
  - port: 6379
    targetPort: 6379
    name: redis
  type: ClusterIP
EOF

print_status "Deploying RabbitMQ..."
cat <<EOF | kubectl apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: rabbitmq
  namespace: $NAMESPACE
  labels:
    app: rabbitmq
spec:
  replicas: 1
  selector:
    matchLabels:
      app: rabbitmq
  template:
    metadata:
      labels:
        app: rabbitmq
    spec:
      containers:
      - name: rabbitmq
        image: rabbitmq:4.0-management
        ports:
        - containerPort: 5672
          name: amqp
        - containerPort: 15672
          name: management
        env:
        - name: RABBITMQ_DEFAULT_USER
          value: "guest"
        - name: RABBITMQ_DEFAULT_PASS
          value: "guest"
        volumeMounts:
        - name: rabbitmq-storage
          mountPath: /var/lib/rabbitmq
        livenessProbe:
          exec:
            command:
            - rabbitmq-diagnostics
            - -q
            - ping
          initialDelaySeconds: 60
          periodSeconds: 10
          timeoutSeconds: 10
          failureThreshold: 3
        readinessProbe:
          exec:
            command:
            - rabbitmq-diagnostics
            - -q
            - check_port_connectivity
          initialDelaySeconds: 20
          periodSeconds: 10
          timeoutSeconds: 10
          failureThreshold: 3
      volumes:
      - name: rabbitmq-storage
        emptyDir: {}

---
apiVersion: v1
kind: Service
metadata:
  name: rabbitmq
  namespace: $NAMESPACE
  labels:
    app: rabbitmq
spec:
  selector:
    app: rabbitmq
  ports:
  - port: 5672
    targetPort: 5672
    name: amqp
  - port: 15672
    targetPort: 15672
    name: management
  type: ClusterIP
EOF

print_status "Deploying Security Service..."
cat <<EOF | kubectl apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: streamhive-security-service
  namespace: $NAMESPACE
spec:
  replicas: 1
  selector:
    matchLabels:
      app: streamhive-security-service
  template:
    metadata:
      labels:
        app: streamhive-security-service
    spec:
      containers:
      - name: security-service
        image: $IMAGE_REPOSITORY/streamhive-security-service:latest
        imagePullPolicy: Never
        ports:
        - containerPort: 8080
        env:
        - name: SERVER_PORT
          value: "8080"
        - name: DB_HOST
          value: "postgres"
        - name: DB_PORT
          value: "5432"
        - name: DB_NAME
          value: "streamhive_security"
        - name: DB_USER
          value: "postgres"
        - name: DB_PASSWORD
          valueFrom:
            secretKeyRef:
              name: streamhive-secrets
              key: DB_PASSWORD
        - name: JWT_SECRET
          valueFrom:
            secretKeyRef:
              name: streamhive-secrets
              key: JWT_SECRET
        resources:
          requests:
            memory: "256Mi"
            cpu: "200m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /health
            port: 8080
          initialDelaySeconds: 30
          periodSeconds: 20
        readinessProbe:
          httpGet:
            path: /health
            port: 8080
          initialDelaySeconds: 15
          periodSeconds: 10
---
apiVersion: v1
kind: Service
metadata:
  name: streamhive-security-service
  namespace: $NAMESPACE
spec:
  selector:
    app: streamhive-security-service
  ports:
  - port: 8080
    targetPort: 8080
  type: ClusterIP
EOF

print_status "Deploying Upload Service..."
cat <<EOF | kubectl apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: streamhive-upload-service
  namespace: $NAMESPACE
spec:
  replicas: 1
  selector:
    matchLabels:
      app: streamhive-upload-service
  template:
    metadata:
      labels:
        app: streamhive-upload-service
    spec:
      containers:
      - name: upload-service
        image: $IMAGE_REPOSITORY/streamhive-upload-service:latest
        imagePullPolicy: Never
        ports:
        - containerPort: 3001
        env:
        - name: PORT
          value: "3001"
        - name: NODE_ENV
          value: "production"
        - name: SECURITY_SERVICE_URL
          value: "http://streamhive-security-service:8080/api/auth/validate"
        - name: JWT_SECRET
          valueFrom:
            secretKeyRef:
              name: streamhive-secrets
              key: JWT_SECRET
        - name: RABBITMQ_URL
          value: "amqp://guest:guest@rabbitmq:5672/"
        - name: AMQP_EXCHANGE
          value: "streamhive"
        - name: AMQP_UPLOAD_ROUTING_KEY
          value: "video.uploaded"
        - name: MAX_FILE_SIZE
          value: "1073741824"
        - name: ALLOWED_FORMATS
          value: "mp4,mov,avi,webm"
        - name: MINIO_ENDPOINT
          valueFrom:
            secretKeyRef:
              name: streamhive-secrets
              key: MINIO_ENDPOINT
        - name: MINIO_ACCESS_KEY
          valueFrom:
            secretKeyRef:
              name: streamhive-secrets
              key: MINIO_ACCESS_KEY
        - name: MINIO_SECRET_KEY
          valueFrom:
            secretKeyRef:
              name: streamhive-secrets
              key: MINIO_SECRET_KEY
        - name: MINIO_RAW_BUCKET
          valueFrom:
            secretKeyRef:
              name: streamhive-secrets
              key: MINIO_RAW_BUCKET
        resources:
          requests:
            memory: "128Mi"
            cpu: "100m"
          limits:
            memory: "256Mi"
            cpu: "250m"
---
apiVersion: v1
kind: Service
metadata:
  name: streamhive-upload-service
  namespace: $NAMESPACE
spec:
  selector:
    app: streamhive-upload-service
  ports:
  - port: 3001
    targetPort: 3001
  type: ClusterIP
EOF

print_status "Deploying Transcoder Service..."
cat <<EOF | kubectl apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: streamhive-transcoder-service
  namespace: $NAMESPACE
spec:
  replicas: 1
  selector:
    matchLabels:
      app: streamhive-transcoder-service
  template:
    metadata:
      labels:
        app: streamhive-transcoder-service
    spec:
      containers:
      - name: transcoder-service
        image: $IMAGE_REPOSITORY/streamhive-transcoder-service:latest
        imagePullPolicy: Never
        env:
        - name: AMQP_URL
          value: "amqp://guest:guest@rabbitmq.streamhive.svc.cluster.local:5672/"
        - name: AMQP_EXCHANGE
          value: "streamhive"
        - name: AMQP_UPLOAD_ROUTING_KEY
          value: "video.uploaded"
        - name: AMQP_TRANSCODED_ROUTING_KEY
          value: "video.transcoded"
        - name: AMQP_QUEUE
          value: "transcoder.video.uploaded"
        - name: CONCURRENCY
          value: "1"
        - name: LOG_LEVEL
          value: "info"
        - name: MINIO_ENDPOINT
          value: "minio" 
        - name: MINIO_PORT
          value: "9000"
        - name: MINIO_USE_SSL
          value: "false"
        - name: MINIO_ACCESS_KEY
          valueFrom:
            secretKeyRef:
              name: streamhive-secrets
              key: MINIO_ACCESS_KEY
        - name: MINIO_SECRET_KEY
          valueFrom:
            secretKeyRef:
              name: streamhive-secrets
              key: MINIO_SECRET_KEY
        - name: MINIO_RAW_BUCKET
          valueFrom:
            secretKeyRef:
              name: streamhive-secrets
              key: MINIO_RAW_BUCKET
        - name: MINIO_PROCESSED_BUCKET
          valueFrom:
            secretKeyRef:
              name: streamhive-secrets
              key: MINIO_PROCESSED_BUCKET
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "1Gi"
            cpu: "1000m"
---
apiVersion: v1
kind: Service
metadata:
  name: streamhive-transcoder-service
  namespace: $NAMESPACE
spec:
  selector:
    app: streamhive-transcoder-service
EOF

print_status "Deploying Video Catalog Service..."
cat <<EOF | kubectl apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: streamhive-video-catalog-service
  namespace: $NAMESPACE
spec:
  replicas: 1
  selector:
    matchLabels:
      app: streamhive-video-catalog-service
  template:
    metadata:
      labels:
        app: streamhive-video-catalog-service
    spec:
      containers:
      - name: video-catalog-service
        image: $IMAGE_REPOSITORY/streamhive-video-catalog-service:latest
        imagePullPolicy: Never
        ports:
        - containerPort: 8080
        env:
        - name: DB_HOST
          value: "postgres"
        - name: DB_PORT
          value: "5432"
        - name: DB_USER
          value: "postgres"
        - name: DB_PASSWORD
          valueFrom:
            secretKeyRef:
              name: streamhive-secrets
              key: DB_PASSWORD
        - name: DB_NAME
          value: "video_catalog"
        - name: DB_SSLMODE
          value: "disable"
        - name: AMQP_URL
          value: "amqp://guest:guest@rabbitmq:5672/"
        - name: AMQP_EXCHANGE
          value: "streamhive"
        - name: AMQP_QUEUE
          value: "video-catalog.video.transcoded"
        - name: AMQP_ROUTING_KEY
          value: "video.transcoded"
        - name: AMQP_UPLOAD_QUEUE
          value: "video-catalog.video.uploaded"
        - name: AMQP_UPLOAD_ROUTING_KEY
          value: "video.uploaded"
        - name: PORT
          value: "8080"
        - name: MINIO_ENDPOINT
          value: "minio:9000"
        - name: MINIO_ACCESS_KEY
          valueFrom:
            secretKeyRef:
              name: streamhive-secrets
              key: MINIO_ACCESS_KEY
        - name: MINIO_SECRET_KEY
          valueFrom:
            secretKeyRef:
              name: streamhive-secrets
              key: MINIO_SECRET_KEY
        - name: MINIO_PROCESSED_BUCKET
          valueFrom:
            secretKeyRef:
              name: streamhive-secrets
              key: MINIO_PROCESSED_BUCKET
        resources:
          requests:
            memory: "128Mi"
            cpu: "100m"
          limits:
            memory: "256Mi"
            cpu: "250m"
---
apiVersion: v1
kind: Service
metadata:
  name: streamhive-video-catalog-service
  namespace: $NAMESPACE
spec:
  selector:
    app: streamhive-video-catalog-service
  ports:
  - port: 8080
    targetPort: 8080
  type: ClusterIP
EOF

print_status "Deploying Playback Service..."
cat <<EOF | kubectl apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: streamhive-playback-service
  namespace: $NAMESPACE
spec:
  replicas: 1
  selector:
    matchLabels:
      app: streamhive-playback-service
  template:
    metadata:
      labels:
        app: streamhive-playback-service
    spec:
      containers:
      - name: playback-service
        image: $IMAGE_REPOSITORY/streamhive-playback-service:latest
        imagePullPolicy: Never
        ports:
        - containerPort: 8090
        env:
        - name: DB_HOST
          value: "postgres"
        - name: DB_PORT
          value: "5432"
        - name: DB_USER
          value: "postgres"
        - name: DB_PASSWORD
          valueFrom:
            secretKeyRef:
              name: streamhive-secrets
              key: DB_PASSWORD
        - name: DB_NAME
          value: "video_catalog"
        - name: DB_SSLMODE
          value: "disable"
        - name: PORT
          value: "8090"
        - name: REDIS_HOST
          value: "redis"
        - name: REDIS_PORT
          value: "6379"
        - name: REDIS_PASSWORD
          value: ""
        - name: CACHE_TTL
          value: "3600"
        - name: MINIO_ENDPOINT
          value: "minio:9000"
        - name: MINIO_ACCESS_KEY
          valueFrom:
            secretKeyRef:
              name: streamhive-secrets
              key: MINIO_ACCESS_KEY
        - name: MINIO_SECRET_KEY
          valueFrom:
            secretKeyRef:
              name: streamhive-secrets
              key: MINIO_SECRET_KEY
        - name: MINIO_PROCESSED_BUCKET
          valueFrom:
            secretKeyRef:
              name: streamhive-secrets
              key: MINIO_PROCESSED_BUCKET
        resources:
          requests:
            memory: "128Mi"
            cpu: "100m"
          limits:
            memory: "256Mi"
            cpu: "250m"
---
apiVersion: v1
kind: Service
metadata:
  name: streamhive-playback-service
  namespace: $NAMESPACE
spec:
  selector:
    app: streamhive-playback-service
  ports:
  - port: 8090
    targetPort: 8090
  type: ClusterIP
EOF

print_status "Deploying Istio Gateway and VirtualService..."
cat <<EOF | kubectl apply -f -
# ISTIO GATEWAY
apiVersion: networking.istio.io/v1alpha3
kind: Gateway
metadata:
  name: streamhive-gateway
  namespace: $NAMESPACE
spec:
  selector:
    istio: ingressgateway
  servers:
  - port:
      number: 80
      name: http
      protocol: HTTP
    hosts:
    - "*"
---
# ISTIO VIRTUALSERVICE
apiVersion: networking.istio.io/v1alpha3
kind: VirtualService
metadata:
  name: streamhive-virtualservice
  namespace: $NAMESPACE
spec:
  hosts:
  - "*"
  gateways:
  - streamhive-gateway
  http:
  # Direct route: allow calling /api/v1/upload directly
  - match:
    - uri:
        prefix: /api/v1/upload
    headers:
      response:
        add:
          x-upload-route: direct-v1
    route:
    - destination:
        host: streamhive-upload-service
        port:
          number: 3001
  # Hotfix: normalize accidental /api/upload/api/v1 -> /api/v1/upload
  - match:
    - uri:
        exact: /api/upload/api/v1
    rewrite:
      uri: "/api/v1/upload"
    headers:
      response:
        add:
          x-upload-route: hotfix-exact
    route:
    - destination:
        host: streamhive-upload-service
        port:
          number: 3001
  - match:
    - uri:
        prefix: /api/upload/api/v1/
    rewrite:
      uri: "/api/v1/upload/"
    headers:
      response:
        add:
          x-upload-route: hotfix-prefix
    route:
    - destination:
        host: streamhive-upload-service
        port:
          number: 3001
  # Rule for Upload Service (exact)
  - match:
    - uri:
        exact: /api/upload
    rewrite:
      uri: "/api/v1/upload"
    headers:
      response:
        add:
          x-upload-route: upload-exact
    route:
    - destination:
        host: streamhive-upload-service
        port:
          number: 3001
  # Rule for Upload Service (prefix with trailing slash)
  - match:
    - uri:
        regex: '^/api/upload/?$'
    rewrite:
      uri: "/api/v1/upload/"
    headers:
      response:
        add:
          x-upload-route: upload-prefix
    route:
    - destination:
        host: streamhive-upload-service
        port:
          number: 3001
  # Rule for Video Catalog Service
  - match:
    - uri:
        prefix: /api/catalog/
    rewrite:
      uri: "/api/v1/"
    route:
    - destination:
        host: streamhive-video-catalog-service
        port:
          number: 8080
  # Rule for Playback Service - handle double path issue
  - match:
    - uri:
        prefix: /api/playback/playback/
    rewrite:
      uri: "/playback/"
    route:
    - destination:
        host: streamhive-playback-service
        port:
          number: 8090
  # Rule for Playback Service - normal case
  - match:
    - uri:
        prefix: /api/playback/
    rewrite:
      uri: "/playback/"
    route:
    - destination:
        host: streamhive-playback-service
        port:
          number: 8090
  # Rule for Security Service
  - match:
    - uri:
        prefix: /api/auth/
    route:
    - destination:
        host: streamhive-security-service
        port:
          number: 8080
  # Rule for the Frontend (catches everything else)
  - route:
    - destination:
        host: streamhive-frontend
        port:
          number: 80
EOF

print_status "Deploying Frontend..."
cat <<EOF | kubectl apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: streamhive-frontend
  namespace: $NAMESPACE
spec:
  replicas: 1
  selector:
    matchLabels:
      app: streamhive-frontend
  template:
    metadata:
      labels:
        app: streamhive-frontend
    spec:
      containers:
      - name: frontend
        image: $IMAGE_REPOSITORY/streamhive-frontend:latest
        imagePullPolicy: Never
        ports:
        - containerPort: 80
        env:
        - name: VITE_API_UPLOAD
          value: "/api/upload"
        - name: VITE_API_CATALOG
          value: "/api/catalog"
        - name: VITE_API_PLAYBACK
          value: "/api/playback"
        - name: VITE_JWT
          value: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ1c2VyMTIzIiwidXNlcm5hbWUiOiJkZW1vIiwicGVybWlzc2lvbnMiOlsidXBsb2FkIiwidmlldyIsImNhdGFsb2ciXSwiaWF0IjoxNzU1NDU1MDYyLCJleHAiOjE3NTU1NDE0NjJ9.9RDfiaYzvevwRHMtwhsYUMapdJZDbiZADJ1oA5UNqEc"
        - name: VITE_API_LOGIN
          value: "/api/auth/login"
        resources:
          requests:
            memory: "128Mi"
            cpu: "50m"
          limits:
            memory: "256Mi"
            cpu: "100m"
---
apiVersion: v1
kind: Service
metadata:
  name: streamhive-frontend
  namespace: $NAMESPACE
spec:
  selector:
    app: streamhive-frontend
  ports:
  - port: 80
    targetPort: 80
  type: ClusterIP
EOF

# Wait for deployments to be ready
print_status "Waiting for all deployments to be ready..."
sleep 10

deployments=(
    "minio"
    "postgres"
    "redis"
    "rabbitmq"
    "streamhive-security-service"
    "streamhive-upload-service"
    "streamhive-transcoder-service"
    "streamhive-video-catalog-service"
    "streamhive-playback-service"
    "streamhive-frontend"
)

for deployment in "${deployments[@]}"; do
    print_status "Waiting for $deployment to be ready..."
    kubectl wait --for=condition=available --timeout=300s deployment/$deployment -n $NAMESPACE
    if [ $? -eq 0 ]; then
        print_status "$deployment is ready ✓"
    else
        print_error "$deployment failed to become ready"
    fi
done

# Get the Minikube IP and NodePort
MINIKUBE_IP=$(minikube ip)
NODEPORT=30080

print_status "=================================="
print_status "StreamHive deployment completed!"
print_status "=================================="
echo ""
print_status "Access URLs:"
echo -e "  ${GREEN}StreamHive App:${NC} http://$MINIKUBE_IP:$NODEPORT"
echo -e "  ${GREEN}MinIO Console:${NC} http://localhost:9001 (use port-forward)"
echo -e "  ${GREEN}RabbitMQ Management:${NC} http://localhost:15672 (use port-forward)"
echo ""
print_status "Port forward commands for local access:"
echo "  kubectl port-forward -n $NAMESPACE svc/minio 9001:9001"
echo "  kubectl port-forward -n $NAMESPACE svc/rabbitmq 15672:15672"
echo ""
print_status "MinIO Credentials:"
echo "  Username: minioadmin"
echo "  Password: minioadmin"
echo ""
print_status "RabbitMQ Credentials:"
echo "  Username: guest"
echo "  Password: guest"
echo ""
print_status "To check pod status:"
echo "  kubectl get pods -n $NAMESPACE"
echo ""
print_status "To view logs:"
echo "  kubectl logs -n $NAMESPACE -l app=<service-name>"
echo ""
print_status "To delete everything:"
echo "  kubectl delete namespace $NAMESPACE"
echo ""

# Create MinIO buckets
print_status "Creating MinIO buckets..."
kubectl run minio-client --rm -i --tty --restart=Never --image=minio/mc:latest -n $NAMESPACE --command -- /bin/sh -c "
mc alias set local http://minio:9000 minioadmin minioadmin
mc mb local/raw-videos --ignore-existing
mc mb local/processed-videos --ignore-existing
echo 'Buckets created successfully'
" 2>/dev/null || print_warning "Failed to create MinIO buckets automatically. You can create them manually via the MinIO console."

print_status "✅ Deployment complete!"minikube ip
# suppose MINIKUBE_IP=$(minikube ip)
curl -v -H "Content-Type: application/json" \
  -X POST "http://$(minikube ip):30080/api/auth/signup" \
  -d '{"email":"test@example.com","password":"secret"}'
