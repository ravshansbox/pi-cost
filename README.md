# pi-cost

Cost report extension for pi.

## Install

```bash
pi install npm:@ravshansbox/pi-cost
```

Add `-l` to install it in project settings.

## Usage

Pi loads the extension from `./index.ts`. Run `/cost` in the TUI to open the cost report UI above the editor, then use the tabs to switch between day, week, month, and all views. In other modes, `/cost` shows an error instead.

For example, run `/cost`, inspect the `week` tab for provider totals, and press `Backspace` on a selected provider to remove that provider's assistant messages from session logs, including mapped multi-provider entries such as Claude Multi.

## Development

```bash
npm install
npm run check
```
