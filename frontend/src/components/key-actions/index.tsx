import { MoreOutlined } from "@ant-design/icons";
import {
  useCustomMutation,
  useDelete,
  useGetIdentity,
  useInvalidate,
  useNavigation,
} from "@refinedev/core";
import { App, Button, Dropdown, Typography } from "antd";
import { LiteLLMError, litellmRequest } from "../../providers/litellm";
import type { LiteLLMIdentity } from "../../providers/auth";
import type { VirtualKey } from "../../pages/keys/list";

const { Text } = Typography;

// Payload for the replacement key of a regeneration. Copies every attribute
// of the old key — budgets, spend, limits, model list, metadata… — minus the
// fields the server owns (token, key_name, timestamps). Two session-gated
// exceptions (verified against LiteLLM v1.100.x): internal users cannot set
// `user_id`/`organization_id` (creating keys for someone else is
// admin-tier — omitting them defaults the key to the caller) nor
// `allowed_routes` (proxy-admin-only; the `key_type` preset covers the
// common cases). `expires` is converted to a remaining `duration` so the
// new key keeps the old validity window.
function buildRegenPayload(
  key: VirtualKey,
  isAdmin: boolean,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (key.key_alias != null) payload.key_alias = key.key_alias;
  if (isAdmin && key.user_id != null) payload.user_id = key.user_id;
  if (key.team_id != null) payload.team_id = key.team_id;
  if (isAdmin && key.organization_id != null)
    payload.organization_id = key.organization_id;
  if (key.spend != null && key.spend > 0) payload.spend = key.spend;
  if (key.soft_budget != null) payload.soft_budget = key.soft_budget;
  if (key.max_budget != null) payload.max_budget = key.max_budget;
  if (key.budget_duration != null)
    payload.budget_duration = key.budget_duration;
  if (key.budget_fallbacks != null && Object.keys(key.budget_fallbacks).length > 0)
    payload.budget_fallbacks = key.budget_fallbacks;
  if (key.models != null && key.models.length > 0) payload.models = key.models;
  if (key.aliases != null && Object.keys(key.aliases).length > 0)
    payload.aliases = key.aliases;
  if (key.config != null && Object.keys(key.config).length > 0)
    payload.config = key.config;
  if (key.metadata != null && Object.keys(key.metadata).length > 0)
    payload.metadata = key.metadata;
  if (key.permissions != null && Object.keys(key.permissions).length > 0)
    payload.permissions = key.permissions;
  if (key.model_max_budget != null && Object.keys(key.model_max_budget).length > 0)
    payload.model_max_budget = key.model_max_budget;
  if (key.allowed_cache_controls != null && key.allowed_cache_controls.length > 0)
    payload.allowed_cache_controls = key.allowed_cache_controls;
  if (key.key_type != null) payload.key_type = key.key_type;
  if (isAdmin && key.allowed_routes != null && key.allowed_routes.length > 0)
    payload.allowed_routes = key.allowed_routes;
  if (key.tpm_limit != null) payload.tpm_limit = key.tpm_limit;
  if (key.rpm_limit != null) payload.rpm_limit = key.rpm_limit;
  if (key.max_parallel_requests != null)
    payload.max_parallel_requests = key.max_parallel_requests;
  if (key.model_tpm_limit != null && Object.keys(key.model_tpm_limit).length > 0)
    payload.model_tpm_limit = key.model_tpm_limit;
  if (key.model_rpm_limit != null && Object.keys(key.model_rpm_limit).length > 0)
    payload.model_rpm_limit = key.model_rpm_limit;
  if (key.blocked === true) payload.blocked = true;
  if (key.expires != null) {
    const remaining = new Date(key.expires).getTime() - Date.now();
    if (!Number.isNaN(remaining) && remaining > 0)
      payload.duration = `${Math.max(1, Math.round(remaining / 1000))}s`;
  }
  return payload;
}

// Row actions for virtual keys, collapsed behind a "…" overflow menu so the
// table stays clean. Edit navigates to /keys/edit/:id; Enable/Disable toggles
// the key's blocked flag (POST /key/block | /key/unblock — reversible, no
// confirmation needed); Regenerate simulates the premium-only
// POST /key/regenerate as delete + create (see regenerate()); Delete asks
// for confirmation first (deletion is permanent — the plaintext key is lost).
export const KeyRowActions = ({ record }: { record: VirtualKey }) => {
  const { edit } = useNavigation();
  const { mutate: deleteKey } = useDelete();
  const { mutate: toggleBlock } = useCustomMutation();
  const invalidate = useInvalidate();
  const modal = App.useApp().modal;
  const { data: identity } = useGetIdentity<LiteLLMIdentity>();
  const recordId = record.token;
  // Unknown role (identity still loading) defaults to admin-tier copying:
  // including user_id is required for correct ownership, while an internal
  // user would just get a clear server-side error instead of a key silently
  // re-owned to the caller.
  const isAdmin = identity?.role !== "internal_user";

  const toggleEnabled = () => {
    const disabling = !record.blocked;
    // useCustomMutation does not invalidate resource queries on its own —
    // refresh the key lists so the Status column reflects the new state.
    toggleBlock(
      {
        url: disabling ? "/key/block" : "/key/unblock",
        method: "post",
        values: { key: recordId },
        successNotification: () => ({
          message: disabling ? "Key disabled" : "Key enabled",
          type: "success",
        }),
      },
      {
        onSuccess: () =>
          invalidate({ resource: "keys", invalidates: ["list", "detail", "all"] }),
      },
    );
  };

  const regenerate = () => {
    modal.confirm({
      title: `Regenerate key ${record.key_alias ?? record.key_name ?? ""}`,
      content:
        "The current key will be revoked immediately and a new one issued with the same name, budgets, spend and settings. The plaintext new key is shown only once. Continue?",
      okText: "Regenerate",
      onOk: async () => {
        let revoked = false;
        try {
          // Order matters: key aliases are globally unique, so the old key
          // must be deleted before the replacement can take its name. 404
          // "No keys found" means it is already gone — the desired state.
          try {
            await litellmRequest("/key/delete", {
              method: "POST",
              body: { keys: [recordId] },
            });
            revoked = true;
          } catch (error) {
            const alreadyGone =
              error instanceof LiteLLMError &&
              error.statusCode === 404 &&
              /no keys found/i.test(error.message);
            if (!alreadyGone) throw error;
            revoked = true;
          }
          const body = await litellmRequest<{ key?: string }>(
            "/key/generate",
            {
              method: "POST",
              body: buildRegenPayload(record, isAdmin),
            },
          );
          const newKey = body.key;
          if (typeof newKey !== "string" || newKey === "") {
            throw new Error(
              "The replacement key was created but the server returned no key value.",
            );
          }
          invalidate({
            resource: "keys",
            invalidates: ["list", "detail", "all"],
          });
          modal.success({
            title: "Key regenerated",
            width: 560,
            content: (
              <>
                <p>The new key — copy it now, it will not be shown again:</p>
                <Text
                  copyable={{ text: newKey }}
                  style={{ fontFamily: "monospace", wordBreak: "break-all" }}
                >
                  {newKey}
                </Text>
              </>
            ),
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unknown error";
          modal.error({
            title: "Regeneration failed",
            width: 560,
            content: revoked
              ? `${message} — the previous key was already deleted; create a new key manually if this persists.`
              : `${message} — the previous key could not be deleted and is still active.`,
          });
        }
      },
    });
  };

  return (
    <Dropdown
      trigger={["click"]}
      placement="bottomRight"
      menu={{
        items: [
          { key: "edit", label: "Edit" },
          { key: "regenerate", label: "Regenerate…" },
          { key: "toggle", label: record.blocked ? "Enable" : "Disable" },
          { key: "delete", label: "Delete", danger: true },
        ],
        onClick: ({ key }) => {
          if (key === "edit") {
            edit("keys", recordId);
          }
          if (key === "toggle") {
            toggleEnabled();
          }
          if (key === "regenerate") {
            regenerate();
          }
          if (key === "delete") {
            modal.confirm({
              title: "Delete key",
              content:
                "This permanently deletes the virtual key. Clients using it will stop working. Continue?",
              okText: "Delete",
              okButtonProps: { danger: true },
              onOk: () => deleteKey({ resource: "keys", id: recordId }),
            });
          }
        },
      }}
    >
      <Button type="text" icon={<MoreOutlined />} aria-label="Key actions" />
    </Dropdown>
  );
};
