package playback

import (
	"context"
	"fmt"
	"io"
	"io/ioutil"
	"net/http"
	"os"
	"path"
	"regexp"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/feature/s3/manager"
	s3 "github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
	"gorm.io/gorm"

	"github.com/streamhive/playback-service/internal/cache"
	"github.com/streamhive/playback-service/internal/models"
)

// Helper function to read secret from file or fallback to environment variable
func getSecret(filePath, envVar string) string {
	if data, err := ioutil.ReadFile(filePath); err == nil {
		return strings.TrimSpace(string(data))
	}
	return os.Getenv(envVar)
}

type Handler struct {
	db         *gorm.DB
	log        *zap.SugaredLogger
	client     *http.Client
	s3client   *s3.Client
	downloader *manager.Downloader
	bucket     string
	cache      *cache.CacheService
}

func NewHandler(db *gorm.DB, log *zap.SugaredLogger) *Handler {
	// Initialize cache service early so it can be used by S3 init
	ctx := context.Background()
	cacheService, err := cache.NewCacheService(log)
	if err != nil {
		log.Errorw("failed to initialize cache service", "err", err)
		cacheService = nil // Continue without cache
	}

	// Initialize S3/MinIO client if credentials are provided via mounted secrets or env
	endpoint := getSecret("/mnt/secrets-store/minio-endpoint", "MINIO_ENDPOINT")
	access := getSecret("/mnt/secrets-store/minio-access-key", "MINIO_ACCESS_KEY")
	secret := getSecret("/mnt/secrets-store/minio-secret-key", "MINIO_SECRET_KEY")
	bucket := getSecret("/mnt/secrets-store/minio-processed-bucket", "MINIO_PROCESSED_BUCKET")
	if bucket == "" {
		bucket = os.Getenv("MINIO_RAW_BUCKET")
	}
	if endpoint != "" && access != "" && secret != "" {
		port := getSecret("/mnt/secrets-store/minio-port", "MINIO_PORT")
		if port == "" {
			port = os.Getenv("MINIO_PORT")
		}
		if port == "" {
			port = "9000"
		}
		url := fmt.Sprintf("http://%s:%s", endpoint, port)
		resolver := aws.EndpointResolverWithOptionsFunc(func(service, region string, options ...interface{}) (aws.Endpoint, error) {
			return aws.Endpoint{URL: url, SigningRegion: region, HostnameImmutable: true}, nil
		})
		cfg, err := config.LoadDefaultConfig(ctx, config.WithEndpointResolverWithOptions(resolver), config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(access, secret, "")))
		if err != nil {
			log.Errorw("s3 config", "err", err)
		} else {
			client := s3.NewFromConfig(cfg, func(o *s3.Options) { o.UsePathStyle = true })
			downloader := manager.NewDownloader(client)
			// Only set bucket if provided
			if bucket == "" {
				bucket = "raw-videos"
			}
			// attach s3 client to handler and continue
			// fallthrough to normal return below
			handler := &Handler{
				db:         db,
				log:        log,
				client:     &http.Client{},
				s3client:   client,
				downloader: downloader,
				bucket:     bucket,
				cache:      cacheService,
			}
			return handler
		}
	} else {
		log.Warn("S3/MinIO client not initialized; playback will fallback to public URLs for blobs")
	}

	_ = ctx // reserved
	return &Handler{
		db:     db,
		log:    log,
		client: &http.Client{},
		cache:  cacheService,
	}
}

// GET /playback/videos/:uploadId
func (h *Handler) GetDescriptor(c *gin.Context) {
	uploadID := c.Param("uploadId")
	var v models.Video
	if err := h.db.Where("upload_id = ?", uploadID).First(&v).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"uploadId":    v.UploadID,
		"title":       v.Title,
		"description": v.Description,
		"tags":        v.Tags,
		"category":    v.Category,
		"duration":    v.Duration,
		"hls": gin.H{
			"master": c.FullPath() + "/master.m3u8", // will rewrite below
		},
	})
}

// Proxy master playlist; rewrite variant URIs to proxy endpoints.
func (h *Handler) GetMaster(c *gin.Context) {
	uploadID := c.Param("uploadId")
	var v models.Video
	if err := h.db.Where("upload_id = ?", uploadID).First(&v).Error; err != nil {
		c.String(http.StatusNotFound, "not found")
		return
	}
	if v.HLSMasterURL == "" {
		c.String(http.StatusBadRequest, "master not ready")
		return
	}
	if h.s3client == nil {
		// fallback to original HTTP (likely public) path
		resp, err := h.client.Get(v.HLSMasterURL)
		if err != nil {
			h.log.Errorw("fetch master", "err", err)
			c.String(http.StatusBadGateway, "upstream error")
			return
		}
		defer resp.Body.Close()
		b, _ := io.ReadAll(resp.Body)
		// Naive rewrite of rendition lines (<res>/index.m3u8)
		re := regexp.MustCompile(`(?m)^(1080p|720p|480p|360p)/index.m3u8$`)
		rewritten := re.ReplaceAllStringFunc(string(b), func(s string) string {
			parts := strings.Split(s, "/")
			return path.Join(parts[0], "index.m3u8")
		})
		c.Header("Content-Type", "application/vnd.apple.mpegurl")
		c.String(http.StatusOK, rewritten)
		return
	}
	// Private: fetch blob path derived from stored URL
	blobPath := h.extractBlobPath(v.HLSMasterURL)
	data, err := h.downloadBlob(c, blobPath)
	if err != nil {
		h.log.Errorw("master download", "err", err)
		c.String(http.StatusBadGateway, "blob error")
		return
	}
	// Naive rewrite of rendition lines (<res>/index.m3u8)
	re := regexp.MustCompile(`(?m)^(1080p|720p|480p|360p)/index.m3u8$`)
	rewritten := re.ReplaceAllStringFunc(string(data), func(s string) string {
		parts := strings.Split(s, "/")
		return path.Join(parts[0], "index.m3u8")
	})
	c.Header("Content-Type", "application/vnd.apple.mpegurl")
	c.String(http.StatusOK, rewritten)
}

// Variant playlist
func (h *Handler) GetVariant(c *gin.Context) {
	uploadID := c.Param("uploadId")
	rendition := c.Param("rendition")
	if !allowedRendition(rendition) {
		c.String(http.StatusBadRequest, "invalid rendition")
		return
	}
	var v models.Video
	if err := h.db.Where("upload_id = ?", uploadID).First(&v).Error; err != nil {
		c.String(http.StatusNotFound, "not found")
		return
	}
	if h.s3client != nil { // private blob path
		base := h.blobBase(v.HLSMasterURL)
		blobPath := base + "/" + rendition + "/index.m3u8"
		data, err := h.downloadBlob(c, blobPath)
		if err != nil {
			h.log.Errorw("variant download", "err", err)
			c.String(http.StatusBadGateway, "blob error")
			return
		}
		c.Header("Content-Type", "application/vnd.apple.mpegurl")
		c.String(http.StatusOK, string(data))
		return
	}
	base := baseHLSPath(v.HLSMasterURL)
	url := base + "/" + rendition + "/index.m3u8"
	proxyM3U8(c, h.client, url)
}

// Segment
func (h *Handler) GetSegment(c *gin.Context) {
	uploadID := c.Param("uploadId")
	rendition := c.Param("rendition")
	segment := c.Param("segment")
	if !allowedRendition(rendition) || !strings.HasSuffix(segment, ".ts") && !strings.HasSuffix(segment, ".m4s") {
		c.String(http.StatusBadRequest, "invalid segment")
		return
	}
	var v models.Video
	if err := h.db.Where("upload_id = ?", uploadID).First(&v).Error; err != nil {
		c.String(http.StatusNotFound, "not found")
		return
	}
	if h.s3client != nil { // private
		base := h.blobBase(v.HLSMasterURL)
		blobPath := base + "/" + rendition + "/" + segment

		// Try cache first
		var data []byte
		var err error

		if h.cache != nil {
			cacheKey := h.cache.GenerateKey("segment", uploadID, blobPath)
			data, err = h.cache.Get(c.Request.Context(), cacheKey)
			if err != nil {
				h.log.Warnw("cache get error", "err", err)
			}
		}

		// Cache miss or no cache - fetch from S3/MinIO
		if data == nil {
			data, err = h.downloadBlob(c, blobPath)
			if err != nil {
				h.log.Errorw("segment download", "err", err)
				c.String(http.StatusBadGateway, "blob error")
				return
			}

			// Store in cache if available
			if h.cache != nil && data != nil {
				cacheKey := h.cache.GenerateKey("segment", uploadID, blobPath)
				if err := h.cache.Set(c.Request.Context(), cacheKey, data); err != nil {
					h.log.Warnw("cache set error", "err", err)
				}
			}
		}

		// Basic content-type guess
		if strings.HasSuffix(segment, ".m3u8") {
			c.Header("Content-Type", "application/vnd.apple.mpegurl")
		} else {
			c.Header("Content-Type", "video/MP2T")
		}
		c.Header("Cache-Control", "public, max-age=60")
		c.Data(http.StatusOK, c.Writer.Header().Get("Content-Type"), data)
		return
	}
	base := baseHLSPath(v.HLSMasterURL)
	url := base + "/" + rendition + "/" + segment
	proxyBinary(c, h.client, url)
}

// GetThumbnail serves video thumbnails
func (h *Handler) GetThumbnail(c *gin.Context) {
	uploadID := c.Param("uploadId")
	var v models.Video
	if err := h.db.Where("upload_id = ?", uploadID).First(&v).Error; err != nil {
		c.String(http.StatusNotFound, "Video not found")
		return
	}

	if v.ThumbnailURL == "" {
		c.String(http.StatusNotFound, "Thumbnail not available")
		return
	}

	if h.s3client != nil {
		// Private blob: serve from S3/MinIO storage with caching
		thumbnailPath := fmt.Sprintf("thumbnails/%s/%s.jpg", v.UserID, v.UploadID)

		// Try cache first
		var data []byte
		var err error

		if h.cache != nil {
			cacheKey := h.cache.GenerateKey("thumbnail", uploadID, thumbnailPath)
			data, err = h.cache.Get(c.Request.Context(), cacheKey)
			if err != nil {
				h.log.Warnw("cache get error", "err", err)
			}
		}

		// Cache miss or no cache - fetch from S3/MinIO
		if data == nil {
			data, err = h.downloadBlob(c, thumbnailPath)
			if err != nil {
				h.log.Errorw("thumbnail download", "err", err)
				c.String(http.StatusNotFound, "Thumbnail not found")
				return
			}

			// Store in cache if available
			if h.cache != nil && data != nil {
				cacheKey := h.cache.GenerateKey("thumbnail", uploadID, thumbnailPath)
				if err := h.cache.Set(c.Request.Context(), cacheKey, data); err != nil {
					h.log.Warnw("cache set error", "err", err)
				}
			}
		}

		c.Header("Content-Type", "image/jpeg")
		c.Header("Cache-Control", "public, max-age=3600")
		c.Data(http.StatusOK, "image/jpeg", data)
		return
	}

	// Public blob: redirect to direct URL
	c.Redirect(http.StatusFound, v.ThumbnailURL)
}

func allowedRendition(r string) bool {
	switch r {
	case "1080p", "720p", "480p", "360p":
		return true
	}
	return false
}

func baseHLSPath(master string) string {
	// master URL ends with master.m3u8; strip
	return strings.TrimSuffix(master, "/master.m3u8")
}

func proxyM3U8(c *gin.Context, cl *http.Client, url string) {
	resp, err := cl.Get(url)
	if err != nil {
		c.String(http.StatusBadGateway, "upstream error")
		return
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	c.Header("Content-Type", "application/vnd.apple.mpegurl")
	c.String(resp.StatusCode, string(b))
}

func proxyBinary(c *gin.Context, cl *http.Client, url string) {
	resp, err := cl.Get(url)
	if err != nil {
		c.String(http.StatusBadGateway, "upstream error")
		return
	}
	defer resp.Body.Close()
	for k, v := range resp.Header {
		if len(v) > 0 {
			c.Header(k, v[0])
		}
	}
	c.Header("Cache-Control", "public, max-age=60")
	c.Status(resp.StatusCode)
	io.Copy(c.Writer, resp.Body)
}

// Optional simple readiness endpoint
func (h *Handler) Ready(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"status": "ok"}) }

// Debug config
func (h *Handler) Config(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"env": os.Environ()}) }

func (h *Handler) downloadBlob(c *gin.Context, path string) ([]byte, error) {
	ctx := c.Request.Context()
	if h.s3client != nil {
		buf := manager.NewWriteAtBuffer([]byte{})
		_, err := h.downloader.Download(ctx, buf, &s3.GetObjectInput{Bucket: aws.String(h.bucket), Key: aws.String(path)})
		if err != nil {
			return nil, err
		}
		return buf.Bytes(), nil
	}
	// fallback: try HTTP fetch
	resp, err := h.client.Get(path)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	return b, nil
}

// Helper to compute base path inside container (without container prefix and without master.m3u8)
func (h *Handler) blobBase(masterURL string) string {
	blobPath := h.extractBlobPath(masterURL)
	return strings.TrimSuffix(blobPath, "/master.m3u8")
}

// extractBlobPath extracts the blob path from either a full Azure URL or relative path
func (h *Handler) extractBlobPath(url string) string {
	// If it's an Azure URL, return path after blob.core.windows.net
	if strings.Contains(url, ".blob.core.windows.net/") {
		parts := strings.SplitN(url, ".blob.core.windows.net/", 2)
		if len(parts) == 2 {
			// remove leading container if present
			p := strings.TrimPrefix(parts[1], h.bucket+"/")
			return strings.TrimPrefix(p, "/")
		}
	}
	// If it's a MinIO/S3 public URL (http(s)://host:port/bucket/...), try to strip host/bucket
	if strings.HasPrefix(url, "http://") || strings.HasPrefix(url, "https://") {
		// naive parse: split on '/', take path after host
		parts := strings.SplitN(url, "/", 4)
		if len(parts) >= 4 {
			// parts[3] is everything after host/port
			p := parts[3]
			// remove leading bucket name if present
			p = strings.TrimPrefix(p, h.bucket+"/")
			return strings.TrimPrefix(p, "/")
		}
	}
	// Relative URL: remove leading slash and return as-is
	return strings.TrimPrefix(url, "/")
}
