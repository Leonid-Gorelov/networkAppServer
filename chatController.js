
import { get, all } from './dataBaseController.js';
import { forwardToUser } from './wsController.js';

export async function handleGetChat(payload) {
    const targetUser = payload.Name;
    const history = await all(
        'SELECT sender, timestamp, id, isRead, file_path, file_type, message FROM messages WHERE (sender = ? AND target = ?) OR (sender = ? AND target = ?) ORDER BY timestamp ASC',
        [this.userName, targetUser, targetUser, this.userName]
    );

    history.forEach((row) => {
        const realTarget = (row.sender === this.userName) ? targetUser : this.userName;
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

        forwardToUser(this.userName, messageObj);
    });
}
