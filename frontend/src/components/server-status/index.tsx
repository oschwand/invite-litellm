import { useCallback, useEffect, useState } from "react";
import { Alert, Button } from "antd";
import { getApiUrl } from "../../providers/constants";

// Unauthenticated GET /health/liveliness. Any HTTP response, even 4xx/5xx,
// counts as reachable; only a network error (connection refused, CORS
// failure, timeout) means unreachable — same semantics as the backend's
// own startup ping.
export const ServerStatusBanner = () => {
  const [unreachable, setUnreachable] = useState(false);
  const [checking, setChecking] = useState(false);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      await fetch(`${getApiUrl()}/health/liveliness`, {
        signal: AbortSignal.timeout(5000),
      });
      setUnreachable(false);
    } catch {
      setUnreachable(true);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  if (!unreachable) return null;

  return (
    <Alert
      banner
      type="warning"
      showIcon
      message="The LiteLLM proxy server is unreachable."
      description={`Requests will fail until it is back up (configured server: ${getApiUrl()}).`}
      action={
        <Button size="small" loading={checking} onClick={() => void check()}>
          Retry
        </Button>
      }
      style={{ marginBottom: 16 }}
    />
  );
};
