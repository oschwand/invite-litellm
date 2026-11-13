import { Typography } from "antd";
import { getApiUrl } from "../../providers/constants";
import { getAppVersion } from "../../providers/config";

const REPO_URL = "https://github.com/oschwand/invite-litellm";

export const AppFooter = () => {
  const version = getAppVersion();
  return (
    <Typography.Text
      type="secondary"
      style={{
        display: "block",
        textAlign: "center",
        padding: "12px 0",
      }}
    >
      <Typography.Link href={REPO_URL} target="_blank" rel="noopener">
        Invite-LiteLLM
      </Typography.Link>
      {version !== null && <> v{version}</>}
      {" · "}
      Connected to {getApiUrl()}
    </Typography.Text>
  );
};
