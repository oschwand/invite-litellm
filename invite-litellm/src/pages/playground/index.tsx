import { useState } from "react";
import { useDocumentTitle } from "@refinedev/react-router";
import { Alert, Button, Card, Input, Typography } from "antd";
import { getApiUrl } from "../../providers/constants";
import { extractErrorMessage } from "../../providers/session";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const bubbleStyle = (role: ChatMessage["role"]): React.CSSProperties => ({
  alignSelf: role === "user" ? "flex-end" : "flex-start",
  maxWidth: "80%",
  padding: "8px 12px",
  borderRadius: 8,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  background:
    role === "user" ? "rgba(22, 119, 255, 0.15)" : "rgba(0, 0, 0, 0.06)",
});

// Test a virtual key against the proxy: a plain OpenAI-style
// POST /chat/completions, authenticated with the user-pasted key (NOT the
// session key, so exactly the key under test is exercised), sending the
// whole conversation history each turn, non-streaming.
export const Playground = () => {
  useDocumentTitle("Playground");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSend =
    !sending &&
    apiKey.trim() !== "" &&
    model.trim() !== "" &&
    input.trim() !== "";

  const send = async () => {
    if (sending) return;
    const key = apiKey.trim();
    const modelName = model.trim();
    const content = input.trim();
    if (key === "" || modelName === "" || content === "") return;

    const history: ChatMessage[] = [...messages, { role: "user", content }];
    setMessages(history);
    setInput("");
    setError(null);
    setSending(true);
    try {
      const response = await fetch(`${getApiUrl()}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: modelName, messages: history }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setError(
          extractErrorMessage(body) ??
            `Request failed (HTTP ${response.status}).`,
        );
        return;
      }
      const reply = (
        body as { choices?: { message?: { content?: string } }[] } | null
      )?.choices?.[0]?.message?.content;
      if (typeof reply !== "string") {
        setError("The proxy returned an unexpected response.");
        return;
      }
      setMessages((current) => [...current, { role: "assistant", content: reply }]);
    } catch {
      setError(
        `Could not reach the LiteLLM server at ${getApiUrl()}. Is it running?`,
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <Card
      title="Playground"
      extra={
        messages.length > 0 && (
          <Button size="small" onClick={() => setMessages([])}>
            Clear conversation
          </Button>
        )
      }
    >
      <div
        style={{
          display: "flex",
          gap: 12,
          marginBottom: 16,
          flexWrap: "wrap",
        }}
      >
        <Input
          style={{ flex: "1 1 220px", fontFamily: "monospace" }}
          placeholder="Virtual key (sk-…)"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        <Input
          style={{ flex: "1 1 160px" }}
          placeholder="Model (e.g. gpt-4o-mini)"
          value={model}
          onChange={(event) => setModel(event.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      {messages.length > 0 ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            maxHeight: 360,
            overflowY: "auto",
            padding: "8px 0",
            marginBottom: 16,
          }}
        >
          {messages.map((message, index) => (
            <div
              key={index}
              style={{
                ...bubbleStyle(message.role),
                fontFamily: message.role === "assistant" ? "monospace" : undefined,
              }}
            >
              {message.content}
            </div>
          ))}
        </div>
      ) : (
        <Typography.Paragraph type="secondary">
          Send a message to test a virtual key against the proxy.
        </Typography.Paragraph>
      )}

      {error && (
        <Alert
          type="error"
          showIcon
          message={error}
          style={{ marginBottom: 16 }}
        />
      )}

      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <Input.TextArea
          style={{ flex: 1 }}
          rows={2}
          placeholder="Type a message… (Enter to send, Shift+Enter for a new line)"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onPressEnter={(event) => {
            if (!event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <Button
          type="primary"
          disabled={!canSend}
          loading={sending}
          onClick={() => void send()}
        >
          Send
        </Button>
      </div>
    </Card>
  );
};
