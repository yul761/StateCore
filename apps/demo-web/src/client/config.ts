type DemoWebRouteMap = typeof import("@project-memory/contracts").DemoWebRoutes;

declare global {
  interface Window {
    PROJECT_MEMORY_DEMO_CONFIG?: {
      apiBaseUrl: string;
      routes: DemoWebRouteMap;
    };
  }
}

export function getDemoConfig() {
  const config = window.PROJECT_MEMORY_DEMO_CONFIG;
  if (!config) {
    throw new Error("missing_demo_config");
  }

  return {
    apiBaseUrl: config.apiBaseUrl.replace(/\/$/, ""),
    routes: config.routes
  };
}
