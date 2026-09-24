import { DateField } from "@refinedev/antd";
import { useCustom, useGetIdentity, useList } from "@refinedev/core";
import { Card, Col, Row, Table, Tag } from "antd";
import type { LiteLLMIdentity } from "../../providers/auth";
import type { VirtualKey } from "../keys/list";

interface DashboardTeam {
  team_id: string;
  team_alias: string | null;
  max_budget: number | null;
  spend: number | null;
  models: string[] | null;
}

type UserInfoResponse = {
  id?: string;
  teams?: DashboardTeam[];
};

const usd = (value: number | null | undefined) =>
  value == null ? "—" : `$${value.toFixed(2)}`;

export const Dashboard = () => {
  const { data: identity } = useGetIdentity<LiteLLMIdentity>();
  const userId = identity?.id;

  const { query: userQuery } = useCustom<UserInfoResponse>({
    url: "/user/info",
    method: "get",
    config: { query: { user_id: userId ?? "" } },
    queryOptions: { enabled: Boolean(userId) },
  });

  const { query: keysQuery } = useList<VirtualKey>({
    resource: "keys",
    pagination: { currentPage: 1, pageSize: 100 },
    queryOptions: { enabled: Boolean(userId) },
  });

  // dataProvider.custom returns the raw LiteLLM body (same convention as
  // simple-rest), so `teams` sits directly on the query result — not under
  // a nested `.data` despite the CustomResponse typing.
  const teams =
    (userQuery.data as UserInfoResponse | undefined)?.teams ?? [];
  // /key/list is visibility-scoped server-side (internal users see only their
  // own keys) — for admin sessions trim it down to the user's own keys.
  // Filtering client-side on purpose: a server-side user_id filter returns 0
  // keys for env-credential admin sessions (user_id "default_user_id").
  const myKeys = (keysQuery.data?.data ?? []).filter(
    (key) => key.user_id && key.user_id === userId,
  );

  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} xl={12}>
        <Card title="My teams" loading={userQuery.isLoading}>
          <Table<DashboardTeam>
            dataSource={teams}
            rowKey="team_id"
            pagination={false}
            size="small"
          >
            <Table.Column<DashboardTeam>
              dataIndex="team_alias"
              title="Name"
              render={(value) => value || "—"}
            />
            <Table.Column<DashboardTeam>
              dataIndex="max_budget"
              title="Budget"
              render={(value) => (value == null ? "Unlimited" : usd(value))}
            />
            <Table.Column<DashboardTeam>
              dataIndex="spend"
              title="Spend"
              render={(value) => usd(value)}
            />
            <Table.Column<DashboardTeam>
              dataIndex="models"
              title="Models"
              render={(value) =>
                value == null || value.length === 0
                  ? "All models"
                  : `${value.length} model${value.length > 1 ? "s" : ""}`
              }
            />
          </Table>
        </Card>
      </Col>
      <Col xs={24} xl={12}>
        <Card title="My virtual keys" loading={keysQuery.isLoading}>
          <Table<VirtualKey>
            dataSource={myKeys}
            rowKey="id"
            pagination={false}
            size="small"
          >
            <Table.Column<VirtualKey>
              dataIndex="key_alias"
              title="Key"
              render={(value) => value ?? "—"}
            />
            <Table.Column<VirtualKey>
              dataIndex="spend"
              title="Spend"
              render={(value) => usd(value)}
            />
            <Table.Column<VirtualKey>
              dataIndex="max_budget"
              title="Budget"
              render={(value) => (value == null ? "Unlimited" : usd(value))}
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
                value ? <Tag color="red">Blocked</Tag> : <Tag color="green">Active</Tag>
              }
            />
          </Table>
        </Card>
      </Col>
    </Row>
  );
};
