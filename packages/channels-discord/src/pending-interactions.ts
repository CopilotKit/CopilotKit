interface LiveInteraction {
  id: string;
  deferred?: boolean;
  replied?: boolean;
}
interface Entry {
  interaction: LiveInteraction;
  responded: boolean;
  timer?: ReturnType<typeof setTimeout>;
}
export interface PendingOpts {
  /** How long before the 3s window we auto-defer (e.g. 2500). */
  ackBufferMs: number;
  /** Ack the interaction (deferUpdate for components, deferReply for commands). */
  defer: (interaction: LiveInteraction) => Promise<void>;
}

/** Tracks live discord.js interactions so a handler can open a modal before the adapter acks. */
export class PendingInteractions {
  private entries = new Map<string, Entry>();
  constructor(private opts: PendingOpts) {}

  /** Stash a live interaction, arm the auto-defer timer, return its triggerId. */
  register(interaction: LiveInteraction): string {
    const prev = this.entries.get(interaction.id);
    if (prev?.timer) clearTimeout(prev.timer);
    const entry: Entry = { interaction, responded: false };
    entry.timer = setTimeout(() => void this.ack(entry), this.opts.ackBufferMs);
    this.entries.set(interaction.id, entry);
    return interaction.id;
  }

  /** Run `fn` (e.g. showModal) only if still unresponded. Returns whether it ran. */
  async respondWith(
    triggerId: string,
    fn: (interaction: LiveInteraction) => Promise<void>,
  ): Promise<boolean> {
    const entry = this.entries.get(triggerId);
    if (!entry || entry.responded) return false;
    entry.responded = true;
    if (entry.timer) clearTimeout(entry.timer);
    await fn(entry.interaction);
    return true;
  }

  /** After dispatch: ack if the handler never responded. Then forget the entry. */
  async settle(triggerId: string): Promise<void> {
    const entry = this.entries.get(triggerId);
    if (!entry) return;
    await this.ack(entry);
    this.entries.delete(triggerId);
  }

  private async ack(entry: Entry): Promise<void> {
    if (entry.responded) return;
    entry.responded = true;
    if (entry.timer) clearTimeout(entry.timer);
    try {
      await this.opts.defer(entry.interaction);
    } catch {
      /* interaction already gone; nothing to do */
    }
  }
}
