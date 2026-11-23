import { Card, Descriptions, Table, Typography } from "antd";
import { useEffect, useState } from "react";
import type { TableColumnsType } from "antd";
import { Link, useParams } from "react-router";
import { useCustom, useGetIdentity, useList } from "@refinedev/core";
import { DateField, EditButton, List, TagField } from "@refinedev/antd";
import { isAllModels } from "../../utils/models";
import { KeyRowActions } from "../../components";
import { backendRequest } from "../../providers/backend";
import type { LiteLLMIdentity } from "../../providers/auth";
import type { VirtualKey } from "../keys/list";

type TeamInfoResponse = {
  id?: string;
  team_info?: {
    team_alias?: string | null;
    max_budget?: number | null;
    spend?: number | null;
    models?: string[] | null;
    metadata?: (Record<string, unknown> & { invite_code?: string | null }) | null;
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

type TeamMemberRow = { user_id: string; user_email: string | null; role: string };
type OwnerUser = { user_id: string; user_alias: string | null; user_email: string | null };

const usd = (value: number | null | undefined) =>
  value == null ? "—" : `$${value.toFixed(4)}`;

// One owner's display name. The proxy gates /user/list behind admin
// rights and refuses cross-user /user/info (403), so a member session
// resolves teammates' aliases through the Python backend's GET /users
// (master key + co-membership check) — best-effort: the membership row's
// email is the last resort, for users that have no alias at all.
const TeamOwnerName = ({
  member,
  ownerUsers,
}: {
  member: TeamMemberRow;
  ownerUsers: OwnerUser[];
}) => {
  const user = ownerUsers.find((candidate) => candidate.user_id === member.user_id);
  const listAlias = user?.user_alias ?? null;
  const [backendAlias, setBackendAlias] = useState<string | null>(null);
  useEffect(() => {
    if (listAlias != null) return;
    let cancelled = false;
    backendRequest<{ users?: { user_id: string; user_alias: string | null }[] }>(
      "/users",
      { query: { user_ids: member.user_id } },
    )
      .then((body) => {
        const found = (body.users ?? []).find(
          (candidate) => candidate.user_id === member.user_id,
        );
        if (!cancelled && found?.user_alias) setBackendAlias(found.user_alias);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [listAlias, member.user_id]);
  return (
    <>
      {listAlias ?? backendAlias ?? user?.user_email ?? member.user_email ?? member.user_id}
    </>
  );
};

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
      ),
  },
  {
    title: "Actions",
    align: "right",
    render: (_, record) => <KeyRowActions record={record} />,
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

  // Invite link — only teams created with an invite code carry one
  // (metadata.invite_code, set at creation by the invite-link form).
  const inviteCode = team?.metadata?.invite_code ?? null;
  const inviteUrl =
    inviteCode && teamId
      ? `${window.location.origin}/invite/${teamId}/${inviteCode}`
      : null;

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

  // Team owner(s) = members with the admin role; /user/list resolves
  // their aliases in one call for admin sessions (members fall through to
  // the per-owner /user/info in TeamOwnerName).
  const admins = ((team?.members_with_roles ?? []) as TeamMemberRow[]).filter(
    (member) => member.role === "admin",
  );
  const { query: ownersQuery } = useCustom<{ users?: OwnerUser[] }>({
    url: "/user/list",
    method: "get",
    config: { query: { user_ids: admins.map((m) => m.user_id).join(",") } },
    queryOptions: { enabled: admins.length > 0 },
    errorNotification: false,
  });
  const ownerUsers =
    (ownersQuery.data as { users?: OwnerUser[] } | undefined)?.users ?? [];

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
        extra={<EditButton resource="teams" recordItemId={teamId} />}
        style={{ marginBottom: 16 }}
      >
        <Descriptions size="small" column={{ xs: 1, md: 4 }}>
          <Descriptions.Item label="Team budget">
            {team?.max_budget == null ? "Unlimited" : usd(team.max_budget)}
          </Descriptions.Item>
          <Descriptions.Item label="Default member budget">
            {usd(team?.team_member_budget_table?.max_budget ?? null)}
          </Descriptions.Item>
          <Descriptions.Item label="Team owner">
            {admins.length === 0
              ? "—"
              : admins.map((member, index) => (
                  <span key={member.user_id}>
                    {index > 0 ? ", " : ""}
                    <TeamOwnerName member={member} ownerUsers={ownerUsers} />
                  </span>
                ))}
          </Descriptions.Item>
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
              <Link to={`/models?team_id=${teamId}`}>All models</Link>
            ) : (
              <Link to={`/models?team_id=${teamId}`}>
                {team?.models?.length} models
              </Link>
            )}
          </Descriptions.Item>
          {inviteUrl ? (
            <Descriptions.Item label="Invite link">
              <Typography.Text
                copyable={{ text: inviteUrl }}
                style={{ fontFamily: "monospace" }}
              >
                <a href={inviteUrl} target="_blank" rel="noopener">
                  {inviteCode}
                </a>
              </Typography.Text>
            </Descriptions.Item>
          ) : null}
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
