import { List, TagField, useTable } from "@refinedev/antd";
import { useCustom } from "@refinedev/core";
import { Popover, Table, Typography } from "antd";
import { useSearchParams } from "react-router";

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
  team_info?: { team_alias?: string | null } | null;
};

export const ModelList = () => {
  // /models?team_id=<id> filters the list to the models allowed for that
  // team (the provider fetches the team's allowlist via /team/info).
  const [searchParams] = useSearchParams();
  const teamId = searchParams.get("team_id") ?? undefined;

  const { tableProps } = useTable<ModelDeployment>({
    resource: "models",
    syncWithLocation: true,
    pagination: { mode: "client" },
    meta: { teamId },
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
  const title = !teamId
    ? "All proxy models"
    : (teamName ?? "Team models");

  return (
    <List title={title}>
      <Table {...tableProps} rowKey="id">
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
