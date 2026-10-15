import { verifyClientSignature } from './hadshakeController.js';
import { all, run } from './dataBaseController.js';
import { broadcastUsersListToAll } from './userListController.js';

export async function handleUser(payload) {
    await verifyClientSignature.call(this, payload.ClientPublicKey, payload.Signature);

    this.userName = payload.Name;

    console.log(this.userName + ' ' + payload.Name);
    console.log(`👤 Пользователь вошел в сеть: ${this.userName}`);

    const registeredUsers = await all(`
                SELECT DISTINCT TRIM(sender) AS name FROM messages WHERE sender IS NOT NULL AND sender != ''
                UNION
                SELECT DISTINCT TRIM(target) AS name FROM messages WHERE target IS NOT NULL AND target != ''
            `);

    const userExists = registeredUsers.some(user => user.name === this.userName);

    if (!userExists) {
        console.log('userExists');
        await run(`INSERT INTO messages (sender, target) VALUES (?, ?)`, [this.userName, this.userName]);
    }

    await broadcastUsersListToAll.call(this);
}
