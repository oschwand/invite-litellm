import { DateField } from "@refinedev/antd";
import { useGetIdentity, useList, useCustom } from "@refinedev/core";
import { InfoCircleOutlined } from "@ant-design/icons";
import { Card, Col, Row, Statistic, Table, Tag, Tooltip } from "antd";
import { Link } from "react-router";
import { isAllModels } from "../../utils/models";
import { KeyRowActions } from "../../components";
import type { LiteLLMIdentity } from "../../providers/auth";
import type { VirtualKey } from "../keys/list";

interface DashboardTeam {
  team_id: string;
  team_alias: string | null;
  models: string[] | null;
}

type UserInfoResponse = {
  id?: string;
  teams?: DashboardTeam[];
  user_info?: {
    spend?: number | null;
    max_budget?: number | null;
  } | null;
};

type TeamMemberMe = {
  id?: string;
  spend?: number | null;
  litellm_budget_table?: { max_budget?: number | null } | null;
};

// The user's own spend within a team, as shown per member in the official
// LiteLLM UI: GET /team/{team_id}/members/me resolves "me" from the
// session key and returns the membership row (spend = current budget
// period, total_spend = lifetime).
const TeamMemberSpend = ({ teamId }: { teamId: string }) => {
  const { query } = useCustom<TeamMemberMe>({
    url: `/team/${teamId}/members/me`,
    method: "get",
  });
  if (query.isLoading || query.isError) return <>—</>;
  const me = query.data as TeamMemberMe | undefined;
  return <>{usd(me?.spend)}</>;
};

// The user's budget within a team: the membership row's budget table
// (litellm_budget_table), i.e. the cap applied to this user's spend in
// this team. No row = no personal cap at team level.
const TeamMemberBudget = ({ teamId }: { teamId: string }) => {
  const { query } = useCustom<TeamMemberMe>({
    url: `/team/${teamId}/members/me`,
    method: "get",
  });
  if (query.isLoading || query.isError) return <>—</>;
  const me = query.data as TeamMemberMe | undefined;
  const budget = me?.litellm_budget_table?.max_budget ?? null;
  return <>{budget == null ? "Unlimited" : usd(budget)}</>;
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
    // Walk every page of /key/list so the aggregation covers the complete
    // key set even on proxies where an admin session sees hundreds of keys.
    pagination: { mode: "off" },
    meta: { allPages: true },
    queryOptions: { enabled: Boolean(userId) },
  });

  // dataProvider.custom returns the raw LiteLLM body (same convention as
  // simple-rest), so `teams` sits directly on the query result — not under
  // a nested `.data` despite the CustomResponse typing.
  const teams =
    (userQuery.data as UserInfoResponse | undefined)?.teams ?? [];
  const myInfo =
    (userQuery.data as UserInfoResponse | undefined)?.user_info ?? null;
  // /key/list is visibility-scoped server-side (internal users see only their
  // own keys) — for admin sessions trim it down to the user's own keys.
  // Filtering client-side on purpose: a server-side user_id filter returns 0
  // keys for env-credential admin sessions (user_id "default_user_id").
  const myKeys = (keysQuery.data?.data ?? []).filter(
    (key) => key.user_id && key.user_id === userId,
  );

  return (
    <Row gutter={[16, 16]}>
      <Col xs={24}>
        <Card loading={userQuery.isLoading}>
          <Row gutter={16}>
            <Col xs={12} md={8}>
              <Statistic
                title="My total spend"
                value={myInfo?.spend ?? 0}
                formatter={(value) => usd(Number(value))}
              />
            </Col>
            <Col xs={12} md={8}>
              <Statistic
                title={
                  <span>
                    My budget{" "}
                    <Tooltip title="This is the global budget limit for your user account. It can be unlimited at this level, while budget limits set at the team level and on individual virtual keys are still enforced.">
                      <InfoCircleOutlined
                        style={{ color: "rgba(0, 0, 0, 0.45)", cursor: "help" }}
                      />
                    </Tooltip>
                  </span>
                }
                value={
                  myInfo?.max_budget == null
                    ? "Unlimited"
                    : `$${myInfo.max_budget.toFixed(2)}`
                }
              />
            </Col>
          </Row>
        </Card>
      </Col>
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
              title="My spend"
              render={(_, record) => <TeamMemberSpend teamId={record.team_id} />}
            />
            <Table.Column<DashboardTeam>
              title="My budget"
              render={(_, record) => <TeamMemberBudget teamId={record.team_id} />}
            />
            <Table.Column<DashboardTeam>
              dataIndex="models"
              title="Models"
              render={(value, record) =>
                isAllModels(value) ? (
                  <Link to="/models">All models</Link>
                ) : (
                  <Link to={`/models?team_id=${record.team_id}`}>
                    {value.length} model{value.length > 1 ? "s" : ""}
                  </Link>
                )
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
              title="Name"
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
            <Table.Column<VirtualKey>
              title="Actions"
              align="right"
              render={(_, record) => (
                <KeyRowActions recordId={String(record.id)} />
              )}
            />
          </Table>
        </Card>
      </Col>
    </Row>
  );
};
