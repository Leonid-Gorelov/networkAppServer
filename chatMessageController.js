import { magma } from './magma.js';
import { run, getSequence, all } from './dataBaseController.js';
import { forwardToUser } from './wsController.js';
import WebSocket from 'ws';

export async function handleChatMessage(payload, ws, wss) {
    const sender = payload.Name;
    const messageText = payload.Message;
    const target = payload.Target;

    if (!sender || !target || !messageText) return;

    const result = await run(
        'INSERT INTO messages (sender, target, message) VALUES (?, ?, ?)',
        [sender, target, messageText]
    );
    console.log(`💾 Сохранено в БД [${sender} -> ${target}]: ${messageText}`);

    const sentMessageIdObj = {
        type: 'sentMessageId',
        Id: result.lastID,
        TempId: payload.TempId,
        IsRead: result.isRead == 1
    };

    // const stringifiedJson1 = JSON.stringify(sentMessageIdObj);
    // const encryptedData1 = magma.encrypt(stringifiedJson1, ws.magmaKey);
    // const finalPayload1 = {
    //     encryptedData: encryptedData1
    // };

    forwardToUser(sender, sentMessageIdObj, wss);

    wss.clients.forEach(async (client) => {
        if (client.readyState === WebSocket.OPEN && client.userName === target) {
            const now = new Date();
            const datePart = now.toLocaleDateString('en-CA');
            const timePart = now.toLocaleTimeString('en-GB', { hour12: false });
            const formattedDate = `${datePart} ${timePart}`;
            //const row = await all("SELECT seq FROM messages ORDER BY timestamp DESC LIMIT 1");

            const messageObj = {
                type: 'chatMessage',
                Name: sender,
                Message: messageText,
                Target: target,
                GotFromDB: false,
                Date: formattedDate,
                Id: result.lastID,
                TempId: 0,
                IsRead: false,
                FilePath: "",
                FileType: "",
                FileName: ""
            };

            const stringifiedObj = JSON.stringify(messageObj);
            // const encryptedData = magma.encrypt(stringifiedObj, client.magmaKey);
            // const finalPayload = {
            //     encryptedData: encryptedData
            // };

            forwardToUser(target, messageObj, wss);
        }
    });
}
