import { get, run } from './dataBaseController.js';
import { forwardToUser } from './wsController.js';

export async function handleMarkAsRead(payload) {
    const row = await get('SELECT target, sender  FROM messages WHERE id = ? ', [payload.Id])

    if (row.target === this.userName) {
        await run('UPDATE messages SET isRead = 1 WHERE id =  ?', [payload.Id]);
        console.log('Mark as read');

        const markObj = {
            type: 'markAsRead',
            Id: payload.Id
        };

        forwardToUser(row.sender, markObj);
    }
}
