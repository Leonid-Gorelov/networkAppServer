import { run } from './dataBaseController.js';
import { forwardToUser } from './wsController.js';

export async function handleChatMessage(payload) {
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

    forwardToUser(sender, sentMessageIdObj);

    const now = new Date();
    const datePart = now.toLocaleDateString('en-CA');
    const timePart = now.toLocaleTimeString('en-GB', { hour12: false });
    const formattedDate = `${datePart} ${timePart}`;
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

    forwardToUser(target, messageObj);
}
