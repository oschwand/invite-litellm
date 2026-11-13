import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useInvalidate } from "@refinedev/core";
import { useDocumentTitle } from "@refinedev/react-router";
import { Alert, Button, Card, Form, Input, Tabs, Typography } from "antd";
import { getApiUrl } from "../../providers/constants";
import { litellmRequest } from "../../providers/litellm";
import {
  extractErrorMessage,
  loadSession,
  saveSession,
  sessionFromToken,
} from "../../providers/session";
import type { LiteLLMSession } from "../../providers/session";

interface SignInValues {
  username: string;
  password: string;
}

interface SignUpValues {
  full_name: string;
  email: string;
  password: string;
  // Form-only field — checked against `password`, never sent to the backend.
  password_confirm: string;
}

// The wire format the signup mode POSTs (no password confirmation).
interface SignUpPayload {
  full_name: string;
  email: string;
  password: string;
}

interface InviteTeamInfo {
  alias: string | null;
  memberBudget: number | null;
}

interface TeamInfoResponse {
  team_info?: {
    team_alias?: string | null;
    team_member_budget_table?: { max_budget?: number | null } | null;
  } | null;
}

// Redemption POST — targets the URL the page was opened with. In production
// that URL belongs to the Python backend serving this build: it validates the
// code, adds the caller to the team and issues the virtual key. Signed-in
// callers authenticate with their session's virtual key; anonymous callers
// send signup credentials instead ({full_name, email, password}).
async function postInvite(
  session: LiteLLMSession | null,
  values?: SignUpPayload,
): Promise<string> {
  let response: Response;
  try {
    response = await fetch(window.location.href, {
      method: "POST",
      headers: {
        ...(session !== null
          ? { Authorization: `Bearer ${session.apiKey}` }
          : {}),
        ...(values !== undefined
          ? { "Content-Type": "application/json" }
          : {}),
      },
      body: values !== undefined ? JSON.stringify(values) : undefined,
    });
  } catch {
    throw new Error(
      `Could not reach the invite backend at ${window.location.origin}. Is it running?`,
    );
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      extractErrorMessage(body) ??
        `Invite redemption failed (HTTP ${response.status}).`,
    );
  }
  const key = (body as { key?: unknown } | null)?.key;
  if (typeof key !== "string" || key.length === 0) {
    throw new Error("The invite backend did not return a virtual key.");
  }
  return key;
}

// Same request authProvider.login makes, called directly (not via useLogin)
// because the default login flow redirects to /dashboard — here the user
// must stay on the invite page and flip to the accept view instead.
async function signInRequest(values: SignInValues): Promise<LiteLLMSession> {
  let response: Response;
  try {
    response = await fetch(`${getApiUrl()}/v2/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: values.username,
        password: values.password,
      }),
    });
  } catch {
    throw new Error(
      `Could not reach the LiteLLM server at ${getApiUrl()}. Is it running?`,
    );
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      extractErrorMessage(body) ?? `Sign-in failed (HTTP ${response.status}).`,
    );
  }
  const token = (body as { token?: unknown } | null)?.token;
  const session = typeof token === "string" ? sessionFromToken(token) : null;
  if (session === null) {
    throw new Error(
      "Sign-in succeeded but the session token could not be read.",
    );
  }
  return session;
}

export const InviteRedeem = () => {
  useDocumentTitle("Team invitation");
  const navigate = useNavigate();
  const invalidate = useInvalidate();
  const { team_id: teamId, invite_code: inviteCode } = useParams();

  const [session, setSession] = useState<LiteLLMSession | null>(() =>
    loadSession(),
  );
  const [teamInfo, setTeamInfo] = useState<InviteTeamInfo | null>(null);
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const [redeeming, setRedeeming] = useState(false);
  const [resultKey, setResultKey] = useState<string | null>(null);
  const [signInError, setSignInError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  const [signInForm] = Form.useForm<SignInValues>();
  const [signUpForm] = Form.useForm<SignUpValues>();

  // Team display name + the member budget the new key will carry. Best
  // effort: /team/info is admin/team-member-gated, so it stays null for
  // anonymous visitors (they just see the raw team id).
  useEffect(() => {
    if (session === null || teamId === undefined) return;
    let cancelled = false;
    litellmRequest<TeamInfoResponse>("/team/info", {
      query: { team_id: teamId },
    })
      .then((body) => {
        if (cancelled) return;
        setTeamInfo({
          alias: body.team_info?.team_alias ?? null,
          memberBudget:
            body.team_info?.team_member_budget_table?.max_budget ?? null,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [session, teamId]);

  const redeem = async (values?: SignUpValues) => {
    setRedeeming(true);
    setRedeemError(null);
    try {
      const key = await postInvite(
        session,
        values === undefined
          ? undefined
          : {
              full_name: values.full_name,
              email: values.email,
              password: values.password,
            },
      );
      setResultKey(key);
      // The keys list gains a row — drop its cached pages.
      invalidate({ resource: "keys", invalidates: ["list"] });
    } catch (error) {
      setRedeemError(
        error instanceof Error ? error.message : "Invite redemption failed.",
      );
    } finally {
      setRedeeming(false);
    }
  };

  const signIn = async (values: SignInValues) => {
    setSigningIn(true);
    setSignInError(null);
    try {
      const activeSession = await signInRequest(values);
      saveSession(activeSession.token);
      setSession(activeSession);
    } catch (error) {
      setSignInError(
        error instanceof Error ? error.message : "Sign-in failed.",
      );
    } finally {
      setSigningIn(false);
    }
  };

  if (teamId === undefined || inviteCode === undefined) {
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
          title="Team invitation"
          style={{ width: 420 }}
          headStyle={{ textAlign: "center", fontSize: 20 }}
        >
          <Alert
            type="error"
            showIcon
            message="This invite link is malformed."
            description="It should look like /invite/{team_id}/{invite_code}."
          />
        </Card>
      </div>
    );
  }

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
        title="Team invitation"
        style={{ width: 420 }}
        headStyle={{ textAlign: "center", fontSize: 20 }}
      >
        {resultKey !== null ? (
          <>
            <Alert
              type="success"
              showIcon
              message="Invite accepted"
              description={
                session !== null
                  ? "You have joined the team. This is your new virtual key:"
                  : "Your account has been created and you have joined the team. This is your virtual key:"
              }
              style={{ marginBottom: 16 }}
            />
            <Typography.Paragraph
              copyable={{ text: resultKey }}
              style={{
                fontFamily: "monospace",
                wordBreak: "break-all",
                marginBottom: 8,
              }}
            >
              {resultKey}
            </Typography.Paragraph>
            <Typography.Paragraph type="warning" style={{ marginBottom: 24 }}>
              This key is shown only once — copy it somewhere safe before
              leaving this page.
            </Typography.Paragraph>
            {session !== null ? (
              <Button
                type="primary"
                size="large"
                block
                onClick={() => navigate("/keys")}
              >
                View my keys
              </Button>
            ) : (
              <Button
                type="primary"
                size="large"
                block
                onClick={() => navigate("/login")}
              >
                Sign in to the dashboard
              </Button>
            )}
          </>
        ) : session !== null ? (
          <>
            <Typography.Paragraph style={{ marginBottom: 8 }}>
              You have been invited to join{" "}
              {teamInfo?.alias ? (
                <Typography.Text strong>{teamInfo.alias}</Typography.Text>
              ) : (
                <Typography.Text code>{teamId}</Typography.Text>
              )}{" "}
              and receive a virtual key for the team.
            </Typography.Paragraph>
            {teamInfo && (
              <Typography.Paragraph type="secondary">
                {teamInfo.memberBudget != null
                  ? `Your virtual key will have a spend budget of $${teamInfo.memberBudget.toFixed(2)}.`
                  : "Your virtual key will be created without a default spend budget."}
              </Typography.Paragraph>
            )}
            <Typography.Paragraph type="secondary">
              Signed in as {session.userEmail || session.userId}. Accepting
              adds you to the team and creates your virtual key.
            </Typography.Paragraph>
            {redeemError && (
              <Alert
                type="error"
                showIcon
                message={redeemError}
                style={{ marginBottom: 16 }}
              />
            )}
            <Button
              type="primary"
              size="large"
              block
              loading={redeeming}
              onClick={() => redeem()}
            >
              Accept invite and create virtual key
            </Button>
          </>
        ) : (
          <>
            <Typography.Paragraph style={{ marginBottom: 8 }}>
              You have been invited to join{" "}
              <Typography.Text code>{teamId}</Typography.Text> and receive a
              virtual key for the team.
            </Typography.Paragraph>
            <Typography.Paragraph type="secondary">
              Create an account (or sign in if you already have one) to accept
              the invitation.
            </Typography.Paragraph>
            <Tabs
              items={[
                {
                  key: "signup",
                  label: "Create account",
                  children: (
                    <>
                      {redeemError && (
                        <Alert
                          type="error"
                          showIcon
                          message={redeemError}
                          style={{ marginBottom: 16 }}
                        />
                      )}
                      <Form
                        form={signUpForm}
                        layout="vertical"
                        requiredMark={false}
                        onFinish={redeem}
                      >
                        <Form.Item
                          name="full_name"
                          label="Full name"
                          rules={[
                            { required: true, message: "Full name is required" },
                          ]}
                        >
                          <Input size="large" placeholder="Ada Lovelace" />
                        </Form.Item>
                        <Form.Item
                          name="email"
                          label="Email"
                          rules={[
                            { required: true, message: "Email is required" },
                            { type: "email", message: "Not a valid email" },
                          ]}
                        >
                          <Input
                            size="large"
                            placeholder="you@example.com"
                          />
                        </Form.Item>
                        <Form.Item
                          name="password"
                          label="Password"
                          rules={[
                            {
                              required: true,
                              message: "Password is required",
                            },
                          ]}
                        >
                          <Input.Password
                            size="large"
                            placeholder="Choose a password"
                          />
                        </Form.Item>
                        <Form.Item
                          name="password_confirm"
                          label="Confirm password"
                          dependencies={["password"]}
                          rules={[
                            {
                              required: true,
                              message: "Please confirm your password",
                            },
                            ({ getFieldValue }) => ({
                              validator(_, value) {
                                if (
                                  !value ||
                                  getFieldValue("password") === value
                                ) {
                                  return Promise.resolve();
                                }
                                return Promise.reject(
                                  new Error("The passwords do not match"),
                                );
                              },
                            }),
                          ]}
                        >
                          <Input.Password
                            size="large"
                            placeholder="Repeat the password"
                          />
                        </Form.Item>
                        <Button
                          type="primary"
                          size="large"
                          htmlType="submit"
                          block
                          loading={redeeming}
                        >
                          Create account and join team
                        </Button>
                      </Form>
                    </>
                  ),
                },
                {
                  key: "signin",
                  label: "Sign in",
                  children: (
                    <>
                      {signInError && (
                        <Alert
                          type="error"
                          showIcon
                          message={signInError}
                          style={{ marginBottom: 16 }}
                        />
                      )}
                      <Form
                        form={signInForm}
                        layout="vertical"
                        requiredMark={false}
                        onFinish={signIn}
                      >
                        <Form.Item
                          name="username"
                          label="Email or username"
                          rules={[
                            {
                              required: true,
                              message: "Email or username is required",
                            },
                          ]}
                        >
                          <Input
                            size="large"
                            placeholder="you@example.com"
                          />
                        </Form.Item>
                        <Form.Item
                          name="password"
                          label="Password"
                          rules={[
                            {
                              required: true,
                              message: "Password is required",
                            },
                          ]}
                        >
                          <Input.Password
                            size="large"
                            placeholder="●●●●●●●●"
                          />
                        </Form.Item>
                        <Button
                          type="primary"
                          size="large"
                          htmlType="submit"
                          block
                          loading={signingIn}
                        >
                          Sign in
                        </Button>
                      </Form>
                    </>
                  ),
                },
              ]}
            />
          </>
        )}
      </Card>
    </div>
  );
};
