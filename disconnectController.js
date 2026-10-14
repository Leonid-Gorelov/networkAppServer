import { broadcastUsersListToAll } from './userListController.js';

export async function handleDisconnect(ws, wss) {
    if (ws.userName) {
        console.log(`❌ Пользователь ${ws.userName} отключился`);
        await broadcastUsersListToAll(wss);
    }
}