// Package main starts the Go ADK sidecar used by the Tauri desktop backend.
package main

import (
	"flag"
	"fmt"
	"log"
	"net"
	"os"
	"os/signal"
	"syscall"

	"google.golang.org/grpc"

	aiv1 "ofive/sidecars/go/ofive-ai-agent/gen/ofive/aiv1"
	"ofive/sidecars/go/ofive-ai-agent/internal/service"
)

const sidecarVersion = "0.1.0"

func main() {
	port := flag.Int("port", 0, "tcp port to listen on")
	flag.Parse()

	if *port <= 0 {
		log.Fatal("[sidecar] port must be provided")
	}

	listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", *port))
	if err != nil {
		log.Fatalf("[sidecar] listen failed: %v", err)
	}

	grpcServer := grpc.NewServer()
	serviceImpl, err := service.NewAIService(sidecarVersion)
	if err != nil {
		log.Fatalf("[sidecar] init service failed: %v", err)
	}
	aiv1.RegisterAiAgentServiceServer(grpcServer, serviceImpl)

	log.Printf("[sidecar] listening on %s", listener.Addr().String())

	shutdownSignal := make(chan os.Signal, 1)
	signal.Notify(shutdownSignal, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		<-shutdownSignal
		log.Printf("[sidecar] shutdown signal received")
		grpcServer.GracefulStop()
	}()

	if err := grpcServer.Serve(listener); err != nil {
		log.Fatalf("[sidecar] serve failed: %v", err)
	}
}
