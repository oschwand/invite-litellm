import type { RefineThemedLayoutHeaderProps } from "@refinedev/antd";
import { useGetIdentity } from "@refinedev/core";
import { UserOutlined } from "@ant-design/icons";
import { Button, Layout as AntdLayout, Space, Switch, theme } from "antd";
import React, { useContext } from "react";
import { Link } from "react-router";
import { ColorModeContext } from "../../contexts/color-mode";

const { useToken } = theme;

type IUser = {
  id: string;
  name: string;
};

export const Header: React.FC<RefineThemedLayoutHeaderProps> = ({
  sticky = true,
}) => {
  const { token } = useToken();
  const { data: user } = useGetIdentity<IUser>();
  const { mode, setMode } = useContext(ColorModeContext);

  const headerStyles: React.CSSProperties = {
    backgroundColor: token.colorBgElevated,
    display: "flex",
    justifyContent: "flex-end",
    alignItems: "center",
    padding: "0px 24px",
    height: "64px",
  };

  if (sticky) {
    headerStyles.position = "sticky";
    headerStyles.top = 0;
    headerStyles.zIndex = 1;
  }

  return (
    <AntdLayout.Header style={headerStyles}>
      <Space>
        <Switch
          checkedChildren="🌛"
          unCheckedChildren="🔆"
          onChange={() => setMode(mode === "light" ? "dark" : "light")}
          defaultChecked={mode === "dark"}
        />
        <Link to="/profile">
          <Button type="text" icon={<UserOutlined />}>
            {user?.name ?? "Profile"}
          </Button>
        </Link>
      </Space>
    </AntdLayout.Header>
  );
};
