import process from 'node:process';
import { createUser } from '../server/auth.js';
import { createDatabase, initializeSchema } from '../server/db.js';

interface ParsedArgs {
  command?: string;
  username?: string;
  password?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command, ...rest] = argv;
  const parsed: ParsedArgs = { command };

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === '--username') {
      parsed.username = rest[index + 1];
      index += 1;
      continue;
    }

    if (token === '--password') {
      parsed.password = rest[index + 1];
      index += 1;
    }
  }

  return parsed;
}

function printUsage(): void {
  console.error(
    [
      'Usage:',
      '  npx tsx cli/manage-users.ts add --username <name> --password <password>',
      '  npx tsx cli/manage-users.ts list',
      '  npx tsx cli/manage-users.ts delete --username <name>',
    ].join('\n'),
  );
}

async function main(): Promise<void> {
  const { command, username, password } = parseArgs(process.argv.slice(2));
  const dbPath = process.env.DB_PATH ?? './data/kanban.db';
  const db = createDatabase(dbPath);

  try {
    initializeSchema(db);

    switch (command) {
      case 'add': {
        if (!username || !password) {
          throw new Error('add requires --username and --password');
        }

        const user = await createUser(db, username, password);
        console.log(`Created user ${user.username} (${user.id})`);
        break;
      }

      case 'list': {
        const users = db
          .prepare('SELECT id, username, created_at FROM users ORDER BY username')
          .all() as Array<{ id: string; username: string; created_at: string }>;

        if (users.length === 0) {
          console.log('No users found');
          break;
        }

        for (const user of users) {
          console.log(`${user.username}\t${user.id}\t${user.created_at}`);
        }
        break;
      }

      case 'delete': {
        if (!username) {
          throw new Error('delete requires --username');
        }

        const user = db
          .prepare('SELECT id FROM users WHERE username = ?')
          .get(username) as { id: string } | undefined;
        if (!user) {
          throw new Error(`User not found: ${username}`);
        }

        db.transaction(() => {
          db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
          db.prepare('DELETE FROM preferences WHERE user_id = ?').run(user.id);
          db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
        })();

        console.log(`Deleted user ${username}`);
        break;
      }

      default:
        printUsage();
        process.exitCode = 1;
    }
  } finally {
    db.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
