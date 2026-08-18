# Local AI World edge tunnel

Temporary development flow only:

1. Start Docker Compose locally.
2. Verify `/api/health/live` locally.
3. Run `start-pinggy-tunnel.ps1` and copy the printed `EDGE_URL`.
4. Run `check-edge.ps1 -Url <EDGE_URL>` when you need an explicit health check.
5. Use that temporary HTTPS URL only for local GPT/App integration testing.

The Pinggy tunnel is never a production ingress or release dependency. The helper
does not write its ephemeral URL into the repository and no GitHub Actions workflow
depends on the tunnel.

Production ingress is the Caddy/DNS path documented in `ops/DEPLOYMENT.md`.
