import { magma } from './magma.js';
import { get, all } from './dataBaseController.js';

export async function handleGetChat(payload, ws, wss) {
    const targetUser = payload.Name;
    ws.currentChatTarget = targetUser;
    console.log(`💬 ${ws.userName} открыл диалог с ${targetUser}`);

    const history = await all(
        'SELECT sender, timestamp, id, isRead, file_path, file_type, message FROM messages WHERE (sender = ? AND target = ?) OR (sender = ? AND target = ?) ORDER BY timestamp ASC',
        [ws.userName, targetUser, targetUser, ws.userName]
    );

    history.forEach((row) => {
        const realTarget = (row.sender === ws.userName) ? targetUser : ws.userName;
        const messageObj = {
            type: 'chatMessage',
            Name: row.sender,
            Message: row.message,
            Target: realTarget,
            GotFromDB: false,
            Date: row.timestamp,
            Id: row.id,
            TempId: 0,
            IsRead: row.isRead == 1,
            FilePath: row.file_path ?? "",
            FileType: row.file_type ?? "",
            FileName: row.file_name ?? ""
        };

        const stringifiedObj = JSON.stringify(messageObj);
        const encryptedText = magma.encrypt(stringifiedObj, ws.magmaKey);
        const finalPayload = {
            encryptedData: encryptedText
        };

        ws.send(JSON.stringify(finalPayload));
    });
}