package orchestrator

import (
	"sync"
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

	o = New(Deps{PhaseRunner: &agent.PhaseRunner{Config: &config.Config{}}}, Hooks{})
	if o.skipCoauthor() {
		t.Fatal("default config omitted the Co-authored-by trailer")
	}

	o = New(Deps{PhaseRunner: &agent.PhaseRunner{
		Config: &config.Config{Defaults: config.DefaultsConfig{DisableCoauthorCommits: true}},
	}}, Hooks{})
	if !o.skipCoauthor() {
		t.Fatal("disable_coauthor_commits kept the Co-authored-by trailer")
	}
}

func TestSkipCoauthorTracksRuntimeUpdates(t *testing.T) {
	t.Parallel()

	o := New(Deps{}, Hooks{})

	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		for i := 0; i < 1000; i++ {
			o.SetDisableCoauthorCommits(i%2 == 0)
		}
	}()
	go func() {
		defer wg.Done()
		for i := 0; i < 1000; i++ {
			_ = o.skipCoauthor()
		}
	}()
	wg.Wait()

	o.SetDisableCoauthorCommits(true)
	if !o.skipCoauthor() {
		t.Fatal("runtime update did not disable the Co-authored-by trailer")
	}
	o.SetDisableCoauthorCommits(false)
	if o.skipCoauthor() {
		t.Fatal("runtime update did not restore the Co-authored-by trailer")
	}
}
