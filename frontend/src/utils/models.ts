const ALL_PROXY_MODELS = "all-proxy-models";

// LiteLLM's "all-proxy-models" is a wildcard codename meaning every model
// deployed on the proxy — treat a list containing only it like no restriction.
export const isAllModels = (models: string[] | null | undefined): boolean =>
  models == null ||
  models.length === 0 ||
  (models.length === 1 && models[0] === ALL_PROXY_MODELS);
