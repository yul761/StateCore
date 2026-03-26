import type { getDemoConfig } from "./config";
import {
  apiFetch,
  type FastLayerViewOutputShape,
  type HealthShape,
  type InspectorBundle,
  type LayerStatusOutputShape,
  type RuntimeTurnShape,
  type ScopeSummary,
  type StableStateOutputShape,
  type WorkingMemoryOutputShape
} from "./lib";

type DemoConfig = ReturnType<typeof getDemoConfig>;

export async function fetchHealth(config: DemoConfig) {
  return apiFetch<HealthShape>(config.apiBaseUrl, config.routes.health, "GET");
}

export async function fetchInspectorBundle(config: DemoConfig, scopeId: string, message: string) {
  const query = new URLSearchParams({ scopeId, message });
  const [working, stable, fast, layer] = await Promise.all([
    apiFetch<WorkingMemoryOutputShape>(config.apiBaseUrl, `${config.routes.workingState}?scopeId=${scopeId}`, "GET"),
    apiFetch<StableStateOutputShape>(config.apiBaseUrl, `${config.routes.stableState}?scopeId=${scopeId}`, "GET"),
    apiFetch<FastLayerViewOutputShape>(config.apiBaseUrl, `${config.routes.fastView}?${query.toString()}`, "GET"),
    apiFetch<LayerStatusOutputShape>(config.apiBaseUrl, `${config.routes.layerStatus}?${query.toString()}`, "GET")
  ]);

  return { working, stable, fast, layer } satisfies InspectorBundle;
}

export async function fetchScopesAndActive(config: DemoConfig) {
  const [scopesResponse, state] = await Promise.all([
    apiFetch<{ items: ScopeSummary[] }>(config.apiBaseUrl, config.routes.listScopes, "GET"),
    apiFetch<{ activeScopeId: string | null }>(config.apiBaseUrl, config.routes.getActiveState, "GET")
  ]);

  return { scopesResponse, state };
}

export async function activateScopeRemote(config: DemoConfig, scopeId: string) {
  const route = config.routes.setActiveScope.replace(":id", scopeId);
  return apiFetch<{ activeScopeId: string | null }>(config.apiBaseUrl, route, "POST");
}

export async function createScopeRemote(config: DemoConfig, name: string) {
  return apiFetch<ScopeSummary>(config.apiBaseUrl, config.routes.createScope, "POST", {
    name,
    stage: "build"
  });
}

export async function sendRuntimeTurn(config: DemoConfig, scopeId: string, message: string) {
  return apiFetch<RuntimeTurnShape>(config.apiBaseUrl, config.routes.runtimeTurn, "POST", {
    scopeId,
    message
  });
}
