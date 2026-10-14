import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { forwardToUser } from './wsController.js';
import { run } from './dataBaseController.js';
import { magma } from './magma.js';
import WebSocket from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const activeFileStreams = new Map();


export async function handleFileChunk(payload, ws, wss) {
    const { FileId, FileName, ChunkIndex, TotalChunks, Base64Data, Target, Sender, TempId } = payload;
    //console.log(payload);

    try {
        let session = activeFileStreams.get(FileId);

        if (!session) {
            const safeFileName = path.basename(FileName);
            const uniqueFileName = `${Date.now()}_${safeFileName}`;
            const fullPath = path.join(__dirname, 'uploads', uniqueFileName);

            fs.writeFileSync(fullPath, '');

            session = {
                fullPath: fullPath,
                webPath: `/uploads/${uniqueFileName}`,
                expectedIndex: 0
            };
            activeFileStreams.set(FileId, session);
            console.log(`📁 Начат прием файла: ${safeFileName} (ID: ${FileId})`);
        }

        if (ChunkIndex !== session.expectedIndex) {
            console.error(`❌ Нарушен порядок чанков для ${FileId}. Ожидался ${session.expectedIndex}, пришел ${ChunkIndex}`);
            return;
        }

        const buffer = Buffer.from(Base64Data, 'base64');

        fs.appendFileSync(session.fullPath, buffer);

        session.expectedIndex++;

        console.log(`📦 Принят чанк [${ChunkIndex + 1}/${TotalChunks}] для файла ID: ${FileId}`);

        if (ChunkIndex === TotalChunks - 1) {
            console.log(`✅ Файл успешно собран на диске: ${session.fullPath}`);

            const ext = path.extname(FileName).toLowerCase();
            const fileType = ['.png', '.jpg', '.jpeg', '.gif'].includes(ext) ? 'image' : 'document';
            const messageText = `📎 Файл: ${FileName}`;
            const result = await run(
                'INSERT INTO messages (sender, target, message, file_path, file_type) VALUES (?, ?, ?, ?, ?)',
                [Sender, Target, messageText, session.webPath, fileType]
            );

            const finalInsertId = result.lastID;
            console.log(`💾 Файловое сообщение сохранено в БД под ID: ${finalInsertId}`);

            const sentMessageIdObj = {
                type: 'sentMessageId',
                Id: finalInsertId,
                TempId: payload.TempId,
                IsRead: false
            };
            forwardToUser(Target, sentMessageIdObj, wss);

            wss.clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN && client.userName === Target) {
                    const now = new Date();
                    const datePart = now.toLocaleDateString('en-CA');
                    const timePart = now.toLocaleTimeString('en-GB', { hour12: false });
                    const formattedDate = `${datePart} ${timePart}`;

                    const messageObj = {
                        type: 'chatMessage',
                        Name: Sender,
                        Message: messageText,
                        Target: Target,
                        GotFromDB: false,
                        Date: formattedDate,
                        Id: finalInsertId,
                        TempId: 0,
                        IsRead: false,
                        FilePath: session.webPath,
                        FileType: fileType,
                        FileName: FileName
                    };

                    // const stringifiedObj = JSON.stringify(messageObj);
                    // const encryptedData = magma.encrypt(stringifiedObj, client.magmaKey);

                    // const finalPayload = {
                    //     encryptedData: encryptedData
                    // };

                    forwardToUser(target, messageObj, wss);
                    console.log(`✉️ Файловое сообщение [ID: ${finalInsertId}] успешно переслано пользователю ${Target}`);
                }
            });

            activeFileStreams.delete(FileId);
        }

    } catch (err) {
        console.error(`❌ Критическая ошибка при сборке чанка файла ${FileId}:`, err);
        activeFileStreams.delete(FileId);
    }
}

export async function handleDownloadFile(payload, ws, wss) {
    const { FilePath, Sender } = payload;

    const safePath = path.join(__dirname, FilePath);

    if (!fs.existsSync(safePath)) {
        console.error(`❌ Запрошенный файл не найден: ${safePath}`);
        return;
    }

    const fileSize = fs.statSync(safePath).size;
    const chunkSize = 64 * 1024;
    const totalChunks = Math.ceil(fileSize / chunkSize);

    console.log(`🚀 Сервер начинает отдачу файла: ${safePath} | Чанков: ${totalChunks}`);

    const fileBuffer = fs.readFileSync(safePath);
    let chunkIndex = 0;

    for (let offset = 0; offset < fileSize; offset += chunkSize) {
        const chunk = fileBuffer.subarray(offset, offset + chunkSize);
        const base64Data = chunk.toString('base64');

        const downloadChunkObj = {
            type: 'fileDownloadChunk',
            Base64Data: base64Data,
            ChunkIndex: chunkIndex,
            TotalChunks: totalChunks
        };

        const stringifiedObj = JSON.stringify(downloadChunkObj);
        const encryptedData = magma.encrypt(stringifiedObj, ws.magmaKey);

        forwardToUser(Sender, { encryptedData: encryptedData }, wss);
        chunkIndex++;
    }
    console.log(`✅ Все чанки файла успешно отданы клиенту.`);
}
