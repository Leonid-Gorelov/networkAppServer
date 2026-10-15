import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { open } from 'sqlite';
import { initDb } from './dataBaseController.js';
import { initServerKeys } from './hadshakeController.js';
import { initWs } from './wsController.js';
import { initS3Client } from './fileController.js';

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

initServerKeys();
await initDb();
initWs();
await initS3Client();

