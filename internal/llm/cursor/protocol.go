package cursor

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/doordash-oss/agentic-orchestrator/internal/llm"
	"github.com/doordash-oss/agentic-orchestrator/internal/llm/askuser"
)

// Protocol is a Cursor ACP client. The CLI is `cursor-agent acp`: JSON-RPC
// over stdin/stdout, one message per line. https://cursor.com/docs/cli/acp
type Protocol struct {
	opts llm.ProtocolOpts

	mu       sync.Mutex
	stdin    io.Writer
	next     atomic.Int64
	initID   int
	authID   int
	sessID   int
	modelID  int
	promptID int

	initDone     chan struct{}
	authDone     chan struct{}
	sessionReady chan struct{}
	modelDone    chan struct{}
	handshakeErr error

	sessionID    string
	systemSent   bool
	promptActive bool
	queue        []string
	turnText     strings.Builder

	perms map[string]pendingPerm
	asks  map[string]pendingAsk
}

type pendingPerm struct {
	rawID                 json.RawMessage
	allow, always, reject string
}

type pendingAsk struct {
	rawID     json.RawMessage
	questions []askedQuestion
}

type askedQuestion struct {
	id      string
	options map[string]string
}

func newProtocol(opts llm.ProtocolOpts) *Protocol {
	return &Protocol{
		opts:         opts,
		initDone:     make(chan struct{}),
		authDone:     make(chan struct{}),
		sessionReady: make(chan struct{}),
		modelDone:    make(chan struct{}),
		perms:        map[string]pendingPerm{},
		asks:         map[string]pendingAsk{},
	}
}

func (p *Protocol) SetStdin(w io.Writer) {
	p.mu.Lock()
	p.stdin = w
	p.mu.Unlock()
}

func (p *Protocol) Handshake(ctx context.Context) error {
	if err := p.send("initialize", map[string]any{
		"protocolVersion": 1,
		"clientCapabilities": map[string]any{
			"fs":       map[string]bool{"readTextFile": false, "writeTextFile": false},
			"terminal": false,
		},
		"clientInfo": map[string]string{"name": "agentico", "version": "0.1.0"},
	}, &p.initID); err != nil {
		return err
	}
	if err := p.wait(ctx, p.initDone, "initialize"); err != nil {
		return err
	}
	if err := p.send("authenticate", map[string]string{"methodId": "cursor_login"}, &p.authID); err != nil {
		return err
	}
	if err := p.wait(ctx, p.authDone, "authenticate"); err != nil {
		return err
	}
	cwd := p.opts.WorkDir
	if cwd == "" {
		cwd = "."
	}
	if p.opts.ResumeSessionID != "" {
		if err := p.send("session/load", map[string]any{
			"sessionId":  p.opts.ResumeSessionID,
			"cwd":        cwd,
			"mcpServers": []any{},
		}, &p.sessID); err != nil {
			return err
		}
	} else if err := p.send("session/new", map[string]any{
		"cwd":        cwd,
		"mcpServers": []any{},
	}, &p.sessID); err != nil {
		return err
	}
	if err := p.wait(ctx, p.sessionReady, "session"); err != nil {
		return err
	}
	if p.opts.Model != "" {
		p.mu.Lock()
		sid := p.sessionID
		p.mu.Unlock()
		if err := p.send("session/set_model", map[string]string{
			"sessionId": sid,
			"modelId":   p.opts.Model,
		}, &p.modelID); err != nil {
			return err
		}
		if err := p.wait(ctx, p.modelDone, "session/set_model"); err != nil {
			return err
		}
	}
	if p.opts.Interactive && p.opts.InitialPrompt == "" {
		return nil
	}
	p.mu.Lock()
	p.promptActive = true
	p.mu.Unlock()
	return p.sendPrompt(p.opts.InitialPrompt)
}

func (p *Protocol) SendUserMessage(text string) error {
	p.mu.Lock()
	if p.promptActive {
		p.queue = append(p.queue, text)
		p.mu.Unlock()
		return nil
	}
	p.promptActive = true
	p.mu.Unlock()
	return p.sendPrompt(text)
}

func (p *Protocol) RespondToControl(requestID string, allow bool, _ json.RawMessage, _ string) error {
	return p.finishPerm(requestID, allow, false)
}

func (p *Protocol) RespondToControlRemember(requestID string) error {
	return p.finishPerm(requestID, true, true)
}

func (p *Protocol) RespondToHook(string) error { return nil }

func (p *Protocol) RespondToAskUser(requestID string, resolved askuser.Resolved) error {
	p.mu.Lock()
	ask, ok := p.asks[requestID]
	if ok {
		delete(p.asks, requestID)
	}
	p.mu.Unlock()
	if !ok {
		return fmt.Errorf("unknown cursor question %q", requestID)
	}
	answers := make([]map[string]any, 0, len(ask.questions))
	var skipped []string
	for i, q := range ask.questions {
		if i >= len(resolved.Answers) || !resolved.Answers[i].Selected {
			if i < len(resolved.Answers) {
				skipped = append(skipped, resolved.Answers[i].Raw)
			}
			continue
		}
		var ids []string
		for _, label := range resolved.Answers[i].Labels {
			if id := q.options[label]; id != "" {
				ids = append(ids, id)
			}
		}
		if len(ids) == 0 {
			skipped = append(skipped, resolved.Answers[i].Raw)
			continue
		}
		answers = append(answers, map[string]any{"questionId": q.id, "selectedOptionIds": ids})
	}
	if len(answers) == 0 {
		return p.reply(ask.rawID, map[string]any{"outcome": map[string]any{
			"outcome": "skipped",
			"reason":  strings.Join(skipped, "\n"),
		}})
	}
	return p.reply(ask.rawID, map[string]any{"outcome": map[string]any{
		"outcome": "answered",
		"answers": answers,
	}})
}

func (p *Protocol) Interrupt() error {
	p.mu.Lock()
	sid := p.sessionID
	p.mu.Unlock()
	if sid == "" {
		return llm.ErrNotSupported
	}
	return p.writeJSON(map[string]any{
		"jsonrpc": "2.0",
		"method":  "session/cancel",
		"params":  map[string]string{"sessionId": sid},
	})
}

func (p *Protocol) SessionID() string {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.sessionID
}

func (p *Protocol) TranscriptPath() string { return "" }

func (p *Protocol) Close() error { return nil }

func (p *Protocol) ParseLine(line []byte) ([]llm.SDKMessage, error) {
	if len(bytes.TrimSpace(line)) == 0 {
		return nil, nil
	}
	var env struct {
		ID     json.RawMessage `json:"id"`
		Method string          `json:"method"`
		Params json.RawMessage `json:"params"`
		Result json.RawMessage `json:"result"`
		Error  json.RawMessage `json:"error"`
	}
	if err := json.Unmarshal(line, &env); err != nil {
		return nil, nil
	}
	hasID := len(bytes.TrimSpace(env.ID)) > 0 && string(env.ID) != "null"
	if hasID && env.Method == "" {
		return p.handleResponse(env.ID, env.Result, env.Error), nil
	}
	if hasID && env.Method != "" {
		return p.handleRequest(env.ID, env.Method, env.Params), nil
	}
	if env.Method == "session/update" {
		return p.handleUpdate(env.Params), nil
	}
	return nil, nil
}

func (p *Protocol) handleResponse(rawID, result, rpcErr json.RawMessage) []llm.SDKMessage {
	id, ok := parseID(rawID)
	if !ok {
		return nil
	}
	p.mu.Lock()
	initID, authID, sessID, modelID, promptID := p.initID, p.authID, p.sessID, p.modelID, p.promptID
	p.mu.Unlock()
	failed := len(bytes.TrimSpace(rpcErr)) > 0 && string(rpcErr) != "null"
	switch id {
	case initID:
		if failed {
			p.fail(p.initDone, fmt.Errorf("cursor initialize failed: %s", rpcErr))
			return nil
		}
		p.signal(p.initDone)
	case authID:
		if failed {
			p.fail(p.authDone, fmt.Errorf("cursor authenticate failed: %s", rpcErr))
			return nil
		}
		p.signal(p.authDone)
	case sessID:
		if failed {
			p.fail(p.sessionReady, fmt.Errorf("cursor session failed: %s", rpcErr))
			return nil
		}
		var res struct {
			SessionID string `json:"sessionId"`
		}
		_ = json.Unmarshal(result, &res)
		p.mu.Lock()
		switch {
		case res.SessionID != "":
			p.sessionID = res.SessionID
		case p.opts.ResumeSessionID != "":
			p.sessionID = p.opts.ResumeSessionID
		}
		sid := p.sessionID
		model := p.opts.Model
		p.mu.Unlock()
		if sid == "" {
			p.fail(p.sessionReady, fmt.Errorf("cursor session returned no session id"))
			return nil
		}
		p.signal(p.sessionReady)
		return []llm.SDKMessage{root(llm.SDKMessage{
			Type: "system", Subtype: "init",
			Init: &llm.SystemInitMessage{Type: "system", Subtype: "init", SessionID: sid, Model: model},
		})}
	case modelID:
		p.signal(p.modelDone)
	case promptID:
		return p.finishPrompt(failed, result, rpcErr)
	}
	return nil
}

func (p *Protocol) finishPrompt(failed bool, result, rpcErr json.RawMessage) []llm.SDKMessage {
	p.mu.Lock()
	text := p.turnText.String()
	p.turnText.Reset()
	p.promptActive = false
	sid := p.sessionID
	var next string
	if !failed && len(p.queue) > 0 {
		next = p.queue[0]
		p.queue = p.queue[1:]
		p.promptActive = true
	} else if failed {
		p.queue = nil
	}
	p.mu.Unlock()

	msg := llm.SDKMessage{Type: "result", Result: &llm.ResultMessage{Type: "result", SessionID: sid, Result: text}}
	if failed {
		msg.Result.Subtype = "error"
		msg.Result.IsError = true
		msg.Result.Result = strings.TrimSpace(string(rpcErr))
	} else {
		var res struct {
			StopReason string `json:"stopReason"`
		}
		_ = json.Unmarshal(result, &res)
		msg.Result.StopReason = res.StopReason
		switch res.StopReason {
		case "", "end_turn":
			msg.Result.Subtype = "success"
		case "max_tokens", "max_turn_requests":
			msg.Result.Subtype = "success"
			msg.Result.StopReason = "max_tokens"
		default:
			msg.Result.Subtype = "error"
			msg.Result.IsError = true
			if text == "" {
				msg.Result.Result = res.StopReason
			}
		}
	}
	out := []llm.SDKMessage{root(msg)}
	if next != "" {
		if err := p.sendPrompt(next); err != nil {
			out = append(out, root(llm.SDKMessage{Type: "result", Result: &llm.ResultMessage{
				Type: "result", Subtype: "error", IsError: true, SessionID: sid, Result: err.Error(),
			}}))
		}
	}
	return out
}

func (p *Protocol) handleRequest(rawID json.RawMessage, method string, params json.RawMessage) []llm.SDKMessage {
	switch method {
	case "session/request_permission":
		return p.handlePermission(rawID, params)
	case "cursor/ask_question":
		return p.handleAsk(rawID, params)
	case "cursor/create_plan":
		_ = p.reply(rawID, map[string]any{"outcome": map[string]any{"outcome": "accepted"}})
		return nil
	default:
		_ = p.replyError(rawID, -32601, "method not supported")
		return nil
	}
}

func (p *Protocol) handlePermission(rawID, params json.RawMessage) []llm.SDKMessage {
	var req struct {
		ToolCall struct {
			Title    string          `json:"title"`
			Kind     string          `json:"kind"`
			RawInput json.RawMessage `json:"rawInput"`
		} `json:"toolCall"`
		Options []struct {
			OptionID string `json:"optionId"`
			Kind     string `json:"kind"`
		} `json:"options"`
	}
	if err := json.Unmarshal(params, &req); err != nil {
		_ = p.reply(rawID, map[string]any{"outcome": map[string]any{"outcome": "cancelled"}})
		return nil
	}
	allow, always, reject := classifyOptions(req.Options)
	if p.opts.DSP {
		_ = p.reply(rawID, selected(allow))
		return nil
	}
	key := idKey(rawID)
	p.mu.Lock()
	p.perms[key] = pendingPerm{rawID: append(json.RawMessage(nil), rawID...), allow: allow, always: always, reject: reject}
	p.mu.Unlock()
	tool, input := permissionInput(req.ToolCall.Kind, req.ToolCall.Title, req.ToolCall.RawInput)
	return []llm.SDKMessage{root(llm.SDKMessage{
		Type: "control_request", Subtype: "can_use_tool",
		ControlRequest: &llm.ControlRequestMessage{
			Type: "control_request", RequestID: key,
			Request: llm.ControlRequest{Subtype: "can_use_tool", ToolName: tool, Input: input},
		},
	})}
}

func (p *Protocol) handleAsk(rawID, params json.RawMessage) []llm.SDKMessage {
	var req struct {
		Title     string `json:"title"`
		Questions []struct {
			ID            string `json:"id"`
			Prompt        string `json:"prompt"`
			AllowMultiple bool   `json:"allowMultiple"`
			Options       []struct {
				ID    string `json:"id"`
				Label string `json:"label"`
			} `json:"options"`
		} `json:"questions"`
	}
	if err := json.Unmarshal(params, &req); err != nil || len(req.Questions) == 0 {
		_ = p.reply(rawID, map[string]any{"outcome": map[string]any{"outcome": "cancelled"}})
		return nil
	}
	bundle := askuser.Bundle{Questions: make([]askuser.Question, 0, len(req.Questions))}
	stored := make([]askedQuestion, 0, len(req.Questions))
	for _, q := range req.Questions {
		opts := make([]askuser.Option, 0, len(q.Options))
		ids := map[string]string{}
		for _, opt := range q.Options {
			opts = append(opts, askuser.Option{Label: opt.Label, Description: ""})
			ids[opt.Label] = opt.ID
		}
		bundle.Questions = append(bundle.Questions, askuser.Question{
			Header: req.Title, Question: q.Prompt, MultiSelect: q.AllowMultiple, Options: opts,
		})
		stored = append(stored, askedQuestion{id: q.ID, options: ids})
	}
	raw, err := json.Marshal(bundle)
	if err != nil {
		_ = p.reply(rawID, map[string]any{"outcome": map[string]any{"outcome": "cancelled"}})
		return nil
	}
	key := idKey(rawID)
	p.mu.Lock()
	p.asks[key] = pendingAsk{rawID: append(json.RawMessage(nil), rawID...), questions: stored}
	p.mu.Unlock()
	return []llm.SDKMessage{root(llm.SDKMessage{
		Type: "control_request", Subtype: "can_use_tool",
		ControlRequest: &llm.ControlRequestMessage{
			Type: "control_request", RequestID: key,
			Request: llm.ControlRequest{Subtype: "can_use_tool", ToolName: "AskUserQuestion", Input: raw},
		},
	})}
}

func (p *Protocol) handleUpdate(params json.RawMessage) []llm.SDKMessage {
	var upd struct {
		Update struct {
			SessionUpdate string `json:"sessionUpdate"`
			Content       struct {
				Text string `json:"text"`
			} `json:"content"`
			ToolCallID string `json:"toolCallId"`
			Title      string `json:"title"`
			Kind       string `json:"kind"`
		} `json:"update"`
	}
	if json.Unmarshal(params, &upd) != nil {
		return nil
	}
	switch upd.Update.SessionUpdate {
	case "agent_message_chunk":
		text := upd.Update.Content.Text
		if text == "" {
			return nil
		}
		p.mu.Lock()
		p.turnText.WriteString(text)
		accumulated := p.turnText.String()
		p.mu.Unlock()
		return []llm.SDKMessage{root(llm.SDKMessage{
			Type: "assistant", Subtype: "partial",
			Assistant: &llm.AssistantMessage{
				Type: "assistant", Subtype: "partial",
				Message: llm.ConversationMsg{Role: "assistant", Content: []llm.ContentBlock{{Type: "text", Text: accumulated}}},
			},
		})}
	case "tool_call", "tool_call_update":
		name := upd.Update.Kind
		if name == "" {
			name = upd.Update.Title
		}
		return []llm.SDKMessage{root(llm.SDKMessage{
			Type: "tool_progress",
			ToolProgress: &llm.ToolProgressMessage{
				Type: "tool_progress", ToolUseID: upd.Update.ToolCallID, ToolName: name, Summary: upd.Update.Title,
			},
		})}
	default:
		return nil
	}
}

func (p *Protocol) sendPrompt(text string) error {
	p.mu.Lock()
	if p.opts.SystemPrompt != "" && !p.systemSent {
		p.systemSent = true
		if text == "" {
			text = p.opts.SystemPrompt
		} else {
			text = p.opts.SystemPrompt + "\n\n" + text
		}
	}
	sid := p.sessionID
	p.turnText.Reset()
	p.mu.Unlock()
	return p.send("session/prompt", map[string]any{
		"sessionId": sid,
		"prompt":    []map[string]string{{"type": "text", "text": text}},
	}, &p.promptID)
}

func (p *Protocol) send(method string, params any, slot *int) error {
	id := int(p.next.Add(1))
	p.mu.Lock()
	*slot = id
	p.mu.Unlock()
	return p.writeJSON(map[string]any{"jsonrpc": "2.0", "id": id, "method": method, "params": params})
}

func (p *Protocol) finishPerm(requestID string, allow, remember bool) error {
	p.mu.Lock()
	perm, ok := p.perms[requestID]
	if ok {
		delete(p.perms, requestID)
	}
	p.mu.Unlock()
	if !ok {
		return nil
	}
	optionID := perm.reject
	if allow {
		optionID = perm.allow
		if remember && perm.always != "" {
			optionID = perm.always
		}
	}
	if optionID == "" {
		return p.reply(perm.rawID, map[string]any{"outcome": map[string]any{"outcome": "cancelled"}})
	}
	return p.reply(perm.rawID, selected(optionID))
}

func (p *Protocol) reply(rawID json.RawMessage, result any) error {
	return p.writeJSON(map[string]any{"jsonrpc": "2.0", "id": rawID, "result": result})
}

func (p *Protocol) replyError(rawID json.RawMessage, code int, message string) error {
	return p.writeJSON(map[string]any{
		"jsonrpc": "2.0",
		"id":      rawID,
		"error":   map[string]any{"code": code, "message": message},
	})
}

func (p *Protocol) writeJSON(v any) error {
	p.mu.Lock()
	w := p.stdin
	p.mu.Unlock()
	if w == nil {
		return fmt.Errorf("cursor stdin is not set")
	}
	return llm.WriteJSONLine(w, v)
}

func (p *Protocol) wait(ctx context.Context, ch chan struct{}, what string) error {
	select {
	case <-ch:
		p.mu.Lock()
		err := p.handshakeErr
		p.mu.Unlock()
		return err
	case <-ctx.Done():
		return fmt.Errorf("cursor %s: %w", what, ctx.Err())
	}
}

func (p *Protocol) signal(ch chan struct{}) {
	p.mu.Lock()
	defer p.mu.Unlock()
	select {
	case <-ch:
	default:
		close(ch)
	}
}

func (p *Protocol) fail(ch chan struct{}, err error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.handshakeErr == nil {
		p.handshakeErr = err
	}
	select {
	case <-ch:
	default:
		close(ch)
	}
}

func selected(optionID string) map[string]any {
	return map[string]any{"outcome": map[string]any{"outcome": "selected", "optionId": optionID}}
}

func classifyOptions(options []struct {
	OptionID string `json:"optionId"`
	Kind     string `json:"kind"`
}) (allow, always, reject string) {
	for _, opt := range options {
		token := strings.ToLower(opt.Kind + " " + opt.OptionID)
		switch {
		case strings.Contains(token, "allow") && strings.Contains(token, "always"):
			always = opt.OptionID
		case strings.Contains(token, "allow"):
			if allow == "" || strings.Contains(token, "once") {
				allow = opt.OptionID
			}
		case strings.Contains(token, "reject"):
			if reject == "" || strings.Contains(token, "once") {
				reject = opt.OptionID
			}
		}
	}
	if allow == "" {
		allow = "allow-once"
	}
	if always == "" {
		always = "allow-always"
	}
	if reject == "" {
		reject = "reject-once"
	}
	return allow, always, reject
}

func permissionInput(kind, title string, raw json.RawMessage) (string, json.RawMessage) {
	tool := "Tool"
	switch kind {
	case "execute":
		tool = "Bash"
	case "edit":
		tool = "Write"
	case "read":
		tool = "Read"
	case "fetch":
		tool = "WebFetch"
	case "search":
		tool = "WebSearch"
	default:
		if kind != "" {
			tool = kind
		}
	}
	if len(bytes.TrimSpace(raw)) > 0 && raw[0] == '{' {
		return tool, raw
	}
	b, _ := json.Marshal(map[string]string{"detail": title})
	return tool, b
}

func parseID(raw json.RawMessage) (int, bool) {
	var n int
	if json.Unmarshal(raw, &n) != nil {
		return 0, false
	}
	return n, true
}

func idKey(raw json.RawMessage) string {
	raw = bytes.TrimSpace(raw)
	if len(raw) > 0 && raw[0] == '"' {
		var s string
		if json.Unmarshal(raw, &s) == nil {
			return s
		}
	}
	return string(raw)
}

func root(msg llm.SDKMessage) llm.SDKMessage {
	msg.Origin = llm.EventOrigin{Kind: llm.EventOriginRoot}
	msg.OccurredAt = time.Now().UTC()
	if msg.ControlRequest != nil {
		msg.ControlRequest.Origin = msg.Origin
	}
	return msg
}
