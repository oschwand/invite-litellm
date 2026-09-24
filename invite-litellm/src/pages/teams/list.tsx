import { List, useTable } from "@refinedev/antd";
import { Table, Typography } from "antd";

export interface Team {
  id: string;
  team_id: string;
  team_alias: string;
}

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
          render={(value) => value || "—"}
        />
        <Table.Column<Team>
          dataIndex="team_id"
          title="Team ID"
          render={(value) => (
            <Typography.Text copyable style={{ fontFamily: "monospace" }}>
              {value}
            </Typography.Text>
          )}
        />
      </Table>
    </List>
  );
};
