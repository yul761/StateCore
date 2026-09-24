import { defineConfig } from "tsup";

// `@statecore/core` and `@statecore/prompts` are inlined so the published
// bundle has no workspace dependency. The two runtime dependencies stay
// external and are declared in package.json. The store is `node:sqlite`, a
// Node builtin — nothing native to locate at runtime, nothing to generate at
// install time.
const noExternal = ["@statecore/core", "@statecore/prompts"];
// `@statecore/db` stays external even though this package no longer depends
// on it: `@statecore/core` (inlined) still carries a lazy `import("@statecore/db")`
// in relationship-context.ts, a path the embedded backend never executes.
// Left unresolved it is a harmless dead `require` in the bundle; resolved, it
// would need the package installed at bundle time (it is not, since sub-project 1).
const external = ["@modelcontextprotocol/sdk", "zod", "@statecore/db"];

export default [
  defineConfig({
    entry: ["src/main.ts"],
    format: ["cjs"],
    platform: "node",
    target: "node22",
    // dist/main.js is the package's `bin`. npm's .bin shim execs the file
    // directly, so without a shebang the shell interprets JavaScript as shell
    // ("use strict: command not found") — shipped broken in 0.1.0, where every
    // test ran `node dist/main.js` and nothing exercised the bin path itself.
    // The `src/lib.ts` entry below must NOT get this banner: it is imported as
    // a module (`statecore-mcp/lib`), never executed, and the e2e test pins
    // `dist/main.js`'s first line as the shebang specifically.
    banner: { js: "#!/usr/bin/env node" },
    noExternal,
    external,
    // tsup's default node-protocol plugin strips the `node:` prefix from
    // every `node:*` import so it can mark it external under its bare name —
    // fine for `fs`/`path`, which resolve either way, but `node:sqlite` (like
    // `node:test`) is prefix-only and has no unprefixed alias, so the
    // stripped `require("sqlite")` throws MODULE_NOT_FOUND at runtime.
    removeNodeProtocol: false,
    clean: true
  }),
  defineConfig({
    entry: ["src/lib.ts"],
    format: ["cjs", "esm"],
    platform: "node",
    target: "node22",
    dts: true,
    noExternal,
    external,
    removeNodeProtocol: false,
    // Bundled dependencies (pino, transitively via @statecore/core's
    // noExternal inlining above) call Node builtins through plain
    // `require(...)`. esbuild wraps every such call in a `__require` helper
    // that falls back to the real global `require` when one is in scope, but
    // ESM has no such global — tsup's `shims` option covers `__dirname`/
    // `__filename`/`import.meta.url` but not this one, so without a `require`
    // binding in scope `dist/lib.mjs` throws "Dynamic require of ... is not
    // supported" the first time such a call runs. This banner defines one
    // via `createRequire(import.meta.url)`, which `__require`'s fallback then
    // picks up. The CJS output needs neither: `require` is already a real
    // global there.
    shims: true,
    esbuildOptions(options, context) {
      if (context.format === "esm") {
        options.banner = {
          ...options.banner,
          js: [
            options.banner?.js,
            'import { createRequire as __createRequire } from "node:module";',
            "const require = __createRequire(import.meta.url);"
          ]
            .filter(Boolean)
            .join("\n")
        };
      }
    },
    // The main-entry config above already cleans `dist/` once; a second clean
    // here would delete what it just built.
    clean: false
  })
];
