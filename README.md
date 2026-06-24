# pi-cost

Cost report extension for pi.

## Install

```json
{
  "extensions": ["github:ravshansbox/pi-cost"]
}
```

## Usage

Pi loads the command from `./index.ts`. Run `/cost` to open the cost report UI above the editor, then use the tabs to switch between day, week, month, and all views.

For example, run `/cost`, inspect the `week` tab for provider totals, and press `Backspace` on a selected provider to remove that provider's assistant messages from session logs, including mapped multi-provider entries such as Claude Multi.

## Development

```bash
npm install
npm test
npm run typecheck
```

Tests run with Node's built-in test runner.
