import assert from 'node:assert/strict';
import test from 'node:test';

import { destinationFor } from '../src/todoist.ts';

/** Stands in for CONFIG.todoist once real pairs are filled in. */
const routed = {
  defaultProjectId: 'p-default',
  channels: {
    'c-bug': 'p-bug',
    'c-fitur': 'p-fitur',
  },
};

test('a mapped channel routes to its project', () => {
  assert.deepEqual(destinationFor(routed, 'c-bug', null), {
    projectId: 'p-bug',
    needsRouting: false,
  });
});

test('a thread inherits the project of the channel it lives in', () => {
  // Discord sends the thread's own id as channel_id, so without the parent a
  // report filed inside a thread would miss the map its channel is in.
  assert.equal(destinationFor(routed, 'thread-123', 'c-fitur').projectId, 'p-fitur');
});

test('a thread mapped in its own right beats its parent', () => {
  assert.equal(destinationFor(routed, 'c-bug', 'c-fitur').projectId, 'p-bug');
});

test('an unmapped channel takes the default and says so', () => {
  assert.deepEqual(destinationFor(routed, 'c-lain', 'c-juga-lain'), {
    projectId: 'p-default',
    needsRouting: true,
  });
});

test('a draft stored before channels were recorded takes the default', () => {
  assert.deepEqual(destinationFor(routed, undefined, undefined), {
    projectId: 'p-default',
    needsRouting: true,
  });
});

test('an empty map means routing is not in use, so nothing needs routing', () => {
  // How the bot ships. Labelling every task would mark nothing at all.
  const unrouted = { defaultProjectId: 'p-default', channels: {} };
  assert.deepEqual(destinationFor(unrouted, 'c-bug', null), {
    projectId: 'p-default',
    needsRouting: false,
  });
});
