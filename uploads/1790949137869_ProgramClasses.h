#pragma once
#include <iostream>
#include <string>
#include <vector>
#include <cstdint>
#include <nlohmann/json.hpp>
#include <QtWidgets/qapplication.h>
#include <QtWidgets/qwidget.h>
#include <QtWidgets/qlabel.h>
#include <QtWidgets/qlineedit.h>
#include <QtWidgets/qpushbutton.h>
#include <QtWidgets/qboxlayout.h>
#include <QtWidgets/qmessagebox.h>
#include <QtWidgets/qlistwidget.h>
#include <QtWidgets/qtextedit.h>
#include <QtWidgets/qstyleditemdelegate.h>
#include <QtWidgets/qstyle.h>
class User
{
public:
	std::string Name;
	std::string ClientPublicKey;
	std::string Signature;
	std::string type = "user";
	User() = default;
	User(std::string name, std::string clientPublicKey, std::string signature);
	~User();
};

NLOHMANN_DEFINE_TYPE_NON_INTRUSIVE(User, Name, ClientPublicKey, Signature, type)

class ChatMessage
{
public:
	std::string Name;
	std::string Message;
	std::string Target;
	bool GotFromDB = false;
	std::string Date;
	int Id;
	int TempId;
	bool IsRead;
	std::string FilePath;
	std::string FileType;
	std::string FileName;
	std::string type = "chatMessage";
	ChatMessage() = default;
	ChatMessage(std::string name, std::string message, std::string target, int tempId);
	~ChatMessage();
};

NLOHMANN_DEFINE_TYPE_NON_INTRUSIVE(ChatMessage, Name, Message, Target, GotFromDB, Date, Id, TempId, IsRead, FilePath, FileType, FileName, type)

class MarkAsRead
{
public:
	int Id;
	std::string type = "markAsRead";
};

NLOHMANN_DEFINE_TYPE_NON_INTRUSIVE(MarkAsRead, Id, type)

class SentMessageId
{
public:
	int TempId;
	int Id;
	bool IsRead;
	std::string type = "sentMessageId";
};

NLOHMANN_DEFINE_TYPE_NON_INTRUSIVE(SentMessageId, TempId, Id, IsRead, type)

class ChatList
{
public:
	std::vector<std::string> Names;
	std::string type = "chatsList";
	ChatList() = default;
	//ChatList();
	~ChatList();
};

NLOHMANN_DEFINE_TYPE_NON_INTRUSIVE(ChatList, Names, type)

class GetChat
{
public:
	std::string Name;
	std::string type = "getChat";
	GetChat() = default;
	GetChat(std::string name);
	~GetChat();
};

NLOHMANN_DEFINE_TYPE_NON_INTRUSIVE(GetChat, Name, type)

class ServerHandshake
{
public:
	std::string ServerPublicKey;
	std::string Signature;
	std::string type = "serverHandshake";
	ServerHandshake() = default;
	//ServerHandshake();
	~ServerHandshake();
};

NLOHMANN_DEFINE_TYPE_NON_INTRUSIVE(ServerHandshake, ServerPublicKey, Signature, type)

class MagmaEncryption
{
private:
	static const uint8_t SBox[8][16];
	static uint32_t FieldF(uint32_t data, uint32_t keyPart);
	static std::vector<uint8_t> EncryptBlock(const std::vector<uint8_t>& block, const std::vector<uint32_t>& roundKeys);
	static std::vector<uint32_t> DeriveRoundKeys(const std::vector<uint8_t>& key);

public:
	static std::string Encrypt(const std::string& plainText, const std::vector<uint8_t>& key);
	static std::string Decrypt(const std::string& cipherText, const std::vector<uint8_t>& key);
	static std::string Base64Encode(const std::vector<uint8_t>& data);
	static std::vector<uint8_t> Base64Decode(const std::string& base64Str);
};

struct ShortMsgInfo {
	QString text;
	QString timeStr;
};

/*struct FileChunkPacket {
	std::string type = "fileChunk";
	std::string fileId;     // Уникальный UUID или временный ID файла, чтобы сервер понимал, к какому файлу относится чанк
	std::string fileName;   // Имя файла (например, "document.pdf")
	int chunkIndex;     // Порядковый номер текущего чанка (0, 1, 2...)
	int totalChunks;    // Сколько всего чанков будет отправлено
	std::string base64Data; // Сам кусочек данных, закодированный в Base64 string
	std::string target;     // Кому летит файл (получатель)
	std::string sender;     // Имя отправителя
};*/

class FileChunkPacket {
public:
	std::string FileId;     // Уникальный UUID или временный ID файла, чтобы сервер понимал, к какому файлу относится чанк
	std::string FileName;   // Имя файла (например, "document.pdf")
	int ChunkIndex;     // Порядковый номер текущего чанка (0, 1, 2...)
	int TotalChunks;    // Сколько всего чанков будет отправлено
	std::string Base64Data; // Сам кусочек данных, закодированный в Base64 string
	std::string Target;     // Кому летит файл (получатель)
	std::string Sender;
	std::string type = "fileChunk";
};

NLOHMANN_DEFINE_TYPE_NON_INTRUSIVE(FileChunkPacket, FileId, FileName, ChunkIndex, TotalChunks, Base64Data, Target, Sender, type)

class FileDownloadRequest {
public:
	std::string FilePath;
	std::string Sender;
	std::string type = "fileDownloadRequest";
};

NLOHMANN_DEFINE_TYPE_NON_INTRUSIVE(FileDownloadRequest, FilePath, Sender, type)