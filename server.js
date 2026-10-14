import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { magma } from './magma.js';

const activeFileStreams = new Map();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function generateServerKeyPair() {
  console.log('⏳ Генерация пары ключей сервера...');

  // Генерируем ключи на эллиптической кривой prime256v1 (NIST P-256)
  // Она идеально совместима с тем, что вы только что сделали на C++
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1', 
    privateKeyEncoding: {
      type: 'pkcs8',          // Стандартный формат для приватных ключей
      format: 'pem'           // Текстовый формат PEM
    },
    publicKeyEncoding: {
      type: 'spki',           // Стандартный формат для публичных ключей
      format: 'pem'           // Текстовый формат PEM
    }
  });

  // Сохраняем приватный ключ на сервере (НИКОМУ НЕ ОТДАВАТЬ)
  fs.writeFileSync('server_private.pem', privateKey, 'utf8');
  
  // Сохраняем публичный ключ сервера (ЕГО НУЖНО СКОПИРОВАТЬ К C++ КЛИЕНТУ)
  fs.writeFileSync('server_public.pem', publicKey, 'utf8');

  console.log('🎉 Ключи сервера успешно созданы и сохранены!');
  console.log(' -> server_private.pem (Остается тут, на сервере)');
  console.log(' -> server_public.pem  (Скопируйте этот файл в папку к C++ клиенту)');
}

//generateServerKeyPair();

const serverPrivateKeyECDSA = crypto.createPrivateKey(fs.readFileSync('server_private.pem')); 
const clientPublicKeyECDSA = crypto.createPublicKey(fs.readFileSync('client_public.pem'));

function establishSessionKeys(clientPublicKeyBase64) {
    if (!clientPublicKeyBase64) {
        throw new Error("Публичный ключ клиента отсутствует или равен undefined");
    }

    // 1. Генерируем временную пару ключей сервера (эллиптическая кривая P-256)
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
        namedCurve: 'prime256v1'
    });
    
    // 2. Экспортируем публичный ключ сервера в Base64 (в формате SPKI для .NET)
    const serverPublicKeySpki = publicKey.export({ 
        type: 'spki', 
        format: 'der' 
    }).toString('base64');

    // 3. Восстанавливаем публичный ключ клиента из полученной Base64 строки
    const clientPublicKeyBuffer = Buffer.from(clientPublicKeyBase64, 'base64');
    const clientPublicKey = crypto.createPublicKey({ 
        key: clientPublicKeyBuffer, 
        format: 'der', 
        type: 'spki' 
    });

    // 4. Вычисляем общий pre-master секрет. 
    // ИСПРАВЛЕНО: Для приватного ключа явно указываем его объект KeyObject
    const rawSecret = crypto.diffieHellman({
        privateKey: privateKey,
        publicKey: clientPublicKey
    });
    
    // 5. Хэшируем его через SHA-256, чтобы получить чистые 32 байта для Магмы
    const magmaKey = crypto.createHash('sha256').update(rawSecret).digest();

    return {
        serverPublicKey: serverPublicKeySpki,
        magmaKey: magmaKey
    };
}

// 1. Инициализация асинхронной базы данных SQLite
let db;
try {
    db = await open({
        filename: 'chat.db',
        driver: sqlite3.Database
    });

//	await db.exec(`
  //  ALTER TABLE messages ADD COLUMN file_type TEXT DEFAULT NULL;
  //`);

    // Создаем таблицу для сообщений, если её нет
    await db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender TEXT,
        target TEXT,
        message TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
	isRead BOOLEAN DEFAULT 0
      )
    `);
    console.log('📦 База данных SQLite (chat.db) успешно подключена');
} catch (err) {
    console.error('❌ Ошибка инициализации БД:', err.message);
    process.exit(1);
}

// 2. Инициализация WebSocket сервера
const wss = new WebSocketServer({ port: 5000 });
console.log('🚀 WebSocket сервер запущен на порту 5000');

// Функция для сборки и отправки списка ВСЕХ пользователей, исключая себя
async function sendUsersListToClient(ws) {
    if (!ws.userName) return;

    try {
        // Очищаем имя текущего пользователя от пробелов для точного сравнения
        const currentClientName = ws.userName.trim();

        // 1. Получаем список всех уникальных имен из базы данных
        const dbUsers = await db.all(`
            SELECT DISTINCT TRIM(sender) AS name FROM messages WHERE sender IS NOT NULL AND sender != ''
            UNION
            SELECT DISTINCT TRIM(target) AS name FROM messages WHERE target IS NOT NULL AND target != ''
        `);
        
        const allRegisteredNames = dbUsers.map(row => row.name.trim());

        // 2. Добавляем тех, кто сейчас онлайн
        const onlineNames = Array.from(wss.clients)
            .map(client => client.userName ? client.userName.trim() : '')
            .filter(name => name !== '');

        // 3. Объединяем оба списка
        const combinedNames = [...allRegisteredNames, ...onlineNames];

        // 4. Фильтруем: убираем дубликаты (без учета регистра) и исключаем себя
        const uniqueFilteredNames = [];
        const seenNames = new Set();

        // Сначала добавляем самого себя в "увиденные", чтобы он гарантированно не попал в итоговый список
        seenNames.add(currentClientName.toLowerCase());

        for (const name of combinedNames) {
            const lowerName = name.toLowerCase();
            if (!seenNames.has(lowerName)) {
                seenNames.add(lowerName);
                uniqueFilteredNames.push(name); // Сохраняем оригинальное написание
            }
        }

        // 5. Формируем JSON-пакет для C# клиента
                // 1. Формируем исходный объект со списком чатов
         const chatListObj = {
            type: 'chatsList',
            Names: uniqueFilteredNames
        };

        // 2. Превращаем в JSON-строку
        const rawJsonString = JSON.stringify(chatListObj);

        // 3. Шифруем строку
        const encryptedDataStr = magma.encrypt(rawJsonString, ws.magmaKey);

        // 4. Упаковываем в финальный контейнер
        const finalPayload = JSON.stringify({
            "encryptedData": encryptedDataStr
        });
console.log(ws.magmaKey);
        // ПРАВИЛЬНАЯ ПРОВЕРКА: Дешифруем строго строку encryptedDataStr, а не finalPayload!
        //console.log("Результат самопроверки сервера:", encryptedDataStr);
//console.log(magma.decrypt(encryptedDataStr, ws.magmaKey));

        if (ws.readyState === WebSocket.OPEN) {
            ws.send(finalPayload); // Раньше здесь ошибочно отправлялся открытый chatListPayload
        }
    } catch (err) {
        console.error('❌ Ошибка при формировании списка пользователей:', err.message);
    }
}


// Вспомогательная функция для массового обновления (когда кто-то зашел/вышел)
async function broadcastUsersListToAll() {
    for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN && client.userName) {
            await sendUsersListToClient(client);
        }
    }
}

function handleClientHandshake(clientPublicKeyBase64) {
    // 1. Создаем серверную пару ECDH на кривой P-256
    const serverEcdh = crypto.createECDH('prime256v1');
    serverEcdh.generateKeys();

    // 2. Получаем открытый ключ сервера в формате DER/SubjectPublicKeyInfo (Base64) для отправки клиенту
    // Важно использовать формат 'spki', чтобы C# смог его прочитать через ImportSubjectPublicKeyInfo
    const serverPublicKeyBase64 = serverEcdh.getPublicKey('base64', 'compressed'); 
    // Примечание: Для идеальной совместимости с .NET лучше использовать некомпрессированный или SPKI.
    // Ниже приведен универсальный способ генерации SPKI в Node.js:
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
        namedCurve: 'prime256v1'
    });
    
    const serverPublicKeySpki = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

    // 3. Восстанавливаем публичный ключ клиента из Base64
    const clientPublicKeyBuffer = Buffer.from(clientPublicKeyBase64, 'base64');

    // 4. Вычисляем общий секрет (серверный приватный + клиентский публичный)
    // В NodeJS crypto.computeSecret возвращает сырой пре-мастер секрет. 
    // Чтобы он совпал с C# (.DeriveKeyMaterial), его нужно прогнать через SHA-256:
    const rawSecret = crypto.diffieHellman({
        privateKey: privateKey,
        publicKey: crypto.createPublicKey({ key: clientPublicKeyBuffer, format: 'der', type: 'spki' })
    });
    
    const sessionMagmaKey = crypto.createHash('sha256').update(rawSecret).digest();
    // sessionMagmaKey — это готовый Buffer (32 байта) ключа Магмы для ЭТОГО конкретного сокета!

    return {
        serverPublicKey: serverPublicKeySpki, // Отправить обратно клиенту C#
        magmaKey: sessionMagmaKey            // Сохранить в объекте ws-соединения (ws.magmaKey = magmaKey)
    };
}

wss.on('connection', (ws) => {
    console.log('🔌 Новое соединение открыто');
    
    ws.userName = '';
    ws.magmaKey = '';
    ws.currentChatTarget = '';

    // Обработчик сообщений делаем async, так как внутри будут запросы к БД
    ws.on('message', async (data) => {
        try {
            const rawJson = data.toString();
             const incomingData = JSON.parse(rawJson);
    let payload;

    // 1. Проверяем, зашифровано ли сообщение.
    // Если есть поле encryptedData — расшифровываем. Если нет — это открытый JSON (юзер)
    if (incomingData.encryptedData) {
        if (!ws.magmaKey) {
            throw new Error("Попытка прислать зашифрованные данные до установки ключа сессии!");
        }
        // Используем decrypt для расшифровки
        const decryptedString = magma.decrypt(incomingData.encryptedData, ws.magmaKey);
        payload = JSON.parse(decryptedString);
    } else {
        // Юзера вы не шифруете, поэтому payload — это и есть сам incomingData
        payload = incomingData;
    }
            // 1. Обработка авторизации пользователя (класс User в C# не имеет поля Type)
            if (payload.type === 'user') {
		const clientPublicKeyDH = payload.ClientPublicKey;
    		const clientSignatureHex = payload.Signature;
if (!clientPublicKeyDH || !clientSignatureHex) {
        console.error("🛑 Ошибка: Клиент не прислал ClientPublicKey или Signature!", payload);
        ws.close();
        return;
    }                
		console.log("\n--- [DEBUG] ПРОВЕРКА ПОДПИСИ КЛИЕНТА ---");
console.log("1. Имя пользователя:", payload.Name);
console.log("2. Полученная подпись Signature (HEX):", clientSignatureHex);

// Декодируем входящую Base64 строку обратно в чистые байты ключа, 
// которые были подписаны на стороне C++
const dataToVerify = Buffer.from(clientPublicKeyDH, 'base64');
console.log("3. Создан бинарный буфер ключа длиной:", dataToVerify.length, "байтов.");

try {
    const isClientValid = crypto.verify(
        'sha256',
        dataToVerify, // Проверяем чистые байты
        clientPublicKeyECDSA,
        Buffer.from(clientSignatureHex, 'hex')
    );

    console.log("4. РЕЗУЛЬТАТ ПРОВЕРКИ КРИПТОГРАФИИ:", isClientValid ? "✅ ВАЛИДНА" : "❌ НЕ ВАЛИДНА");
    console.log("---------------------------------------\n");

    if (!isClientValid) {
        console.error(`🛑 Подпись клиента ${payload.Name} не валидна! Разрыв соединения.`);
        ws.close();
        return;
    }

    // ... логика успешного хэндшейка ...
} catch (err) {
    console.error("❌ Исключение при проверке подписи:", err.message);
    ws.close();
}


//    		if (!isClientValid) {
  //      	console.error(`❌ Подпись клиента ${payload.Name} не валидна! Разрыв соединения.`);
    //    	ws.close();
      //  	return;
    	//	}

		ws.userName = payload.Name;
                console.log(`👤 Пользователь вошел в сеть: ${ws.userName}`);
              
		const {serverPublicKey, magmaKey} =  establishSessionKeys(clientPublicKeyDH);
  		ws.magmaKey = magmaKey;

		const serverSignBuffer = crypto.sign(
            'sha256',
            Buffer.from(serverPublicKey, 'utf8'), // Подписываем текстовые символы 'MFkw...'
            serverPrivateKeyECDSA
        );

// ШАГ 2: Переводим полученный буфер подписи в HEX-строку для отправки
const serverSignHex = serverSignBuffer.toString('hex');
		const serverHandshake = JSON.stringify({
            	type: 'serverHandshake',
            	ServerPublicKey: serverPublicKey,
		Signature: serverSignHex
       		 });

		if (ws.readyState === WebSocket.OPEN) {
        	    ws.send(serverHandshake);
	        }

                // Рассылаем обновленный список ников (чатов) всем участникам
                await broadcastUsersListToAll();
                return;
            }
//console.log(payload);
            // 2. Обработка выбора чата (класс GetChat -> type: "getChat")
	     if(payload.type === 'markAsRead')
	     {
//console.log('MArkasread')
		const row = await  db.get('SELECT target, sender  FROM messages WHERE id = ? ', [payload.Id])
console.log(row.target);	      	
		if(row.target === ws.userName)
		{
		 await db.run('UPDATE messages SET isRead = 1 WHERE id =  ?', [payload.Id]);
console.log('Mark as read');
		 wss.clients.forEach((client) => {
			if(client.readyState === WebSocket.OPEN && client.userName === row.sender)
			{
			 const markObj = {
			 type: 'markAsRead',
			 Id: payload.Id
			 };

			const stringifiedObj = JSON.stringify(markObj);
			const encryptedData = magma.encrypt(stringifiedObj, client.magmaKey);
			
			const finalPayload = {
			    encryptedData: encryptedData
			};

			client.send(JSON.stringify(finalPayload));
		 }});
		}
	     }
	     else if (payload.type === 'fileChunk') {
    // Деструктуризируем поля с ЗАГЛАВНОЙ буквы, как они прилетают от C++ клиента
    const { FileId, FileName, ChunkIndex, TotalChunks, Base64Data, Target, Sender, TempId } = payload;
	//console.log(payload);

    try {
        let session = activeFileStreams.get(FileId);

        // 1. Если это самый первый чанк, инициализируем файл на диске
        if (!session) {
            // Очищаем имя файла от опасных символов пути (Path Traversal Protection)
            const safeFileName = path.basename(FileName);
            // Генерируем уникальное имя для диска
            const uniqueFileName = `${Date.now()}_${safeFileName}`;

            const fullPath = path.join(__dirname, 'uploads', uniqueFileName);

            // Создаем пустой файл
            fs.writeFileSync(fullPath, '');

            session = {
                fullPath: fullPath,
                webPath: `/uploads/${uniqueFileName}`,
                expectedIndex: 0
            };
            activeFileStreams.set(FileId, session);
            console.log(`📁 Начат прием файла: ${safeFileName} (ID: ${FileId})`);
        }

        // Защита: проверка последовательности чанков
        if (ChunkIndex !== session.expectedIndex) {
            console.error(`❌ Нарушен порядок чанков для ${FileId}. Ожидался ${session.expectedIndex}, пришел ${ChunkIndex}`);
            return;
        }

        // 2. Декодируем текущий чанк из Base64 в бинарный Buffer
        const buffer = Buffer.from(Base64Data, 'base64');

        // Дописываем кусочек в конец файла на диске
        fs.appendFileSync(session.fullPath, buffer);
        
        // Сдвигаем счетчик ожидаемого чанка
        session.expectedIndex++;

        console.log(`📦 Принят чанк [${ChunkIndex + 1}/${TotalChunks}] для файла ID: ${FileId}`);

        // 3. ПРОВЕРКА ФИНАЛА: Если это был последний чанк, сохраняем в БД и уведомляем клиентов
        if (ChunkIndex === TotalChunks - 1) {
            console.log(`✅ Файл успешно собран на диске: ${session.fullPath}`);

            // Определяем тип файла по расширению для интерфейса C++
            const ext = path.extname(FileName).toLowerCase();
            const fileType = ['.png', '.jpg', '.jpeg', '.gif'].includes(ext) ? 'image' : 'document';

            // Формируем текст сообщения
            const messageText = `📎 Файл: ${FileName}`;

            // Сохраняем итоговую запись в базу данных SQLite (колонки в БД оставляем в нижнем регистре)
            const result = await db.run(
                'INSERT INTO messages (sender, target, message, file_path, file_type) VALUES (?, ?, ?, ?, ?)',
                Sender, Target, messageText, session.webPath, fileType
            );

            const finalInsertId = result.lastID;
            console.log(`💾 Файловое сообщение сохранено в БД под ID: ${finalInsertId}`);

            // 4. Отправляем ОТПРАВИТЕЛЮ подтверждение постоянного ID (Поля с заглавной буквы!)
            const sentMessageIdObj = {
                type: 'sentMessageId',
                Id: finalInsertId,
                TempId: payload.TempId, 
                IsRead: false
            };
            ws.send(JSON.stringify({ encryptedData: magma.encrypt(JSON.stringify(sentMessageIdObj), ws.magmaKey) }));

            // 5. Рассылаем получателю финальный пакет сообщения с файлом (Поля с заглавной буквы!)
            wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && client.userName === Target) {
        const now = new Date();
        const datePart = now.toLocaleDateString('en-CA'); 
        const timePart = now.toLocaleTimeString('en-GB', { hour12: false });
        const formattedDate = `${datePart} ${timePart}`;        

        // Создаем объект сообщения, расширенный полями файла (по вашим регистрам)
        const messageObj = {
            type: 'chatMessage',
            Name: Sender,
            Message: messageText, // "📎 Файл: название.ext"
            Target: Target,
            GotFromDB: false,
            Date: formattedDate,
            Id: finalInsertId,    // Используем наш гарантированный ID из БД!
            TempId:0,
	    IsRead: false,
            // Добавляем новые поля файла в пакет для C++ фронтенда
            FilePath: session.webPath,
            FileType: fileType,
            FileName: FileName
        };

        // Превращаем его в строку и шифруем ключом получателя
        const stringifiedObj = JSON.stringify(messageObj);
        const encryptedData = magma.encrypt(stringifiedObj, client.magmaKey);

        // Упаковываем зашифрованные данные в финальный JSON и отправляем
        const finalPayload = {
            encryptedData: encryptedData
        };

        client.send(JSON.stringify(finalPayload));
        console.log(`✉️ Файловое сообщение [ID: ${finalInsertId}] успешно переслано пользователю ${Target}`);
    }
});

            // Удаляем сессию сборки из оперативной памяти
            activeFileStreams.delete(FileId);
        }

    } catch (err) {
        console.error(`❌ Критическая ошибка при сборке чанка файла ${FileId}:`, err);
        activeFileStreams.delete(FileId);
    }
}


else if (payload.type === 'fileDownloadRequest') {
    const { FilePath, Sender } = payload;
    
    // Безопасно строим абсолютный путь к файлу на сервере
    const safePath = path.join(__dirname, FilePath); 

    if (!fs.existsSync(safePath)) {
        console.error(`❌ Запрошенный файл не найден: ${safePath}`);
        return;
    }

    const fileSize = fs.statSync(safePath).size;
    const chunkSize = 64 * 1024; // 64 КБ
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

        // Шифруем и отправляем обратно клиенту в этот же сокет
        const stringifiedObj = JSON.stringify(downloadChunkObj);
        const encryptedData = magma.encrypt(stringifiedObj, ws.magmaKey);
        
        ws.send(JSON.stringify({ encryptedData: encryptedData }));
        chunkIndex++;
    }
    console.log(`✅ Все чанки файла успешно отданы клиенту.`);
}
              
	     else if (payload.type === 'getChat' || payload.Type === 'getChat') {
                const targetUser = payload.Name;
                ws.currentChatTarget = targetUser;
                console.log(`💬 ${ws.userName} открыл диалог с ${targetUser}`);

                // Загружаем историю сообщений из БД между двумя пользователями (используем await)
                const history = await db.all(
                    'SELECT sender, timestamp, id, isRead, file_path, file_type,  message FROM messages WHERE (sender = ? AND target = ?) OR (sender = ? AND target = ?) ORDER BY timestamp ASC',
                    ws.userName, targetUser, targetUser, ws.userName
                );
                
                // Отправляем историю сообщений обратно клиенту
                history.forEach((row) => {
		     const realTarget = (row.sender === ws.userName) ? targetUser : ws.userName;
                    //const encryptedText = magma.encrypt(row.message, ws.magmaKey);
		    const messageObj = {
        type: 'chatMessage',
        Name: row.sender,
        Message: row.message, // Берем исходный текст сообщения из БД
        Target: realTarget,
        GotFromDB: true,
	Date: row.timestamp,
	Id: row.id,
	TempId: 0,
	IsRead: row.isRead == 1,
	FilePath: row.file_path || "",
	FileType: row.file_type || "",
	FileName: ""
    };

    // 2. Преобразуем объект в строку, чтобы передать его в функцию шифрования Magma
    const stringifiedObj = JSON.stringify(messageObj);

    // 3. Шифруем полученную строку (обратите внимание на ws.magmaKey)
    const encryptedText = magma.encrypt(stringifiedObj, ws.magmaKey);

    // 4. Формируем финальный объект для отправки клиенту
    const finalPayload = {
        encryptedData: encryptedText
    };

    // 5. Отправляем JSON-строку через WebSocket
    ws.send(JSON.stringify(finalPayload));
                });
                return;
            }

            // 3. Обработка отправки сообщения (Type: "chatMessage")
            if (payload.Type === 'chatMessage' || payload.type === 'chatMessage') {
                const sender = payload.Name;
                const messageText = payload.Message;
                const target = payload.Target;

                if (!sender || !target || !messageText) return;

                // Сохраняем сообщение в базу данных SQLite (используем await)
                const result = await db.run(
                    'INSERT INTO messages (sender, target, message) VALUES (?, ?, ?)',
                    sender, target, messageText
                );
                console.log(`💾 Сохранено в БД [${sender} -> ${target}]: ${messageText}`);

		const sentMessageIdObj = {
		type: 'sentMessageId',
		Id: result.lastID,
		TempId: payload.TempId,
		IsRead: result.isRead == 1
		};
	
		const stringifiedJson1 = JSON.stringify(sentMessageIdObj);
		const encryptedData1 = magma.encrypt(stringifiedJson1, ws.magmaKey);
		const finalPayload1 = {
		encryptedData: encryptedData1
		};
		
		ws.send(JSON.stringify(finalPayload1));

                // Отправляем сообщение получателю (если он онлайн)
                wss.clients.forEach(async (client) => {
    if (client.readyState === WebSocket.OPEN && client.userName === target) {
	const now = new Date();
	const datePart = now.toLocaleDateString('en-CA'); 
	const timePart = now.toLocaleTimeString('en-GB', { hour12: false });
	const formattedDate = `${datePart} ${timePart}`;        
	const row = await db.get("SELECT seq FROM sqlite_sequence WHERE name = 'messages'");

        // 1. Создаем объект сообщения (без лишних копирований)
        const messageObj = {
            type: 'chatMessage',
            Name: sender,
            Message: messageText,
            Target: target,
            GotFromDB: false,
	    Date: formattedDate,
	    Id: row.seq,
	    TempId: 0,
	    IsRead: false,
	    FilePath: "",
	    FileType: "",
	    FileName: ""
        };

        // 2. Превращаем его в строку и шифруем ключом текущего клиента
        const stringifiedObj = JSON.stringify(messageObj);
        const encryptedData = magma.encrypt(stringifiedObj, client.magmaKey);

        // 3. Упаковываем зашифрованные данные в финальный JSON и отправляем
        const finalPayload = {
            encryptedData: encryptedData
        };

        client.send(JSON.stringify(finalPayload));
    }
});

            }
	    if (payload.type === 'callOffer') {
    const { Target, Sender, Sdp } = payload;
    console.log(`📞 [Сигналинг] ${Sender} звонит ${Target}`);
    
    // Пересылаем пакет целиком получателю звонка
    forwardToUser(Target, {
        type: 'callOffer',
        Sender: Sender,
        Sdp: Sdp
    });
}

// 2. Обработка ответа на звонок (Answer)
else if (payload.type === 'callAnswer') {
    const { Target, Sender, Sdp } = payload;
    console.log(`🤙 [Сигналинг] ${Sender} принял звонок от ${Target}`);
    
    forwardToUser(Target, {
        type: 'callAnswer',
        Sender: Sender,
        Sdp: Sdp
    });
}

// 3. Обмен прямыми сетевыми адресами (ICE Candidates)
else if (payload.type === 'iceCandidate') {
    const { Target, Sender, Candidate } = payload;
 console.log(`[СЕРВЕР 📡] Маршрут от ${Sender}: ${Candidate.substring(0, 50)}...`);    
    forwardToUser(Target, {
        type: 'iceCandidate',
        Sender: Sender,
        Candidate: Candidate
    });
}

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

    // Обработка отключения пользователя
    ws.on('close', async () => {
        if (ws.userName) {
            console.log(`❌ Пользователь ${ws.userName} отключился`);
            // Перерасчитываем список пользователей без отключившегося и отправляем остальным
            await broadcastUsersListToAll();
        }
    });
});
