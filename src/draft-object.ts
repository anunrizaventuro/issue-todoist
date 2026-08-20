import { DurableObject } from 'cloudflare:workers';
import { DraftCore, type DraftStorage } from './draft-core.ts';
import type { AiFields, Draft, EditFields } from './draft.ts';
import type { NormalizedIssue } from './issue.ts';
import type { ProcessResult } from './process.ts';
import type { Env } from './env.ts';

/**
 * Durable Object shell.
 *
 * Every method forwards; the logic lives in DraftCore so it stays testable from
 * plain Node. This is the only file besides index.ts that touches the runtime.
 */
export class IssueDraft extends DurableObject<Env> {
  private get core(): DraftCore {
    return new DraftCore(this.ctx.storage as unknown as DraftStorage, this.env);
  }

  start(draft: Draft, windowMs: number): Promise<void> {
    return this.core.start(draft, windowMs);
  }

  read(): Promise<Draft | null> {
    return this.core.read();
  }

  edit(fields: EditFields): Promise<Draft | null> {
    return this.core.edit(fields);
  }

  editAi(fields: AiFields): Promise<Draft | null> {
    return this.core.editAi(fields);
  }

  rewrite(issue: NormalizedIssue, rawInput: string): Promise<Draft | null> {
    return this.core.rewrite(issue, rawInput);
  }

  priority(value: number): Promise<Draft | null> {
    return this.core.priority(value);
  }

  approve(): Promise<ProcessResult | 'closed'> {
    return this.core.approve();
  }

  cancel(): Promise<Draft | null> {
    return this.core.cancel();
  }

  /** The runtime calls this by name; the logic is DraftCore.fire. */
  alarm(): Promise<void> {
    return this.core.fire();
  }
}
