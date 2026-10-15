import { all } from './dataBaseController.js';
import { forwardToAll } from './wsController.js';

async function sendUsersListToClient() {
    if (!this.userName) return;

    try {
        const currentClientName = this.userName.trim();

        const dbUsers = await all(`
            SELECT DISTINCT TRIM(sender) AS name FROM messages WHERE sender IS NOT NULL AND sender != ''
            UNION
            SELECT DISTINCT TRIM(target) AS name FROM messages WHERE target IS NOT NULL AND target != ''
        `);

        const allRegisteredNames = dbUsers.map(row => row.name.trim());

        const chatListObj = {
            type: 'chatsList',
            Names: allRegisteredNames
        };

        forwardToAll(chatListObj);
    } catch (err) {
        console.error('❌ Ошибка при формировании списка пользователей:', err.message);
    }
}

export async function broadcastUsersListToAll() {
    sendUsersListToClient.call(this);
}
