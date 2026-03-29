import type { getDemoConfig } from "./config";
import {
  type AgentScenarioRunShape,
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

export async function fetchHealth(config: DemoConfig, userId: string) {
  return apiFetch<HealthShape>(config.apiBaseUrl, userId, config.routes.health, "GET");
}

export async function fetchInspectorBundle(config: DemoConfig, userId: string, scopeId: string, message: string) {
  const query = new URLSearchParams({ scopeId, message });
  const [working, stable, fast, layer] = await Promise.all([
    apiFetch<WorkingMemoryOutputShape>(config.apiBaseUrl, userId, `${config.routes.workingState}?scopeId=${scopeId}`, "GET"),
    apiFetch<StableStateOutputShape>(config.apiBaseUrl, userId, `${config.routes.stableState}?scopeId=${scopeId}`, "GET"),
    apiFetch<FastLayerViewOutputShape>(config.apiBaseUrl, userId, `${config.routes.fastView}?${query.toString()}`, "GET"),
    apiFetch<LayerStatusOutputShape>(config.apiBaseUrl, userId, `${config.routes.layerStatus}?${query.toString()}`, "GET")
  ]);

  return { working, stable, fast, layer } satisfies InspectorBundle;
}

export async function fetchScopesAndActive(config: DemoConfig, userId: string) {
  const [scopesResponse, state] = await Promise.all([
    apiFetch<{ items: ScopeSummary[] }>(config.apiBaseUrl, userId, config.routes.listScopes, "GET"),
    apiFetch<{ activeScopeId: string | null }>(config.apiBaseUrl, userId, config.routes.getActiveState, "GET")
  ]);

  return { scopesResponse, state };
}

export async function activateScopeRemote(config: DemoConfig, userId: string, scopeId: string) {
  const route = config.routes.setActiveScope.replace(":id", scopeId);
  return apiFetch<{ activeScopeId: string | null }>(config.apiBaseUrl, userId, route, "POST");
}

export async function createScopeRemote(config: DemoConfig, userId: string, name: string) {
  return apiFetch<ScopeSummary>(config.apiBaseUrl, userId, config.routes.createScope, "POST", {
    name,
    stage: "build"
  });
}

export async function sendRuntimeTurn(config: DemoConfig, userId: string, scopeId: string, message: string) {
  return apiFetch<RuntimeTurnShape>(config.apiBaseUrl, userId, config.routes.runtimeTurn, "POST", {
    scopeId,
    message
  });
}

export async function runAgentScenarioRemote(config: DemoConfig, userId: string, scenarioId: string) {
  const route = config.routes.agentScenarioRun.replace(":id", scenarioId);
  return apiFetch<AgentScenarioRunShape>(config.apiBaseUrl, userId, route, "POST");
}
