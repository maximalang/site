import { createProviderCredentialRouteHandler } from "../../../../src/server/provider-credential-http";
import { applicationProviderCredentialDependencies } from "../../../../src/server/runtime-proxy";

export const dynamic = "force-dynamic";

export const POST = createProviderCredentialRouteHandler(applicationProviderCredentialDependencies);
