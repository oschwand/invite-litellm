import { useLogin } from "@refinedev/core";
import { Button, Card, Form, Input } from "antd";

interface LoginFormValues {
  username: string;
  password: string;
}

export const Login = () => {
  const [form] = Form.useForm<LoginFormValues>();
  const { mutate: login, isPending } = useLogin<LoginFormValues>();

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Card
        title="Sign in to your account"
        style={{ width: 400 }}
        headStyle={{ textAlign: "center", fontSize: 20 }}
      >
        <Form
          form={form}
          layout="vertical"
          requiredMark={false}
          onFinish={(values) => login(values)}
        >
          <Form.Item
            name="username"
            label="Username"
            rules={[{ required: true, message: "Username is required" }]}
          >
            <Input size="large" placeholder="Username" />
          </Form.Item>
          <Form.Item
            name="password"
            label="Password"
            rules={[{ required: true, message: "Password is required" }]}
          >
            <Input.Password size="large" placeholder="●●●●●●●●" />
          </Form.Item>
          <Button
            type="primary"
            size="large"
            htmlType="submit"
            block
            loading={isPending}
          >
            Sign in
          </Button>
        </Form>
      </Card>
    </div>
  );
};
