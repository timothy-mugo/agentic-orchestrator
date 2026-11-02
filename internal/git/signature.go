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

package git

import "strings"

const (
	// agenticURL is the public repository URL for attribution.
	agenticURL = "https://github.com/doordash-oss/agentic-orchestrator"

	// agenticoCommitEmail is the noreply address Agentico co-authors
	// programmatic commits under. GitHub matches co-author trailers to
	// profiles by email; a noreply address keeps attribution without
	// implying a human mailbox.
	agenticoCommitEmail = "noreply@doordash-oss.github.com"

	// agenticoName is the display name for Agentico's commit attribution.
	agenticoName = "Agentico"

	// commitSignatureTrailer is appended to programmatic commit messages as
	// a git trailer. Uses the Co-authored-by convention so GitHub renders
	// Agentico as a co-author on commits and pull requests.
	commitSignatureTrailer = "Co-authored-by: " + agenticoName + " <" + agenticoCommitEmail + ">"

	// pRSignature is the markdown signature appended to PR bodies and comments.
	pRSignature = "\n\n---\n\n*Generated with [agentic orchestrator](" + agenticURL + ")*"
)

// CommitOptions controls trailer behavior for one programmatic commit.
// The zero value keeps the Co-authored-by trailer.
type CommitOptions struct {
	// SkipCoauthor omits the Co-authored-by trailer. The workspace sets this
	// from defaults.disable_coauthor_commits.
	SkipCoauthor bool
}

func commitOptionsOf(opts []CommitOptions) CommitOptions {
	if len(opts) == 0 {
		return CommitOptions{}
	}
	return opts[0]
}

func applyCommitSignature(message string, opts CommitOptions) string {
	if opts.SkipCoauthor {
		return message
	}
	return message + "\n\n" + commitSignatureTrailer
}

// injectPRSignature appends the agentic orchestrator signature to a PR body or comment.
// Idempotent — skips if the signature is already present.
func injectPRSignature(body string) string {
	if strings.Contains(body, pRSignature) {
		return body
	}
	return body + pRSignature
}
