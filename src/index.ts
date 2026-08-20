import { handleInteraction } from './handler.ts';
import type { Env } from './env.ts';

// Exported so the runtime can find the class named in wrangler.toml.
export { IssueDraft } from './draft-object.ts';

/**
 * Cloudflare Workers adapter. The only file that touches the Workers runtime —
 * all interaction logic lives in handler.ts.
 */
export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handleInteraction(request, env, (p) => ctx.waitUntil(p));
  },
} satisfies ExportedHandler<Env>;
