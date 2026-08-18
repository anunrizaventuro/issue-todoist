import { handleInteraction } from './handler.ts';
import type { Env } from './env.ts';

/**
 * Cloudflare Workers adapter. The only file that touches the Workers runtime —
 * all interaction logic lives in handler.ts.
 */
export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handleInteraction(request, env, (p) => ctx.waitUntil(p));
  },
} satisfies ExportedHandler<Env>;
