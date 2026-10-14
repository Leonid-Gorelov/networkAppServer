import { get, run } from './dataBaseController.js';
import { magma } from './magma.js';
import WebSocket from 'ws';

export async function handleMarkAsRead(payload, ws, wss) {
    const row = await get('SELECT target, sender  FROM messages WHERE id = ? ', [payload.Id])
    if (row.target === ws.userName) {
        await run('UPDATE messages SET isRead = 1 WHERE id =  ?', [payload.Id]);
        console.log('Mark as read');
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN && client.userName === row.sender) {
                const markObj = {
                    type: 'markAsRead',
                    Id: payload.Id
                };

                const stringifiedObj = JSON.stringify(markObj);
                const encryptedData = magma.encrypt(stringifiedObj, client.magmaKey);

                const finalPayload = {
                    encryptedData: encryptedData
                };

                client.send(JSON.stringify(finalPayload));
            }
        });
    }
}