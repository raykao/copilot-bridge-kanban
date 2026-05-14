import type { Migration } from '../migrations.js';
import migration001 from './001-drop-bridge-session-id.js';
import migration002 from './002-agent-tokens-per-card.js';
import migration003 from './003-nullable-agent-token-card-id.js';

export const migrations: Migration[] = [migration001, migration002, migration003];
