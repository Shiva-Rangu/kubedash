# Stage 1: Build React Frontend
FROM node:22-alpine AS frontend-builder
WORKDIR /ui
COPY frontend/package.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Stage 2: Build Go Backend
FROM golang:1.23-alpine AS backend-builder
RUN apk add --no-cache git ca-certificates
WORKDIR /app
ENV GOPROXY=https://proxy.golang.org,direct
COPY backend/go.mod ./
COPY backend/main.go ./
RUN go mod tidy && \
    CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o k8s-dashboard main.go

# Stage 3: Final Production Image
FROM alpine:3.20
RUN apk --no-cache add ca-certificates
WORKDIR /root/
COPY --from=backend-builder /app/k8s-dashboard .
COPY --from=frontend-builder /ui/dist ./static

EXPOSE 8080
ENTRYPOINT ["./k8s-dashboard"]