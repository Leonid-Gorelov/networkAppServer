#include "ProgramClasses.h"
#include <iostream>
#include <string>
#include <openssl/rand.h>
#include <vector>
#include <cstring>
#include <algorithm>
#include <stdexcept>

User::User(std::string name, std::string clientPublicKey, std::string signature)
{
	User::Name = name;
	User::ClientPublicKey = clientPublicKey;
    User::Signature = signature;
}

User::~User() {}

ChatMessage::ChatMessage(std::string name, std::string message, std::string target, int tempId)
{
	ChatMessage::Name = name;
	ChatMessage::Message = message;
	ChatMessage::Target = target;
    ChatMessage::TempId = tempId;
}

ChatMessage::~ChatMessage() {}

GetChat::GetChat(std::string name)
{
	GetChat::Name = name;
}

GetChat::~GetChat() {}

ServerHandshake::~ServerHandshake () {}

ChatList::~ChatList() {}

const uint8_t MagmaEncryption::SBox[8][16] = {
    {1,  7, 14, 13,  0,  5,  8,  3,  4, 15, 10,  6,  9, 12, 11,  2},
    {8, 14,  2,  5,  6,  9,  1, 12, 15,  4, 11,  0, 13, 10,  3,  7},
    {5, 13, 15,  6,  9,  2, 12, 10, 11,  7,  8,  1,  4,  3, 14,  0},
    {7, 15,  5, 10,  8,  1,  6, 13,  0,  4,  9, 14, 11,  2,  12,  3},
    {6, 12,  7,  1,  5, 15, 13,  8,  4, 10,  9, 14,  0,  3, 11,  2},
    {4, 11, 10,  0,  7,  2,  1, 13,  3,  6,  8,  5,  9, 12, 15, 14},
    {13,11,  4,  1,  3, 15,  5,  9,  0, 10, 14,  7,  6,  8,  2, 12},
    {1, 15, 13,  0,  5,  7, 10,  4,  9,  2,  3, 14,  6, 11,  8, 12}
};

uint32_t MagmaEncryption::FieldF(uint32_t data, uint32_t keyPart)
{
    uint32_t sum = data + keyPart;
    uint32_t sBoxResult = 0;

    for (int i = 0; i < 8; i++)
    {
        int bitShift = i * 4;
        uint8_t nibble = static_cast<uint8_t>((sum >> bitShift) & 0x0F);
        sBoxResult |= static_cast<uint32_t>(SBox[i][nibble] << bitShift);
    }

    return (sBoxResult << 11) | (sBoxResult >> 21);
}

std::vector<uint8_t> MagmaEncryption::EncryptBlock(const std::vector<uint8_t>& block, const std::vector<uint32_t>& roundKeys)
{
    uint32_t n1, n2;
    std::memcpy(&n1, &block[0], 4);
    std::memcpy(&n2, &block[4], 4);

    for (int i = 0; i < 32; i++)
    {
        uint32_t keyIndex = (i < 24) ? static_cast<uint32_t>(i % 8) : static_cast<uint32_t>(7 - (i % 8));
        uint32_t temp = n1;
        n1 = n2 ^ FieldF(n1, roundKeys[keyIndex]);
        n2 = temp;
    }

    std::vector<uint8_t> result(8);
    std::memcpy(&result[0], &n1, 4);
    std::memcpy(&result[4], &n2, 4);
    return result;
}

std::vector<uint32_t> MagmaEncryption::DeriveRoundKeys(const std::vector<uint8_t>& key)
{
    std::vector<uint32_t> roundKeys(8);
    for (int i = 0; i < 8; i++)
    {
        std::memcpy(&roundKeys[i], &key[i * 4], 4);
    }
    return roundKeys;
}

std::string MagmaEncryption::Encrypt(const std::string& plainText, const std::vector<uint8_t>& key)
{
    if (plainText.empty()) return plainText;

    std::vector<uint8_t> plainBytes(plainText.begin(), plainText.end());
    std::vector<uint32_t> roundKeys = DeriveRoundKeys(key);

    std::vector<uint8_t> iv(8);
   
    if (RAND_bytes(iv.data(), static_cast<int>(iv.size())) != 1) {
        throw std::runtime_error("OpenSSL: Ошибка генерации случайных чисел для IV");
    }

    //BCryptGenRandom(NULL, iv.data(), static_cast<ULONG>(iv.size()), BCRYPT_USE_SYSTEM_PREFERRED_RNG);

    std::vector<uint8_t> encryptedBytes(plainBytes.size());
    std::vector<uint8_t> counter(8);
    std::memcpy(counter.data(), iv.data(), 8);

    for (size_t i = 0; i < plainBytes.size(); i += 8)
    {
        std::vector<uint8_t> gamma = EncryptBlock(counter, roundKeys);
        size_t bytesToProcess = (std::min)(static_cast<size_t>(8), plainBytes.size() - i);

        for (size_t j = 0; j < bytesToProcess; j++)
        {
            encryptedBytes[i + j] = plainBytes[i + j] ^ gamma[j];
        }

        uint64_t ctrVal;
        std::memcpy(&ctrVal, counter.data(), 8);
        ctrVal++;
        std::memcpy(counter.data(), &ctrVal, 8);
    }

    std::vector<uint8_t> finalResult(iv.size() + encryptedBytes.size());
    std::memcpy(finalResult.data(), iv.data(), iv.size());
    std::memcpy(finalResult.data() + iv.size(), encryptedBytes.data(), encryptedBytes.size());

    return Base64Encode(finalResult);
}

std::string MagmaEncryption::Decrypt(const std::string& cipherText, const std::vector<uint8_t>& key)
{
    if (cipherText.empty()) return cipherText;

    std::vector<uint8_t> fullCipherBytes = Base64Decode(cipherText);
    std::vector<uint32_t> roundKeys = DeriveRoundKeys(key);

    std::vector<uint8_t> iv(8);
    std::vector<uint8_t> cipherBytes(fullCipherBytes.size() - 8);
    std::memcpy(iv.data(), fullCipherBytes.data(), 8);
    std::memcpy(cipherBytes.data(), fullCipherBytes.data() + 8, cipherBytes.size());

    std::vector<uint8_t> decryptedBytes(cipherBytes.size());
    std::vector<uint8_t> counter(8);
    std::memcpy(counter.data(), iv.data(), 8);

    for (size_t i = 0; i < cipherBytes.size(); i += 8)
    {
        std::vector<uint8_t> gamma = EncryptBlock(counter, roundKeys);
        size_t bytesToProcess = (std::min)(static_cast<size_t>(8), cipherBytes.size() - i);

        for (size_t j = 0; j < bytesToProcess; j++)
        {
            decryptedBytes[i + j] = cipherBytes[i + j] ^ gamma[j];
        }

        uint64_t ctrVal;
        std::memcpy(&ctrVal, counter.data(), 8);
        ctrVal++;
        std::memcpy(counter.data(), &ctrVal, 8);
    }

    return std::string(decryptedBytes.begin(), decryptedBytes.end());
}

std::string MagmaEncryption::Base64Encode(const std::vector<uint8_t>& data)
{
    static const char lookup[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string out;
    out.reserve(((data.size() + 2) / 3) * 4);
    int val = 0, valb = -6;
    for (uint8_t c : data) {
        val = (val << 8) + c;
        valb += 8;
        while (valb >= 0) {
            out.push_back(lookup[(val >> valb) & 0x3F]);
            valb -= 6;
        }
    }
    if (valb > -6) out.push_back(lookup[((val << 8) >> (valb + 8)) & 0x3F]);
    while (out.size() % 4) out.push_back('=');
    return out;
}

std::vector<uint8_t> MagmaEncryption::Base64Decode(const std::string& base64Str)
{
    static const std::vector<int> T = []() {
        std::vector<int> table(256, -1);
        for (int i = 0; i < 64; i++) table["ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"[i]] = i;
        return table;
    }();

    std::vector<uint8_t> out;
    int val = 0, valb = -8;
    for (char c : base64Str) {
        if (T[c] == -1) { if (c == '=') break; continue; }
        val = (val << 6) + T[c];
        valb += 6;
        if (valb >= 0) {
            out.push_back(char((val >> valb) & 0xFF));
            valb -= 8;
        }
    }
    return out;
}
