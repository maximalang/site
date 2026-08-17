import { bootstrapNativeChatSecrets } from "./bootstrap-secrets.js";

const directory = process.argv[2];

try {
  const result = await bootstrapNativeChatSecrets(directory);
  process.stdout.write(
    `AI World native Chat secrets created:\n${result.jwksPath}\n${result.cookieKeysPath}\n`,
  );
} catch (error) {
  process.stderr.write(
    `Secret bootstrap failed: ${error instanceof Error ? error.message : "unknown error"}\n`,
  );
  process.exitCode = 1;
}
