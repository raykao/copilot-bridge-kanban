import type { Migration } from '../migrations.js';
import migration001 from './001-drop-bridge-session-id.js';
import migration002 from './002-agent-tokens-per-card.js';
import migration003 from './003-agents-table.js';
import migration004 from './004-add-acp-session-id.js';
import migration005 from './005-agents-api-key.js';

export const migrations: Migration[] = [migration001, migration002, migration003, migration004, migration005];
