// Package cursorsession restores Supervisor history for Cursor by writing
// the same plain-text seed OpenCode uses. Cursor ACP cannot accept a session
// rebuilt by a third party, so a relaunch starts a new session and the
// protocol delivers this seed with the first prompt.
package cursorsession

import (
	"context"

	"github.com/doordash-oss/agentic-orchestrator/internal/llm"
	"github.com/doordash-oss/agentic-orchestrator/internal/supervisor"
	"github.com/doordash-oss/agentic-orchestrator/internal/supervisor/opencodesession"
)

// Harness is the harness name this converter is registered under.
const Harness = "cursor"

const seedFileName = "cursor-history-seed.txt"

// Options configures a Converter.
type Options struct {
	// ContextWindow reports the model's context window in tokens from the
	// model catalog. Nil, or a result of zero or less, uses the seed default.
	ContextWindow func(model string) int
}

// Converter implements supervisor.Converter for Cursor by writing a history seed.
type Converter struct {
	opts Options
}

var (
	_ supervisor.Converter     = (*Converter)(nil)
	_ supervisor.HistorySeeder = (*Converter)(nil)
)

// New returns a Cursor history-seed converter.
func New(opts Options) *Converter {
	return &Converter{opts: opts}
}

// RegistryContextWindow looks the model's context window up in the catalog
// of the registry's Cursor provider. It reports 0 when the model is unknown.
func RegistryContextWindow(reg *llm.Registry) func(model string) int {
	return func(model string) int {
		if reg == nil {
			return 0
		}
		provider := reg.ByName(Harness)
		if provider == nil {
			return 0
		}
		return provider.ContextWindowForModel(model)
	}
}

// Harness reports "cursor".
func (c *Converter) Harness() string { return Harness }

// SeedsHistory reports true: Cursor receives history as a seed and does not
// resume a third-party session file.
func (c *Converter) SeedsHistory() bool { return true }

// Rebuild writes the seed under in.ConversationDir.
func (c *Converter) Rebuild(ctx context.Context, in supervisor.RebuildInput) (supervisor.RebuildResult, error) {
	return opencodesession.WriteSeed(ctx, in, opencodesession.Options{
		ContextWindow: c.opts.ContextWindow,
		Harness:       Harness,
	}, seedFileName)
}
