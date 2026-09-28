import { MoreOutlined } from "@ant-design/icons";
import { useDelete, useNavigation } from "@refinedev/core";
import { App, Button, Dropdown } from "antd";

// Row actions for virtual keys, collapsed behind a "…" overflow menu so the
// table stays clean. Edit navigates to /keys/edit/:id; Delete asks for
// confirmation first (deletion is permanent — the plaintext key is lost).
export const KeyRowActions = ({ recordId }: { recordId: string }) => {
  const { edit } = useNavigation();
  const { mutate: deleteKey } = useDelete();
  const modal = App.useApp().modal;

  return (
    <Dropdown
      trigger={["click"]}
      placement="bottomRight"
      menu={{
        items: [
          { key: "edit", label: "Edit" },
          { key: "delete", label: "Delete", danger: true },
        ],
        onClick: ({ key }) => {
          if (key === "edit") {
            edit("keys", recordId);
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
