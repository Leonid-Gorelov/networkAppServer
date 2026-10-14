import { verifyClientSignature } from './hadshakeController.js';
import { broadcastUsersListToAll } from './userListController.js';
import { handleChatMessage } from './chatMessageController.js';
import { handleMarkAsRead } from './markAsReadController.js';
import { handleCallOffer } from './callController.js';
import { handleAnswer } from './callController.js';
import { handleIceCandidate } from './callController.js';
import { handleDisconnect } from './disconnectController.js';
import { handleFileChunk } from './fileController.js';
import { handleDownloadFile } from './fileController.js';
import { handleGetChat } from './chatController.js';

export async function handleClientAction(payload, ws, wss) {
    console.log(payload.type);
    switch (payload.type) {
        case 'user':
            await verifyClientSignature(payload.ClientPublicKey, payload.Signature, ws);

            ws.userName = payload.Name;
            console.log(`👤 Пользователь вошел в сеть: ${ws.userName}`);

            await broadcastUsersListToAll(wss);
            break;
        case 'chatMessage':
            handleChatMessage(payload, ws, wss);
            break;
        case 'markAsRead':
            handleMarkAsRead(payload, ws, wss);
            break;
        case 'callOffer':
            handleCallOffer(payload, wss);
            break;
        case 'callAnswer':
            handleAnswer(payload, wss);
            break;
        case 'iceCandidate':
            handleIceCandidate(payload, wss);
            break;
        case 'getChat':
            handleGetChat(payload, ws, wss);
            break;
        case 'fileChunk':
            handleFileChunk(payload, ws, wss);
            break;
        case 'downloadFile':
            handleDownloadFile(payload, ws, wss);
            break;
        case 'disconnect':
            handleDisconnect(ws, wss);
            break;
        default:
            break;
    }
}
