#!/bin/bash

# Load testing script for Upload Service

set -e

UPLOAD_URL=${UPLOAD_URL:-"http://localhost:3001/api/v1/upload"}
JWT_TOKEN=${JWT_TOKEN:-""}
CONCURRENT_USERS=${CONCURRENT_USERS:-10}
TEST_DURATION=${TEST_DURATION:-60}

if [ -z "$JWT_TOKEN" ]; then
    echo "❌ JWT_TOKEN environment variable is required"
    echo "Usage: JWT_TOKEN=your_token ./scripts/load-test.sh"
    exit 1
fi

echo "🔥 Starting load test for Upload Service..."
echo "   URL: $UPLOAD_URL"
echo "   Concurrent Users: $CONCURRENT_USERS"
echo "   Duration: ${TEST_DURATION}s"

# Create a small test video file if it doesn't exist
if [ ! -f "test-video.mp4" ]; then
    echo "📹 Creating test video file..."
    # Create a 5-second test video using ffmpeg (if available)
    if command -v ffmpeg &> /dev/null; then
        ffmpeg -f lavfi -i testsrc=duration=5:size=640x480:rate=30 -f lavfi -i sine=frequency=1000:duration=5 -c:v libx264 -c:a aac -shortest test-video.mp4 -y
    else
        echo "❌ ffmpeg not found. Please create a test-video.mp4 file manually."
        exit 1
    fi
fi

# Function to upload a video
upload_video() {
    local user_id=$1
    curl -X POST \
        -H "Authorization: Bearer $JWT_TOKEN" \
        -F "video=@test-video.mp4" \
        -F "title=Load Test Video $user_id" \
        -F "description=This is a load test video" \
        -F "tags=test,load,performance" \
        -F "isPrivate=false" \
        -F "category=other" \
        "$UPLOAD_URL" \
        -w "%{http_code}|%{time_total}\n" \
        -s -o /dev/null
}

# Start background processes for concurrent uploads
echo "🚀 Starting concurrent upload tests..."
for i in $(seq 1 $CONCURRENT_USERS); do
    (
        end_time=$(($(date +%s) + TEST_DURATION))
        request_count=0
        success_count=0
        total_time=0
        
        while [ $(date +%s) -lt $end_time ]; do
            result=$(upload_video $i)
            http_code=$(echo $result | cut -d'|' -f1)
            time_taken=$(echo $result | cut -d'|' -f2)
            
            request_count=$((request_count + 1))
            total_time=$(echo "$total_time + $time_taken" | bc -l)
            
            if [ "$http_code" -eq 202 ]; then
                success_count=$((success_count + 1))
            fi
            
            # Small delay between requests
            sleep 1
        done
        
        avg_time=$(echo "scale=3; $total_time / $request_count" | bc -l)
        success_rate=$(echo "scale=2; $success_count * 100 / $request_count" | bc -l)
        
        echo "User $i: $request_count requests, $success_count successful (${success_rate}%), avg time: ${avg_time}s"
    ) &
done

# Wait for all background processes to complete
wait

echo "✅ Load test completed!"
echo "📊 Check the service logs for detailed performance metrics"

# Cleanup
rm -f test-video.mp4
