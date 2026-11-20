import { useState } from "react";
import { CreateButton, EditButton, List, useTable } from "@refinedev/antd";
import { useCreate } from "@refinedev/core";
import { App, Form, Input, InputNumber, Modal, Switch, Table, Typography } from "antd";
import { Link } from "react-router";
import { isAllModels } from "../../utils/models";
import { randomInviteCode } from "../../utils/invite";

export interface Team {
  id: string;
  team_id: string;
  team_alias: string;
  key_count: number | null;
  max_budget: number | null;
  member_budget: number | null;
  spend: number | null;
  models: string[] | null;
  invite_code: string | null;
}

const usd = (value: number | null | undefined) =>
  value == null ? "—" : `$${value.toFixed(2)}`;

interface TeamFormValues {
  name: string;
  max_budget: number | null;
  team_member_budget: number | null;
  invite: boolean;
}

const positiveAmount = {
  type: "number" as const,
  min: 0.01,
  message: "Must be a positive amount",
};

export const TeamList = () => {
  const { tableProps } = useTable<Team>({
    resource: "teams",
    syncWithLocation: true,
    pagination: { mode: "client" },
  });

  const { mutateAsync: createTeam } = useCreate();
  const modal = App.useApp().modal;
  const [form] = Form.useForm<TeamFormValues>();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const openForm = () => {
    form.resetFields();
    setOpen(true);
  };

  const submit = async (values: TeamFormValues) => {
    const inviteCode = values.invite ? randomInviteCode() : null;
    setSaving(true);
    try {
      const result = await createTeam({
        resource: "teams",
        values: {
          team_alias: values.name,
          // Without these routes team members get 401 when generating or
          // deleting their own keys (invite redemption back-fills them for
          // pre-existing teams, but a new team can be correct from day one).
          team_member_permissions: ["/key/generate", "/key/delete"],
          ...(values.max_budget != null ? { max_budget: values.max_budget } : {}),
          ...(values.team_member_budget != null
            ? { team_member_budget: values.team_member_budget }
            : {}),
          ...(inviteCode !== null
            ? { metadata: { invite_code: inviteCode } }
            : {}),
        },
      });
      setOpen(false);
      form.resetFields();
      const teamId =
        (result.data as unknown as { team_id?: string } | undefined)?.team_id ??
        null;
      if (inviteCode !== null && teamId) {
        const url = `${window.location.origin}/invite/${teamId}/${inviteCode}`;
        modal.success({
          title: "Team created",
          width: 560,
          content: (
            <>
              <p>
                Share this invite link — anyone opening it can join the team
                and get a virtual key:
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
      }
    } catch {
      // The notification provider already surfaces the error — keep the
      // modal open so the entered values are not lost.
    } finally {
      setSaving(false);
    }
  };

  return (
    <List
      title="Teams"
      headerButtons={<CreateButton onClick={() => openForm()} />}
    >
      <Table {...tableProps} rowKey="id">
        <Table.Column<Team>
          dataIndex="team_alias"
          title="Name"
          render={(value, record) => (
            <Link to={`/team/${record.team_id}`}>{value || "—"}</Link>
          )}
        />
        <Table.Column<Team>
          dataIndex="key_count"
          title="Keys"
          render={(value) => (value == null ? "—" : value)}
        />
        <Table.Column<Team>
          dataIndex="max_budget"
          title="Team budget"
          render={(value) => (value == null ? "Unlimited" : usd(value))}
        />
        <Table.Column<Team>
          dataIndex="member_budget"
          title="Member budget"
          render={(value) => usd(value)}
        />
        <Table.Column<Team>
          dataIndex="spend"
          title="Spend"
          render={(value) => usd(value)}
        />
        <Table.Column<Team>
          dataIndex="models"
          title="Allowed models"
          render={(value, record) =>
            isAllModels(value) ? (
              <Link to={`/models?team_id=${record.team_id}`}>All models</Link>
            ) : (
              <Link to={`/models?team_id=${record.team_id}`}>
                {value.length} models
              </Link>
            )
          }
        />
        <Table.Column<Team>
          dataIndex="invite_code"
          title="Invite link"
          render={(value, record) =>
            value ? (
              <>
                <Typography.Link
                  href={`${window.location.origin}/invite/${record.team_id}/${value}`}
                  target="_blank"
                  rel="noopener"
                  style={{ marginRight: 8 }}
                >
                  {value}
                </Typography.Link>
                <Typography.Text
                  copyable={{
                    text: `${window.location.origin}/invite/${record.team_id}/${value}`,
                  }}
                />
              </>
            ) : (
              "—"
            )
          }
        />
        <Table.Column<Team>
          title="Actions"
          align="right"
          render={(_, record) => (
            <EditButton
              type="text"
              size="small"
              recordItemId={record.team_id}
            />
          )}
        />
      </Table>

      <Modal
        title="Create team"
        open={open}
        onOk={() => form.submit()}
        confirmLoading={saving}
        okText="Create"
        onCancel={() => setOpen(false)}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={submit}
          initialValues={{ invite: false }}
        >
          <Form.Item
            label="Name"
            name="name"
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
            label="Create invite link"
            name="invite"
            valuePropName="checked"
            tooltip="Generates a link that lets new users join this team and receive a virtual key with the member budget."
          >
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </List>
  );
};
