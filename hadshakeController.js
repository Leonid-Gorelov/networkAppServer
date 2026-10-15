import crypto from 'crypto';
import fs from 'fs';
import { forwardToUser } from './wsController.js';

let serverPrivateKeyECDSA, clientPublicKeyECDSA;

export async function initServerKeys() {
    serverPrivateKeyECDSA = crypto.createPrivateKey(fs.readFileSync('server_private.pem'));
    clientPublicKeyECDSA = crypto.createPublicKey(fs.readFileSync('client_public.pem'));
}

export async function establishSessionKeys(clientPublicKeyBase64) {
    if (!clientPublicKeyBase64) {
        throw new Error("Публичный ключ клиента отсутствует или равен undefined");
    }

    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
        namedCurve: 'prime256v1'
    });

    const serverPublicKeySpki = publicKey.export({
        type: 'spki',
        format: 'der'
    }).toString('base64');

    const clientPublicKeyBuffer = Buffer.from(clientPublicKeyBase64, 'base64');
    const clientPublicKey = crypto.createPublicKey({
        key: clientPublicKeyBuffer,
        format: 'der',
        type: 'spki'
    });

    const rawSecret = crypto.diffieHellman({
        privateKey: privateKey,
        publicKey: clientPublicKey
    });

    const magmaKey = crypto.createHash('sha256').update(rawSecret).digest();

    return {
        serverPublicKey: serverPublicKeySpki,
        magmaKey: magmaKey
    };
}

export async function handleClientHandshake(clientPublicKeyBase64) {
    const serverEcdh = crypto.createECDH('prime256v1');
    serverEcdh.generateKeys();

    const serverPublicKeyBase64 = serverEcdh.getPublicKey('base64', 'compressed');
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
        namedCurve: 'prime256v1'
    });

    const serverPublicKeySpki = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');

    const clientPublicKeyBuffer = Buffer.from(clientPublicKeyBase64, 'base64');

    const rawSecret = crypto.diffieHellman({
        privateKey: privateKey,
        publicKey: crypto.createPublicKey({ key: clientPublicKeyBuffer, format: 'der', type: 'spki' })
    });

    const sessionMagmaKey = crypto.createHash('sha256').update(rawSecret).digest();

    return {
        serverPublicKey: serverPublicKeySpki,
        magmaKey: sessionMagmaKey
    };
}

export async function verifyClientSignature(clientPublicKeyBase64, signature) {
    const clientPublicKeyDH = clientPublicKeyBase64;
    const clientSignatureHex = signature;
    if (!clientPublicKeyDH || !clientSignatureHex) {
        console.error("🛑 Ошибка: Клиент не прислал ClientPublicKey или Signature!");
        this.close();
        return;
    }
    const dataToVerify = Buffer.from(clientPublicKeyDH, 'base64');

    try {
        const isClientValid = crypto.verify(
            'sha256',
            dataToVerify,
            clientPublicKeyECDSA,
            Buffer.from(clientSignatureHex, 'hex')
        );

        console.log("4. РЕЗУЛЬТАТ ПРОВЕРКИ КРИПТОГРАФИИ:", isClientValid ? "✅ ВАЛИДНА" : "❌ НЕ ВАЛИДНА");
        console.log("---------------------------------------\n");

        if (!isClientValid) {
            console.error(`🛑 Подпись клиента ${payload.Name} не валидна! Разрыв соединения.`);
            //ws.close();
            return;
        }

        const { serverPublicKey, magmaKey } = await establishSessionKeys(clientPublicKeyDH);
        this.magmaKey = magmaKey;

        const serverSignBuffer = crypto.sign(
            'sha256',
            Buffer.from(serverPublicKey, 'utf8'),
            serverPrivateKeyECDSA
        );

        const serverSignHex = serverSignBuffer.toString('hex');
        const serverHandshake = {
            type: 'serverHandshake',
            ServerPublicKey: serverPublicKey,
            Signature: serverSignHex
        };

        forwardToUser(this.userName, serverHandshake);

    } catch (err) {
        console.error("❌ Исключение при проверке подписи:", err.message);
        this.close();
    }
}
