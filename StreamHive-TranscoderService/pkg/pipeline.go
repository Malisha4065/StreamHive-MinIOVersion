package pkg

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"go.uber.org/zap"

	"github.com/streamhive/transcoder/internal/ffmpeg"
	"github.com/streamhive/transcoder/internal/queue"
	"github.com/streamhive/transcoder/internal/storage"
)

type UploadEvent struct {
	UploadID      string   `json:"uploadId"`
	UserID        string   `json:"userId"`
	Username      string   `json:"username"`
	OriginalName  string   `json:"originalFilename"`
	Title         string   `json:"title"`
	Description   string   `json:"description"`
	Tags          []string `json:"tags"`
	IsPrivate     bool     `json:"isPrivate"`
	Category      string   `json:"category"`
	RawVideoPath  string   `json:"rawVideoPath"`
	ContainerName string   `json:"containerName"`
	BlobURL       string   `json:"blobUrl"`
	Resolutions   []string `json:"resolutions"`
}

type Transcoder struct {
	log *zap.SugaredLogger
	s3  *storage.S3Client
	pub *queue.Publisher
}

func NewTranscoder(log *zap.SugaredLogger, s3c *storage.S3Client, pub *queue.Publisher) *Transcoder {
	return &Transcoder{log: log, s3: s3c, pub: pub}
}

// buildAzureURL constructs the full Azure Blob Storage URL for a given blob path
func (t *Transcoder) buildAzureURL(blobPath string) string {
	// Prefer explicit public base if provided (MINIO_PUBLIC_BASE)
	if base := os.Getenv("MINIO_PUBLIC_BASE"); base != "" {
		return fmt.Sprintf("%s/%s", strings.TrimRight(base, "/"), blobPath)
	}
	// Fallback to constructing from endpoint
	endpoint := getSecret("/mnt/secrets-store/minio-endpoint", "MINIO_ENDPOINT")
	if endpoint == "" {
		endpoint = os.Getenv("MINIO_ENDPOINT")
	}
	port := getSecret("/mnt/secrets-store/minio-port", "MINIO_PORT")
	if port == "" {
		port = os.Getenv("MINIO_PORT")
	}
	if endpoint == "" {
		t.log.Warnw("MinIO endpoint not set, returning relative URL", "blobPath", blobPath)
		return fmt.Sprintf("/%s", blobPath)
	}
	// Assume http when not using SSL
	scheme := "http"
	if os.Getenv("MINIO_USE_SSL") == "true" {
		scheme = "https"
	}
	host := endpoint
	if port != "" {
		host = fmt.Sprintf("%s:%s", endpoint, port)
	}
	return fmt.Sprintf("%s://%s/%s", scheme, host, blobPath)
}

// Helper function to read secret from file or fallback to environment variable
func getSecret(filePath, envVar string) string {
	if data, err := os.ReadFile(filePath); err == nil {
		return strings.TrimSpace(string(data))
	}
	return os.Getenv(envVar)
}

func (t *Transcoder) Handle(ctx context.Context, body []byte) error {
	var evt UploadEvent
	if err := json.Unmarshal(body, &evt); err != nil {
		return fmt.Errorf("json: %w", err)
	}
	if evt.UploadID == "" || evt.UserID == "" || evt.RawVideoPath == "" {
		return fmt.Errorf("missing required fields")
	}

	work := filepath.Join(os.TempDir(), fmt.Sprintf("transcoder-%s", evt.UploadID))
	if err := os.MkdirAll(work, 0o755); err != nil {
		return err
	}
	defer os.RemoveAll(work)

	inputPath := filepath.Join(work, "input.mp4")
	if err := t.s3.DownloadTo(ctx, evt.RawVideoPath, inputPath); err != nil {
		return fmt.Errorf("download: %w", err)
	}

	// Generate variants
	outRoot := filepath.Join(work, "hls")
	if err := os.MkdirAll(outRoot, 0o755); err != nil {
		return err
	}

	ladder := evt.Resolutions
	if len(ladder) == 0 {
		ladder = []string{"1080p", "720p", "480p", "360p"}
	}

	for _, res := range ladder {
		resDir := filepath.Join(outRoot, res)
		if err := os.MkdirAll(resDir, 0o755); err != nil {
			return err
		}

		cmd := ffmpeg.BuildHLSCommand(ctx, inputPath, resDir, res)
		cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
		start := time.Now()
		if err := cmd.Run(); err != nil {
			return fmt.Errorf("ffmpeg %s: %w", res, err)
		}
		t.log.Infow("rendition done", "res", res, "ms", time.Since(start).Milliseconds())
	}

	// Write master playlist to outRoot
	masterPath := filepath.Join(outRoot, "master.m3u8")
	if err := os.WriteFile(masterPath, []byte(buildMaster(evt.UserID, evt.UploadID, ladder)), 0o644); err != nil {
		return err
	}

	// Upload entire HLS folder (playlists + segments)
	base := fmt.Sprintf("hls/%s/%s", evt.UserID, evt.UploadID)
	if err := t.s3.UploadDir(ctx, outRoot, base); err != nil {
		return fmt.Errorf("upload hls: %w", err)
	}

	// Thumbnail
	thumbPath := filepath.Join(work, "thumb.jpg")
	thumbCmd := exec.CommandContext(ctx, "ffmpeg", "-y", "-ss", "1", "-i", inputPath, "-frames:v", "1", thumbPath)
	var thumbnailURL string
	if err := thumbCmd.Run(); err == nil {
		thumbBlobPath := fmt.Sprintf("thumbnails/%s/%s.jpg", evt.UserID, evt.UploadID)
		if err := t.s3.UploadFile(ctx, thumbPath, thumbBlobPath, "image/jpeg"); err == nil {
			thumbnailURL = t.buildAzureURL(thumbBlobPath)
		}
	}

	// Publish transcoded with rich metadata so catalog can fill missing fields
	out := map[string]any{
		"uploadId":         evt.UploadID,
		"userId":           evt.UserID,
		"title":            evt.Title,
		"description":      evt.Description,
		"tags":             evt.Tags,
		"category":         evt.Category,
		"isPrivate":        evt.IsPrivate,
		"originalFilename": evt.OriginalName,
		"rawVideoPath":     evt.RawVideoPath,
		"hls": map[string]any{
			"masterUrl": t.buildAzureURL(fmt.Sprintf("%s/%s", base, "master.m3u8")),
		},
		"thumbnailUrl": thumbnailURL,
		"ready":        true,
	}
	return t.pub.PublishJSON(ctx, out)
}

func buildMaster(userId, uploadId string, ladder []string) string {
	// Bandwidth should match actual encoded bitrates (video + audio)
	bw := map[string]int{
		"1080p": 5192000, // 5000k video + 192k audio
		"720p":  2928000, // 2800k video + 128k audio
		"480p":  1496000, // 1400k video + 96k audio
		"360p":  864000,  // 800k video + 64k audio
	}
	resMap := map[string]string{"1080p": "1920x1080", "720p": "1280x720", "480p": "854x480", "360p": "640x360"}
	if len(ladder) == 0 {
		ladder = []string{"1080p", "720p", "480p", "360p"}
	}
	s := "#EXTM3U\n"
	for _, r := range ladder {
		s += fmt.Sprintf("#EXT-X-STREAM-INF:BANDWIDTH=%d,RESOLUTION=%s\n", bw[r], resMap[r])
		s += fmt.Sprintf("%s/index.m3u8\n", r)
	}
	return s
}
