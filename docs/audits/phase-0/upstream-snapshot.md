# Upstream snapshot

Observed on 2026-08-13. SHAs are immutable evidence anchors; release tags are
informational because several projects develop ahead of their latest release.
License values in this table are initial GitHub API observations and are not the
final legal classification.

Revalidation at `2026-08-13T08:11:04+03:00` found all 27 repositories available
and non-archived. Remote HEAD still matched 26 pinned SHAs. OpenClaw had advanced
from the audited `b05d2308...` to `f8fcfe34...` during the audit window. The
table intentionally preserves the immutable source revision actually inspected;
Phase 1 must upgrade it as an explicit dependency change and rerun its contract
audit instead of silently moving the evidence anchor.

| Repository | Default branch | HEAD SHA | Latest observed release | GitHub license |
| --- | --- | --- | --- | --- |
| `openclaw/openclaw` | `main` | `b05d2308e7a58be5e2b4a8b5d2823e0a217b3425` | `v2026.7.1-2` | unrecognized |
| `geezerrrr/agent-town` | `main` | `e81a218dd376f37870290cc0c307a165475a303d` | `v0.4.1` | missing |
| `rafapetter/agent-town` | `main` | `78e8e91b9c2620ff8048377f12048412ed603028` | none | MIT |
| `eliautobot/my-virtual-office` | `main` | `0c8ff7e9abaee3d02117decbe1f1bbd6ffeafd76` | `v0.7.3` | AGPL-3.0 |
| `Pixel-Process-UG/agent-office` | `main` | `da62eee3bb054d0500b15ace53dd005adcfa512d` | `v0.3.0` | MIT |
| `harishkotra/agent-office` | `main` | `b00de4e8615c02605be7b90694dccda55d5d8168` | none | MIT |
| `pixel-agents-hq/pixel-agents` | `main` | `0f823e2842b66e472aab747829fd05b7a5c655c4` | `v1.4.0` | MIT |
| `bagidea/bagidea-office` | `main` | `a4f69333ce2fcd9feef3a73642d5c6c270a6c36a` | `v0.9.49` | MIT |
| `a16z-infra/ai-town` | `main` | `7b242334bfbfef02f7718bded120d431e8f307df` | none | MIT |
| `TianyiDataScience/openclaw-control-center` | `main` | `5d1e3245d9540b676aca7069c3f900bb36d8d44f` | none | MIT |
| `daggerhashimoto/openclaw-nerve` | `master` | `312e27333e14f841b95bf4f2b205a856b4a4c370` | `v1.5.3` | MIT |
| `openagents-org/openagents` | `develop` | `4e94efe4391166c5ce9a38c5eb9d7cda2aad3306` | `launcher-v0.9.7` | Apache-2.0 |
| `iOfficeAI/AionUi` | `main` | `0864694ef3bd8a280a1885a132bf65b8a68bf014` | `v2.1.54` | Apache-2.0 |
| `BerriAI/litellm` | `v1.96.2` | `83d6d84bfb7abbbff70d456bc89028d426db8c33` | `v1.96.2` | `ghcr.io/berriai/litellm@sha256:154e23bb5f31b1f10e16392a8ef299bd2cde08de3a64a6849002cfcc25ce3c63` |
| `maximhq/bifrost` | `dev` | `c556c60c582e3d4d32a53b206d129648f076e628` | `ent-v1.5.10-base` | Apache-2.0 |
| `langchain-ai/langgraph` | `main` | `644815f9e5bc52ad8f7a5227a456227e9c3e639b` | `1.2.11` | MIT |
| `getzep/graphiti` | `main` | `d40da88f202c0eba5b2c4164d1c912bd663a0159` | `v0.29.3` | Apache-2.0 |
| `FalkorDB/FalkorDB` | `main` | `8512cbad3da9b881bdd5a1ece0ae6f9b6778891e` | `v4.20.2` | unrecognized |
| `pgvector/pgvector` | `master` | `521957586f952754bd631159bb03e9f30fdb9b2a` | none | unrecognized |
| `jacomyal/sigma.js` | `main` | `d32c4e5bfd4c5f49724ebc21bd786b01be555dac` | `sigma@3.0.3` | MIT |
| `graphology/graphology` | `master` | `b6e4b31ac0d68aaff36600c19faa0c751db6d015` | `0.26.0` | MIT |
| `xyflow/xyflow` | `main` | `6eee160629a1c29267e1ae35ecabf4c9cc8d63e1` | `@xyflow/svelte@1.6.3` | MIT |
| `langfuse/langfuse` | `main` | `f1206115b29d8ddc83a51350834ccd7f8c2fba2f` | `v4.10.0` | unrecognized |
| `n8n-io/n8n` | `master` | `cbb55770537b0874f684dab9dda992d461bd577a` | `n8n@2.34.5` | unrecognized |
| `docker/mcp-gateway` | `main` | `24b028f4f9aac85ce1a1057c5e8d739836e7c18d` | none | MIT |
| `steel-dev/steel-browser` | `main` | `5880b48c1af107219ff3d904edbb8f6b76bea9b6` | `v0.5.3-beta` | Apache-2.0 |
| `openai/codex` | `main` | `902bd9e06b3ecb32cbf7f8e64cd23b956be3e7fe` | `rust-v0.147.0` | Apache-2.0 |

## Primary repository sources

Each repository is available at `https://github.com/<repository>`. Current
product documentation will be linked from the component audit that relies on it.
