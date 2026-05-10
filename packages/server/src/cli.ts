import process from 'node:process';
import { createUser } from './auth.js';
import { createDatabase, initializeSchema } from './db.js';

type CliCommand = 'add' | 'list' | 'delete';

function printUsage(): void {
  console.error(
    [
      'Usage:',
      '  node packages/server/dist/cli.js user add <username> <password>',
      '  node packages/server/dist/cli.js user list',
      '  node packages/server/dist/cli.js user delete <username>',
    ].join('\n'),
  );
}

function parseArgs(argv: string[]): { scope?: string; command?: CliCommand; username?: string; password?: string } {
  const [scope, command, username, password] = argv;
  return { scope, command: command as CliCommand | undefined, username, password };
}

async function main(): Promise<void> {
  const { scope, command, username, password } = parseArgs(process.argv.slice(2));
  if (scope !== 'user' || !command) {
    printUsage();
    process.exit(1);
  }

  const db = createDatabase(process.env.DB_PATH ?? './data/kanban.db');

  try {
    initializeSchema(db);

    switch (command) {
      case 'add': {
        if (!username || !password) {
          throw new Error('user add requires <username> <password>');
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
          throw new Error('user delete requires <username>');
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
        process.exit(1);
    }
  } finally {
    db.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
