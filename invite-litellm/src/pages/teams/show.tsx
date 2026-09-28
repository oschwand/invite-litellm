import { Card, Descriptions, Table } from "antd";
import type { TableColumnsType } from "antd";
import { Link, useParams } from "react-router";
import { useCustom, useGetIdentity, useList } from "@refinedev/core";
import { DateField, List, TagField } from "@refinedev/antd";
import { isAllModels } from "../../utils/models";
import { KeyRowActions } from "../../components";
import type { LiteLLMIdentity } from "../../providers/auth";
import type { VirtualKey } from "../keys/list";

type TeamInfoResponse = {
  id?: string;
  team_info?: {
    team_alias?: string | null;
    max_budget?: number | null;
    spend?: number | null;
    models?: string[] | null;
    team_member_budget_table?: { max_budget?: number | null } | null;
    members_with_roles?: {
      user_id: string;
      user_email: string | null;
      role: string;
    }[] | null;
  } | null;
};

type TeamMemberMe = {
  id?: string;
  role?: string | null;
  spend?: number | null;
  litellm_budget_table?: { max_budget?: number | null } | null;
};

const usd = (value: number | null | undefined) =>
  value == null ? "—" : `$${value.toFixed(2)}`;

// Base columns shared by both tables — antd Table only accepts Column
// children as direct JSX children, so a reusable wrapper component would
// render no columns; plain column arrays work for both. The team-wide
// table additionally shows the Owner column.
const keyColumns: TableColumnsType<VirtualKey> = [
  {
    title: "Name",
    dataIndex: "key_alias",
    render: (_, record) => record.key_alias ?? "—",
  },
  {
    title: "Key",
    dataIndex: "key_name",
    render: (value: string | null) => value ?? "—",
  },
  {
    title: "Spend",
    dataIndex: "spend",
    render: (value: number | null) => usd(value),
  },
  {
    title: "Budget",
    dataIndex: "max_budget",
    render: (value: number | null) =>
      value == null ? "Unlimited" : usd(value),
  },
  {
    title: "Expires",
    dataIndex: "expires",
    render: (value: string | null) =>
      value ? <DateField value={value} format="YYYY-MM-DD HH:mm" /> : "Never",
  },
  {
    title: "Status",
    dataIndex: "blocked",
    render: (value: boolean | null) =>
      value ? (
        <TagField value="Blocked" color="red" />
      ) : (
        <TagField value="Active" color="green" />
      ),
  },
  {
    title: "Models",
    dataIndex: "models",
    render: (value: string[] | null, record) =>
      !value || value.length === 0 || isAllModels(value) ? (
        <Link to="/models">All models</Link>
      ) : (
        <Link to={`/models?key_hash=${record.token}`}>
          {value.length} model{value.length > 1 ? "s" : ""}
        </Link>
      ),
  },
  {
    title: "Actions",
    align: "right",
    render: (_, record) => <KeyRowActions recordId={String(record.id)} />,
  },
];

const teamKeyColumns: TableColumnsType<VirtualKey> = [
  ...keyColumns.slice(0, 2),
  {
    title: "Owner",
    dataIndex: "owner_name",
    render: (_, record) => record.owner_name ?? record.user_id ?? "—",
  },
  ...keyColumns.slice(2),
];

export const TeamShow = () => {
  const { team_id: teamId } = useParams();
  const { data: identity } = useGetIdentity<LiteLLMIdentity>();
  const userId = identity?.id;

  const { query: teamQuery } = useCustom<TeamInfoResponse>({
    url: "/team/info",
    method: "get",
    config: { query: { team_id: teamId } },
    queryOptions: { enabled: Boolean(teamId) },
  });
  const team =
    (teamQuery.data as TeamInfoResponse | undefined)?.team_info ?? null;

  // The caller's role in this team — admins additionally see every key.
  const { query: memberQuery } = useCustom<TeamMemberMe>({
    url: `/team/${teamId}/members/me`,
    method: "get",
    queryOptions: { enabled: Boolean(teamId) },
  });
  const isAdmin =
    (memberQuery.data as TeamMemberMe | undefined)?.role === "admin";
  const mySpend = (memberQuery.data as TeamMemberMe | undefined)?.spend ?? null;
  const myBudget =
    (memberQuery.data as TeamMemberMe | undefined)?.litellm_budget_table
      ?.max_budget ?? null;

  // Team owner(s) = members with the admin role; resolve display names
  // via /user/list (best-effort — non-admin members fall back to the
  // email/id carried by the membership row).
  const admins = (team?.members_with_roles ?? []).filter(
    (member) => member.role === "admin",
  );
  const { query: ownersQuery } = useCustom<{
    users?: { user_id: string; user_alias: string | null; user_email: string | null }[];
  }>({
    url: "/user/list",
    method: "get",
    config: { query: { user_ids: admins.map((m) => m.user_id).join(",") } },
    queryOptions: { enabled: admins.length > 0 },
  });
  const ownerUsers =
    (ownersQuery.data as
      | { users?: { user_id: string; user_alias: string | null; user_email: string | null }[] }
      | undefined)?.users ?? [];
  const teamOwners = admins
    .map((member) => {
      const user = ownerUsers.find((candidate) => candidate.user_id === member.user_id);
      return (
        user?.user_alias ?? user?.user_email ?? member.user_email ?? member.user_id
      );
    })
    .join(", ");

  // Every key of the team in one walk (meta.allPages). The provider forwards
  // the team_id filter to /key/list; "mine" is filtered client-side because
  // a server-side user_id filter returns 0 keys for env-credential admin
  // sessions (user_id "default_user_id").
  const { query: keysQuery } = useList<VirtualKey>({
    resource: "keys",
    pagination: { mode: "off" },
    meta: { allPages: true },
    filters: [{ field: "team_id", operator: "eq", value: teamId }],
    queryOptions: { enabled: Boolean(teamId) },
  });
  const teamKeys = keysQuery.data?.data ?? [];
  const myKeys = userId
    ? teamKeys.filter((key) => key.user_id === userId)
    : [];

  return (
    <>
      <Card
        loading={teamQuery.isLoading}
        title={team?.team_alias ?? "Team"}
        style={{ marginBottom: 16 }}
      >
        <Descriptions size="small" column={{ xs: 1, md: 4 }}>
          <Descriptions.Item label="Team budget">
            {team?.max_budget == null ? "Unlimited" : usd(team.max_budget)}
          </Descriptions.Item>
          <Descriptions.Item label="Default member budget">
            {usd(team?.team_member_budget_table?.max_budget ?? null)}
          </Descriptions.Item>
          <Descriptions.Item label="Team owner">{teamOwners || "—"}</Descriptions.Item>
          <Descriptions.Item label="Total spend">
            {usd(team?.spend ?? null)}
          </Descriptions.Item>
          <Descriptions.Item label="My own spend">
            {memberQuery.isLoading ? "…" : usd(mySpend)}
          </Descriptions.Item>
          <Descriptions.Item label="My own budget">
            {memberQuery.isLoading ? "…" : myBudget == null ? "Unlimited" : usd(myBudget)}
          </Descriptions.Item>
          <Descriptions.Item label="Allowed models">
            {isAllModels(team?.models) ? (
              <Link to="/models">All models</Link>
            ) : (
              <Link to={`/models?team_id=${teamId}`}>
                {team?.models?.length} models
              </Link>
            )}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <List title="My virtual keys">
        <Table<VirtualKey>
          columns={keyColumns}
          dataSource={myKeys}
          rowKey="id"
          size="small"
          pagination={{ pageSize: 10, hideOnSinglePage: true }}
          loading={keysQuery.isLoading}
        />
      </List>

      {isAdmin ? (
        <List title="All keys">
          <Table<VirtualKey>
            columns={teamKeyColumns}
            dataSource={teamKeys}
            rowKey="id"
            size="small"
            pagination={{ pageSize: 10, hideOnSinglePage: true }}
          />
        </List>
      ) : null}
    </>
  );
};
