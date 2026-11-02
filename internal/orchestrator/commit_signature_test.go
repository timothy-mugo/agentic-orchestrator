package orchestrator

import (
	"testing"

	"github.com/doordash-oss/agentic-orchestrator/internal/agent"
	"github.com/doordash-oss/agentic-orchestrator/internal/config"
)

func TestSkipCoauthorReadsWorkspaceDefault(t *testing.T) {
	t.Parallel()

	o := New(Deps{}, Hooks{})
	if o.skipCoauthor() {
		t.Fatal("missing config omitted the Co-authored-by trailer")
	}

	o.deps.PhaseRunner = &agent.PhaseRunner{Config: &config.Config{}}
	if o.skipCoauthor() {
		t.Fatal("default config omitted the Co-authored-by trailer")
	}

	o.deps.PhaseRunner.Config.Defaults.DisableCoauthorCommits = true
	if !o.skipCoauthor() {
		t.Fatal("disable_coauthor_commits kept the Co-authored-by trailer")
	}
}
