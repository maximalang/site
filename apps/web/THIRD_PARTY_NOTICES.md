# Third-party notices

## a16z-infra/ai-town

- Repository: <https://github.com/a16z-infra/ai-town>
- License: MIT; full text in
  [`third-party/a16z-infra-ai-town-LICENSE.txt`](third-party/a16z-infra-ai-town-LICENSE.txt)

Phase 6 uses AI Town as an implementation reference for game-first composition,
canvas viewport interaction, nearest-neighbor pixel rendering, character
selection, character detail context, and visible speaking/thinking cues. No AI
Town tilesheets, character artwork, branded UI, names, Convex simulation code,
or generated media assets are copied into Agent World.

All Phase 6 terrain, props and character sprites are generated from
project-owned code in `ai-town-world.tsx`.

## WW-AI-Lab/openclaw-office

- Repository: <https://github.com/WW-AI-Lab/openclaw-office>
- Audited commit: `def631a4533df2b0c8bb6aa19ef3e07c81f4fbc6`
- License: MIT; full text in
  [`third-party/WW-AI-Lab-openclaw-office-LICENSE.txt`](third-party/WW-AI-Lab-openclaw-office-LICENSE.txt)

The Phase 5 React/SVG office implementation remains only as deprecated legacy
code for non-World compatibility while Phase 6 lands. It is no longer imported
by the owner-facing WORLD renderer. Its third-party notice is retained until
those legacy source files are removed in a later cleanup.
