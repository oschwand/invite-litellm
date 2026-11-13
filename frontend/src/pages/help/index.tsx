import { useDocumentTitle } from "@refinedev/react-router";
import { Card, Typography } from "antd";
import { getApiUrl } from "../../providers/constants";

const pythonExample = [
  "from openai import OpenAI",
  "",
  "client = OpenAI(",
  `    base_url="${getApiUrl()}",  # the LiteLLM proxy server`,
  '    api_key="sk-...",             # your virtual key',
  ")",
  "",
  "response = client.chat.completions.create(",
  '    model="gpt-4o-mini",',
  '    messages=[{"role": "user", "content": "Hello!"}],',
  ")",
  "print(response.choices[0].message.content)",
].join("\n");

const codeBlockStyle: React.CSSProperties = {
  fontFamily: "monospace",
  whiteSpace: "pre-wrap",
  wordBreak: "break-all",
  background: "rgba(0, 0, 0, 0.06)",
  borderRadius: 8,
  padding: 16,
  margin: "12px 0",
};

export const Help = () => {
  useDocumentTitle("Help");

  return (
    <Card title="Help">
      <Typography.Title level={4}>
        Calling the proxy from Python
      </Typography.Title>
      <Typography.Paragraph>
        Use any virtual key from the <em>Virtual keys</em> table as the API key
        of a standard OpenAI client, pointing it at this proxy server (
        <Typography.Text code>{getApiUrl()}</Typography.Text>). The proxy
        forwards requests to the real model providers and tracks the spend of
        each key.
      </Typography.Paragraph>
      <div style={codeBlockStyle}>{pythonExample}</div>
      <Typography.Paragraph>
        The proxy speaks the standard OpenAI HTTP API, so any OpenAI-compatible
        client library, in any language, can be used the same way, provided it
        is pointed at the proxy URL (
        <Typography.Text code>{getApiUrl()}</Typography.Text>) with a virtual
        key.
      </Typography.Paragraph>

      <Typography.Title level={4}>How budgets work</Typography.Title>
      <ul>
        <li>
          Every virtual key has a <strong>spend</strong>, counted in US dollars
          by the proxy on each request, and an optional <strong>budget</strong>{" "}
          (USD). Once a key's spend reaches its budget, the proxy rejects
          further requests made with that key. Keys without a budget show{" "}
          <em>No limit</em> in the table.
        </li>
        <li>
          A <strong>team budget</strong> caps the combined spend of all the keys
          belonging to a team. Once the team total is reached, every key of the
          team stops working, even keys with remaining individual budget.
        </li>
        <li>
          A <strong>team member budget</strong> is the default budget
          automatically given to the virtual key created when someone joins the
          team through an invite link. Team admins set it when creating the
          team; it is shown as <em>Member budget</em> in the Teams table.
        </li>
        <li>
          The <em>Spend</em> and <em>Budget</em> columns of the Virtual keys
          table (and the <em>Spend</em> column of the Teams table) always show
          the current values tracked by the proxy. Regenerating a key keeps its
          budget and accumulated spend.
        </li>
      </ul>
    </Card>
  );
};
