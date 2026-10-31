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

package skillcatalog

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/doordash-oss/agentic-orchestrator/internal/config"
)

func TestResolveDefaultsShippedOnAndExternalOff(t *testing.T) {
	root := t.TempDir()
	writeSkill(t, filepath.Join(root, "systematic-debugging"), "systematic-debugging", "Use when encountering any bug, before proposing fixes")
	writeSkill(t, filepath.Join(root, "vercel-react-best-practices"), "vercel-react-best-practices", "React and Next.js performance optimization guidelines")

	cat := Resolve(config.SkillsConfig{}, t.TempDir(), t.TempDir(), root)

	goGuide := mustEntry(t, cat, "guideline:go")
	if !goGuide.Enabled || !goGuide.Toggleable || goGuide.Kind != KindGuideline {
		t.Fatalf("go guideline = %+v", goGuide)
	}
	implement := mustEntry(t, cat, "skill:implement")
	if !implement.Enabled || implement.Toggleable {
		t.Fatalf("implement = %+v, want always enabled and not toggleable", implement)
	}
	frontend := mustEntry(t, cat, "skill:frontend-design")
	if !frontend.Enabled || !frontend.Toggleable {
		t.Fatalf("frontend-design = %+v, want enabled and toggleable", frontend)
	}
	debug := mustEntry(t, cat, "external:systematic-debugging")
	if debug.Enabled || !debug.Toggleable || debug.Origin != OriginExternal {
		t.Fatalf("systematic-debugging = %+v, want off until activated", debug)
	}
	if debug.Path != filepath.Join(root, "systematic-debugging", "SKILL.md") {
		t.Fatalf("path = %s", debug.Path)
	}
	if len(cat.ImplicitRoots) != 1 || cat.ImplicitRoots[0] != root {
		t.Fatalf("implicit roots = %+v", cat.ImplicitRoots)
	}
}

func TestResolveHonorsSwitchesAndExtraRoots(t *testing.T) {
	user := t.TempDir()
	writeSkill(t, filepath.Join(user, "react-expert"), "react-expert", "Use when building React applications")
	extra := t.TempDir()
	writeSkill(t, filepath.Join(extra, "systematic-debugging"), "systematic-debugging", "Find the root cause before fixing")
	// A folder that is itself one skill, not a parent of several.
	lone := t.TempDir()
	writeSkill(t, lone, "grill-me", "Interview the user before designing")

	cat := Resolve(config.SkillsConfig{
		Roots:    []string{extra, lone},
		Disabled: []string{"guideline:go", "skill:frontend-design", "skill:implement"},
		Enabled:  []string{"external:systematic-debugging", "external:grill-me"},
	}, t.TempDir(), t.TempDir(), user)

	if mustEntry(t, cat, "guideline:go").Enabled {
		t.Fatal("disabled go guideline is still enabled")
	}
	if mustEntry(t, cat, "skill:frontend-design").Enabled {
		t.Fatal("disabled frontend-design is still enabled")
	}
	if mustEntry(t, cat, "skill:implement").Enabled != true {
		t.Fatal("locking a phase skill off must not stick")
	}
	if !mustEntry(t, cat, "external:systematic-debugging").Enabled {
		t.Fatal("enabled external skill is off")
	}
	if !mustEntry(t, cat, "external:grill-me").Enabled {
		t.Fatal("skill folder that is itself a skill was not found")
	}
	if mustEntry(t, cat, "external:react-expert").Enabled {
		t.Fatal("unlisted external skill defaulted on")
	}

	filter := cat.Filter()
	if !filter.Active || filter.AllowsGuideline("go") || !filter.AllowsGuideline("python") {
		t.Fatalf("guideline filter = %+v", filter)
	}
	if filter.AllowsSkill("frontend-design") || !filter.AllowsSkill("implement") {
		t.Fatal("skill filter did not honor the switch")
	}
	if len(filter.External) != 2 {
		t.Fatalf("external skills in the prompt = %+v", filter.External)
	}
}

func TestResolveSkipsUnreadableRootsAndDuplicateNames(t *testing.T) {
	user := t.TempDir()
	writeSkill(t, filepath.Join(user, "shared"), "shared", "from the user folder")
	extra := t.TempDir()
	writeSkill(t, filepath.Join(extra, "shared"), "shared", "from the extra folder")

	missing := filepath.Join(extra, "missing")
	cat := Resolve(config.SkillsConfig{Roots: []string{extra, missing}}, t.TempDir(), t.TempDir(), user)
	got := mustEntry(t, cat, "external:shared")
	if got.Description != "from the user folder" {
		t.Fatalf("duplicate skill kept %q", got.Description)
	}
	if len(cat.Roots) != 2 || cat.Roots[0] != extra || cat.Roots[1] != missing {
		t.Fatalf("roots = %#v, want the missing folder kept", cat.Roots)
	}
}

func TestPartitionRootsKeepsAConfiguredFolderThatIsMissing(t *testing.T) {
	kept, fresh := PartitionRoots([]string{"/skills/saved"}, []string{"/skills/saved", "/skills/new"})
	if len(kept) != 1 || kept[0] != "/skills/saved" {
		t.Fatalf("kept = %#v", kept)
	}
	if len(fresh) != 1 || fresh[0] != "/skills/new" {
		t.Fatalf("fresh = %#v", fresh)
	}
}

func TestResolveFollowsSkillDirectorySymlinks(t *testing.T) {
	root := t.TempDir()
	target := filepath.Join(t.TempDir(), "real")
	writeSkill(t, target, "linked", "via symlink")
	if err := os.Symlink(target, filepath.Join(root, "linked")); err != nil {
		t.Fatal(err)
	}
	cat := Resolve(config.SkillsConfig{Roots: []string{root}, Enabled: []string{"external:linked"}}, t.TempDir(), t.TempDir(), "")
	got := mustEntry(t, cat, "external:linked")
	if !got.Enabled {
		t.Fatal("linked skill was discovered but left off")
	}
}

func TestResolveOmitsExternalSkillsWhoseIDExceedsTheCatalogLimit(t *testing.T) {
	root := t.TempDir()
	name := strings.Repeat("n", 200)
	writeSkill(t, filepath.Join(root, "long"), name, "too long to cross the desktop catalog")
	cat := Resolve(config.SkillsConfig{Roots: []string{root}}, t.TempDir(), t.TempDir(), "")
	for _, entry := range cat.Entries {
		if entry.Origin == OriginExternal {
			t.Fatalf("kept oversized skill %s", entry.ID)
		}
	}
}

func writeSkill(t *testing.T, dir, name, description string) {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	body := "---\nname: " + name + "\ndescription: " + description + "\ntopics: testing\n---\n\n# " + name + "\n"
	if err := os.WriteFile(filepath.Join(dir, "SKILL.md"), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

func mustEntry(t *testing.T, cat Catalog, id string) Entry {
	t.Helper()
	for _, entry := range cat.Entries {
		if entry.ID == id {
			return entry
		}
	}
	t.Fatalf("catalog missing %s", id)
	return Entry{}
}
