package services

import (
	"context"
	"fmt"
	"os"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
)

// S3ClientAdapter implements the StorageClient interface for MinIO/S3.
type S3ClientAdapter struct {
	client *s3.Client
}

// NewS3ClientAdapterFromEnv creates a new S3 client from environment variables.
func NewS3ClientAdapterFromEnv() (*S3ClientAdapter, error) {
	endpoint := os.Getenv("MINIO_ENDPOINT")
	access := os.Getenv("MINIO_ACCESS_KEY")
	secret := os.Getenv("MINIO_SECRET_KEY")
	region := os.Getenv("AWS_REGION")
	if region == "" {
		region = "us-east-1"
	}

	if endpoint == "" || access == "" || secret == "" {
		return nil, fmt.Errorf("missing MinIO environment variables for S3 adapter")
	}
	
	port := os.Getenv("MINIO_PORT")
	if port == "" {
		port = "9000"
	}
	url := fmt.Sprintf("http://%s:%s", endpoint, port)

	cfg, err := config.LoadDefaultConfig(context.Background(),
		config.WithRegion(region),
		config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(access, secret, "")),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to load AWS config for MinIO: %w", err)
	}

	client := s3.NewFromConfig(cfg, func(o *s3.Options) {
		o.BaseEndpoint = aws.String(url)
		o.UsePathStyle = true
	})

	return &S3ClientAdapter{client: client}, nil
}

// DeleteBlob deletes a single object from the specified bucket.
func (a *S3ClientAdapter) DeleteBlob(ctx context.Context, bucket, blobPath string) error {
	_, err := a.client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(bucket),
		Key:    aws.String(blobPath),
	})
	return err
}

// DeleteBlobsWithPrefix deletes all objects with a given prefix from the specified bucket.
func (a *S3ClientAdapter) DeleteBlobsWithPrefix(ctx context.Context, bucket, prefix string) error {
	paginator := s3.NewListObjectsV2Paginator(a.client, &s3.ListObjectsV2Input{
		Bucket: aws.String(bucket),
		Prefix: aws.String(prefix),
	})

	var objectsToDelete []types.ObjectIdentifier
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return fmt.Errorf("failed to list objects with prefix %s: %w", prefix, err)
		}
		for _, obj := range page.Contents {
			objectsToDelete = append(objectsToDelete, types.ObjectIdentifier{Key: obj.Key})
		}
	}

	if len(objectsToDelete) == 0 {
		return nil // Nothing to delete
	}

	_, err := a.client.DeleteObjects(ctx, &s3.DeleteObjectsInput{
		Bucket: aws.String(bucket),
		Delete: &types.Delete{Objects: objectsToDelete},
	})
	return err
}

// BlobExists checks if a blob exists in the specified bucket.
func (a *S3ClientAdapter) BlobExists(ctx context.Context, bucket, blobPath string) (bool, error) {
	_, err := a.client.HeadObject(ctx, &s3.HeadObjectInput{
		Bucket: aws.String(bucket),
		Key:    aws.String(blobPath),
	})
	if err != nil {
		if strings.Contains(err.Error(), "NotFound") {
			return false, nil
		}
		return false, err
	}
	return true, nil
}