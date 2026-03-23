/**
 * Cost Report Extension
 *
 * Displays AI provider cost statistics from session logs.
 * Supports filtering by time range (week, month, all time) and allows
 * deleting provider data from sessions.
 *
 * Usage:
 *   /cost [days]  - Show cost report for last N days (default: 7)
 *
 * Controls:
 *   ←→ tabs       - Switch between week/month/all views
 *   ↑↓            - Navigate providers
 *   enter         - Expand/collapse provider details
 *   backspace     - Delete selected provider from sessions
 *   esc           - Close
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { visibleWidth, matchesKey, Key } from "@mariozechner/pi-tui";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as readline from "node:readline";

// =============================================================================
// Types
// =============================================================================

interface DailyCost {
	date: string;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	total: number;
	requests: number;
}

interface ProviderCost {
	provider: string;
	displayName: string;
	days: DailyCost[];
	totalCost: number;
	totalRequests: number;
	models: Map<string, number>;
}

// =============================================================================
// Constants
// =============================================================================

const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
	anthropic: "Claude",
	"anthropic-multi": "Claude Multi",
	openai: "OpenAI",
	"openai-codex": "Codex",
	"openai-codex-multi": "Codex Multi",
	google: "Gemini",
	"google-gemini-cli": "Gemini",
	"github-copilot": "Copilot",
};

const MULTI_PROVIDER_BASES: Record<string, string> = {
	"anthropic-multi": "anthropic",
	"openai-codex-multi": "openai-codex",
};

// =============================================================================
// Helper Functions
// =============================================================================

function formatProviderName(provider: string): string {
	return PROVIDER_DISPLAY_NAMES[provider] || provider;
}

function getEffectiveProvider(
	loggedProvider: string,
	selectedProvider?: string,
	loggedModel?: string,
	selectedModel?: string,
): string {
	if (!selectedProvider) return loggedProvider;
	if (loggedProvider === selectedProvider) return loggedProvider;
	const baseProvider = MULTI_PROVIDER_BASES[selectedProvider];
	if (!baseProvider || loggedProvider !== baseProvider) return loggedProvider;
	if (selectedModel && loggedModel && selectedModel !== loggedModel) return loggedProvider;
	return selectedProvider;
}

// =============================================================================
// Session Log Scanning
// =============================================================================

async function scanSessionLogs(daysBack: number | null = 30): Promise<ProviderCost[]> {
	const sessionsDir = path.join(os.homedir(), ".pi", "agent", "sessions");
	const providerCosts = new Map<string, ProviderCost>();

	const cutoffDate = new Date();
	if (daysBack !== null) {
		cutoffDate.setDate(cutoffDate.getDate() - daysBack);
	} else {
		cutoffDate.setTime(0);
	}

	if (!fs.existsSync(sessionsDir)) {
		return [];
	}

	const sessionDirs = fs
		.readdirSync(sessionsDir, { withFileTypes: true })
		.filter((d) => d.isDirectory())
		.map((d) => path.join(sessionsDir, d.name));

	for (const dir of sessionDirs) {
		const files = fs
			.readdirSync(dir)
			.filter((f) => f.endsWith(".jsonl"))
			.map((f) => path.join(dir, f));

		for (const file of files) {
			await scanSessionFile(file, cutoffDate, providerCosts);
		}
	}

	return Array.from(providerCosts.values()).sort((a, b) => b.totalCost - a.totalCost);
}

async function scanSessionFile(
	filePath: string,
	cutoffDate: Date,
	providerCosts: Map<string, ProviderCost>,
): Promise<void> {
	const fileStream = fs.createReadStream(filePath);
	const rl = readline.createInterface({
		input: fileStream,
		crlfDelay: Infinity,
	});

	let selectedProvider: string | undefined;
	let selectedModel: string | undefined;

	for await (const line of rl) {
		try {
			const entry = JSON.parse(line);
			if (entry.type === "model_change") {
				selectedProvider = entry.provider || selectedProvider;
				selectedModel = entry.modelId || selectedModel;
				continue;
			}

			if (entry.type === "message" && entry.message?.role === "assistant") {
				const msg = entry.message;
				const timestamp = new Date(entry.timestamp || msg.timestamp);
				if (timestamp < cutoffDate) continue;

				const model = msg.model || "unknown";
				const provider = getEffectiveProvider(
					msg.provider || "unknown",
					selectedProvider,
					model,
					selectedModel,
				);
				const usage = msg.usage;

				if (!usage?.cost) continue;

				const dateKey = timestamp.toISOString().split("T")[0];

				if (!providerCosts.has(provider)) {
					providerCosts.set(provider, {
						provider,
						displayName: formatProviderName(provider),
						days: [],
						totalCost: 0,
						totalRequests: 0,
						models: new Map(),
					});
				}

				const pc = providerCosts.get(provider)!;
				let day = pc.days.find((d) => d.date === dateKey);
				if (!day) {
					day = {
						date: dateKey,
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						total: 0,
						requests: 0,
					};
					pc.days.push(day);
				}

				day.input += usage.cost.input || 0;
				day.output += usage.cost.output || 0;
				day.cacheRead += usage.cost.cacheRead || 0;
				day.cacheWrite += usage.cost.cacheWrite || 0;
				day.total += usage.cost.total || 0;
				day.requests += 1;
				pc.totalCost += usage.cost.total || 0;
				pc.totalRequests += 1;

				const modelCost = pc.models.get(model) || 0;
				pc.models.set(model, modelCost + (usage.cost.total || 0));
			}
		} catch {
			// Skip malformed lines
		}
	}
}

// =============================================================================
// Provider Deletion
// =============================================================================

async function deleteProviderFromSessions(provider: string): Promise<void> {
	const sessionsDir = path.join(os.homedir(), ".pi", "agent", "sessions");
	if (!fs.existsSync(sessionsDir)) return;

	const sessionDirs = fs
		.readdirSync(sessionsDir, { withFileTypes: true })
		.filter((d) => d.isDirectory())
		.map((d) => path.join(sessionsDir, d.name));

	for (const dir of sessionDirs) {
		const files = fs
			.readdirSync(dir)
			.filter((f) => f.endsWith(".jsonl"))
			.map((f) => path.join(dir, f));

		for (const file of files) {
			const fileStream = fs.createReadStream(file);
			const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
			const kept: string[] = [];
			let modified = false;

			for await (const line of rl) {
				if (!line.trim()) continue;
				try {
					const entry = JSON.parse(line);
					if (entry.type === "message" && entry.message?.role === "assistant") {
						const msgProvider = entry.message.provider || "unknown";
						if (msgProvider === provider) {
							modified = true;
							continue;
						}
					}
					kept.push(line);
				} catch {
					kept.push(line);
				}
			}

			if (modified) {
				await fs.promises.writeFile(file, kept.join("\n") + "\n");
			}
		}
	}
}

// =============================================================================
// UI Component
// =============================================================================

class CostComponent {
	private costs: ProviderCost[] = [];
	private loading = true;
	private tui: { requestRender: () => void };
	private theme: any;
	private onClose: () => void;
	private daysBack: number;
	private expanded: string | null = null;
	private cursor = 0;
	private currentTab = 0;
	private tabs: { label: string; days: number | null }[] = [
		{ label: "week", days: 7 },
		{ label: "month", days: 30 },
		{ label: "all", days: null },
	];

	constructor(
		tui: { requestRender: () => void },
		theme: any,
		onClose: () => void,
		daysBack: number,
	) {
		this.tui = tui;
		this.theme = theme;
		this.onClose = onClose;
		this.daysBack = daysBack;
		this.currentTab = this.tabs.findIndex((t) => t.days === daysBack);
		if (this.currentTab === -1) this.currentTab = 0;
		this.load();
	}

	private async load() {
		const days = this.tabs[this.currentTab].days;
		this.costs = await scanSessionLogs(days);
		this.loading = false;
		this.tui.requestRender();
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.escape)) {
			this.onClose();
		} else if (matchesKey(data, Key.left)) {
			if (this.tabs.length > 1) {
				this.currentTab = (this.currentTab - 1 + this.tabs.length) % this.tabs.length;
				this.load();
			}
		} else if (matchesKey(data, Key.right)) {
			if (this.tabs.length > 1) {
				this.currentTab = (this.currentTab + 1) % this.tabs.length;
				this.load();
			}
		} else if (matchesKey(data, Key.up)) {
			if (this.costs.length > 0) {
				this.cursor = (this.cursor - 1 + this.costs.length) % this.costs.length;
				this.tui.requestRender();
			}
		} else if (matchesKey(data, Key.down)) {
			if (this.costs.length > 0) {
				this.cursor = (this.cursor + 1) % this.costs.length;
				this.tui.requestRender();
			}
		} else if (matchesKey(data, Key.enter)) {
			if (this.costs.length > 0) {
				const pc = this.costs[this.cursor];
				this.expanded = this.expanded === pc.provider ? null : pc.provider;
				this.tui.requestRender();
			}
		} else if (matchesKey(data, Key.backspace)) {
			if (this.costs.length > 0 && !this.loading) {
				const pc = this.costs[this.cursor];
				this.costs.splice(this.cursor, 1);
				if (this.cursor >= this.costs.length) {
					this.cursor = Math.max(0, this.costs.length - 1);
				}
				this.tui.requestRender();
				deleteProviderFromSessions(pc.provider);
			}
		}
	}

	invalidate(): void {}

	render(width: number): string[] {
		const t = this.theme;
		const dim = (s: string) => t.fg("muted", s);
		const bold = (s: string) => t.bold(s);
		const accent = (s: string) => t.fg("accent", s);
		const success = (s: string) => t.fg("success", s);
		const warning = (s: string) => t.fg("warning", s);

		const totalW = width;
		const innerW = totalW - 4;
		const hLine = "─".repeat(totalW - 2);

		const box = (content: string) => {
			const contentW = visibleWidth(content);
			const pad = Math.max(0, innerW - contentW);
			return dim("│ ") + content + " ".repeat(pad) + dim(" │");
		};

		const lines: string[] = [];
		lines.push(dim(`╭${hLine}╮`));
		lines.push(box(bold(accent(`cost`))));

		const tabLine: string[] = [];
		for (let i = 0; i < this.tabs.length; i++) {
			const tab = this.tabs[i];
			const isActive = i === this.currentTab;
			const tabText = isActive ? bold(tab.label) : dim(tab.label);
			tabLine.push(tabText);
			if (i < this.tabs.length - 1) {
				tabLine.push(dim("·"));
			}
		}
		lines.push(box(tabLine.join(" ")));

		lines.push(dim(`├${hLine}┤`));

		if (this.loading) {
			lines.push(box("scanning session logs..."));
		} else if (this.costs.length === 0) {
			lines.push(box(dim("no usage data found")));
		} else {
			let grandTotal = 0;
			let idx = 0;

			for (const pc of this.costs) {
				grandTotal += pc.totalCost;
				const costStr = `$${pc.totalCost.toFixed(4)}`;
				const color = pc.totalCost > 1 ? warning : success;
				const cursorMark = idx === this.cursor ? bold(accent("> ")) : "  ";

				lines.push(
					box(
						`${cursorMark}${bold(pc.displayName.toLowerCase())} ${color(costStr)} ${dim(`(${pc.totalRequests} requests)`)}`,
					),
				);

				if (this.expanded === pc.provider) {
					const sortedModels = Array.from(pc.models.entries())
						.sort((a, b) => b[1] - a[1])
						.slice(0, 3);

					for (const [model, cost] of sortedModels) {
						const shortModel = model.length > 25 ? model.substring(0, 22) + "..." : model;
						lines.push(box(dim(`    ${shortModel.toLowerCase()}: $${cost.toFixed(4)}`)));
					}
				}
				idx++;
			}

			lines.push(dim(`├${hLine}┤`));
			const totalColor = grandTotal > 10 ? warning : success;
			lines.push(box(`${bold("total:")} ${totalColor(`$${grandTotal.toFixed(4)}`)}`));
		}

		lines.push(dim(`├${hLine}┤`));
		lines.push(box(dim("←→ tabs  ↑↓ navigate  enter expand  backspace delete  esc close")));
		lines.push(dim(`╰${hLine}╯`));

		return lines;
	}

	dispose(): void {}
}

// =============================================================================
// Extension Entry Point
// =============================================================================

export default function (pi: ExtensionAPI) {
	pi.registerCommand("cost", {
		description: "Show cost report from session logs",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("Cost report requires interactive mode", "error");
				return;
			}
			const daysBack = parseInt(args || "7") || 7;
			await ctx.ui.custom((tui, theme, _kb, done) => {
				return new CostComponent(tui, theme, () => done(undefined), daysBack);
			});
		},
	});
}
