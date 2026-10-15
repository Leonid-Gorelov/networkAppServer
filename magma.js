import crypto from 'crypto';
import { Buffer } from 'buffer';

const S_BOX = new Uint8Array([
    1, 7, 14, 13, 0, 5, 8, 3, 4, 15, 10, 6, 9, 12, 11, 2,
    8, 14, 2, 5, 6, 9, 1, 12, 15, 4, 11, 0, 13, 10, 3, 7,
    5, 13, 15, 6, 9, 2, 12, 10, 11, 7, 8, 1, 4, 3, 14, 0,
    7, 15, 5, 10, 8, 1, 6, 13, 0, 4, 9, 14, 11, 2, 12, 3,
    6, 12, 7, 1, 5, 15, 13, 8, 4, 10, 9, 14, 0, 3, 11, 2,
    4, 11, 10, 0, 7, 2, 1, 13, 3, 6, 8, 5, 9, 12, 15, 14,
    13, 11, 4, 1, 3, 15, 5, 9, 0, 10, 14, 7, 6, 8, 2, 12,
    1, 15, 13, 0, 5, 7, 10, 4, 9, 2, 3, 14, 6, 11, 8, 12
]);

function deriveRoundKeys(keyBuffer) {
    const keys = new Uint32Array(8);
    for (let i = 0; i < 8; i++) {
        keys[i] = keyBuffer.readUint32LE(i * 4);
    }
    return keys;
}

function fieldF(data, keyPart) {
    const sum = (data + keyPart) >>> 0;
    let sBoxResult = 0;

    for (let i = 0; i < 8; i++) {
        const shift = i * 4;
        const nibble = (sum >>> shift) & 0x0F;
        const substituted = S_BOX[(i * 16) + nibble];
        sBoxResult |= (substituted << shift);
    }

    sBoxResult = sBoxResult >>> 0;
    return ((sBoxResult << 11) | (sBoxResult >>> 21)) >>> 0;
}

function encryptBlock(blockBuffer, roundKeys) {
    let n1 = blockBuffer.readUint32LE(0);
    let n2 = blockBuffer.readUint32LE(4);

    for (let i = 0; i < 32; i++) {
        const keyIndex = (i < 24) ? (i % 8) : (7 - (i % 8));
        const temp = n1;
        n1 = (n2 ^ fieldF(n1, roundKeys[keyIndex])) >>> 0;
        n2 = temp;
    }

    const result = Buffer.alloc(8);
    result.writeUint32LE(n1, 0);
    result.writeUint32LE(n2, 4);
    return result;
}

export const magma = {
    encrypt(plainText, keyBuffer) {
        if (!plainText) return plainText;
        if (!keyBuffer || keyBuffer.length !== 32) throw new Error("Invalid Magma key length");

        const plainBytes = Buffer.from(plainText, 'utf8');
        const roundKeys = deriveRoundKeys(keyBuffer);

        const iv = crypto.randomBytes(8);

        const counter = Buffer.alloc(8);
        iv.copy(counter);

        const encryptedBytes = Buffer.alloc(plainBytes.length);

        for (let i = 0; i < plainBytes.length; i += 8) {
            const gamma = encryptBlock(counter, roundKeys);
            const bytesToProcess = Math.min(8, plainBytes.length - i);

            for (let j = 0; j < bytesToProcess; j++) {
                encryptedBytes[i + j] = plainBytes[i + j] ^ gamma[j];
            }

            let carry = 1;
            for (let b = 0; b < 8; b++) {
                const sum = counter[b] + carry;
                counter[b] = sum & 0xFF;
                carry = sum >> 8;
                if (carry === 0) break;
            }
        }

        return Buffer.concat([iv, encryptedBytes]).toString('base64');
    },

    decrypt(cipherTextBase64, keyBuffer) {
        if (!cipherTextBase64) return cipherTextBase64;
        if (!keyBuffer || keyBuffer.length !== 32) throw new Error("Invalid Magma key length");

        const fullCipherBytes = Buffer.from(cipherTextBase64, 'base64');
        if (fullCipherBytes.length < 8) return "";

        const roundKeys = deriveRoundKeys(keyBuffer);

        const iv = Buffer.alloc(8);
        fullCipherBytes.copy(iv, 0, 0, 8);

        const cipherBytes = fullCipherBytes.subarray(8);
        const decryptedBytes = Buffer.alloc(cipherBytes.length);

        const counter = Buffer.alloc(8);
        iv.copy(counter);

        for (let i = 0; i < cipherBytes.length; i += 8) {
            const gamma = encryptBlock(counter, roundKeys);
            const bytesToProcess = Math.min(8, cipherBytes.length - i);

            for (let j = 0; j < bytesToProcess; j++) {
                decryptedBytes[i + j] = cipherBytes[i + j] ^ gamma[j];
            }

            let carry = 1;
            for (let b = 0; b < 8; b++) {
                const sum = counter[b] + carry;
                counter[b] = sum & 0xFF;
                carry = sum >> 8;
                if (carry === 0) break;
            }
        }

        return decryptedBytes.toString('utf8');
    }
};
