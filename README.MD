==============================================================
STREAMHIVE-LOCAL MINIKUBE VERSION
==============================================================

This is a version of StreamHive application which doesn't involve any usage of Azure or other cloud services.
It uses MinIO image locally as blob storage.
Running this version requires Kubernetes cluster in Minikube.


Steps(Linux):

1. Start Minikube using:

start minikube

2. Build docker images in the minikube environment:

eval "$(minikube docker-env)"

3. Run docker images or docker ps to make user that docker command executes within Minikube env.

4. Run build script to build the images locally.

./build-docker.sh

5. Run deploy script to deploy to minikube cluster

./deploy-minikube.sh

6. Signup and upload sample video and test the video streaming functionality.