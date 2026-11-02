// Copyright 2026 DoorDash, Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

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
