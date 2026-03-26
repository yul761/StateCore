import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

type DemoWebRouteMap = typeof import("@project-memory/contracts").DemoWebRoutes;

const demoWebRoutes: DemoWebRouteMap = {
  health: "/health",
  createScope: "/scopes",
  listScopes: "/scopes",
  setActiveScope: "/scopes/:id/active",
  getActiveState: "/state",
  runtimeTurn: "/memory/runtime/turn",
  workingState: "/memory/working-state",
  stableState: "/memory/stable-state",
  fastView: "/memory/fast-view",
  layerStatus: "/memory/layer-status"
};

async function start() {
  const app = express();
  const port = Number(process.env.DEMO_WEB_PORT || 3100);
  const apiBaseUrl = process.env.DEMO_API_BASE_URL || process.env.API_BASE_URL || "http://localhost:3000";
  const serverFile = fileURLToPath(import.meta.url);
  const appRoot = path.resolve(path.dirname(serverFile), "..");
  const isProduction = process.env.NODE_ENV === "production";

  app.use(express.json());

  app.use(async (req, res, next) => {
    const shouldProxy =
      req.path === "/health" || req.path === "/state" || req.path.startsWith("/scopes") || req.path.startsWith("/memory");

    if (!shouldProxy) {
      next();
      return;
    }

    try {
      const upstreamUrl = new URL(req.originalUrl, apiBaseUrl);
      const upstreamHeaders = new Headers();

      for (const [key, value] of Object.entries(req.headers)) {
        if (!value) continue;
        if (key === "host" || key === "content-length" || key === "connection") continue;
        upstreamHeaders.set(key, Array.isArray(value) ? value.join(", ") : value);
      }

      const upstreamResponse = await fetch(upstreamUrl, {
        method: req.method,
        headers: upstreamHeaders,
        body:
          req.method === "GET" || req.method === "HEAD"
            ? undefined
            : req.body !== undefined && Object.keys(req.body || {}).length
              ? JSON.stringify(req.body)
              : undefined
      });

      const responseText = await upstreamResponse.text();
      res.status(upstreamResponse.status);
      const contentType = upstreamResponse.headers.get("content-type");
      if (contentType) {
        res.setHeader("content-type", contentType);
      }
      res.send(responseText);
    } catch (error) {
      next(error);
    }
  });

  app.get("/config.js", (_req, res) => {
    res.type("application/javascript");
    res.send(
      `window.PROJECT_MEMORY_DEMO_CONFIG = ${JSON.stringify({
        apiBaseUrl: "",
        routes: demoWebRoutes
      })};\n`
    );
  });

  if (isProduction) {
    const clientDir = path.resolve(appRoot, "dist/client");
    app.use(express.static(clientDir));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(clientDir, "index.html"));
    });
  } else {
    const { createServer } = await import("vite");
    const vite = await createServer({
      root: appRoot,
      server: {
        middlewareMode: true
      },
      appType: "custom"
    });

    app.use(vite.middlewares);

    app.get("*", async (req, res, next) => {
      try {
        const templatePath = path.resolve(appRoot, "index.html");
        const template = await fs.readFile(templatePath, "utf8");
        const html = await vite.transformIndexHtml(req.originalUrl, template);
        res.status(200).set({ "Content-Type": "text/html" }).end(html);
      } catch (error) {
        vite.ssrFixStacktrace(error as Error);
        next(error);
      }
    });
  }

  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`demo-web listening on http://localhost:${port}`);
  });
}

void start();
