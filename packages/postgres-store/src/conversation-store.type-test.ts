import type { Pool } from "pg";
import { PostgresConversationStore, type TransactionPool } from "./conversation-store.js";

declare const pgPool: Pool;
declare const transactionPool: TransactionPool;

new PostgresConversationStore(pgPool);
new PostgresConversationStore(transactionPool);
