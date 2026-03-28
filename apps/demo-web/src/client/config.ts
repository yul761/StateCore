type DemoWebRouteMap = typeof import("@statecore/contracts").DemoWebRoutes;

declare global {
  interface Window {
    STATECORE_DEMO_CONFIG?: {
      apiBaseUrl: string;
      routes: DemoWebRouteMap;
    };
  }
}

export function getDemoConfig() {
  const config = window.STATECORE_DEMO_CONFIG;
  if (!config) {
    throw new Error("missing_demo_config");
  }

  return {
    apiBaseUrl: config.apiBaseUrl.replace(/\/$/, ""),
    routes: config.routes
  };
}
