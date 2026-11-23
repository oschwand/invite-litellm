import { useMemo, useState } from "react";
import { List, TagField, useTable } from "@refinedev/antd";
import { useCustom } from "@refinedev/core";
import { SearchOutlined } from "@ant-design/icons";
import { Input, Popover, Table, Typography } from "antd";
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

const usd = (value: number) => `$${value.toFixed(4)}`;

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

// --- Column sorting ------------------------------------------------------
// Comparators are written for ascending: antd negates the result itself for
// descending sorts and passes the active order as the third argument, which
// the numeric comparator uses to keep "—" (missing) values at the bottom in
// BOTH directions instead of letting the negation float them to the top.
type SortOrder = "ascend" | "descend" | null | undefined;

const compareNumbers = (
  a: number | null,
  b: number | null,
  order: SortOrder,
): number => {
  if (a == null && b == null) return 0;
  if (a == null || b == null) {
    const bias = order === "descend" ? -1 : 1;
    return a == null ? bias : -bias;
  }
  return a - b;
};

const compareNames = (a: ModelDeployment, b: ModelDeployment) =>
  a.model_name.localeCompare(b.model_name);

const compareModes = (a: ModelDeployment, b: ModelDeployment) =>
  (a.model_info?.mode ?? "").localeCompare(b.model_info?.mode ?? "");

const contextOf = (record: ModelDeployment): number | null =>
  record.model_info?.max_input_tokens ?? record.model_info?.max_tokens ?? null;

type TeamInfoResponse = {
  id?: string;
  team_info?: {
    team_alias?: string | null;
    models?: string[] | null;
  } | null;
};

export const ModelList = () => {
  // /models?team_id=<id> filters by a team's allowlist, /models?key_hash=<h>
  // by a virtual key's own allowlist (the provider resolves both).
  const [searchParams] = useSearchParams();
  const teamId = searchParams.get("team_id") ?? undefined;
  const keyHash = searchParams.get("key_hash") ?? undefined;
  // The page only exists through team/key links (the sider hides it):
  // without a filter it renders nothing and fetches nothing.
  const hasFilter = teamId != null || keyHash != null;

  const { tableProps, sorters } = useTable<ModelDeployment>({
    resource: "models",
    syncWithLocation: true,
    // Mode "off": Refine's "client" pagination slices the list to the
    // current page inside useList, which would trap sorting and the
    // free-text filter inside that page. With it off, dataSource is the
    // full list and the antd table below paginates locally.
    pagination: { mode: "off" },
    // Mode "off": sort clicks must not refetch — the list arrives in one
    // call and antd sorts the rendered dataSource locally with the column
    // comparators below. The sorter state still rides syncWithLocation, so
    // sorted views stay shareable/reloadable.
    sorters: { mode: "off" },
    meta: { teamId, keyHash },
    queryOptions: { enabled: hasFilter },
  });

  // Local pagination for the antd table (Refine's is disabled above).
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Strict asc/desc toggle: antd's header cycle would add a third "cancel
  // sort" click (asc → desc → unsorted). The controlled sortOrder below plus
  // the onChange wrapper turn that cancel into a flip back to ascending, so
  // every click only ever toggles between the two directions.
  const activeSorter = sorters[0];
  const orderFor = (columnKey: string): "ascend" | "descend" | undefined =>
    activeSorter?.field === columnKey
      ? activeSorter.order === "desc"
        ? "descend"
        : "ascend"
      : undefined;

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

  if (!hasFilter) return null;

  let title: React.ReactNode;
  if (teamId) {
    title = `Models for team ${teamName ?? teamId}`;
  } else {
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
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
      }
    >
      <Table
        {...tableProps}
        dataSource={filteredModels}
        rowKey="id"
        pagination={{
          current: page,
          pageSize,
          onChange: (nextPage, nextSize) => {
            setPage(nextPage);
            setPageSize(nextSize);
          },
        }}
        // antd's default tooltip announces a "cancel sorting" third click;
        // the onChange wrapper below makes every click toggle direction.
        showSorterTooltip={{ title: "Toggle sort direction" }}
        onChange={(pagination, filters, sorter, extra) => {
          // Normalize what antd reports before Refine's handler sees it:
          // - a "cancel sort" click reports no order (and no column
          //   identity) — flip the active column back to ascending;
          // - the column key doubles as the sorter field fallback (Refine
          //   drops sorters that report no field).
          const proposed = Array.isArray(sorter) ? sorter[0] : sorter;
          const next =
            proposed && activeSorter
              ? {
                  ...proposed,
                  columnKey: proposed.columnKey ?? activeSorter.field,
                  field:
                    proposed.field ??
                    proposed.columnKey ??
                    activeSorter.field,
                  order: proposed.order ?? "ascend",
                }
              : sorter;
          tableProps.onChange?.(pagination, filters, next, extra);
        }}
      >
        <Table.Column<ModelDeployment>
          key="model_name"
          dataIndex="model_name"
          title="Model"
          sortOrder={orderFor("model_name")}
          sorter={compareNames}
          render={(value) => (
            <span style={{ fontFamily: "monospace" }}>{value}</span>
          )}
        />
        <Table.Column<ModelDeployment>
          key="mode"
          dataIndex={["model_info", "mode"]}
          title="Type"
          sortOrder={orderFor("mode")}
          sorter={compareModes}
          render={(value) => (value ? <TagField value={value} /> : "—")}
        />
        <Table.Column<ModelDeployment>
          key="input"
          dataIndex="input"
          title="In"
          sortOrder={orderFor("input")}
          sorter={(a, b, order) =>
            compareNumbers(
              resolveCosts(a).input.amount,
              resolveCosts(b).input.amount,
              order,
            )
          }
          render={(_, record) => renderCost(resolveCosts(record).input)}
        />
        <Table.Column<ModelDeployment>
          key="output"
          dataIndex="output"
          title="Out"
          sortOrder={orderFor("output")}
          sorter={(a, b, order) =>
            compareNumbers(
              resolveCosts(a).output.amount,
              resolveCosts(b).output.amount,
              order,
            )
          }
          render={(_, record) => renderCost(resolveCosts(record).output)}
        />
        <Table.Column<ModelDeployment>
          key="cache_read"
          dataIndex="cache_read"
          title="Cache read"
          sortOrder={orderFor("cache_read")}
          sorter={(a, b, order) =>
            compareNumbers(
              resolveCosts(a).cacheRead.amount,
              resolveCosts(b).cacheRead.amount,
              order,
            )
          }
          render={(_, record) => renderCost(resolveCosts(record).cacheRead)}
        />
        <Table.Column<ModelDeployment>
          key="cache_write"
          dataIndex="cache_write"
          title="Cache write"
          sortOrder={orderFor("cache_write")}
          sorter={(a, b, order) =>
            compareNumbers(
              resolveCosts(a).cacheWrite.amount,
              resolveCosts(b).cacheWrite.amount,
              order,
            )
          }
          render={(_, record) => renderCost(resolveCosts(record).cacheWrite)}
        />
        <Table.Column<ModelDeployment>
          key="other"
          dataIndex="other"
          title="Other"
          sortOrder={orderFor("other")}
          sorter={(a, b, order) =>
            compareNumbers(
              resolveCosts(a).extras.length,
              resolveCosts(b).extras.length,
              order,
            )
          }
          render={(_, record) => (
            <OtherCosts parts={resolveCosts(record).extras} />
          )}
        />
        <Table.Column<ModelDeployment>
          key="context"
          dataIndex={["model_info", "max_input_tokens"]}
          title="Context"
          sortOrder={orderFor("context")}
          sorter={(a, b, order) =>
            compareNumbers(contextOf(a), contextOf(b), order)
          }
          render={(value, record) =>
            formatContext(value ?? record.model_info?.max_tokens ?? null)
          }
        />
      </Table>
    </List>
  );
};
