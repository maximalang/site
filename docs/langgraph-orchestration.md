# LangGraph orchestration boundary

AI World uses `@langchain/langgraph` 1.4.8 with
`@langchain/langgraph-checkpoint-postgres` 1.0.4. LangGraph owns workflow
checkpoints, recovery and next-action selection only. Canonical Mission, Task,
Run, Event, Memory and Account records remain in the `agent_world` PostgreSQL
schema.

The workflow stores canonical IDs and bounded orchestration state under a
LangGraph `thread_id` equal to the Mission ID. Nodes return one declarative
pending action and never dispatch a transport or mutate product state. The
caller must apply that action through the canonical domain/store boundary and
then invoke the graph with the resulting Task/Run/Event IDs. This makes replay
safe: restoring a checkpoint cannot repeat an external side effect by itself.

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

Mission decomposition, canonical action application, structured meetings and
the owner Mission UI remain subsequent slices; the workflow package must not be
presented as their completion.
