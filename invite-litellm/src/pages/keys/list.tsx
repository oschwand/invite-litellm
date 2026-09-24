import {
  DateField,
  DeleteButton,
  List,
  TagField,
  useTable,
} from "@refinedev/antd";
import { Table } from "antd";

export interface VirtualKey {
  id: string;
  token: string;
  key_name: string | null;
  key_alias: string | null;
  user_id: string | null;
  team_id: string | null;
  spend: number | null;
  max_budget: number | null;
  expires: string | null;
  blocked: boolean | null;
  models: string[] | null;
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
          render={(_, record) => record.key_alias ?? record.key_name ?? "—"}
        />
        <Table.Column<VirtualKey>
          dataIndex="user_id"
          title="Owner"
          render={(value) => value || "—"}
        />
        <Table.Column<VirtualKey>
          dataIndex="team_id"
          title="Team"
          render={(value) => value || "—"}
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
          render={(value) =>
            value == null || value.length === 0
              ? "All models"
              : `${value.length} model${value.length > 1 ? "s" : ""}`
          }
        />
        <Table.Column<VirtualKey>
          title="Actions"
          align="right"
          render={(_, record) => (
            <DeleteButton type="text" recordItemId={record.id} />
          )}
        />
      </Table>
    </List>
  );
};
