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

// Package skillcatalog lists the skills and language guidelines an agent can
// be told about, and applies the user's on/off switches.
package skillcatalog

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/doordash-oss/agentic-orchestrator/internal/config"
	"github.com/doordash-oss/agentic-orchestrator/internal/guidelinedef"
	"github.com/doordash-oss/agentic-orchestrator/internal/skilldef"
	"github.com/doordash-oss/agentic-orchestrator/internal/utilskill"
)

const (
	KindSkill      = "skill"
	KindGuideline  = "guideline"
	OriginBuiltin  = "builtin"
	OriginExternal = "external"
)

// DefaultUserSkillsDir is the folder scanned even when the user has not
// added it. An empty string means the home directory could not be resolved.
func DefaultUserSkillsDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".agents", "skills")
}

// Entry is one row in the settings list and one candidate for the prompt.
type Entry struct {
	ID          string
	Name        string
	Description string
	Kind        string
	Origin      string
	Path        string
	Topics      string
	Enabled     bool
	Toggleable  bool
}

// Catalog is the resolved list for one runtime.
type Catalog struct {
	ImplicitRoots []string
	Roots         []string
	Entries       []Entry
}

// ExternalSkill is an enabled skill that lives outside the binary.
type ExternalSkill struct {
	Name        string
	Description string
	Topics      string
	Path        string
	Dir         string
}

// Filter decides which guidance reaches a system prompt.
// A zero Filter leaves the prompt unchanged.
type Filter struct {
	Active             bool
	disabledSkills     map[string]struct{}
	disabledGuidelines map[string]struct{}
	External           []ExternalSkill
}

// AllowsSkill reports whether a built-in skill may be advertised.
func (f Filter) AllowsSkill(name string) bool {
	if !f.Active {
		return true
	}
	_, off := f.disabledSkills[name]
	return !off
}

// AllowsGuideline reports whether a language guideline may be advertised.
func (f Filter) AllowsGuideline(name string) bool {
	if !f.Active {
		return true
	}
	_, off := f.disabledGuidelines[name]
	return !off
}

// Dirs returns the directories of enabled external skills, for read-only mounts.
func (f Filter) Dirs() []string {
	if !f.Active {
		return nil
	}
	dirs := make([]string, 0, len(f.External))
	seen := make(map[string]struct{}, len(f.External))
	for _, skill := range f.External {
		if skill.Dir == "" {
			continue
		}
		if _, ok := seen[skill.Dir]; ok {
			continue
		}
		seen[skill.Dir] = struct{}{}
		dirs = append(dirs, skill.Dir)
	}
	return dirs
}

// Resolve builds the catalog. userSkillsDir is the default folder scanned
// even when it is not listed in policy.Roots; pass "" to skip it.
// skillsDir and guidelinesDir are the reconciled on-disk copies. Missing
// extra roots are skipped so a stale path cannot hide the rest of the list.
func Resolve(policy config.SkillsConfig, skillsDir, guidelinesDir, userSkillsDir string) Catalog {
	disabled := setOf(policy.Disabled)
	enabled := setOf(policy.Enabled)
	optional := setOf(utilskill.All())

	var entries []Entry
	if defs, err := guidelinedef.ParseEmbedded(); err == nil {
		names := sortedKeys(defs)
		for _, name := range names {
			def := defs[name]
			id := "guideline:" + name
			path := ""
			if guidelinesDir != "" {
				path = filepath.Join(guidelinesDir, name, "index.md")
			}
			entries = append(entries, Entry{
				ID:          id,
				Name:        def.Language,
				Description: def.Description,
				Kind:        KindGuideline,
				Origin:      OriginBuiltin,
				Path:        path,
				Enabled:     !has(disabled, id),
				Toggleable:  true,
			})
		}
	}
	if defs, err := skilldef.ParseEmbedded(); err == nil {
		names := sortedSkillKeys(defs)
		for _, name := range names {
			def := defs[name]
			id := "skill:" + name
			_, toggleable := optional[name]
			on := true
			if toggleable {
				on = !has(disabled, id)
			}
			path := ""
			if skillsDir != "" {
				path = filepath.Join(skillsDir, name, "SKILL.md")
			}
			topics := def.Topics
			if topics == "" {
				topics = "—"
			}
			entries = append(entries, Entry{
				ID:          id,
				Name:        def.Name,
				Description: def.Description,
				Kind:        KindSkill,
				Origin:      OriginBuiltin,
				Path:        path,
				Topics:      topics,
				Enabled:     on,
				Toggleable:  toggleable,
			})
		}
	}

	var implicit []string
	var roots []string
	seenSkills := map[string]struct{}{}
	if userSkillsDir != "" {
		if info, err := os.Stat(userSkillsDir); err == nil && info.IsDir() {
			implicit = append(implicit, userSkillsDir)
			entries = append(entries, discoverDir(userSkillsDir, enabled, seenSkills)...)
		}
	}
	for _, root := range policy.Roots {
		info, err := os.Stat(root)
		if err != nil || !info.IsDir() {
			continue
		}
		roots = append(roots, root)
		entries = append(entries, discoverDir(root, enabled, seenSkills)...)
	}

	sort.SliceStable(entries, func(i, j int) bool {
		if entries[i].Kind != entries[j].Kind {
			return entries[i].Kind == KindGuideline
		}
		if entries[i].Origin != entries[j].Origin {
			return entries[i].Origin == OriginBuiltin
		}
		return entries[i].Name < entries[j].Name
	})
	return Catalog{ImplicitRoots: implicit, Roots: roots, Entries: entries}
}

// Filter projects the catalog onto the system prompt.
func (c Catalog) Filter() Filter {
	f := Filter{
		Active:             true,
		disabledSkills:     map[string]struct{}{},
		disabledGuidelines: map[string]struct{}{},
	}
	for _, entry := range c.Entries {
		if entry.Enabled {
			if entry.Origin == OriginExternal {
				f.External = append(f.External, ExternalSkill{
					Name:        entry.Name,
					Description: entry.Description,
					Topics:      entry.Topics,
					Path:        entry.Path,
					Dir:         filepath.Dir(entry.Path),
				})
			}
			continue
		}
		switch {
		case entry.Kind == KindGuideline:
			name := strings.TrimPrefix(entry.ID, "guideline:")
			f.disabledGuidelines[name] = struct{}{}
		case entry.Origin == OriginBuiltin:
			name := strings.TrimPrefix(entry.ID, "skill:")
			f.disabledSkills[name] = struct{}{}
		}
	}
	return f
}

func discoverDir(root string, enabled map[string]struct{}, seen map[string]struct{}) []Entry {
	var entries []Entry
	if entry, ok := skillEntry(root, enabled, seen); ok {
		entries = append(entries, entry)
	}
	children, err := os.ReadDir(root)
	if err != nil {
		return entries
	}
	for _, child := range children {
		if !child.IsDir() {
			continue
		}
		if entry, ok := skillEntry(filepath.Join(root, child.Name()), enabled, seen); ok {
			entries = append(entries, entry)
		}
	}
	return entries
}

func skillEntry(dir string, enabled map[string]struct{}, seen map[string]struct{}) (Entry, bool) {
	path := filepath.Join(dir, "SKILL.md")
	data, err := os.ReadFile(path)
	if err != nil {
		return Entry{}, false
	}
	name, description, topics := parseSkillFrontmatter(string(data), filepath.Base(dir))
	if description == "" {
		return Entry{}, false
	}
	if _, dup := seen[name]; dup {
		return Entry{}, false
	}
	seen[name] = struct{}{}
	id := "external:" + name
	if topics == "" {
		topics = "—"
	}
	_, on := enabled[id]
	return Entry{
		ID:          id,
		Name:        name,
		Description: description,
		Kind:        KindSkill,
		Origin:      OriginExternal,
		Path:        path,
		Topics:      topics,
		Enabled:     on,
		Toggleable:  true,
	}, true
}

func parseSkillFrontmatter(content, fallbackName string) (name, description, topics string) {
	name = fallbackName
	if !strings.HasPrefix(content, "---") {
		return name, "", ""
	}
	rest := content[3:]
	front, _, found := strings.Cut(rest, "---")
	if !found {
		return name, "", ""
	}
	for _, line := range strings.Split(front, "\n") {
		line = strings.TrimSpace(line)
		key, val, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		val = strings.Trim(strings.TrimSpace(val), `"'`)
		switch key {
		case "name":
			if val != "" {
				name = val
			}
		case "description":
			description = val
		case "topics":
			topics = val
		}
	}
	return name, description, topics
}

// CleanRoots checks that every extra skill folder exists and returns the
// symlink-resolved absolute paths. An empty list is valid.
func CleanRoots(roots []string) ([]string, error) {
	if len(roots) == 0 {
		return nil, nil
	}
	out := make([]string, 0, len(roots))
	seen := make(map[string]string, len(roots))
	for _, root := range roots {
		expanded := expandHome(strings.TrimSpace(root))
		info, err := os.Stat(expanded)
		if err != nil {
			return nil, fmt.Errorf("skill folder %s could not be opened", root)
		}
		if !info.IsDir() {
			return nil, fmt.Errorf("skill folder %s is not a directory", root)
		}
		abs, err := filepath.Abs(expanded)
		if err != nil {
			return nil, fmt.Errorf("skill folder %s could not be resolved", root)
		}
		resolved, err := filepath.EvalSymlinks(abs)
		if err != nil {
			return nil, fmt.Errorf("skill folder %s could not be resolved", root)
		}
		if prev, ok := seen[resolved]; ok {
			return nil, fmt.Errorf("skill folder %s names the same directory as %s", root, prev)
		}
		seen[resolved] = root
		out = append(out, resolved)
	}
	return out, nil
}

func expandHome(path string) string {
	if path != "~" && !strings.HasPrefix(path, "~/") {
		return path
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return path
	}
	if path == "~" {
		return home
	}
	return filepath.Join(home, path[2:])
}

func setOf(ids []string) map[string]struct{} {
	out := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		if id != "" {
			out[id] = struct{}{}
		}
	}
	return out
}

func has(set map[string]struct{}, id string) bool {
	_, ok := set[id]
	return ok
}

func sortedKeys(defs map[string]guidelinedef.GuidelineDef) []string {
	names := make([]string, 0, len(defs))
	for name := range defs {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}

func sortedSkillKeys(defs map[string]skilldef.SkillDef) []string {
	names := make([]string, 0, len(defs))
	for name := range defs {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}
