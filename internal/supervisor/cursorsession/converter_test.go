package cursorsession

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/doordash-oss/agentic-orchestrator/internal/supervisor"
)

func TestRebuildWritesCursorSeed(t *testing.T) {
	c := New(Options{})
	if !c.SeedsHistory() || c.Harness() != Harness {
		t.Fatalf("converter = %s seeds=%v", c.Harness(), c.SeedsHistory())
	}
	dir := t.TempDir()
	res, err := c.Rebuild(context.Background(), supervisor.RebuildInput{
		ConversationDir: dir,
		Model:           "auto",
		Records: []supervisor.Record{{
			Seq: 1, TurnID: "turn-1", Kind: supervisor.KindUser, Visibility: supervisor.VisibilityContent,
			Data: []byte(`{"text":"remember this"}`),
		}},
	})
	if err != nil || !res.Resume || res.SessionID != "" || !strings.HasSuffix(res.Path, "cursor-history-seed.txt") {
		t.Fatalf("Rebuild = %+v, %v", res, err)
	}
	data, err := os.ReadFile(res.Path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), "User: remember this") {
		t.Fatalf("seed = %s", data)
	}
}

func TestRebuildEmptySelectionDoesNotResume(t *testing.T) {
	res, err := New(Options{}).Rebuild(context.Background(), supervisor.RebuildInput{ConversationDir: t.TempDir()})
	if err != nil || res.Resume || res.Path != "" {
		t.Fatalf("Rebuild = %+v, %v", res, err)
	}
}
