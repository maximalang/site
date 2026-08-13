import type {
  AccountId,
  AgentId,
  CanonicalModelId,
  ModelRouteId,
  ProviderId,
  SkillId,
  ToolId,
} from "./index.js";

declare const accountId: AccountId;
declare const agentId: AgentId;
declare const modelId: CanonicalModelId;
declare const modelRouteId: ModelRouteId;
declare const providerId: ProviderId;
declare const skillId: SkillId;
declare const toolId: ToolId;

function acceptsProviderId(_id: ProviderId): void {}
function acceptsModelId(_id: CanonicalModelId): void {}
function acceptsModelRouteId(_id: ModelRouteId): void {}
function acceptsSkillId(_id: SkillId): void {}
function acceptsToolId(_id: ToolId): void {}

acceptsProviderId(providerId);
acceptsModelId(modelId);
acceptsModelRouteId(modelRouteId);
acceptsSkillId(skillId);
acceptsToolId(toolId);

// @ts-expect-error Account identity cannot be used as Provider identity.
acceptsProviderId(accountId);

// @ts-expect-error Agent identity cannot be used as CanonicalModel identity.
acceptsModelId(agentId);

// @ts-expect-error CanonicalModel identity cannot be used as ModelRoute identity.
acceptsModelRouteId(modelId);

// @ts-expect-error Tool identity cannot be used as Skill identity.
acceptsSkillId(toolId);

// @ts-expect-error Skill identity cannot be used as Tool identity.
acceptsToolId(skillId);
