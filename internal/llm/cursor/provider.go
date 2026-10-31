package cursor

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	"github.com/doordash-oss/agentic-orchestrator/internal/llm"
	"github.com/doordash-oss/agentic-orchestrator/internal/llm/clirun"
)

const (
	providerName  = "cursor"
	defaultBinary = "cursor-agent"
)

var ansiRE = regexp.MustCompile(`\x1b\[[0-9;]*m`)

// Provider implements llm.LLMProvider for the Cursor CLI ACP server.
type Provider struct {
	llm.Catalog
	runner clirun.CommandRunner
	binary string
}

func NewProvider(binary string) *Provider {
	p := &Provider{binary: binary}
	p.Catalog = llm.NewCatalog(p.cliBinary(), defaultModelInfos)
	return p
}

func (p *Provider) Name() string { return providerName }

func (p *Provider) cliBinary() string {
	if p.binary != "" {
		return p.binary
	}
	return defaultBinary
}

func (p *Provider) BuildCommand(opts llm.CommandBuildOpts) ([]string, []string, error) {
	args := []string{p.cliBinary()}
	if opts.Model != "" {
		args = append(args, "--model", opts.Model)
	}
	if opts.WorkDir != "" {
		args = append(args, "--workspace", opts.WorkDir)
	}
	args = append(args, "--trust")
	if opts.DangerouslySkipPerms {
		args = append(args, "--force")
	}
	for _, dir := range opts.AdditionalDirs {
		if dir != "" {
			args = append(args, "--add-dir", dir)
		}
	}
	args = append(args, "acp")
	return args, nil, nil
}

func (p *Provider) NewProtocol(opts llm.ProtocolOpts) llm.Protocol {
	return newProtocol(opts)
}

func (p *Provider) InstallHint() string {
	return "curl https://cursor.com/install -fsS | bash"
}

func (p *Provider) VersionInfo() (string, error) {
	bin := p.cliBinary()
	out, err := clirun.VersionProbe(p.runner, bin)
	if err != nil {
		return "", fmt.Errorf("failed to run '%s --version': %w", bin, err)
	}
	return out, nil
}

func (p *Provider) MinVersion() [3]int { return [3]int{0, 0, 0} }

func (p *Provider) EnvVarsToExclude() []string { return nil }

func (p *Provider) SupportsNativeToollessReview() bool { return false }

func (p *Provider) ReviewPreferenceBand(llm.ModelInfo) (int, bool) { return 0, false }

func (p *Provider) RecommendedModels(llm.PhaseRole) []string {
	if p.MatchesModel("auto") {
		return []string{"auto"}
	}
	if models := p.AvailableModels(); len(models) > 0 {
		return []string{models[0]}
	}
	return nil
}

func (p *Provider) AskingQuestionsClause() string {
	return `## Asking Questions

When you need a decision from the user, use your question tool. Ask one question at a time and offer 2-4 mutually exclusive options.

` + llm.RecommendationConfidenceClause
}

func (p *Provider) CheckReadiness(ctx context.Context) llm.ProviderReadiness {
	runner := p.runner
	if runner == nil {
		runner = clirun.DefaultRunner()
	}
	out, runErr := runner(ctx, p.cliBinary(), []string{"status", "--format", "json"}, nil)
	var status struct {
		IsAuthenticated bool   `json:"isAuthenticated"`
		Message         string `json:"message"`
		UserInfo        struct {
			Email string `json:"email"`
		} `json:"userInfo"`
	}
	if err := json.Unmarshal(out, &status); err != nil {
		detail := "could not check authentication"
		if runErr != nil {
			detail = fmt.Sprintf("could not check authentication: %v", runErr)
		}
		return llm.ProviderReadiness{
			Ready:  false,
			Detail: detail,
			Remedy: "Run 'cursor-agent login'",
		}
	}
	if status.IsAuthenticated {
		detail := "authenticated"
		if status.UserInfo.Email != "" {
			detail = "authenticated as " + status.UserInfo.Email
		}
		return llm.ProviderReadiness{Ready: true, Detail: detail}
	}
	detail := status.Message
	if detail == "" {
		detail = "not logged in"
	}
	return llm.ProviderReadiness{
		Ready:  false,
		Detail: detail,
		Remedy: "Run 'cursor-agent login' or set CURSOR_API_KEY",
	}
}

func (p *Provider) DiscoverModelCatalog(ctx context.Context) ([]llm.ModelInfo, error) {
	return p.DiscoverModelCatalogWithProgress(ctx, nil)
}

func (p *Provider) DiscoverModelCatalogWithProgress(ctx context.Context, report llm.ModelDiscoveryReporter) ([]llm.ModelInfo, error) {
	runner := p.runner
	if runner == nil {
		runner = clirun.DefaultRunner()
	}
	out, err := runner(ctx, p.cliBinary(), []string{"models"}, nil)
	if err != nil {
		return nil, fmt.Errorf("running %s models: %w", p.cliBinary(), err)
	}
	models := parseModelList(out)
	if len(models) == 0 {
		return nil, fmt.Errorf("%s models returned no model ids", p.cliBinary())
	}
	if report != nil {
		for _, model := range models {
			report(model)
		}
	}
	return models, nil
}

func parseModelList(out []byte) []llm.ModelInfo {
	text := ansiRE.ReplaceAllString(string(out), "")
	var models []llm.ModelInfo
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		id, name, ok := strings.Cut(line, " - ")
		if !ok || id == "" || strings.Contains(id, " ") {
			continue
		}
		if i := strings.LastIndex(name, " ("); i >= 0 && strings.HasSuffix(name, ")") {
			name = strings.TrimSpace(name[:i])
		}
		if name == "" {
			name = id
		}
		models = append(models, llm.ModelInfo{ID: id, DisplayName: name, Category: "balanced"})
	}
	return models
}

func defaultModelInfos() []llm.ModelInfo {
	return []llm.ModelInfo{{ID: "auto", DisplayName: "Auto", Category: "balanced"}}
}
