import type { Migration } from '../migrations.js';
import migration001 from './001-drop-bridge-session-id.js';
import migration002 from './002-agent-tokens-per-card.js';
import migration003 from './003-agents-table.js';
import migration004 from './004-add-acp-session-id.js';
import migration005 from './005-agents-api-key.js';
import migration006 from './006-agents-name-nullable.js';
import migration007 from './007-runs-provider-id.js';
import migration008 from './008-providers-table.js';
import migration009 from './009-agents-provider-id.js';
import migration010 from './010-backfill-providers-from-agents.js';

export const migrations: Migration[] = [
  migration001,
  migration002,
  migration003,
  migration004,
  migration005,
  migration006,
  migration007,
  migration008,
  migration009,
  migration010,
];
