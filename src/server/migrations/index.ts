import type { Migration } from '../migrations.js';
import migration001 from './001-drop-bridge-session-id.js';
import migration002 from './002-agent-tokens-per-card.js';

export const migrations: Migration[] = [migration001, migration002];
