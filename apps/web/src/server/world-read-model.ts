import { buildUnavailableWorldReadModel, type WorldReadModel } from "@agent-world/read-model";
import { buildContractFixture } from "../test-fixtures";

type ProviderOptions = {
  dataSource: string | undefined;
  environment: string | undefined;
  now: () => Date;
};

export type WorldReadModelProvider = () => Promise<WorldReadModel>;

export function createWorldReadModelProvider(options: ProviderOptions): WorldReadModelProvider {
  return async () => {
    const generatedAt = options.now().toISOString();
    if (options.environment !== "production" && options.dataSource === "contract-fixture") {
      return buildContractFixture(generatedAt);
    }
    return buildUnavailableWorldReadModel(generatedAt);
  };
}

export const readWorldReadModel = createWorldReadModelProvider({
  dataSource: process.env.AGENT_WORLD_DATA_SOURCE,
  environment: process.env.NODE_ENV,
  now: () => new Date(),
});
