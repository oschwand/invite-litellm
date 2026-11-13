import { List, TagField, useTable } from "@refinedev/antd";
import { Table } from "antd";

export interface LiteLLMUser {
  id: string;
  user_id: string;
  user_alias: string | null;
  user_email: string | null;
  user_role: string | null;
  spend: number | null;
  max_budget: number | null;
}

const usd = (value: number | null | undefined) =>
  value == null ? "—" : `$${value.toFixed(2)}`;

const roleColor = (role: string | null | undefined): string => {
  if (role === "proxy_admin") return "gold";
  if (role === "org_admin") return "purple";
  if (role === "internal_user") return "blue";
  return "default";
};

export const UserList = () => {
  const { tableProps } = useTable<LiteLLMUser>({
    resource: "users",
    syncWithLocation: true,
  });

  return (
    <List title="Users">
      <Table {...tableProps} rowKey="id">
        <Table.Column<LiteLLMUser>
          dataIndex="user_alias"
          title="Name"
          render={(value) => value || "—"}
        />
        <Table.Column<LiteLLMUser>
          dataIndex="user_email"
          title="Email"
          render={(value) => value || "—"}
        />
        <Table.Column<LiteLLMUser>
          dataIndex="user_role"
          title="Role"
          render={(value) =>
            value ? (
              <TagField value={value} color={roleColor(value)} />
            ) : (
              "—"
            )
          }
        />
        <Table.Column<LiteLLMUser>
          dataIndex="spend"
          title="Spend"
          render={(value) => usd(value)}
        />
        <Table.Column<LiteLLMUser>
          dataIndex="max_budget"
          title="Budget"
          render={(value) => (value == null ? "Unlimited" : usd(value))}
        />
      </Table>
    </List>
  );
};
