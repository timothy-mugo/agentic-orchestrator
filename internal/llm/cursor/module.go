package cursor

import (
	"github.com/doordash-oss/agentic-orchestrator/internal/config"
	"github.com/doordash-oss/agentic-orchestrator/internal/llm"
	"go.uber.org/fx"
)

// Module registers the Cursor provider. An optional CLI override is read from
// providers.cursor.cli.
var Module = fx.Module("llm-cursor",
	fx.Invoke(func(r *llm.Registry, cfg *config.Config) {
		r.Register(NewProvider(cfg.ProviderCLI(providerName, defaultBinary)))
	}),
)
