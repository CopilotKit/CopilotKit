# Teams app package

The Teams app manifest + icons you sideload into Microsoft Teams to install the
bot. Build the `.zip` with one command, then upload it in **Teams → Apps →
Manage your apps → Upload a custom app**.

## Build it

From `examples/teams`:

```sh
pnpm package
```

This validates everything Teams needs and writes `appPackage/appPackage.zip`:

- **Bot id:** read from `MICROSOFT_APP_ID` / `CLIENT_ID` / `clientId` (env or
  `examples/teams/.env`) and injected into `manifest.json`'s `bots[0].botId`, so
  the committed manifest stays a placeholder and you never hardcode your id. Must
  be the **Application (client) ID** (a GUID) of the Entra app bound to your
  Azure Bot.
- **Icons:** `color.png` (192×192) and `outline.png` (32×32). Auto-generated as
  CopilotKit-purple placeholders if missing; drop in your own PNGs of those exact
  sizes to brand it.
- **Manifest:** checked for valid JSON and the required bot fields.

If something's missing the script tells you exactly what and how to fix it.

## What's here

- `manifest.json`: the app manifest template (`botId` is a placeholder; the
  build injects the real one). Edit `developer` / `name` / `description` to taste.
- `color.png` / `outline.png`: placeholder icons (regenerated if deleted).
- `package.mjs`: the dependency-free build script (`pnpm package`).
- `appPackage.zip`: the build output (gitignored).

The bot only **replies** once your hosted endpoint is set as the Azure Bot
**messaging endpoint**. Installing the package just registers the bot in Teams.
