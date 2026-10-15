import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { forwardToUser } from './wsController.js';
import { run } from './dataBaseController.js';
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import * as dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const activeFileStreams = new Map();
let s3Client;

export async function initS3Client() {
    dotenv.config();

    s3Client = new S3Client({
        endpoint: process.env.S3_ENDPOINT,
        region: process.env.S3_REGION,
        credentials: {
            accessKeyId: process.env.S3_ACCESS_KEY_ID,
            secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
        },
        forcePathStyle: true
    });
}

export async function handleFileChunk(payload) {
    const { FileId, FileName, ChunkIndex, TotalChunks, Base64Data, Target, Sender, TempId } = payload;

    try {
        let session = activeFileStreams.get(FileId);

        if (!session) {
            const safeFileName = path.basename(FileName);
            const uniqueFileName = `${Date.now()}_${safeFileName}`;
            const fullPath = path.join(__dirname, 'uploads', uniqueFileName);

            if (!fs.existsSync(path.dirname(fullPath))) {
                fs.mkdirSync(path.dirname(fullPath), { recursive: true });
            }

            fs.writeFileSync(fullPath, '');

            session = {
                fullPath: fullPath,
                uniqueFileName: uniqueFileName,
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
            console.log(`✅ Файл успешно собран на диске: ${session.fullPath}. Отправка в RustFS...`);

            const fileStream = fs.createReadStream(session.fullPath);
            const ext = path.extname(FileName).toLowerCase();
            const fileType = ['.png', '.jpg', '.jpeg', '.gif'].includes(ext) ? 'image' : 'document';

            let contentType = 'application/octet-stream';
            if (fileType === 'image') contentType = `image/${ext.replace('.', '')}`;

            const s3Key = `uploads/${session.uniqueFileName}`;

            await s3Client.send(new PutObjectCommand({
                Bucket: process.env.S3_BUCKET_NAME,
                Key: s3Key,
                Body: fileStream,
                ContentType: contentType
            }));

            const s3WebPath = `${process.env.S3_ENDPOINT}/${process.env.S3_BUCKET_NAME}/${s3Key}`;
            console.log(`🚀 Файл успешно загружен в S3: ${s3WebPath}`);

            fs.unlinkSync(session.fullPath);

            const messageText = `📎 Файл: ${FileName}`;
            const result = await run(
                'INSERT INTO messages (sender, target, message, file_path, file_type) VALUES (?, ?, ?, ?, ?)',
                [Sender, Target, messageText, s3WebPath, fileType]
            );

            const finalInsertId = result.lastID;
            console.log(`💾 Файловое сообщение сохранено в БД под ID: ${finalInsertId}`);

            const sentMessageIdObj = {
                type: 'sentMessageId',
                Id: finalInsertId,
                TempId: payload.TempId,
                IsRead: false
            };
            forwardToUser(Target, sentMessageIdObj);

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
                FilePath: s3WebPath,
                FileType: fileType,
                FileName: FileName
            };

            forwardToUser(Target, messageObj);
            console.log(`✉️ Файловое сообщение [ID: ${finalInsertId}] успешно переслано пользователю ${Target}`);

            activeFileStreams.delete(FileId);
        }

    } catch (err) {
        console.error(`❌ Критическая ошибка при сборке чанка файла ${FileId}:`, err);
        const session = activeFileStreams.get(FileId);
        if (session && fs.existsSync(session.fullPath)) {
            try { fs.unlinkSync(session.fullPath); } catch (e) { }
        }
        activeFileStreams.delete(FileId);
    }
}

function parseS3Url(s3Url) {
    const url = new URL(s3Url);
    const pathParts = url.pathname.split('/').filter(Boolean);

    const bucketName = pathParts[0];
    const s3Key = pathParts.slice(1).join('/');

    return { bucketName, s3Key };
}

export async function handleDownloadFile(payload) {
    const { FilePath, Sender } = payload;

    try {
        console.log(`🔍 Запрос на скачивание файла из S3: ${FilePath}`);

        const { bucketName, s3Key } = parseS3Url(FilePath);

        const s3Response = await s3Client.send(new GetObjectCommand({
            Bucket: bucketName,
            Key: s3Key,
        }));

        const fileBuffer = await streamToBuffer(s3Response.Body);

        const fileSize = fileBuffer.length;
        const chunkSize = 64 * 1024;
        const totalChunks = Math.ceil(fileSize / chunkSize);

        console.log(`🚀 Сервер скачал файл из RustFS и начинает отдачу клиенту. Чанков: ${totalChunks}`);

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

            forwardToUser(Sender, downloadChunkObj);
            chunkIndex++;
        }

        console.log(`✅ Все чанки файла из RustFS успешно отданы клиенту.`);

    } catch (err) {
        console.error(`❌ КРИТИЧЕСКАЯ ОШИБКА при скачивании файла из S3:`, err);
    }
}

async function streamToBuffer(stream) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        stream.on('data', (chunk) => chunks.push(chunk));
        stream.on('error', (err) => reject(err));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
    });
}
