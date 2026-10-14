import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { magma } from './magma.js';
import { sendUsersListToClient, broadcastUsersListToAll } from './userListController.js';
import { verifyClientSignature } from './hadshakeController.js';
import { initDb } from './dataBaseController.js';
import { handleClientAction } from './actionsController.js';
import { initServerKeys } from './hadshakeController.js';

const activeFileStreams = new Map();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function generateServerKeyPair() {
    console.log('⏳ Генерация пары ключей сервера...');

    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
        namedCurve: 'prime256v1',
        privateKeyEncoding: {
            type: 'pkcs8',
            format: 'pem'
        },
        publicKeyEncoding: {
            type: 'spki',
            format: 'pem'
        }
    });

    fs.writeFileSync('server_private.pem', privateKey, 'utf8');
    fs.writeFileSync('server_public.pem', publicKey, 'utf8');

    console.log('🎉 Ключи сервера успешно созданы и сохранены!');
    console.log(' -> server_private.pem (Остается тут, на сервере)');
    console.log(' -> server_public.pem  (Скопируйте этот файл в папку к C++ клиенту)');
}

//generateServerKeyPair();

// const serverPrivateKeyECDSA = crypto.createPrivateKey(fs.readFileSync('server_private.pem'));
// const clientPublicKeyECDSA = crypto.createPublicKey(fs.readFileSync('client_public.pem'));

initServerKeys();


// let db;
// try {
//     db = await open({
//         filename: 'chat.db',
//         driver: sqlite3.Database
//     });

//     //	await db.exec(`
//     //  ALTER TABLE messages ADD COLUMN file_type TEXT DEFAULT NULL;
//     //`);

//     await db.exec(`
//       CREATE TABLE IF NOT EXISTS messages (
//         id INTEGER PRIMARY KEY AUTOINCREMENT,
//         sender TEXT,
//         target TEXT,
//         message TEXT,
//         timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
// 	    isRead BOOLEAN DEFAULT 0
//       )
//     `);
//     console.log('📦 База данных SQLite (chat.db) успешно подключена');
// } catch (err) {
//     console.error('❌ Ошибка инициализации БД:', err.message);
//     process.exit(1);
// }

await initDb();

const wss = new WebSocketServer({ port: 5000 });
console.log('🚀 WebSocket сервер запущен на порту 5000');



wss.on('connection', (ws) => {
    console.log('🔌 Новое соединение открыто');

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

            await handleClientAction(payload, ws, wss);
            // if (payload.type === 'user') {
            //     verifyClientSignature(payload.ClientPublicKey, payload.Signature, ws);

            //     ws.userName = payload.Name;
            //     console.log(`👤 Пользователь вошел в сеть: ${ws.userName}`);

            //     await broadcastUsersListToAll(wss);
            //     return;
            // }
            //console.log(payload);
            // if (payload.type === 'markAsRead') {
            //     //console.log('MArkasread')
            //     const row = await db.get('SELECT target, sender  FROM messages WHERE id = ? ', [payload.Id])
            //     console.log(row.target);
            //     if (row.target === ws.userName) {
            //         await db.run('UPDATE messages SET isRead = 1 WHERE id =  ?', [payload.Id]);
            //         console.log('Mark as read');
            //         wss.clients.forEach((client) => {
            //             if (client.readyState === WebSocket.OPEN && client.userName === row.sender) {
            //                 const markObj = {
            //                     type: 'markAsRead',
            //                     Id: payload.Id
            //                 };

            //                 const stringifiedObj = JSON.stringify(markObj);
            //                 const encryptedData = magma.encrypt(stringifiedObj, client.magmaKey);

            //                 const finalPayload = {
            //                     encryptedData: encryptedData
            //                 };

            //                 client.send(JSON.stringify(finalPayload));
            //             }
            //         });
            //     }
            // }
            // else if (payload.type === 'fileChunk') {
            //     const { FileId, FileName, ChunkIndex, TotalChunks, Base64Data, Target, Sender, TempId } = payload;
            //     //console.log(payload);

            //     try {
            //         let session = activeFileStreams.get(FileId);

            //         if (!session) {
            //             const safeFileName = path.basename(FileName);
            //             const uniqueFileName = `${Date.now()}_${safeFileName}`;
            //             const fullPath = path.join(__dirname, 'uploads', uniqueFileName);

            //             fs.writeFileSync(fullPath, '');

            //             session = {
            //                 fullPath: fullPath,
            //                 webPath: `/uploads/${uniqueFileName}`,
            //                 expectedIndex: 0
            //             };
            //             activeFileStreams.set(FileId, session);
            //             console.log(`📁 Начат прием файла: ${safeFileName} (ID: ${FileId})`);
            //         }

            //         if (ChunkIndex !== session.expectedIndex) {
            //             console.error(`❌ Нарушен порядок чанков для ${FileId}. Ожидался ${session.expectedIndex}, пришел ${ChunkIndex}`);
            //             return;
            //         }

            //         const buffer = Buffer.from(Base64Data, 'base64');

            //         fs.appendFileSync(session.fullPath, buffer);

            //         session.expectedIndex++;

            //         console.log(`📦 Принят чанк [${ChunkIndex + 1}/${TotalChunks}] для файла ID: ${FileId}`);

            //         if (ChunkIndex === TotalChunks - 1) {
            //             console.log(`✅ Файл успешно собран на диске: ${session.fullPath}`);

            //             const ext = path.extname(FileName).toLowerCase();
            //             const fileType = ['.png', '.jpg', '.jpeg', '.gif'].includes(ext) ? 'image' : 'document';
            //             const messageText = `📎 Файл: ${FileName}`;
            //             const result = await db.run(
            //                 'INSERT INTO messages (sender, target, message, file_path, file_type) VALUES (?, ?, ?, ?, ?)',
            //                 Sender, Target, messageText, session.webPath, fileType
            //             );

            //             const finalInsertId = result.lastID;
            //             console.log(`💾 Файловое сообщение сохранено в БД под ID: ${finalInsertId}`);

            //             const sentMessageIdObj = {
            //                 type: 'sentMessageId',
            //                 Id: finalInsertId,
            //                 TempId: payload.TempId,
            //                 IsRead: false
            //             };
            //             ws.send(JSON.stringify({ encryptedData: magma.encrypt(JSON.stringify(sentMessageIdObj), ws.magmaKey) }));

            //             wss.clients.forEach((client) => {
            //                 if (client.readyState === WebSocket.OPEN && client.userName === Target) {
            //                     const now = new Date();
            //                     const datePart = now.toLocaleDateString('en-CA');
            //                     const timePart = now.toLocaleTimeString('en-GB', { hour12: false });
            //                     const formattedDate = `${datePart} ${timePart}`;

            //                     const messageObj = {
            //                         type: 'chatMessage',
            //                         Name: Sender,
            //                         Message: messageText,
            //                         Target: Target,
            //                         GotFromDB: false,
            //                         Date: formattedDate,
            //                         Id: finalInsertId,
            //                         TempId: 0,
            //                         IsRead: false,
            //                         FilePath: session.webPath,
            //                         FileType: fileType,
            //                         FileName: FileName
            //                     };

            //                     const stringifiedObj = JSON.stringify(messageObj);
            //                     const encryptedData = magma.encrypt(stringifiedObj, client.magmaKey);

            //                     const finalPayload = {
            //                         encryptedData: encryptedData
            //                     };

            //                     client.send(JSON.stringify(finalPayload));
            //                     console.log(`✉️ Файловое сообщение [ID: ${finalInsertId}] успешно переслано пользователю ${Target}`);
            //                 }
            //             });

            //             activeFileStreams.delete(FileId);
            //         }

            //     } catch (err) {
            //         console.error(`❌ Критическая ошибка при сборке чанка файла ${FileId}:`, err);
            //         activeFileStreams.delete(FileId);
            //     }
            // }


            // else if (payload.type === 'fileDownloadRequest') {
            //     const { FilePath, Sender } = payload;

            //     const safePath = path.join(__dirname, FilePath);

            //     if (!fs.existsSync(safePath)) {
            //         console.error(`❌ Запрошенный файл не найден: ${safePath}`);
            //         return;
            //     }

            //     const fileSize = fs.statSync(safePath).size;
            //     const chunkSize = 64 * 1024;
            //     const totalChunks = Math.ceil(fileSize / chunkSize);

            //     console.log(`🚀 Сервер начинает отдачу файла: ${safePath} | Чанков: ${totalChunks}`);

            //     const fileBuffer = fs.readFileSync(safePath);
            //     let chunkIndex = 0;

            //     for (let offset = 0; offset < fileSize; offset += chunkSize) {
            //         const chunk = fileBuffer.subarray(offset, offset + chunkSize);
            //         const base64Data = chunk.toString('base64');

            //         const downloadChunkObj = {
            //             type: 'fileDownloadChunk',
            //             Base64Data: base64Data,
            //             ChunkIndex: chunkIndex,
            //             TotalChunks: totalChunks
            //         };

            //         const stringifiedObj = JSON.stringify(downloadChunkObj);
            //         const encryptedData = magma.encrypt(stringifiedObj, ws.magmaKey);

            //         ws.send(JSON.stringify({ encryptedData: encryptedData }));
            //         chunkIndex++;
            //     }
            //     console.log(`✅ Все чанки файла успешно отданы клиенту.`);
            // }

            // else if (payload.type === 'getChat' || payload.Type === 'getChat') {
            //     const targetUser = payload.Name;
            //     ws.currentChatTarget = targetUser;
            //     console.log(`💬 ${ws.userName} открыл диалог с ${targetUser}`);

            //     const history = await db.all(
            //         'SELECT sender, timestamp, id, isRead, file_path, file_type,  message FROM messages WHERE (sender = ? AND target = ?) OR (sender = ? AND target = ?) ORDER BY timestamp ASC',
            //         ws.userName, targetUser, targetUser, ws.userName
            //     );

            //     history.forEach((row) => {
            //         const realTarget = (row.sender === ws.userName) ? targetUser : ws.userName;
            //         const messageObj = {
            //             type: 'chatMessage',
            //             Name: row.sender,
            //             Message: row.message,
            //             Target: realTarget,
            //             GotFromDB: true,
            //             Date: row.timestamp,
            //             Id: row.id,
            //             TempId: 0,
            //             IsRead: row.isRead == 1,
            //             FilePath: row.file_path || "",
            //             FileType: row.file_type || "",
            //             FileName: ""
            //         };

            //         const stringifiedObj = JSON.stringify(messageObj);
            //         const encryptedText = magma.encrypt(stringifiedObj, ws.magmaKey);
            //         const finalPayload = {
            //             encryptedData: encryptedText
            //         };

            //         ws.send(JSON.stringify(finalPayload));
            //     });
            //     return;
            // }

            // if (payload.Type === 'chatMessage' || payload.type === 'chatMessage') {
            //     const sender = payload.Name;
            //     const messageText = payload.Message;
            //     const target = payload.Target;

            //     if (!sender || !target || !messageText) return;

            //     const result = await db.run(
            //         'INSERT INTO messages (sender, target, message) VALUES (?, ?, ?)',
            //         sender, target, messageText
            //     );
            //     console.log(`💾 Сохранено в БД [${sender} -> ${target}]: ${messageText}`);

            //     const sentMessageIdObj = {
            //         type: 'sentMessageId',
            //         Id: result.lastID,
            //         TempId: payload.TempId,
            //         IsRead: result.isRead == 1
            //     };

            //     const stringifiedJson1 = JSON.stringify(sentMessageIdObj);
            //     const encryptedData1 = magma.encrypt(stringifiedJson1, ws.magmaKey);
            //     const finalPayload1 = {
            //         encryptedData: encryptedData1
            //     };

            //     ws.send(JSON.stringify(finalPayload1));

            //     wss.clients.forEach(async (client) => {
            //         if (client.readyState === WebSocket.OPEN && client.userName === target) {
            //             const now = new Date();
            //             const datePart = now.toLocaleDateString('en-CA');
            //             const timePart = now.toLocaleTimeString('en-GB', { hour12: false });
            //             const formattedDate = `${datePart} ${timePart}`;
            //             const row = await db.get("SELECT seq FROM sqlite_sequence WHERE name = 'messages'");

            //             const messageObj = {
            //                 type: 'chatMessage',
            //                 Name: sender,
            //                 Message: messageText,
            //                 Target: target,
            //                 GotFromDB: false,
            //                 Date: formattedDate,
            //                 Id: row.seq,
            //                 TempId: 0,
            //                 IsRead: false,
            //                 FilePath: "",
            //                 FileType: "",
            //                 FileName: ""
            //             };

            //             const stringifiedObj = JSON.stringify(messageObj);
            //             const encryptedData = magma.encrypt(stringifiedObj, client.magmaKey);
            //             const finalPayload = {
            //                 encryptedData: encryptedData
            //             };

            //             client.send(JSON.stringify(finalPayload));
            //         }
            //     });

            // }
            // if (payload.type === 'callOffer') {
            //     const { Target, Sender, Sdp } = payload;
            //     console.log(`📞 [Сигналинг] ${Sender} звонит ${Target}`);

            //     forwardToUser(Target, {
            //         type: 'callOffer',
            //         Sender: Sender,
            //         Sdp: Sdp
            //     });
            // }

            // else if (payload.type === 'callAnswer') {
            //     const { Target, Sender, Sdp } = payload;
            //     console.log(`🤙 [Сигналинг] ${Sender} принял звонок от ${Target}`);

            //     forwardToUser(Target, {
            //         type: 'callAnswer',
            //         Sender: Sender,
            //         Sdp: Sdp
            //     });
            // }

            // else if (payload.type === 'iceCandidate') {
            //     const { Target, Sender, Candidate } = payload;
            //     console.log(`[СЕРВЕР 📡] Маршрут от ${Sender}: ${Candidate.substring(0, 50)}...`);
            //     forwardToUser(Target, {
            //         type: 'iceCandidate',
            //         Sender: Sender,
            //         Candidate: Candidate
            //     });
            // }

        } catch (error) {
            console.error('❌ Ошибка обработки сообщения:', error);
        }
    });

    function forwardToUser(targetName, packetObj) {
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN && client.userName === targetName) {
                const encryptedData = magma.encrypt(JSON.stringify(packetObj), client.magmaKey);
                client.send(JSON.stringify({ encryptedData: encryptedData }));
            }
        });
    }

    ws.on('close', async () => {
        if (ws.userName) {
            console.log(`❌ Пользователь ${ws.userName} отключился`);
            await broadcastUsersListToAll(wss);
        }
    });
});
