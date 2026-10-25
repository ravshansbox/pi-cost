import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import extension from './index.ts';

const KEYS = {
  left: '\x1b[D',
  right: '\x1b[C',
  up: '\x1b[A',
  down: '\x1b[B',
  enter: '\r',
  backspace: '\x7f',
};

type Component = { handleInput(data: string): void; render(width: number): string[] };

function setupAgentDir(files: Record<string, object[]>): string {
  const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-cost-'));
  const sessionDir = path.join(agentDir, 'sessions', 'project');
  fs.mkdirSync(sessionDir, { recursive: true });
  for (const [name, entries] of Object.entries(files)) {
    fs.writeFileSync(
      path.join(sessionDir, name),
      entries.map((e) => JSON.stringify(e)).join('\n') + '\n',
    );
  }
  process.env['PI_CODING_AGENT_DIR'] = agentDir;
  return sessionDir;
}

function assistant(provider: string, cost: number, daysAgo = 0): object {
  const timestamp = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  return {
    type: 'message',
    timestamp,
    message: {
      role: 'assistant',
      provider,
      model: `${provider}-model`,
      usage: { cost: { total: cost } },
    },
  };
}

async function openCost(args = ''): Promise<Component> {
  let handler: ((args: string, ctx: unknown) => Promise<void>) | undefined;
  const pi = {
    registerCommand: (_name: string, opts: { handler: typeof handler }) => {
      handler = opts.handler;
    },
  };
  extension(pi as never);
  let component: Component | undefined;
  const theme = { fg: (_c: string, s: string) => s, bold: (s: string) => `*${s}*` };
  const ctx = {
    hasUI: true,
    ui: {
      notify: () => {},
      custom: (factory: (...a: unknown[]) => Component) => {
        component = factory({ requestRender: () => {} }, theme, {}, () => {});
        return new Promise(() => {});
      },
    },
  };
  void handler!(args, ctx);
  await settle();
  return component!;
}

function settle(ms = 100): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function screen(component: Component): string {
  return component.render(80).join('\n');
}

test('shows provider totals for the selected tab', async () => {
  setupAgentDir({
    'a.jsonl': [assistant('anthropic', 1.5), assistant('openai', 2, 10)],
  });
  const cost = await openCost();
  assert.match(screen(cost), /claude\* \$1\.5000/);
  assert.doesNotMatch(screen(cost), /openai/);
  cost.handleInput(KEYS.left);
  await settle();
  assert.match(screen(cost), /openai\* \$2\.0000/);
});

test('keeps the cursor on a visible provider after switching tabs', async () => {
  setupAgentDir({
    'a.jsonl': [
      assistant('anthropic', 1),
      assistant('anthropic', 1, 10),
      assistant('openai', 5, 10),
    ],
  });
  const cost = await openCost();
  cost.handleInput(KEYS.left);
  await settle();
  cost.handleInput(KEYS.down);
  cost.handleInput(KEYS.right);
  await settle();
  assert.match(screen(cost), /> \*+claude/);
});

test('shows the latest tab when an earlier scan finishes last', async (t) => {
  setupAgentDir({ 'a.jsonl': [assistant('anthropic', 1), assistant('openai', 5, 10)] });
  const cost = await openCost();
  const readdir = fs.promises.readdir;
  let delayed = false;
  t.mock.method(fs.promises, 'readdir', async (...args: unknown[]) => {
    if (!delayed) {
      delayed = true;
      await settle(200);
    }
    return (readdir as (...a: unknown[]) => unknown)(...args);
  });
  cost.handleInput(KEYS.left);
  cost.handleInput(KEYS.right);
  await settle(400);
  assert.doesNotMatch(screen(cost), /openai/);
});

test('skips session files it cannot read', async () => {
  const sessionDir = setupAgentDir({
    'a.jsonl': [assistant('anthropic', 1)],
    'b.jsonl': [assistant('openai', 2)],
  });
  fs.chmodSync(path.join(sessionDir, 'a.jsonl'), 0o000);
  const cost = await openCost();
  assert.match(screen(cost), /openai\* \$2\.0000/);
});

test('keeps a provider listed when deleting it fails', async () => {
  const sessionDir = setupAgentDir({ 'a.jsonl': [assistant('anthropic', 1)] });
  fs.chmodSync(path.join(sessionDir, 'a.jsonl'), 0o444);
  const rejections: unknown[] = [];
  const onRejection = (reason: unknown) => rejections.push(reason);
  process.on('unhandledRejection', onRejection);
  const cost = await openCost();
  cost.handleInput(KEYS.backspace);
  await settle();
  process.off('unhandledRejection', onRejection);
  assert.deepEqual(rejections, []);
  assert.match(screen(cost), /claude\* \$1\.0000/);
});
