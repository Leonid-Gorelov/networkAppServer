import WebSocket from 'ws';
import { magma } from './magma.js';
import { broadcastUsersListToAll } from './userListController.js';
import { handleClientAction } from './actionsController.js';
import { WebSocketServer } from 'ws';

let wss;

export function initWs() {
    wss = new WebSocketServer({ port: 5000 });

    wss.on('connection', async (ws) => {

        ws.userName = '';
        ws.magmaKey = '';
        ws.currentChatTarget = '';

        ws.on('message', async (data) => {
            try {
                const rawJson = data.toString();
                const incomingData = JSON.parse(rawJson);
                let payload;

                if (incomingData.encryptedData) {
                    if (!ws.magmaKey) {
                        throw new Error("Попытка прислать зашифрованные данные до установки ключа сессии!");
                    }
                    const decryptedString = magma.decrypt(incomingData.encryptedData, ws.magmaKey);
                    payload = JSON.parse(decryptedString);
                } else {
                    payload = incomingData;
                }

                await handleClientAction.call(ws, payload);
            } catch (error) {
                console.error('Ошибка при обработке данных:', error);
            }
        });

        ws.on('close', async () => {
            if (ws.userName) {
                console.log(`❌ Пользователь ${ws.userName} отключился`);
                await broadcastUsersListToAll.call(ws);
            }
        });
    });
}

export async function forwardToUser(targetName, packetObj) {
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN && client.userName === targetName) {
            if (packetObj.type === 'serverHandshake') {
                client.send(JSON.stringify(packetObj));
                return;
            }

            const encryptedData = magma.encrypt(JSON.stringify(packetObj), client.magmaKey);
            client.send(JSON.stringify({ encryptedData: encryptedData }));
        }
    });
}

export function forwardToAll(packetObj) {
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN && client.userName) {
            const encryptedData = magma.encrypt(JSON.stringify(packetObj), client.magmaKey);
            client.send(JSON.stringify({ encryptedData: encryptedData }));
        }
    });
}
