import WebSocket from 'ws';
import { magma } from './magma.js';

export async function forwardToUser(targetName, packetObj, wss) {
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN && client.userName === targetName) {
            const encryptedData = magma.encrypt(JSON.stringify(packetObj), client.magmaKey);
            client.send(JSON.stringify({ encryptedData: encryptedData }));
        }
    });
}
