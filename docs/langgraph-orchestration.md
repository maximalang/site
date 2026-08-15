# LangGraph orchestration boundary

AI World uses `@langchain/langgraph` 1.4.8 with
`@langchain/langgraph-checkpoint-postgres` 1.0.4. LangGraph owns workflow
checkpoints, recovery and next-action selection only. Canonical Mission, Task,
Run, Event, Memory and Account records remain in the `agent_world` PostgreSQL
schema.

The workflow stores canonical IDs and bounded orchestration state under a
LangGraph `thread_id` equal to the Mission ID. Nodes return one declarative
pending action and never dispatch a transport or mutate product state. The
production runtime applies selected actions only through canonical
domain/store boundaries. Mission decomposition atomically materializes
transport-neutral Tasks and dependency edges. A restart-safe PostgreSQL
supervisor activates a downstream approval only after every predecessor has a
canonical `COMPLETED` Run, records one provenance-linked handoff edge per
dependency and renews the bounded approval window. Restoring a checkpoint or
repeating a supervisor tick therefore cannot repeat an external side effect.

The production saver uses the separate `agent_world_langgraph` schema in the
same PostgreSQL database. Its `setup()` migrations run explicitly when the
checkpointer is provisioned. The isolated verifier destroys its disposable
database and proves recovery in a new saver/process boundary:

```powershell
$env:AGENT_WORLD_LANGGRAPH_TEST_ACK='isolated'
npm.cmd run test:orchestration
```

Current source contracts:

- LangGraph persistence and `thread_id`:
  <https://docs.langchain.com/oss/javascript/langgraph/persistence>
- production PostgreSQL checkpointer and required `setup()`:
  <https://reference.langchain.com/javascript/langchain-langgraph-checkpoint-postgres/index/PostgresSaver>
- functional API recovery semantics:
  <https://docs.langchain.com/oss/javascript/langgraph/use-functional-api>

Mission decomposition, canonical Task materialization and structured meetings
are implemented. Automatic handoff activation is implemented without bypassing
approval policy; policy-authorized downstream dispatch and the complete owner
Mission UI remain separate acceptance gaps.
