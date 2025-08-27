#!/bin/sh

# This script will generate the config.js file using environment variables
# The output path is where Nginx serves files from
CONFIG_FILE="/usr/share/nginx/html/config.js"

echo "Generating runtime configuration for the frontend..."

# Use a here-document (cat <<EOF) to write the JavaScript file
cat <<EOF > ${CONFIG_FILE}
window.runtimeConfig = {
  VITE_API_UPLOAD: "${VITE_API_UPLOAD}",
  VITE_API_CATALOG: "${VITE_API_CATALOG}",
  VITE_API_PLAYBACK: "${VITE_API_PLAYBACK}",
  VITE_API_LOGIN: "${VITE_API_LOGIN}",
  VITE_JWT: "${VITE_JWT}",
};
EOF

echo "Configuration generated successfully at ${CONFIG_FILE}"
cat ${CONFIG_FILE} # Print the generated file content for debugging

# Start the Nginx server in the foreground
# This command must be the last one
exec nginx -g 'daemon off;'