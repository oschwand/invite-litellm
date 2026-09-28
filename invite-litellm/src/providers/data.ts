import type {
  BaseRecord,
  CreateParams,
  CreateResponse,
  CrudFilter,
  CrudSort,
  DataProvider,
  DeleteOneParams,
  DeleteOneResponse,
  GetListParams,
  GetListResponse,
  GetOneParams,
  GetOneResponse,
  LogicalFilter,
  UpdateParams,
  UpdateResponse,
} from "@refinedev/core";
import { API_URL } from "./constants";
import { isAllModels } from "../utils/models";
import { LiteLLMError, litellmRequest, type QueryValue } from "./litellm";

// ---------------------------------------------------------------------------
// LiteLLM API response shapes (verified against a live proxy v1.100.x — the
// OpenAPI spec leaves most of these untyped). See ../frontend/AGENTS.md for
// the field-level documentation of key objects.
// ---------------------------------------------------------------------------

type LiteLLMRecord = Record<string, unknown>;

interface KeyListResponse {
  keys?: LiteLLMRecord[];
  total_count?: number;
  total_pages?: number;
}

interface UserListResponse {
  users?: LiteLLMRecord[];
  total?: number;
}

interface ModelInfoResponse {
  data?: LiteLLMRecord[];
}

// Server-side filterable query params per resource (list endpoints).
const KEY_LIST_FILTERS: Record<string, string> = {
  user_id: "user_id",
  team_id: "team_id",
  organization_id: "organization_id",
  key_alias: "key_alias",
  status: "status",
  expires: "expires",
};

const USER_LIST_FILTERS: Record<string, string> = {
  role: "role",
  team_id: "team",
  user_email: "user_email",
};

// Refine filter -> LiteLLM query params (exact-match fields only).
function filtersToQuery(
  filters: CrudFilter[] | undefined,
  mapping: Record<string, string>,
): Record<string, QueryValue> {
  const query: Record<string, QueryValue> = {};
  for (const filter of filters ?? []) {
    if ("field" in filter && filter.operator === "eq" && mapping[filter.field]) {
      query[mapping[filter.field]] = String(filter.value);
    }
  }
  return query;
}

function sorterToQuery(
  sorters: CrudSort[] | undefined,
): Record<string, QueryValue> {
  const sorter = sorters?.[0];
  if (!sorter) return {};
  return { sort_by: sorter.field, sort_order: sorter.order };
}

// Client-side sorting/filtering for endpoints that return the full list in
// one shot (/team/list, /model/info).
function applyClientSide(
  records: LiteLLMRecord[],
  sorters: CrudSort[] | undefined,
  filters: LogicalFilter[],
): LiteLLMRecord[] {
  let result = [...records];
  for (const filter of filters) {
    const expected = filter.value;
    result = result.filter((record) => {
      const actual = record[filter.field];
      if (filter.operator === "eq") return actual === expected;
      if (filter.operator === "ne") return actual !== expected;
      if (filter.operator === "contains") {
        return String(actual ?? "")
          .toLowerCase()
          .includes(String(expected ?? "").toLowerCase());
      }
      if (filter.operator === "null") return actual == null;
      return true;
    });
  }
  const sorter = sorters?.[0];
  if (sorter) {
    result.sort((a, b) => {
      const av = a[sorter.field];
      const bv = b[sorter.field];
      const cmp =
        av === bv ? 0 : av == null ? -1 : bv == null ? 1 : av > bv ? 1 : -1;
      return sorter.order === "desc" ? -cmp : cmp;
    });
  }
  return result;
}

function logicalFilters(filters: CrudFilter[] | undefined): LogicalFilter[] {
  return (filters ?? []).filter((filter): filter is LogicalFilter =>
    "field" in filter === true,
  );
}

function withId(record: LiteLLMRecord, idField: string): LiteLLMRecord {
  return { ...record, id: String(record[idField] ?? record.id ?? "") };
}

// Resolve user ids to display names (alias, falling back to email) via a
// single /user/list?user_ids=a,b,c call. Best-effort: unresolvable ids are
// simply absent from the map (callers fall back to the raw id).
async function resolveUserNames(
  userIds: string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  // Chunk to keep the user_ids query param within URL limits.
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += 50) {
    chunks.push(ids.slice(index, index + 50));
  }
  try {
    const maps = await Promise.all(
      chunks.map((chunk) =>
        litellmRequest<UserListResponse>("/user/list", {
          query: { user_ids: chunk.join(",") },
        }),
      ),
    );
    const map = new Map<string, string>();
    for (const body of maps) {
      for (const user of body.users ?? []) {
        const id = String(user.user_id ?? "");
        const name =
          (user.user_alias as string | null) ??
          (user.user_email as string | null) ??
          "";
        if (id && name) map.set(id, name);
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

// Resolve team ids to names: /team/list (admin-only, one call) first, then
// per-team /team/info for anything still missing (works for team members).
async function resolveTeamNames(
  teamIds: string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(teamIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  const map = new Map<string, string>();
  try {
    const teams = await litellmRequest<LiteLLMRecord[]>("/team/list", {});
    for (const team of teams) {
      const id = String(team.team_id ?? "");
      const alias = String(team.team_alias ?? "");
      if (id && alias) map.set(id, alias);
    }
  } catch {
    // /team/list is admin-only — fall through to /team/info lookups.
  }
  await Promise.all(
    ids
      .filter((id) => !map.has(id))
      .map(async (id) => {
        try {
          const body = await litellmRequest<{ team_info?: LiteLLMRecord }>(
            "/team/info",
            { query: { team_id: id } },
          );
          const alias = String(body.team_info?.team_alias ?? "");
          if (alias) map.set(id, alias);
        } catch {
          // unresolved — callers fall back to the raw team id
        }
      }),
  );
  return map;
}

function assertSupportedResource(resource: string) {
  if (!["keys", "teams", "users", "models"].includes(resource)) {
    throw new LiteLLMError(
      `Unknown resource "${resource}" — expected keys, teams, users or models.`,
      400,
    );
  }
}

export const dataProvider: DataProvider = {
  getList: async <TData extends BaseRecord = BaseRecord>(
    params: GetListParams,
  ): Promise<GetListResponse<TData>> => {
    const { resource, pagination, sorters, filters, meta } = params;
    assertSupportedResource(resource);
    const currentPage = pagination?.currentPage ?? 1;
    const pageSize = pagination?.pageSize ?? 10;
    const onlyLogical = logicalFilters(filters);

    if (resource === "keys") {
      const baseQuery: Record<string, QueryValue> = {
        return_full_object: true,
        ...filtersToQuery(filters, KEY_LIST_FILTERS),
        ...sorterToQuery(sorters),
      };

      let keys: LiteLLMRecord[] = [];
      let totalCount = 0;

      if ((meta as { allPages?: boolean } | undefined)?.allPages === true) {
        // Walk every page (hard cap 20 x 100 keys) so callers like the
        // dashboard can aggregate over the complete key set — an admin
        // session's own keys can sit far beyond page 1 on a busy proxy.
        // Page 1 reveals total_pages; the remaining pages load in parallel.
        const first = await litellmRequest<KeyListResponse>("/key/list", {
          query: { ...baseQuery, page: 1, size: 100 },
        });
        keys = [...(first.keys ?? [])];
        totalCount = first.total_count ?? keys.length;
        const totalPages = Math.min(first.total_pages ?? 1, 20);
        const rest = await Promise.all(
          Array.from({ length: Math.max(0, totalPages - 1) }, (_, index) =>
            litellmRequest<KeyListResponse>("/key/list", {
              query: { ...baseQuery, page: index + 2, size: 100 },
            }),
          ),
        );
        for (const body of rest) {
          keys.push(...(body.keys ?? []));
        }
      } else {
        const body = await litellmRequest<KeyListResponse>("/key/list", {
          query: { ...baseQuery, page: currentPage, size: Math.min(pageSize, 100) },
        });
        keys = body.keys ?? [];
        totalCount = body.total_count ?? keys.length;
      }
      // Resolve owner/team ids to display names (best-effort, in parallel).
      const [userNames, teamNames] = await Promise.all([
        resolveUserNames(keys.map((key) => String(key.user_id ?? ""))),
        resolveTeamNames(keys.map((key) => String(key.team_id ?? ""))),
      ]);
      const enriched = keys.map((key) => ({
        ...key,
        owner_name: userNames.get(String(key.user_id ?? "")) ?? null,
        team_name: teamNames.get(String(key.team_id ?? "")) ?? null,
      }));
      return {
        data: enriched.map((key) => withId(key, "token")) as TData[],
        total: totalCount,
      };
    }

    if (resource === "users") {
      const body = await litellmRequest<UserListResponse>("/user/list", {
        query: {
          page: currentPage,
          page_size: Math.min(pageSize, 100),
          ...filtersToQuery(filters, USER_LIST_FILTERS),
          ...sorterToQuery(sorters),
        },
      });
      const users = body.users ?? [];
      return {
        data: users.map((user) => withId(user, "user_id")) as TData[],
        total: body.total ?? users.length,
      };
    }

    if (resource === "teams") {
      const teams = await litellmRequest<LiteLLMRecord[]>("/team/list", {
        query: filtersToQuery(filters, { user_id: "user_id" }),
      });
      // /team/list returns only {team_id, team_alias} — enrich each row via
      // /team/info in parallel, best-effort (missing fields stay null).
      const enriched = await Promise.all(
        teams.map(async (team) => {
          try {
            const body = await litellmRequest<{
              team_info?: LiteLLMRecord;
              keys?: LiteLLMRecord[];
            }>("/team/info", { query: { team_id: String(team.team_id) } });
            const info = body.team_info ?? {};
            const memberBudget = info.team_member_budget_table as
              | { max_budget?: number | null }
              | null
              | undefined;
            return {
              ...team,
              key_count: Array.isArray(body.keys) ? body.keys.length : null,
              max_budget: (info.max_budget as number | null) ?? null,
              member_budget: memberBudget?.max_budget ?? null,
              spend: (info.spend as number | null) ?? null,
              models: (info.models as string[] | null) ?? null,
            };
          } catch {
            return {
              ...team,
              key_count: null,
              max_budget: null,
              member_budget: null,
              spend: null,
              models: null,
            };
          }
        }),
      );
      const list = applyClientSide(enriched, sorters, onlyLogical);
      return {
        data: list.map((team) => withId(team, "team_id")) as TData[],
        total: list.length,
      };
    }

    // models — when meta.teamId is set (linked from a team's Models cell),
    // fetch the team's allowlist via /team/info and filter by model_name.
    // meta.keyHash does the same for a virtual key's own allowlist (linked
    // from the keys page) via /key/list?key_hash. The /model/info?teamId
    // server param is NOT usable for this: it filters by deployment access
    // (direct_access / access_via_team_ids), not by the allowed-models
    // list. Unrestricted (models null/empty or just "all-proxy-models")
    // gets the full list.
    const teamId = (meta as { teamId?: string } | undefined)?.teamId;
    const keyHash = (meta as { keyHash?: string } | undefined)?.keyHash;
    let allowedModels: string[] | undefined;
    if (teamId) {
      const teamBody = await litellmRequest<{
        team_info?: { models?: string[] | null };
      }>("/team/info", { query: { team_id: teamId } });
      const teamModels = teamBody.team_info?.models ?? null;
      if (teamModels && !isAllModels(teamModels)) {
        allowedModels = teamModels;
      }
    } else if (keyHash) {
      const keyBody = await litellmRequest<KeyListResponse>("/key/list", {
        query: { return_full_object: true, key_hash: keyHash, size: 1 },
      });
      const keyModels = (keyBody.keys?.[0]?.models as string[] | null) ?? null;
      if (keyModels && !isAllModels(keyModels)) {
        allowedModels = keyModels;
      }
    }
    const body = await litellmRequest<ModelInfoResponse>("/model/info", {});
    const models = allowedModels
      ? (body.data ?? []).filter((model) =>
          allowedModels!.includes(String(model.model_name ?? "")),
        )
      : (body.data ?? []);
    const list = applyClientSide(models, sorters, onlyLogical);
    return {
      data: list.map((model) => withId(model, "model_name")) as TData[],
      total: list.length,
    };
  },

  getOne: async <TData extends BaseRecord = BaseRecord>(
    params: GetOneParams,
  ): Promise<GetOneResponse<TData>> => {
    const { resource, id } = params;
    assertSupportedResource(resource);
    const key = String(id);

    if (resource === "keys") {
      // Look up by key hash via /key/list's key_hash filter — deterministic
      // with the hashes /key/list returns (unlike /key/info, which expects
      // the raw key).
      const body = await litellmRequest<KeyListResponse>("/key/list", {
        query: { return_full_object: true, key_hash: key, size: 1 },
      });
      const info = body.keys?.[0];
      if (!info) {
        throw new LiteLLMError(`Key "${key}" was not found.`, 404);
      }
      return { data: withId(info, "token") as TData };
    }

    if (resource === "teams") {
      const body = await litellmRequest<{ team_info?: LiteLLMRecord }>(
        "/team/info",
        { query: { team_id: key } },
      );
      return { data: withId(body.team_info ?? {}, "team_id") as TData };
    }

    if (resource === "users") {
      const body = await litellmRequest<LiteLLMRecord>("/user/info", {
        query: { user_id: key },
      });
      const info = (body.user_info as LiteLLMRecord | undefined) ?? body;
      return { data: withId(info, "user_id") as TData };
    }

    // models: /model/info has no per-name lookup — scan the list.
    const body = await litellmRequest<ModelInfoResponse>("/model/info", {});
    const model = (body.data ?? []).find((m) => m.model_name === key);
    if (!model) {
      throw new LiteLLMError(`Model "${key}" was not found.`, 404);
    }
    return { data: withId(model, "model_name") as TData };
  },

  create: async <TData extends BaseRecord = BaseRecord, TVariables = Record<string, unknown>>(
    params: CreateParams<TVariables>,
  ): Promise<CreateResponse<TData>> => {
    const { resource, variables } = params;
    assertSupportedResource(resource);
    if (resource === "models") {
      throw new LiteLLMError(
        "Creating models is not supported by this data provider.",
        400,
      );
    }

    const endpoints: Record<string, string> = {
      keys: "/key/generate",
      teams: "/team/new",
      users: "/user/new",
    };
    const idFields: Record<string, string> = {
      keys: "token",
      teams: "team_id",
      users: "user_id",
    };
    const body = await litellmRequest<LiteLLMRecord>(endpoints[resource], {
      method: "POST",
      body: variables,
    });
    return { data: withId(body, idFields[resource]) as TData };
  },

  update: async <TData extends BaseRecord = BaseRecord, TVariables = Record<string, unknown>>(
    params: UpdateParams<TVariables>,
  ): Promise<UpdateResponse<TData>> => {
    const { resource, id, variables } = params;
    assertSupportedResource(resource);
    if (resource === "models") {
      throw new LiteLLMError(
        "Updating models is not supported by this data provider.",
        400,
      );
    }

    const idFields: Record<string, string> = {
      keys: "key",
      teams: "team_id",
      users: "user_id",
    };
    const endpoints: Record<string, string> = {
      keys: "/key/update",
      teams: "/team/update",
      users: "/user/update",
    };
    const body = await litellmRequest<LiteLLMRecord>(endpoints[resource], {
      method: "POST",
      body: { [idFields[resource]]: String(id), ...variables },
    });
    return { data: { ...body, id } as TData };
  },

  deleteOne: async <TData extends BaseRecord = BaseRecord, TVariables = Record<string, unknown>>(
    params: DeleteOneParams<TVariables>,
  ): Promise<DeleteOneResponse<TData>> => {
    const { resource, id } = params;
    assertSupportedResource(resource);
    if (resource === "models") {
      throw new LiteLLMError(
        "Deleting models is not supported by this data provider.",
        400,
      );
    }

    try {
      if (resource === "keys") {
        await litellmRequest("/key/delete", {
          method: "POST",
          body: { keys: [String(id)] },
        });
      } else if (resource === "teams") {
        await litellmRequest("/team/delete", {
          method: "POST",
          body: { team_ids: [String(id)] },
        });
      } else {
        await litellmRequest("/user/delete", {
          method: "POST",
          body: { user_ids: [String(id)] },
        });
      }
    } catch (error) {
      // Deleting an already-deleted key hash returns 404 "No keys found" —
      // treat as success so retries are safe (key aliases are globally
      // unique and regeneration is delete -> create).
      const alreadyGone =
        error instanceof LiteLLMError &&
        error.statusCode === 404 &&
        /no keys found/i.test(error.message);
      if (!alreadyGone) throw error;
    }
    return { data: { id } as TData };
  },

  getApiUrl: () => API_URL,

  custom: async ({ url, method, payload, query }) =>
    litellmRequest(url, {
      method: method.toUpperCase(),
      body: payload,
      query: query as Record<string, QueryValue> | undefined,
    }),
};
