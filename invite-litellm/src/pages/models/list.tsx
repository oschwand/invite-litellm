import { List, TagField, useTable } from "@refinedev/antd";
import { Table } from "antd";
import { useSearchParams } from "react-router";

export interface ModelDeployment {
  id: string;
  model_name: string;
  model_info: {
    mode?: string | null;
    input_cost_per_token?: number | null;
    output_cost_per_token?: number | null;
    max_input_tokens?: number | null;
    max_tokens?: number | null;
  } | null;
}

const perMTok = (value: number | null | undefined) =>
  value == null
    ? "—"
    : `$${(value * 1_000_000).toLocaleString(undefined, {
        maximumFractionDigits: 2,
      })}/Mtok`;

const formatContext = (value: number | null | undefined) =>
  value == null ? "—" : `${Math.round(value / 1000)}k`;

export const ModelList = () => {
  // /models?team_id=<id> filters the list to the models allowed for that
  // team (forwarded to /model/info as the teamId param by the provider).
  const [searchParams] = useSearchParams();
  const teamId = searchParams.get("team_id") ?? undefined;

  const { tableProps } = useTable<ModelDeployment>({
    resource: "models",
    syncWithLocation: true,
    pagination: { mode: "client" },
    meta: { teamId },
  });

  return (
    <List title="Models">
      <Table {...tableProps} rowKey="id">
        <Table.Column<ModelDeployment>
          dataIndex="model_name"
          title="Model"
          render={(value) => (
            <span style={{ fontFamily: "monospace" }}>{value}</span>
          )}
        />
        <Table.Column<ModelDeployment>
          dataIndex={["model_info", "mode"]}
          title="Type"
          render={(value) =>
            value ? <TagField value={value} /> : "—"
          }
        />
        <Table.Column<ModelDeployment>
          dataIndex={["model_info", "input_cost_per_token"]}
          title="In / Mtok"
          render={(value) => perMTok(value)}
        />
        <Table.Column<ModelDeployment>
          dataIndex={["model_info", "output_cost_per_token"]}
          title="Out / Mtok"
          render={(value) => perMTok(value)}
        />
        <Table.Column<ModelDeployment>
          dataIndex={["model_info", "max_input_tokens"]}
          title="Context"
          render={(value, record) =>
            formatContext(value ?? record.model_info?.max_tokens ?? null)
          }
        />
      </Table>
    </List>
  );
};
