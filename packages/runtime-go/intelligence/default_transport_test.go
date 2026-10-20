package intelligence_test

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/CopilotKit/CopilotKit/packages/runtime-go/intelligence"
)

type applicationTransport struct {
	requests int
	closes   int
	status   int
}

func (transport *applicationTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	transport.requests++
	return &http.Response{
		StatusCode: transport.status,
		Header:     http.Header{"Location": []string{"https://untrusted.example"}},
		Body:       io.NopCloser(strings.NewReader(`{"memories":[]}`)),
		Request:    request,
	}, nil
}

func (transport *applicationTransport) CloseIdleConnections() { transport.closes++ }

func TestSDKBorrowsCustomDefaultTransport(t *testing.T) {
	original := http.DefaultTransport
	transport := &applicationTransport{status: http.StatusOK}
	http.DefaultTransport = transport
	t.Cleanup(func() { http.DefaultTransport = original })
	client, err := intelligence.New(intelligence.Config{APIKey: "secret"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = client.ListMemories(context.Background(), intelligence.ListMemoriesParams{UserID: "customer"})
	if err != nil || transport.requests != 1 {
		t.Fatalf("custom transport was not used: requests=%d error=%v", transport.requests, err)
	}
	transport.status = http.StatusTemporaryRedirect
	_, err = client.ListMemories(context.Background(), intelligence.ListMemoriesParams{UserID: "customer"})
	var platformError *intelligence.Error
	if !errors.As(err, &platformError) || platformError.Status != http.StatusTemporaryRedirect || transport.requests != 2 {
		t.Fatalf("redirect was not rejected: requests=%d error=%v", transport.requests, err)
	}
	client.Close()
	if transport.closes != 0 {
		t.Fatal("SDK closed the application's default transport")
	}
}

func TestSDKClonesStandardDefaultTransport(t *testing.T) {
	original := http.DefaultTransport
	transport := &http.Transport{MaxIdleConns: 73}
	http.DefaultTransport = transport
	t.Cleanup(func() { http.DefaultTransport = original })
	client, err := intelligence.New(intelligence.Config{APIKey: "secret"})
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	cloned, ok := client.Configuration().HTTPClient.Transport.(*http.Transport)
	if !ok || cloned == transport || cloned.MaxIdleConns != 73 {
		t.Fatal("SDK did not retain an independent copy of the default transport settings")
	}
}
