import type { Stores, ToolExecution } from "@ultron/memory";
import type { ToolEvent } from "@ultron/schemas";
import type { EventBus } from "./events.ts";
import { toolByName, type ToolContext, type ToolDef } from "./tools.ts";
import type { FileService } from "../files/service.ts";
import type { ConnectorService } from "../connectors/service.ts";

export interface ActionPolicy {
  /** Kill switch: when paused, nothing except read-only (L0) tools runs. */
  paused: boolean;
  /** Ask before L1 actions too (by default reversible low-risk actions just happen and are logged). */
  confirmLowRisk: boolean;
}

export const APPROVAL_TTL_MS = 10 * 60_000;
const MAX_RESULT_CHARS = 12_000;
const MAX_CALLS_PER_TURN = 8;

/** Keeps results valid JSON when they're too long, and says so, instead of cutting mid-structure. */
function capResult(result: string): string {
  if (result.length <= MAX_RESULT_CHARS) return result;
  return JSON.stringify({ truncated: true, note: "The result was too long; this is only the first part.", partial: result.slice(0, MAX_RESULT_CHARS - 200) });
}

export { MAX_CALLS_PER_TURN };

export type Decision = "allow" | "needs_approval" | "deny";

/** The policy engine: model output is only ever a proposal; this decides what actually happens. */
export function decide(tool: Pick<ToolDef, "risk">, policy: ActionPolicy): { decision: Decision; reason: string } {
  if (tool.risk >= 3) return { decision: "deny", reason: "High-risk actions (money, deleting, security settings) are blocked." };
  if (policy.paused && tool.risk >= 1) return { decision: "deny", reason: "Actions are paused (Settings → Actions)." };
  if (tool.risk === 2 || (tool.risk === 1 && policy.confirmLowRisk)) return { decision: "needs_approval", reason: "Needs the owner's approval in the app." };
  return { decision: "allow", reason: "" };
}

let previewCtx: { connectors?: ConnectorService } = {};
export const toEvent = (e: ToolExecution): ToolEvent => {
  const tool = toolByName(e.tool);
  let preview: string | undefined;
  try {
    preview = tool?.preview?.(e.input as never, previewCtx);
  } catch {
    preview = undefined;
  }
  return { executionId: e.id, tool: e.tool, summary: e.summary, status: e.status, risk: e.risk, ...(preview ? { preview } : {}) };
};

export class ActionRunner {
  /** Hook for tools that change memories (wired to meaning-based indexing by the app). */
  onMemoryChanged?: () => void;
  similarFiles?: ToolContext["similarFiles"];
  calendar?: ToolContext["calendar"];
  secrets?: ToolContext["secrets"];
  constructor(
    private stores: Stores,
    private bus: EventBus,
    private dryRun: boolean,
    private now: () => Date = () => new Date(),
    private files?: FileService,
    private connectors?: ConnectorService,
  ) {
    previewCtx = { connectors };
  }

  policy(): ActionPolicy {
    return this.stores.preferences.get<ActionPolicy>("actions", { paused: false, confirmLowRisk: false });
  }

  /**
   * Validates and records a proposed tool call, then runs it, queues it for approval, or refuses it.
   * Returns the record plus the text handed back to the model (always data, never instructions).
   */
  async propose(name: string, rawArgs: unknown, ctx: { conversationId: string | null; requestedBy: ToolExecution["requestedBy"] }): Promise<{ execution: ToolExecution | null; resultForModel: string }> {
    const tool = toolByName(name);
    if (!tool) return { execution: null, resultForModel: JSON.stringify({ error: `Unknown tool "${name}". Only use the tools provided.` }) };
    const parsed = tool.input.safeParse(rawArgs ?? {});
    if (!parsed.success) {
      return { execution: null, resultForModel: JSON.stringify({ error: `Invalid input for ${name}: ${parsed.error.issues.map((i) => i.message).join("; ")}` }) };
    }
    const risk = tool.riskFor?.(parsed.data, { stores: this.stores, conversationId: ctx.conversationId }) ?? tool.risk;
    const { decision, reason } = decide({ risk }, this.policy());
    const exec = this.stores.actions.create({
      conversationId: ctx.conversationId,
      tool: tool.name,
      input: parsed.data as Record<string, unknown>,
      risk,
      requestedBy: ctx.requestedBy,
      summary: tool.describe(parsed.data),
      status: decision === "allow" ? "running" : decision === "deny" ? "denied" : "awaiting_approval",
    });
    this.stores.audit.record(`action.${decision === "allow" ? "started" : decision === "deny" ? "denied" : "awaiting_approval"}`, ctx.requestedBy, exec.id, { tool: tool.name, risk });
    if (decision === "deny") {
      const e = this.stores.actions.update(exec.id, { status: "denied", error: reason })!;
      this.bus.emit({ type: "action_updated", execution: e });
      return { execution: e, resultForModel: JSON.stringify({ status: "refused", reason }) };
    }
    if (decision === "needs_approval") {
      this.bus.emit({ type: "action_updated", execution: exec });
      return {
        execution: exec,
        resultForModel: JSON.stringify({ status: "waiting_for_owner_approval", note: "Not done yet. Tell the owner it is waiting for their approval in the ULTRON app. Do not claim it happened." }),
      };
    }
    const done = await this.execute(exec, tool);
    return { execution: done, resultForModel: done.status === "succeeded" ? done.result! : JSON.stringify({ status: "failed", error: done.error }) };
  }

  private async execute(exec: ToolExecution, tool: ToolDef): Promise<ToolExecution> {
    try {
      const result = await Promise.race([
        tool.run(exec.input, { stores: this.stores, conversationId: exec.conversationId, dryRun: this.dryRun, now: this.now, files: this.files, connectors: this.connectors, onMemoryChanged: this.onMemoryChanged, similarFiles: this.similarFiles, calendar: this.calendar, secrets: this.secrets }),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`Timed out after ${tool.timeoutMs / 1000}s.`)), tool.timeoutMs)),
      ]);
      const e = this.stores.actions.update(exec.id, { status: "succeeded", result: capResult(result) })!;
      this.stores.audit.record("action.succeeded", exec.requestedBy, exec.id, { tool: tool.name });
      this.bus.emit({ type: "action_updated", execution: e });
      return e;
    } catch (err) {
      const e = this.stores.actions.update(exec.id, { status: "failed", error: (err as Error).message })!;
      this.stores.audit.record("action.failed", exec.requestedBy, exec.id, { tool: tool.name });
      this.bus.emit({ type: "action_updated", execution: e });
      return e;
    }
  }

  /** Owner decision from the app (never from model output or voice). */
  async resolve(id: string, approve: boolean): Promise<ToolExecution | { failure: string; code: number }> {
    this.stores.actions.expireStale(APPROVAL_TTL_MS, this.now());
    const exec = this.stores.actions.get(id);
    if (!exec) return { failure: "No such action.", code: 404 };
    if (exec.status !== "awaiting_approval") return { failure: `This action is already ${exec.status.replace("_", " ")}.`, code: 409 };
    const tool = toolByName(exec.tool)!;
    if (!approve) {
      const e = this.stores.actions.update(id, { status: "denied", error: "Denied by the owner." })!;
      this.stores.audit.record("action.denied", "owner", id, { tool: exec.tool });
      this.bus.emit({ type: "action_updated", execution: e });
      this.syncMessage(e);
      return e;
    }
    // Policy can change between proposal and approval (e.g. the kill switch): re-check before running.
    if (this.policy().paused) return { failure: "Actions are paused. Resume them in Settings first.", code: 409 };
    this.stores.audit.record("action.approved", "owner", id, { tool: exec.tool });
    const running = this.stores.actions.update(id, { status: "running" })!;
    const e = await this.execute(running, tool);
    this.syncMessage(e);
    return e;
  }

  /** Deny everything waiting for approval (part of the emergency stop). */
  denyAllPending(): number {
    const pending = this.stores.actions.pending();
    for (const p of pending) {
      const e = this.stores.actions.update(p.id, { status: "cancelled", error: "Cancelled by emergency stop." })!;
      this.bus.emit({ type: "action_updated", execution: e });
      this.syncMessage(e);
    }
    return pending.length;
  }

  /** Keeps the chat bubble that proposed an action in step with its final state. */
  private syncMessage(e: ToolExecution) {
    if (!e.conversationId) return;
    for (const m of this.stores.conversations.messages(e.conversationId)) {
      if (m.toolEvents.some((t) => t.executionId === e.id)) {
        this.stores.conversations.updateMessage(m.id, { toolEvents: m.toolEvents.map((t) => (t.executionId === e.id ? toEvent(e) : t)) });
      }
    }
  }
}
