package cursor

import (
	"context"
	"slices"
	"testing"

	"github.com/doordash-oss/agentic-orchestrator/internal/llm"
)

func TestBuildCommandLaunchesACP(t *testing.T) {
	args, env, err := NewProvider("").BuildCommand(llm.CommandBuildOpts{
		Model:                "composer-2",
		WorkDir:              "/work",
		AdditionalDirs:       []string{"/extra"},
		DangerouslySkipPerms: true,
	})
	if err != nil {
		t.Fatalf("BuildCommand() error: %v", err)
	}
	if env != nil {
		t.Fatalf("BuildCommand() env = %v, want nil", env)
	}
	want := []string{"cursor-agent", "--model", "composer-2", "--workspace", "/work", "--trust", "--force", "--add-dir", "/extra", "acp"}
	if !slices.Equal(args, want) {
		t.Fatalf("BuildCommand() = %v, want %v", args, want)
	}
}

func TestParseModelList(t *testing.T) {
	out := []byte("\x1b[2mAvailable models\x1b[0m\n\ncomposer-2 \x1b[2m- Composer 2\x1b[0m (default)\nauto - Auto (current)\n\nTip: use --model <id>\n")
	got := parseModelList(out)
	if len(got) != 2 || got[0].ID != "composer-2" || got[0].DisplayName != "Composer 2" || got[1].ID != "auto" {
		t.Fatalf("parseModelList() = %+v", got)
	}
}

func TestCheckReadinessAuthenticated(t *testing.T) {
	p := NewProvider("cursor-agent")
	p.runner = func(context.Context, string, []string, []string) ([]byte, error) {
		return []byte(`{"isAuthenticated":true,"userInfo":{"email":"a@b.c"}}`), nil
	}
	got := p.CheckReadiness(context.Background())
	if !got.Ready || got.Detail != "authenticated as a@b.c" {
		t.Fatalf("CheckReadiness() = %+v", got)
	}
}

func TestDiscoverModelCatalog(t *testing.T) {
	p := NewProvider("cursor-agent")
	var gotArgs []string
	p.runner = func(_ context.Context, name string, args []string, _ []string) ([]byte, error) {
		if name != "cursor-agent" {
			t.Fatalf("binary = %q", name)
		}
		gotArgs = args
		return []byte("auto - Auto\n"), nil
	}
	models, err := p.DiscoverModelCatalog(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(gotArgs, []string{"models"}) || len(models) != 1 || models[0].ID != "auto" {
		t.Fatalf("discover args %v models %+v", gotArgs, models)
	}
}
