import { useMemo, useState } from "react";
import { List, TagField, useTable } from "@refinedev/antd";
import { useCustom, useGetIdentity } from "@refinedev/core";
import { SearchOutlined } from "@ant-design/icons";
import { Input, Popover, Table, Tag, Typography } from "antd";
import { Link, useSearchParams } from "react-router";

import { isAllModels } from "../../utils/models";
import { isAdminRole } from "../../providers/access";

export interface ModelDeployment {
  id: string;
  model_name: string;
  model_info: {
    mode?: string | null;
    max_input_tokens?: number | null;
    max_tokens?: number | null;
    [costField: string]: unknown;
  } | null;
}

const usd = (value: number) => `$${value.toFixed(2)}`;

// Cost scaling: per-token/character/audio-token fields are quoted per
// million; image/second/request fields as-is. Cache fields are named
// "..._token_cost" (no "per_") and are per-token too.
const costScale = (field: string): number => {
  if (field.endsWith("per_token")) return 1_000_000;
  if (field.endsWith("per_character")) return 1_000_000;
  if (field.endsWith("per_audio_token")) return 1_000_000;
  if (field.startsWith("cache_") && field.endsWith("_token_cost")) {
    return 1_000_000;
  }
  return 1;
};

const costUnit = (field: string): string => {
  if (field.endsWith("per_audio_token")) return "/M audiotok";
  if (field.endsWith("per_token")) return "/Mtok";
  if (field.endsWith("per_character")) return "/Mchar";
  if (field.startsWith("cache_") && field.endsWith("_token_cost")) {
    return "/Mtok";
  }
  if (field.endsWith("per_image")) return "/image";
  if (field.endsWith("per_second")) return "/s";
  if (field.endsWith("per_request")) return "/request";
  return "";
};

const COST_LABELS: Record<string, string> = {
  input_cost_per_token: "in",
  output_cost_per_token: "out",
  cache_read_input_token_cost: "cache read",
  cache_creation_input_token_cost: "cache write",
  input_cost_per_image: "in",
  output_cost_per_image: "out",
  input_cost_per_second: "in",
  output_cost_per_second: "out",
  input_cost_per_character: "in",
  output_cost_per_character: "out",
  input_cost_per_audio_token: "audio in",
  output_cost_per_audio_token: "audio out",
};

const costLabel = (field: string): string => {
  const generic = field
    .replace(/_?cost_?/g, " ")
    .replace(/_/g, " ")
    .replace(/\binput\b/g, "in")
    .replace(/\boutput\b/g, "out")
    .replace(/\s+/g, " ")
    .trim();
  return COST_LABELS[field] ?? (generic !== "" ? generic : "cost");
};

const INPUT_FIELDS = [
  "input_cost_per_token",
  "input_cost_per_character",
  "input_cost_per_image",
  "input_cost_per_second",
  "input_cost_per_audio_token",
  "input_cost_per_request",
];

const OUTPUT_FIELDS = [
  "output_cost_per_token",
  "output_cost_per_character",
  "output_cost_per_image",
  "output_cost_per_second",
  "output_cost_per_audio_token",
  "output_cost_per_request",
];

interface ResolvedCost {
  amount: number | null;
  unit: string;
}

type CostMap = Record<string, number>;

function collectCosts(info: ModelDeployment["model_info"]): CostMap {
  const costs: CostMap = {};
  for (const [field, value] of Object.entries(info ?? {})) {
    if (!field.includes("cost")) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value === 0) {
      continue;
    }
    costs[field] = value;
  }
  return costs;
}

function pickCost(
  costs: CostMap,
  used: Set<string>,
  fields: string[],
): ResolvedCost {
  for (const field of fields) {
    const value = costs[field];
    if (typeof value === "number" && value !== 0) {
      used.add(field);
      return { amount: value * costScale(field), unit: costUnit(field) };
    }
  }
  return { amount: null, unit: "" };
}

const renderCost = ({ amount, unit }: ResolvedCost) =>
  amount == null ? "—" : `${usd(amount)}${unit}`;

// Resolve the In/Out/Cache columns once per row (first non-zero field wins,
// mirroring the previous Alpine frontend), then list whatever other
// non-zero cost fields remain under "Other".
function resolveCosts(record: ModelDeployment) {
  const costs = collectCosts(record.model_info);
  const used = new Set<string>();
  const input = pickCost(costs, used, INPUT_FIELDS);
  const output = pickCost(costs, used, OUTPUT_FIELDS);
  const cacheRead = pickCost(costs, used, ["cache_read_input_token_cost"]);
  const cacheWrite = pickCost(costs, used, ["cache_creation_input_token_cost"]);
  const extras: string[] = [];
  for (const field of Object.keys(costs).sort()) {
    if (used.has(field)) continue;
    extras.push(
      `${costLabel(field)} ${usd(costs[field] * costScale(field))}${costUnit(field)}`,
    );
  }
  return { input, output, cacheRead, cacheWrite, extras };
}

// Long "Other" cells truncate to a clickable summary that expands (click)
// into a popover listing every extra cost on its own line.
const OtherCosts = ({ parts }: { parts: string[] }) => {
  if (parts.length === 0) return <>—</>;
  const joined = parts.join(" · ");
  if (joined.length <= 40) return <>{joined}</>;
  return (
    <Popover
      title="Other costs"
      trigger="click"
      content={
        <div style={{ maxWidth: 420 }}>
          {parts.map((part) => (
            <div key={part}>{part}</div>
          ))}
        </div>
      }
    >
      <Typography.Link>{parts.length} costs…</Typography.Link>
    </Popover>
  );
};

const formatContext = (value: number | null | undefined) =>
  value == null ? "—" : `${Math.round(value / 1000)}k`;

type TeamInfoResponse = {
  id?: string;
  team_info?: {
    team_alias?: string | null;
    models?: string[] | null;
  } | null;
};

type TeamListItem = {
  team_id: string;
  team_alias?: string | null;
};

// Shared /team/info?team_id=… lookup — both team cells below use it, and
// react-query dedupes the request for the same team.
const useTeamInfoQuery = (teamId: string) =>
  useCustom<TeamInfoResponse>({
    url: "/team/info",
    method: "get",
    config: { query: { team_id: teamId } },
    errorNotification: false,
  });

const TeamAliasCell = ({ team }: { team: TeamListItem }) => {
  const { query } = useTeamInfoQuery(team.team_id);
  const alias =
    (query.data as TeamInfoResponse | undefined)?.team_info?.team_alias ??
    null;
  return (
    <Link to={`/models?team_id=${team.team_id}`}>
      {alias || team.team_alias || team.team_id}
    </Link>
  );
};

// One row of the per-team overview: resolves the team's live allowlist via
// /team/info?team_id=… (best-effort — an erroring team shows no models).
const TeamModelsRow = ({ team }: { team: TeamListItem }) => {
  const { query } = useTeamInfoQuery(team.team_id);
  const models =
    (query.data as TeamInfoResponse | undefined)?.team_info?.models ?? null;

  if (query.isLoading) {
    return <Typography.Text type="secondary">…</Typography.Text>;
  }
  if (isAllModels(models)) {
    return <Link to={`/models?team_id=${team.team_id}`}>All models</Link>;
  }
  return (
    <span>
      {(models ?? []).map((model) => (
        <Tag key={model} style={{ fontFamily: "monospace" }}>
          {model}
        </Tag>
      ))}
    </span>
  );
};

// Model list per team (shown on the unfiltered /models view only).
// /team/list is admin-gated (407 for internal users): when it does not
// resolve, fall back to the signed-in user's own teams, listed in
// /user/info's user_info.teams — /team/info stays callable per team.
const TeamModelsTable = () => {
  const { data: identity } = useGetIdentity<{ id?: string }>();
  const { query: teamListQuery } = useCustom<{ teams?: TeamListItem[] }>({
    url: "/team/list",
    method: "get",
    errorNotification: false,
  });
  const { query: userInfoQuery } = useCustom<{ user_info?: { teams?: string[] } }>({
    url: "/user/info",
    method: "get",
    config: { query: { user_id: identity?.id ?? "" } },
    queryOptions: {
      enabled: Boolean(identity?.id) && !teamListQuery.isSuccess,
    },
    errorNotification: false,
  });

  const adminTeams = teamListQuery.isSuccess
    ? ((teamListQuery.data as { teams?: TeamListItem[] } | undefined)?.teams ??
        [])
    : [];
  const memberTeams: TeamListItem[] = (
    (userInfoQuery.data as { user_info?: { teams?: string[] } } | undefined)
      ?.user_info?.teams ?? []
  ).map((teamId) => ({ team_id: teamId }));
  const teams = teamListQuery.isSuccess ? adminTeams : memberTeams;
  const loading =
    teamListQuery.isLoading ||
    (!teamListQuery.isSuccess && userInfoQuery.isLoading);

  if (!loading && teams.length === 0) return null;

  return (
    <div style={{ marginBottom: 24 }}>
      <Typography.Title level={5} style={{ marginTop: 0 }}>
        Model list by team
      </Typography.Title>
      <Table<TeamListItem>
        rowKey="team_id"
        loading={loading}
        dataSource={teams}
        pagination={false}
        size="small"
      >
        <Table.Column<TeamListItem>
          dataIndex="team_alias"
          title="Team"
          render={(_, record) => <TeamAliasCell team={record} />}
        />
        <Table.Column<TeamListItem>
          title="Models"
          render={(_, record) => <TeamModelsRow team={record} />}
        />
      </Table>
    </div>
  );
};

export const ModelList = () => {
  // /models?team_id=<id> filters by a team's allowlist, /models?key_hash=<h>
  // by a virtual key's own allowlist (the provider resolves both).
  const [searchParams] = useSearchParams();
  const teamId = searchParams.get("team_id") ?? undefined;
  const keyHash = searchParams.get("key_hash") ?? undefined;

  // Non-admin sessions list the models their teams allow (backend GET
  // /models); admins keep the full deployment list via /model/info.
  const { data: identity } = useGetIdentity<{ role?: string }>();
  const adminTier = isAdminRole(identity?.role);

  const { tableProps } = useTable<ModelDeployment>({
    resource: "models",
    syncWithLocation: true,
    pagination: { mode: "client" },
    meta: { teamId, keyHash },
  });

  // Resolve the team's display name for the title when filtering.
  const { query: teamQuery } = useCustom<TeamInfoResponse>({
    url: "/team/info",
    method: "get",
    config: { query: { team_id: teamId } },
    queryOptions: { enabled: Boolean(teamId) },
  });
  const teamName = (
    teamQuery.data as TeamInfoResponse | undefined
  )?.team_info?.team_alias;

  // Resolve the key's record for the title when filtering by key: alias,
  // the masked key (key_name, e.g. "sk-...zfmQ") and its team's name.
  const { query: keyQuery } = useCustom<{
    keys?: {
      key_alias?: string | null;
      key_name?: string | null;
      team_id?: string | null;
    }[];
  }>({
    url: "/key/list",
    method: "get",
    config: { query: { return_full_object: true, key_hash: keyHash, size: 1 } },
    queryOptions: { enabled: Boolean(keyHash) },
  });
  const keyRecord = (
    keyQuery.data as
      | {
          keys?: {
            key_alias?: string | null;
            key_name?: string | null;
            team_id?: string | null;
          }[];
        }
      | undefined
  )?.keys?.[0];

  const keyTeamId = keyRecord?.team_id ?? undefined;
  const { query: keyTeamQuery } = useCustom<TeamInfoResponse>({
    url: "/team/info",
    method: "get",
    config: { query: { team_id: keyTeamId } },
    queryOptions: { enabled: Boolean(keyHash && keyTeamId) },
  });
  const keyTeamName = (
    keyTeamQuery.data as TeamInfoResponse | undefined
  )?.team_info?.team_alias;

  // Free-text filter over the fetched list (name or type), client-side —
  // the models endpoint returns everything in one call anyway.
  const [search, setSearch] = useState("");
  const filteredModels = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const data = tableProps.dataSource ?? [];
    if (needle === "") return tableProps.dataSource;
    return data.filter(
      (model) =>
        model.model_name.toLowerCase().includes(needle) ||
        (model.model_info?.mode ?? "").toLowerCase().includes(needle),
    );
  }, [tableProps.dataSource, search]);

  let title: React.ReactNode = adminTier
    ? "All proxy models"
    : "Models available to your teams";
  if (teamId) {
    title = teamName ?? "Team models";
  } else if (keyHash) {
    title = (
      <span>
        {keyRecord?.key_alias ?? "Key models"}
        {keyRecord?.key_name ? (
          <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
            {keyRecord.key_name}
          </Typography.Text>
        ) : null}
        {keyTeamName ? (
          <Typography.Text type="secondary" style={{ marginLeft: 8 }}>
            · {keyTeamName}
          </Typography.Text>
        ) : null}
      </span>
    );
  }

  return (
    <List
      title={title}
      headerButtons={
        <Input
          allowClear
          placeholder="Filter by name or type"
          prefix={<SearchOutlined style={{ opacity: 0.4 }} />}
          style={{ width: 220 }}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      }
    >
      {teamId == null && keyHash == null ? <TeamModelsTable /> : null}
      <Table {...tableProps} dataSource={filteredModels} rowKey="id">
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
          render={(value) => (value ? <TagField value={value} /> : "—")}
        />
        <Table.Column<ModelDeployment>
          title="In"
          render={(_, record) => renderCost(resolveCosts(record).input)}
        />
        <Table.Column<ModelDeployment>
          title="Out"
          render={(_, record) => renderCost(resolveCosts(record).output)}
        />
        <Table.Column<ModelDeployment>
          title="Cache read"
          render={(_, record) => renderCost(resolveCosts(record).cacheRead)}
        />
        <Table.Column<ModelDeployment>
          title="Cache write"
          render={(_, record) => renderCost(resolveCosts(record).cacheWrite)}
        />
        <Table.Column<ModelDeployment>
          title="Other"
          render={(_, record) => (
            <OtherCosts parts={resolveCosts(record).extras} />
          )}
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
