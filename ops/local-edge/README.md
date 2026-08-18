# Local AI World edge tunnel

Temporary development flow:

1. Start Docker Compose.
2. Verify `/api/health/live` locally.
3. Run `start-pinggy-tunnel.ps1`.
4. Use the generated HTTPS URL for temporary GPT plugin testing.

The tunnel URL is intentionally temporary and should not replace production ingress.

The helper updates `ops/agent-world-edge-upstream.txt` for validation workflows.
