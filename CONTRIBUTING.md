# Contributing

Thank you for your interest. Issues are welcome in English: bug reports and ideas. Security problems go through a private report, see below.

## How changes land

This repository is a mirror of the development tree. The code arrives here as one commit per version, `Release vX.Y.Z` (the first one is `Initial release vX.Y.Z`), tagged `vX.Y.Z`. We do not accept pull requests. If you want to change something, open an issue; if the idea fits, we will implement it and credit you in the release notes.

The rest of this file describes the rules the code follows, so that issues and reviews speak the same language.

## Checks

- `scripts/check` is green: typecheck, ESLint, Prettier and Vitest.
- New behaviour comes with tests. A bug fix comes with a test that fails without it.

## Code style

- TypeScript everywhere, Vue 3 with `<script setup lang="ts">` in the interface. Formatting is Prettier, rules are ESLint; the lint config changes only together with the code that needs the new rule.
- Comments only explain *why*, when the code cannot show it: a library bug workaround, a quirk of the Minecraft protocol or of Windows. They are written in English. Everything else should be clear from small functions and explicit names and types.
- Minecraft versions look like `1.21.11` and `26.2`. Never assume a version starts with `1.`.
- Time is stored and sent in UTC and shown in Moscow time.
- Dependencies are pinned to exact versions (`save-exact`) and should be the latest stable release.

## Interface

- Interface strings live only in `src/shared/i18n/`; components and screens never contain text. The interface is Russian only for now; `ru.ts` and the `*.ru.ts` files next to it hold all strings, so a translation will not require code changes.
- Colours, radii, shadows and fonts come only from the `--mc-*` tokens in `design/shared/tokens.css`. No raw hex, rgb or named colours. Fonts are system fonts only; icons are Bootstrap Icons.
- Accessibility: text contrast at least 4.5:1, a visible `:focus-visible`, `aria-label` on icon buttons, status never shown by colour alone.
- Errors are explained in plain language with an action, not a stack trace.

## Security

- Keep `contextIsolation` and `sandbox` on. The renderer never imports Node.js or Electron; new capabilities go through the typed API in `src/preload` and are validated in `src/main`.
- Everything the launcher downloads and runs is checked against a known hash before launch: Mojang files against Mojang's manifests, Fabric libraries against the Fabric profile or the Maven `.sha1` files, mods against the SHA-256 the website publishes. Do not add downloads without a hash check, and do not load interface code from the network.
- No secrets in the client. Do not commit keys, tokens, internal URLs or personal data.
- Report vulnerabilities privately through GitHub security advisories, not in public issues.

## Licence

By contributing you agree that your contribution is licensed under GPL-3.0-only. The MC Monitor name, logo and artwork are not part of the licence, see `ASSETS.md`. Do not add images, fonts or other assets without a licence that allows it, and name the source in the issue.
