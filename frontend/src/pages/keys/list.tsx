import { DateField, List, TagField, useTable } from "@refinedev/antd";
import { Table } from "antd";
import { Link } from "react-router";
import { isAllModels } from "../../utils/models";
import { KeyRowActions } from "../../components";

export interface VirtualKey {
  id: string;
  token: string;
  key_name: string | null;
  key_alias: string | null;
  user_id: string | null;
  owner_name: string | null;
  team_id: string | null;
  team_name: string | null;
  organization_id: string | null;
  spend: number | null;
  soft_budget: number | null;
  max_budget: number | null;
  budget_duration: string | null;
  budget_fallbacks: Record<string, unknown> | null;
  expires: string | null;
  blocked: boolean | null;
  models: string[] | null;
  aliases: Record<string, string> | null;
  config: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  permissions: Record<string, boolean> | null;
  model_max_budget: Record<string, number> | null;
  allowed_cache_controls: string[] | null;
  allowed_routes: string[] | null;
  key_type: string | null;
  tpm_limit: number | null;
  rpm_limit: number | null;
  max_parallel_requests: number | null;
  model_tpm_limit: Record<string, number> | null;
  model_rpm_limit: Record<string, number> | null;
}

const usd = (value: number | null | undefined) =>
  value == null ? "—" : `$${value.toFixed(2)}`;

export const KeyList = () => {
  const { tableProps } = useTable<VirtualKey>({
    resource: "keys",
    syncWithLocation: true,
  });

  return (
    <List title="Virtual keys">
      <Table {...tableProps} rowKey="id">
        <Table.Column<VirtualKey>
          dataIndex="key_alias"
          title="Name"
          render={(_, record) => record.key_alias ?? "—"}
        />
        <Table.Column<VirtualKey>
          dataIndex="key_name"
          title="Key"
          render={(value) => value ?? "—"}
        />
        <Table.Column<VirtualKey>
          dataIndex="owner_name"
          title="Owner"
          render={(_, record) => record.owner_name ?? record.user_id ?? "—"}
        />
        <Table.Column<VirtualKey>
          dataIndex="team_name"
          title="Team"
          render={(_, record) => record.team_name ?? record.team_id ?? "—"}
        />
        <Table.Column<VirtualKey>
          dataIndex="spend"
          title="Spend"
          render={(value) => usd(value)}
        />
        <Table.Column<VirtualKey>
          dataIndex="max_budget"
          title="Budget"
          render={(value) =>
            value == null ? "Unlimited" : usd(value)
          }
        />
        <Table.Column<VirtualKey>
          dataIndex="expires"
          title="Expires"
          render={(value) =>
            value ? (
              <DateField value={value} format="YYYY-MM-DD HH:mm" />
            ) : (
              "Never"
            )
          }
        />
        <Table.Column<VirtualKey>
          dataIndex="blocked"
          title="Status"
          render={(value) =>
            value ? (
              <TagField value="Blocked" color="red" />
            ) : (
              <TagField value="Active" color="green" />
            )
          }
        />
        <Table.Column<VirtualKey>
          dataIndex="models"
          title="Models"
          render={(value, record) =>
            isAllModels(value) ? (
              <Link
                to={
                  record.team_id
                    ? `/models?team_id=${record.team_id}`
                    : `/models?key_hash=${record.token}`
                }
              >
                All models
              </Link>
            ) : (
              <Link to={`/models?key_hash=${record.token}`}>
                {value.length} model{value.length > 1 ? "s" : ""}
              </Link>
            )
          }
        />
        <Table.Column<VirtualKey>
          title="Actions"
          align="right"
          render={(_, record) => <KeyRowActions record={record} />}
        />
      </Table>
    </List>
  );
};
