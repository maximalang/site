# Local laptop visual preview

This preview is for owner-side visual inspection only. It is intentionally separate from production activation and never claims live runtime evidence.

## Requirements

- Node.js 24.x (the repository currently requires 24.15.x)
- npm 11.x
- no PostgreSQL, Docker, LiteLLM, OpenClaw or external credentials are required

## Start

From the repository root:

```powershell
npm run preview:local
```

On first launch the command installs the pinned workspace if `node_modules` is absent, builds the TypeScript project references, starts the real Next.js UI on an internal loopback port, then exposes a loopback-only preview at:

```text
http://127.0.0.1:3210
```

The script also tries to open the default browser automatically. Pass `-- --no-open` when you only want the URL printed.

## What is real

The preview uses the repository's actual Next.js application, components, CSS, responsive behavior and client-side schemas. World, Command, Hub, Memory Center and the conversation drawer receive bounded contract fixtures through a loopback proxy so they can be reviewed without owner infrastructure.

## What is not real

- no production PostgreSQL is contacted;
- no model, Codex, OpenClaw, Native Chat, Graphiti or integration credential is used;
- no external origin is required;
- mutations are rejected with `LOCAL_PREVIEW_READ_ONLY`;
- the World read model reports `CONTRACT_FIXTURE`, so the UI keeps its visible non-live warning.

The proxy binds only to `127.0.0.1`. It is not a LAN or public preview server.

## Stop

Press `Ctrl+C` in the terminal that started the preview.

For production or owner-live acceptance, use the deployment and live-proof procedures under `ops/DEPLOYMENT.md` and `docs/live-acceptance.md` instead.
