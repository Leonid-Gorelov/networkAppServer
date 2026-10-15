import { verifyClientSignature } from './hadshakeController.js';
import { broadcastUsersListToAll } from './userListController.js';
import { handleChatMessage } from './chatMessageController.js';
import { handleMarkAsRead } from './markAsReadController.js';
import { handleCallOffer } from './callController.js';
import { handleAnswer } from './callController.js';
import { handleIceCandidate } from './callController.js';
import { handleFileChunk } from './fileController.js';
import { handleDownloadFile } from './fileController.js';
import { handleGetChat } from './chatController.js';
import { all, run } from './dataBaseController.js';
import { handleUser } from './userController.js';

export async function handleClientAction(payload) {
    console.log(payload.type);
    switch (payload.type) {
        case 'user':
        handleUser.call(this, payload);
            break;
        case 'chatMessage':
            handleChatMessage.call(this, payload);
            break;
        case 'markAsRead':
            handleMarkAsRead.call(this, payload);
            break;
        case 'callOffer':
            handleCallOffer.call(this, payload);
            break;
        case 'callAnswer':
            handleAnswer.call(this, payload);
            break;
        case 'iceCandidate':
            handleIceCandidate.call(this, payload);
            break;
        case 'getChat':
            handleGetChat.call(this, payload);
            break;
        case 'fileChunk':
            handleFileChunk.call(this, payload);
            break;
        case 'fileDownloadRequest':
            handleDownloadFile.call(this, payload);
            break;
        default:
            break;
    }
}
