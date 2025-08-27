// src/components/Header.jsx
import React from "react";
import { Layout, Button, Avatar, Dropdown } from "antd";
import { UserOutlined, LogoutOutlined } from "@ant-design/icons";

const { Header } = Layout;

const AppHeader = ({ onLogout }) => {
  const menuItems = [
    {
      key: "logout",
      label: "Logout",
      icon: <LogoutOutlined />,
      onClick: onLogout,
    },
  ];

  return (
    <Header
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "0 24px",
        background: "#001529",
      }}
    >
      {/* Left side - App Title */}
      <div style={{ color: "white", fontSize: "20px", fontWeight: "bold" }}>
        🎬 AI Video Generator
      </div>

      {/* Right side - Profile + Logout */}
      <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
        <Dropdown
          menu={{ items: menuItems }}
          placement="bottomRight"
          arrow
          trigger={["click"]}
        >
          <Avatar
            size="large"
            icon={<UserOutlined />}
            style={{ backgroundColor: "#1890ff", cursor: "pointer" }}
          />
        </Dropdown>
      </div>
    </Header>
  );
};

export default AppHeader;
