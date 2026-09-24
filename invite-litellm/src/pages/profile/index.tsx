import { useGetIdentity, useLogout } from "@refinedev/core";
import { LogoutOutlined } from "@ant-design/icons";
import { Avatar, Button, Card, Descriptions, Tag, Typography } from "antd";
import { API_URL } from "../../providers/constants";
import type { LiteLLMIdentity } from "../../providers/auth";

const { Text } = Typography;

const roleTagColor = (role: string): string => {
  if (role === "proxy_admin") return "gold";
  if (role === "org_admin") return "purple";
  if (role === "internal_user") return "blue";
  return "default";
};

const centered: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "center",
  paddingTop: 48,
};

export const Profile = () => {
  const { data: identity, isLoading } = useGetIdentity<LiteLLMIdentity>();
  const { mutate: logout, isPending: logoutPending } = useLogout();

  if (isLoading) {
    return (
      <div style={centered}>
        <Card loading style={{ width: 480 }} />
      </div>
    );
  }

  if (!identity) {
    return (
      <div style={centered}>
        <Card title="Profile" style={{ width: 480 }}>
          <Text type="secondary">Not signed in.</Text>
        </Card>
      </div>
    );
  }

  return (
    <div style={centered}>
      <Card title="Profile" style={{ width: 480 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 24,
          }}
        >
          <Avatar size={48} style={{ backgroundColor: "#1677ff" }}>
            {(identity.name || identity.id).slice(0, 1).toUpperCase()}
          </Avatar>
          <div>
            <Text strong style={{ fontSize: 16 }}>
              {identity.name}
            </Text>
            <br />
            <Tag color={roleTagColor(identity.role)}>{identity.role}</Tag>
          </div>
        </div>
        <Descriptions column={1} bordered size="small">
          <Descriptions.Item label="User ID">
            <Text copyable style={{ fontFamily: "monospace" }}>
              {identity.id}
            </Text>
          </Descriptions.Item>
          <Descriptions.Item label="Email">
            {identity.email || "—"}
          </Descriptions.Item>
          <Descriptions.Item label="Role">
            <Tag color={roleTagColor(identity.role)}>{identity.role}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="Session expires">
            {new Date(identity.expiresAt * 1000).toLocaleString()}
          </Descriptions.Item>
          <Descriptions.Item label="Server">
            <Text style={{ fontFamily: "monospace" }}>{API_URL}</Text>
          </Descriptions.Item>
        </Descriptions>
        <Button
          block
          size="large"
          danger
          icon={<LogoutOutlined />}
          loading={logoutPending}
          onClick={() => logout()}
          style={{ marginTop: 24 }}
        >
          Sign out
        </Button>
      </Card>
    </div>
  );
};
