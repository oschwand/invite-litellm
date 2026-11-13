import { Edit, useForm } from "@refinedev/antd";
import { useCustomMutation, useList } from "@refinedev/core";
import type { HttpError } from "@refinedev/core";
import { App, Button, Form, Input, InputNumber, Select, Typography } from "antd";
import { randomInviteCode } from "../../utils/invite";

interface TeamRecord {
  id: string;
  team_id: string;
  team_alias: string | null;
  max_budget: number | null;
  // Flattened from team_info.team_member_budget_table.max_budget by the
  // data provider's getOne so the form syncs automatically (same field
  // name as NewTeamRequest/UpdateTeamRequest, which drives the member
  // budget row on the server).
  team_member_budget: number | null;
  models?: string[] | null;
  metadata?: (Record<string, unknown> & { invite_code?: string | null }) | null;
}

interface ModelOption {
  id: string;
  model_name: string;
}

const positiveAmount = {
  type: "number" as const,
  min: 0.01,
  message: "Must be a positive amount",
};

export const TeamEdit = () => {
  const { formProps, saveButtonProps, query } =
    useForm<TeamRecord, HttpError, TeamRecord>({
      resource: "teams",
      redirect: "list",
    });
  const { mutate: updateTeam } = useCustomMutation();
  const modal = App.useApp().modal;

  const record = query?.data?.data;

  // Model suggestions for the tags picker (free entry allowed).
  const { query: modelsQuery } = useList<ModelOption>({
    resource: "models",
    pagination: { mode: "off" },
  });
  const modelOptions = (modelsQuery.data?.data ?? []).map((model) => ({
    value: model.model_name,
    label: model.model_name,
  }));

  const teamId = record?.team_id ?? null;
  const inviteCode = record?.metadata?.invite_code ?? null;
  const inviteUrl =
    inviteCode && teamId
      ? `${window.location.origin}/invite/${teamId}/${inviteCode}`
      : null;

  // Issue a fresh invite code via /team/update — independent of the form
  // fields above, so it works with or without unsaved changes. The new code
  // is merged into the existing metadata so nothing stored there is lost
  // (the server also re-merges its system-managed keys, e.g.
  // team_member_budget_id).
  const writeInviteCode = () => {
    if (!teamId) return;
    const code = randomInviteCode();
    updateTeam(
      {
        url: "/team/update",
        method: "post",
        values: {
          team_id: teamId,
          metadata: { ...(record?.metadata ?? {}), invite_code: code },
        },
        successNotification: () => ({
          message: inviteCode ? "Invite link regenerated" : "Invite link created",
          type: "success",
        }),
      },
      {
        onSuccess: async () => {
          await query?.refetch();
          const url = `${window.location.origin}/invite/${teamId}/${code}`;
          modal.success({
            title: "Invite link",
            width: 560,
            content: (
              <>
                <p>
                  Share this link — anyone opening it can join the team and
                  get a virtual key:
                </p>
                <Typography.Text
                  copyable={{ text: url }}
                  style={{ fontFamily: "monospace", wordBreak: "break-all" }}
                >
                  {url}
                </Typography.Text>
              </>
            ),
          });
        },
      },
    );
  };

  const createOrRegenerateInvite = () => {
    if (inviteCode) {
      // Regenerating invalidates the current link — confirm first.
      modal.confirm({
        title: "Regenerate invite link",
        content:
          "The current invite link will stop working immediately and a new one will be issued. Continue?",
        okText: "Regenerate",
        onOk: () => writeInviteCode(),
      });
    } else {
      writeInviteCode();
    }
  };

  return (
    <Edit
      saveButtonProps={saveButtonProps}
      title={`Edit team ${record?.team_alias ?? ""}`}
    >
      <Form
        {...formProps}
        layout="vertical"
        onFinish={(values) =>
          formProps.onFinish?.({
            ...values,
            // Empty number fields arrive as undefined — send explicit nulls
            // so the server clears the budgets (unlimited team / no default
            // member budget) instead of leaving them untouched.
            max_budget: values.max_budget ?? null,
            team_member_budget: values.team_member_budget ?? null,
          })
        }
      >
        <Form.Item
          label="Name"
          name="team_alias"
          rules={[{ required: true, message: "Name is required" }]}
        >
          <Input placeholder="Team name" />
        </Form.Item>
        <Form.Item
          label="Max team budget (USD)"
          name="max_budget"
          tooltip="Maximum total spend across the whole team. Leave empty for unlimited."
          rules={[positiveAmount]}
        >
          <InputNumber
            min={0}
            style={{ width: "100%" }}
            placeholder="Unlimited"
          />
        </Form.Item>
        <Form.Item
          label="Team member budget (USD)"
          name="team_member_budget"
          tooltip="Default budget for each member's virtual keys — also the budget granted when accepting an invite. Leave empty for no default."
          rules={[positiveAmount]}
        >
          <InputNumber
            min={0}
            style={{ width: "100%" }}
            placeholder="No default"
          />
        </Form.Item>
        <Form.Item
          label="Allowed models"
          name="models"
          tooltip="Models members of this team may use. Leave empty (or just all-proxy-models) for no restriction."
        >
          <Select
            mode="tags"
            allowClear
            options={modelOptions}
            placeholder="All models"
            tokenSeparators={[","]}
          />
        </Form.Item>
        <Form.Item
          label="Invite link"
          tooltip="A link that lets new users join this team and receive a virtual key with the member budget. Saved independently of the form above."
        >
          {inviteCode ? (
            <Typography.Text
              copyable={inviteUrl ? { text: inviteUrl } : false}
              style={{ fontFamily: "monospace", marginRight: 8 }}
            >
              {inviteCode}
            </Typography.Text>
          ) : (
            <span style={{ marginRight: 8 }}>None yet</span>
          )}
          <Button onClick={createOrRegenerateInvite}>
            {inviteCode ? "Regenerate" : "Create invite link"}
          </Button>
        </Form.Item>
      </Form>
    </Edit>
  );
};
