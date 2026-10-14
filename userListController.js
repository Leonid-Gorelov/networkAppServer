import { all } from './dataBaseController.js';
import WebSocket from 'ws';
import { magma } from './magma.js';

export async function sendUsersListToClient(ws, wss) {
    if (!ws.userName) return;

    try {
        const currentClientName = ws.userName.trim();

        const dbUsers = await all(`
            SELECT DISTINCT TRIM(sender) AS name FROM messages WHERE sender IS NOT NULL AND sender != ''
            UNION
            SELECT DISTINCT TRIM(target) AS name FROM messages WHERE target IS NOT NULL AND target != ''
        `);

        const allRegisteredNames = dbUsers.map(row => row.name.trim());

        const onlineNames = Array.from(wss.clients)
            .map(client => client.userName ? client.userName.trim() : '')
            .filter(name => name !== '');

        const combinedNames = [...allRegisteredNames, ...onlineNames];

        const uniqueFilteredNames = [];
        const seenNames = new Set();

        seenNames.add(currentClientName.toLowerCase());

        for (const name of combinedNames) {
            const lowerName = name.toLowerCase();
            if (!seenNames.has(lowerName)) {
                seenNames.add(lowerName);
                uniqueFilteredNames.push(name);
            }
        }

        const chatListObj = {
            type: 'chatsList',
            Names: uniqueFilteredNames
        };

        const rawJsonString = JSON.stringify(chatListObj);

        const encryptedDataStr = magma.encrypt(rawJsonString, ws.magmaKey);

        const finalPayload = JSON.stringify({
            "encryptedData": encryptedDataStr
        });

        if (ws.readyState === WebSocket.OPEN) {
            ws.send(finalPayload);
        }
    } catch (err) {
        console.error('❌ Ошибка при формировании списка пользователей:', err.message);
    }
}

export async function broadcastUsersListToAll(wss) {
    for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN && client.userName) {
            await sendUsersListToClient(client, wss);
        }
    }
}