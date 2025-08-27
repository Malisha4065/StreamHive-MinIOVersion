# Multi-stage build for production
FROM node:20-alpine AS builder
WORKDIR /app

# Copy dependency manifests first for layer caching
COPY package.json ./
COPY package-lock.json* ./  
COPY pnpm-lock.yaml* ./  
COPY yarn.lock* ./  

RUN npm install --legacy-peer-deps

COPY . .
RUN npm run build

# Production stage with nginx
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 80
ENTRYPOINT ["/entrypoint.sh"]