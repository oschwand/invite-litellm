import { Edit, useForm } from "@refinedev/antd";
import { useList } from "@refinedev/core";
import { Form, Input, InputNumber, Select } from "antd";
import type { VirtualKey } from "./list";

interface TeamOption {
  id: string;
  team_id: string;
  team_alias: string | null;
}

interface ModelOption {
  id: string;
  model_name: string;
}

export const KeyEdit = () => {
  const { formProps, saveButtonProps, query } = useForm<VirtualKey>({
    resource: "keys",
    redirect: "list",
  });

  const record = query?.data?.data;

  // Team picker: /team/list is admin-only — best-effort options, always
  // keeping the key's current team selectable for non-admin sessions.
  const { query: teamsQuery } = useList<TeamOption>({
    resource: "teams",
    pagination: { mode: "off" },
  });
  const teams = teamsQuery.data?.data ?? [];
  const teamOptions = teams.map((team) => ({
    value: team.team_id,
    label: team.team_alias ?? team.team_id,
  }));
  const currentTeamId = record?.team_id ?? null;
  if (currentTeamId && !teamOptions.some((o) => o.value === currentTeamId)) {
    teamOptions.push({
      value: currentTeamId,
      label: record?.team_name ?? currentTeamId,
    });
  }

  // Model suggestions for the tags picker (free entry allowed).
  const { query: modelsQuery } = useList<ModelOption>({
    resource: "models",
    pagination: { mode: "off" },
  });
  const modelOptions = (modelsQuery.data?.data ?? []).map((model) => ({
    value: model.model_name,
    label: model.model_name,
  }));

  return (
    <Edit
      saveButtonProps={saveButtonProps}
      title={`Edit key ${record?.key_alias ?? record?.key_name ?? ""}`}
    >
      <Form {...formProps} layout="vertical">
        <Form.Item
          label="Name"
          name="key_alias"
          rules={[{ required: true, message: "Name is required" }]}
        >
          <Input placeholder="Key name" />
        </Form.Item>
        <Form.Item
          label="Budget (USD)"
          name="max_budget"
          tooltip="Maximum spend for this key. Leave empty for unlimited. Team limit still applies."
        >
          <InputNumber
            min={0}
            style={{ width: "100%" }}
            placeholder="Unlimited"
          />
        </Form.Item>
        <Form.Item
          label="Team"
          name="team_id"
          tooltip="Team the key belongs to. Clear to remove the key from its team."
        >
          <Select allowClear options={teamOptions} placeholder="No team" />
        </Form.Item>
        <Form.Item
          label="Models"
          name="models"
          tooltip="Models this key may use. Leave empty (or just all-proxy-models) for no restriction."
        >
          <Select
            mode="tags"
            allowClear
            options={modelOptions}
            placeholder="All models"
            tokenSeparators={[","]}
          />
        </Form.Item>
      </Form>
    </Edit>
  );
};
