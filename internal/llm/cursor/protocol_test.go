package cursor

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/doordash-oss/agentic-orchestrator/internal/llm"
	"github.com/doordash-oss/agentic-orchestrator/internal/llm/askuser"
)

func TestHandshakeAndPromptResult(t *testing.T) {
	pr, pw := io.Pipe()
	p := newProtocol(llm.ProtocolOpts{
		WorkDir:       "/work",
		Model:         "auto",
		SystemPrompt:  "be brief",
		InitialPrompt: "hello",
	})
	p.SetStdin(pw)
	var prompt string
	done := make(chan struct{})
	go func() {
		defer close(done)
		sc := bufio.NewScanner(pr)
		for sc.Scan() {
			var req struct {
				ID     int             `json:"id"`
				Method string          `json:"method"`
				Params json.RawMessage `json:"params"`
			}
			if json.Unmarshal(sc.Bytes(), &req) != nil {
				continue
			}
			if req.Method == "session/prompt" {
				var params struct {
					Prompt []struct {
						Text string `json:"text"`
					} `json:"prompt"`
				}
				_ = json.Unmarshal(req.Params, &params)
				if len(params.Prompt) > 0 {
					prompt = params.Prompt[0].Text
				}
				return
			}
			result := map[string]any{}
			if req.Method == "session/new" {
				result["sessionId"] = "sess-1"
			}
			raw, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": req.ID, "result": result})
			p.ParseLine(raw)
		}
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := p.Handshake(ctx); err != nil {
		t.Fatalf("Handshake() error: %v", err)
	}
	if p.SessionID() != "sess-1" {
		t.Fatalf("SessionID() = %q", p.SessionID())
	}
	msgs, _ := p.ParseLine([]byte(`{"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"Hi"}}}}`))
	if len(msgs) != 1 || msgs[0].Assistant == nil || msgs[0].Assistant.Message.Content[0].Text != "Hi" {
		t.Fatalf("chunk = %+v", msgs)
	}
	msgs, _ = p.ParseLine([]byte(fmt.Sprintf(`{"jsonrpc":"2.0","id":%d,"result":{"stopReason":"end_turn"}}`, p.promptID)))
	if len(msgs) != 1 || !msgs[0].Result.IsSuccess() || msgs[0].Result.Result != "Hi" {
		t.Fatalf("result = %+v", msgs)
	}
	pw.Close()
	select {
	case <-done:
	case <-ctx.Done():
		t.Fatal("reader did not finish")
	}
	if prompt != "be brief\n\nhello" {
		t.Fatalf("prompt = %q", prompt)
	}
}

func TestPermissionAndQuestion(t *testing.T) {
	var buf bytes.Buffer
	p := newProtocol(llm.ProtocolOpts{})
	p.SetStdin(&buf)

	msgs, _ := p.ParseLine([]byte(`{"jsonrpc":"2.0","id":7,"method":"session/request_permission","params":{"toolCall":{"kind":"execute","title":"ls","rawInput":{"command":"ls"}},"options":[{"optionId":"allow-once","kind":"allow_once"},{"optionId":"reject-once","kind":"reject_once"}]}}`))
	if len(msgs) != 1 || msgs[0].ControlRequest == nil || msgs[0].ControlRequest.Request.ToolName != "Bash" {
		t.Fatalf("permission = %+v", msgs)
	}
	if err := p.RespondToControl(msgs[0].ControlRequest.RequestID, true, nil, ""); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(buf.String(), `"optionId":"allow-once"`) {
		t.Fatalf("allow response = %s", buf.String())
	}

	buf.Reset()
	msgs, _ = p.ParseLine([]byte(`{"jsonrpc":"2.0","id":8,"method":"cursor/ask_question","params":{"title":"Scope","questions":[{"id":"q1","prompt":"Which?","options":[{"id":"a","label":"A"},{"id":"b","label":"B"}]}]}}`))
	if len(msgs) != 1 || msgs[0].ControlRequest.Request.ToolName != "AskUserQuestion" {
		t.Fatalf("question = %+v", msgs)
	}
	bundle, err := askuser.Parse(msgs[0].ControlRequest.Request.Input)
	if err != nil {
		t.Fatal(err)
	}
	resolved, err := bundle.Resolve(map[string]string{"1": "A"})
	if err != nil {
		t.Fatal(err)
	}
	if err := p.RespondToAskUser(msgs[0].ControlRequest.RequestID, resolved); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(buf.String(), `"questionId":"q1"`) || !strings.Contains(buf.String(), `"a"`) {
		t.Fatalf("answer = %s", buf.String())
	}
}

func TestSkipPermissionsAutoAllows(t *testing.T) {
	var buf bytes.Buffer
	p := newProtocol(llm.ProtocolOpts{DSP: true})
	p.SetStdin(&buf)
	msgs, _ := p.ParseLine([]byte(`{"jsonrpc":"2.0","id":3,"method":"session/request_permission","params":{"toolCall":{"kind":"edit","title":"write"},"options":[{"optionId":"allow-once","kind":"allow_once"}]}}`))
	if len(msgs) != 0 {
		t.Fatalf("DSP permission surfaced %+v", msgs)
	}
	if !strings.Contains(buf.String(), `"optionId":"allow-once"`) {
		t.Fatalf("auto-allow = %s", buf.String())
	}
}
