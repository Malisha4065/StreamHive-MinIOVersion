package services

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"go.uber.org/zap"
	"gorm.io/gorm"

	"github.com/streamhive/video-catalog-api/internal/models"
)

type StorageClient interface {
	DeleteBlob(ctx context.Context, bucket, blobPath string) error
	DeleteBlobsWithPrefix(ctx context.Context, bucket, prefix string) error
	BlobExists(ctx context.Context, bucket, blobPath string) (bool, error)
}

// VideoDeleteService handles video deletion including storage cleanup
type VideoDeleteService struct {
	db              *gorm.DB
	logger          *zap.SugaredLogger
	storage         StorageClient // Renamed from 'azure'
	rawBucket       string
	processedBucket string
}

func NewVideoDeleteService(db *gorm.DB, logger *zap.SugaredLogger, client StorageClient) *VideoDeleteService {
	return &VideoDeleteService{
		db:              db,
		logger:          logger,
		storage:         client,
		rawBucket:       os.Getenv("MINIO_RAW_BUCKET"),
		processedBucket: os.Getenv("MINIO_PROCESSED_BUCKET"),
	}
}

// DeleteVideoCompletely removes a video and all associated files from database and storage
func (s *VideoDeleteService) DeleteVideoCompletely(ctx context.Context, videoID uint) error {
	// First get the video to extract all file paths
	var video models.Video
	if err := s.db.First(&video, videoID).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return fmt.Errorf("video not found")
		}
		s.logger.Errorw("Failed to get video for deletion", "error", err, "videoID", videoID)
		return fmt.Errorf("failed to get video: %w", err)
	}

	s.logger.Infow("Starting complete video deletion",
		"videoID", videoID,
		"uploadID", video.UploadID,
		"userID", video.UserID,
		"title", video.Title)

	// 1. Raw video file from the raw bucket
	if video.RawVideoPath != "" {
		if err := s.storage.DeleteBlob(ctx, s.rawBucket, video.RawVideoPath); err != nil {
			s.logger.Warnw("Failed to delete raw video file (continuing)", "error", err, "path", video.RawVideoPath)
		} else {
			s.logger.Infow("Deleted raw video", "path", video.RawVideoPath)
		}
	}

	// 2. HLS files from the processed bucket
	hlsPrefix := fmt.Sprintf("hls/%s/%s/", video.UserID, video.UploadID)
	if err := s.storage.DeleteBlobsWithPrefix(ctx, s.processedBucket, hlsPrefix); err != nil {
		s.logger.Warnw("Failed to delete HLS files with prefix (continuing)", "error", err, "prefix", hlsPrefix)
	} else {
		s.logger.Infow("Deleted HLS files", "prefix", hlsPrefix)
	}

	// 3. Thumbnail from the processed bucket
	thumbnailPath := fmt.Sprintf("thumbnails/%s/%s.jpg", video.UserID, video.UploadID)
	if err := s.storage.DeleteBlob(ctx, s.processedBucket, thumbnailPath); err != nil {
		s.logger.Warnw("Failed to delete thumbnail file (continuing)", "error", err, "path", thumbnailPath)
	} else {
		s.logger.Infow("Deleted thumbnail", "path", thumbnailPath)
	}

	s.logger.Infow("Storage cleanup completed", "videoID", videoID)

	// --- Now delete from database ---
	if err := s.db.Unscoped().Delete(&video).Error; err != nil {
		s.logger.Errorw("Failed to delete video from database", "error", err, "videoID", videoID)
		return fmt.Errorf("failed to delete video from database: %w", err)
	}

	s.logger.Infow("Video completely deleted", "videoID", videoID, "uploadID", video.UploadID)
	return nil
}

// extractHLSPrefix extracts the HLS storage prefix from the master URL
func (s *VideoDeleteService) extractHLSPrefix(masterURL, userID, uploadID string) string {
	// Expected format: https://{account}.blob.core.windows.net/{container}/hls/{userID}/{uploadID}/master.m3u8
	// We want to extract: hls/{userID}/{uploadID}

	if masterURL == "" {
		return ""
	}

	// Try to extract from URL
	parts := strings.Split(masterURL, "/")
	for i, part := range parts {
		if part == "hls" && i+2 < len(parts) {
			// Found hls/{userID}/{uploadID}/master.m3u8
			return filepath.Join("hls", parts[i+1], parts[i+2])
		}
	}

	// Fallback: construct from known user and upload IDs
	return fmt.Sprintf("hls/%s/%s", userID, uploadID)
}
