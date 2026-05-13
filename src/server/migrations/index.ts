import type { Migration } from '../migrations.js';
import migration001 from './001-drop-bridge-session-id.js';

export const migrations: Migration[] = [migration001];
