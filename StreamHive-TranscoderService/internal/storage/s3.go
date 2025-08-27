package storage

import (
	"context"
	"fmt"
	"io/fs"
	"io/ioutil"
	"mime"
	"os"
	"path/filepath"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/feature/s3/manager"
	s3 "github.com/aws/aws-sdk-go-v2/service/s3"
)

// Helper function to read secret from file or fallback to environment variable
func getSecret(filePath, envVar string) string {
	if data, err := ioutil.ReadFile(filePath); err == nil {
		return strings.TrimSpace(string(data))
	}
	return os.Getenv(envVar)
}

type S3Client struct {
	client     *s3.Client
	uploader   *manager.Uploader
	downloader *manager.Downloader
	rawBucket       string // Bucket for downloads (original videos)
	processedBucket string // Bucket for uploads (HLS, thumbnails)
}

func NewS3ClientFromEnv(ctx context.Context) (*S3Client, error) {
	rawBucket := os.Getenv("MINIO_RAW_BUCKET")
	if rawBucket == "" {
		rawBucket = "raw-videos"
	}

	processedBucket := os.Getenv("MINIO_PROCESSED_BUCKET")
	if processedBucket == "" {
		processedBucket = "processed-videos" // A sensible default
	}

	// Build custom AWS config if MINIO endpoint is provided
	endpoint := getSecret("/mnt/secrets-store/minio-endpoint", "MINIO_ENDPOINT")
	if endpoint == "" {
		endpoint = os.Getenv("MINIO_ENDPOINT")
	}
	access := getSecret("/mnt/secrets-store/minio-access-key", "MINIO_ACCESS_KEY")
	secret := getSecret("/mnt/secrets-store/minio-secret-key", "MINIO_SECRET_KEY")
	region := os.Getenv("AWS_REGION")
	if region == "" {
		region = "us-east-1"
	}

	var cfg aws.Config
	var err error
	if endpoint != "" {
		// Use static creds and custom endpoint for MinIO
		port := getSecret("/mnt/secrets-store/minio-port", "MINIO_PORT")
		if port == "" {
			port = os.Getenv("MINIO_PORT")
		}
		if port == "" {
			port = "9000"
		}
		url := fmt.Sprintf("http://%s:%s", endpoint, port)
		
		customResolver := aws.EndpointResolverWithOptionsFunc(func(service, region string, options ...interface{}) (aws.Endpoint, error) {
			if service == s3.ServiceID {
				return aws.Endpoint{
					URL:               url,
					HostnameImmutable: true,
					SigningRegion:     region,
				}, nil
			}
			return aws.Endpoint{}, &aws.EndpointNotFoundError{}
		})

		cfg, err = config.LoadDefaultConfig(ctx,
			config.WithRegion(region),
			config.WithEndpointResolverWithOptions(customResolver),
			config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(access, secret, "")),
		)
	} else {
		cfg, err = config.LoadDefaultConfig(ctx)
	}
	if err != nil {
		return nil, err
	}

	client := s3.NewFromConfig(cfg, func(o *s3.Options) {
		// allow path style for MinIO
		o.UsePathStyle = true
	})

	uploader := manager.NewUploader(client)
	downloader := manager.NewDownloader(client)

	return &S3Client{client: client, uploader: uploader, downloader: downloader, rawBucket: rawBucket, processedBucket: processedBucket}, nil
}

func (c *S3Client) DownloadTo(ctx context.Context, blobPath, localPath string) error {
	if err := os.MkdirAll(filepath.Dir(localPath), 0o755); err != nil {
		return err
	}
	f, err := os.Create(filepath.Clean(localPath))
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = c.downloader.Download(ctx, f, &s3.GetObjectInput{Bucket: aws.String(c.rawBucket), Key: aws.String(blobPath)})
	return err
}

func (c *S3Client) UploadFile(ctx context.Context, localPath, blobPath string, contentType string) error {
	f, err := os.Open(filepath.Clean(localPath))
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = c.uploader.Upload(ctx, &s3.PutObjectInput{Bucket: aws.String(c.processedBucket), Key: aws.String(blobPath), Body: f, ContentType: aws.String(contentType)})
	return err
}

func (c *S3Client) UploadDir(ctx context.Context, localRoot, blobPrefix string) error {
	return filepath.WalkDir(localRoot, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(localRoot, path)
		if err != nil {
			return err
		}
		blobName := filepath.ToSlash(filepath.Join(blobPrefix, rel))
		ct := detectContentType(path)
		return c.UploadFile(ctx, path, blobName, ct)
	})
}

func detectContentType(path string) string {
	low := strings.ToLower(path)
	if strings.HasSuffix(low, ".m3u8") {
		return "application/vnd.apple.mpegurl"
	}
	if strings.HasSuffix(low, ".ts") {
		return "video/MP2T"
	}
	if strings.HasSuffix(low, ".jpg") || strings.HasSuffix(low, ".jpeg") {
		return "image/jpeg"
	}
	if strings.HasSuffix(low, ".png") {
		return "image/png"
	}
	if ct := mime.TypeByExtension(filepath.Ext(low)); ct != "" {
		return ct
	}
	return "application/octet-stream"
}

func (c *S3Client) DeleteBlob(ctx context.Context, blobPath string) error {
	_, err := c.client.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: aws.String(c.processedBucket), Key: aws.String(blobPath)})
	return err
}

func (c *S3Client) DeleteBlobsWithPrefix(ctx context.Context, prefix string) error {
	// List objects with prefix and delete them
	paginator := s3.NewListObjectsV2Paginator(c.client, &s3.ListObjectsV2Input{Bucket: aws.String(c.processedBucket), Prefix: aws.String(prefix)})
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return fmt.Errorf("failed to list objects with prefix %s: %w", prefix, err)
		}
		for _, obj := range page.Contents {
			if obj.Key != nil {
				if err := c.DeleteBlob(ctx, *obj.Key); err != nil {
					return fmt.Errorf("failed to delete object %s: %w", *obj.Key, err)
				}
			}
		}
	}
	return nil
}

func (c *S3Client) BlobExists(ctx context.Context, blobPath string) (bool, error) {
	_, err := c.client.HeadObject(ctx, &s3.HeadObjectInput{Bucket: aws.String(c.processedBucket), Key: aws.String(blobPath)})
	if err != nil {
		if strings.Contains(err.Error(), "NotFound") {
			return false, nil
		}
		return false, err
	}
	return true, nil
}
