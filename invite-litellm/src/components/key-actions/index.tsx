import { MoreOutlined } from "@ant-design/icons";
import {
  useCustomMutation,
  useDelete,
  useInvalidate,
  useNavigation,
} from "@refinedev/core";
import { App, Button, Dropdown } from "antd";

// Row actions for virtual keys, collapsed behind a "…" overflow menu so the
// table stays clean. Edit navigates to /keys/edit/:id; Enable/Disable toggles
// the key's blocked flag (POST /key/block | /key/unblock — reversible, no
// confirmation needed); Delete asks for confirmation first (deletion is
// permanent — the plaintext key is lost).
export const KeyRowActions = ({
  recordId,
  blocked,
}: {
  recordId: string;
  blocked: boolean | null | undefined;
}) => {
  const { edit } = useNavigation();
  const { mutate: deleteKey } = useDelete();
  const { mutate: toggleBlock } = useCustomMutation();
  const invalidate = useInvalidate();
  const modal = App.useApp().modal;

  const toggleEnabled = () => {
    const disabling = !blocked;
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

  return (
    <Dropdown
      trigger={["click"]}
      placement="bottomRight"
      menu={{
        items: [
          { key: "edit", label: "Edit" },
          { key: "toggle", label: blocked ? "Enable" : "Disable" },
          { key: "delete", label: "Delete", danger: true },
        ],
        onClick: ({ key }) => {
          if (key === "edit") {
            edit("keys", recordId);
          }
          if (key === "toggle") {
            toggleEnabled();
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
