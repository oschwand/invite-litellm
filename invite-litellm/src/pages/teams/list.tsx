import { List, useTable } from "@refinedev/antd";
import { Table } from "antd";
import { Link } from "react-router";
import { isAllModels } from "../../utils/models";

export interface Team {
  id: string;
  team_id: string;
  team_alias: string;
  key_count: number | null;
  max_budget: number | null;
  member_budget: number | null;
  spend: number | null;
  models: string[] | null;
}

const usd = (value: number | null | undefined) =>
  value == null ? "—" : `$${value.toFixed(2)}`;

export const TeamList = () => {
  const { tableProps } = useTable<Team>({
    resource: "teams",
    syncWithLocation: true,
    pagination: { mode: "client" },
  });

  return (
    <List title="Teams">
      <Table {...tableProps} rowKey="id">
        <Table.Column<Team>
          dataIndex="team_alias"
          title="Name"
          render={(value, record) => (
            <Link to={`/team/${record.team_id}`}>{value || "—"}</Link>
          )}
        />
        <Table.Column<Team>
          dataIndex="key_count"
          title="Keys"
          render={(value) => (value == null ? "—" : value)}
        />
        <Table.Column<Team>
          dataIndex="max_budget"
          title="Team budget"
          render={(value) => (value == null ? "Unlimited" : usd(value))}
        />
        <Table.Column<Team>
          dataIndex="member_budget"
          title="Member budget"
          render={(value) => usd(value)}
        />
        <Table.Column<Team>
          dataIndex="spend"
          title="Spend"
          render={(value) => usd(value)}
        />
        <Table.Column<Team>
          dataIndex="models"
          title="Allowed models"
          render={(value, record) =>
            isAllModels(value) ? (
              <Link to="/models">All models</Link>
            ) : (
              <Link to={`/models?team_id=${record.team_id}`}>
                {value.length} models
              </Link>
            )
          }
        />
      </Table>
    </List>
  );
};
