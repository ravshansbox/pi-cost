# pi-cost

Cost report extension for pi.

## Install

```json
{
  "extensions": ["github:ravshansbox/pi-cost"]
}
```

## Usage

Pi loads the command from `./index.ts`. Run `/cost` to open the cost report UI, then use the tabs to switch between day, week, month, and all-time views.

For example, run `/cost 7` to open the report, inspect the `week` tab for provider totals, and press `Backspace` on a selected provider to remove that provider's assistant messages from session logs.

## Development

```bash
npm install
npm test
npm run typecheck
```
