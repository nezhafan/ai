package backend

import (
	"context"
	"testing"
)

func TestForegroundRequestWaitsForDomReady(t *testing.T) {
	app := NewApp()
	calls := 0
	app.activateWindow = func(context.Context, string) {
		calls++
	}

	app.requestForeground("file-open")
	if calls != 0 {
		t.Fatalf("expected no activation before dom ready, got %d", calls)
	}

	app.domReady(context.Background())
	if calls != 1 {
		t.Fatalf("expected activation after dom ready, got %d", calls)
	}
}

func TestForegroundRequestActivatesImmediatelyAfterDomReady(t *testing.T) {
	app := NewApp()
	app.ctx = context.Background()
	calls := 0
	app.activateWindow = func(context.Context, string) {
		calls++
	}

	app.domReady(context.Background())
	app.requestForeground("open-paths")

	if calls != 1 {
		t.Fatalf("expected immediate activation after dom ready, got %d", calls)
	}
}
