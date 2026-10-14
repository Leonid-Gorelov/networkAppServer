#include "Functions.h"

using EVP_PKEY_ptr = std::unique_ptr<EVP_PKEY, decltype(&EVP_PKEY_free)>;
using EVP_PKEY_CTX_ptr = std::unique_ptr<EVP_PKEY_CTX, decltype(&EVP_PKEY_CTX_free)>;

std::mutex Functions::pendingIceMutex;
std::vector<std::pair<std::string, std::string>> Functions::pendingIceCandidates;
std::shared_ptr<rtc::PeerConnection> Functions::peerConnection;

void Functions::DeriveMagmaKey(const ECDiffieHellman& clientEcdh, const std::string& serverPublicKeyBase64)
{
	try {
	std::cout << "Derive Magma key";
	// Декодируем Base64 от сервера
	std::vector<uint8_t> serverBytes = MagmaEncryption::Base64Decode(serverPublicKeyBase64);
	EVP_PKEY* serverPubKey = nullptr;

	// В зависимости от того, что прислал сервер (полный SPKI или сырой SEC1)
	if (serverBytes.size() == 91 || (serverBytes.size() > 0 && serverBytes[0] == 0x30)) {
		// Формат SPKI (стандартный X.509)
		const uint8_t* p = serverBytes.data();
		serverPubKey = d2i_PUBKEY(nullptr, &p, static_cast<long>(serverBytes.size()));
		if (!serverPubKey) throw std::runtime_error("OpenSSL: Ошибка импорта SPKI ключа сервера");
	}
	else if (serverBytes.size() == 65 || serverBytes.size() == 64) {
		// Сырой формат SEC1 (без заголовков, только координаты с префиксом 0x04 или без)
		std::vector<uint8_t> cleanSec1;
		if (serverBytes.size() == 64) {
			cleanSec1.push_back(0x04); // Добавляем префикс несжатой точки, если его нет
			cleanSec1.insert(cleanSec1.end(), serverBytes.begin(), serverBytes.end());
		}
		else {
			cleanSec1 = std::move(serverBytes);
		}

		// Импортируем сырую точку в OpenSSL 3.x через параметры
		EVP_PKEY_CTX_ptr ctx(EVP_PKEY_CTX_new_from_name(nullptr, "EC", nullptr), EVP_PKEY_CTX_free);
		if (!ctx || EVP_PKEY_fromdata_init(ctx.get()) <= 0)
			throw std::runtime_error("OpenSSL: Ошибка инициализации fromdata");

		OSSL_PARAM params[3];
		params[0] = OSSL_PARAM_construct_utf8_string("group", const_cast<char*>("P-256"), 0);
		params[1] = OSSL_PARAM_construct_octet_string("pub", cleanSec1.data(), cleanSec1.size());
		params[2] = OSSL_PARAM_construct_end();

		if (EVP_PKEY_fromdata(ctx.get(), &serverPubKey, EVP_PKEY_PUBLIC_KEY, params) <= 0)
			throw std::runtime_error("OpenSSL: Ошибка импорта сырых координат ключа сервера");
	}
	else {
		throw std::runtime_error("Неверный размер открытого ключа сервера: " + std::to_string(serverBytes.size()));
	}

	ECDiffieHellman serverEcdh(serverPubKey);

	EVP_PKEY_CTX_ptr deriveCtx(EVP_PKEY_CTX_new(clientEcdh.get(), nullptr), EVP_PKEY_CTX_free);
	if (!deriveCtx || EVP_PKEY_derive_init(deriveCtx.get()) <= 0)
		throw std::runtime_error("OpenSSL: Ошибка инициализации derive");

	if (EVP_PKEY_derive_set_peer(deriveCtx.get(), serverEcdh.get()) <= 0)
		throw std::runtime_error("OpenSSL: Ошибка установки ключа пира");

	size_t sharedSecretLen = 0;
	if (EVP_PKEY_derive(deriveCtx.get(), nullptr, &sharedSecretLen) <= 0)
		throw std::runtime_error("OpenSSL: Ошибка определения длины секрета");

	std::vector<uint8_t> sharedSecret(sharedSecretLen);
	if (EVP_PKEY_derive(deriveCtx.get(), sharedSecret.data(), &sharedSecretLen) <= 0)
		throw std::runtime_error("OpenSSL: Ошибка вычисления общего секрета");

	MagmaEncryption::sessionMagmaKey.resize(32);
	unsigned int mdLen = 0;
	if (!EVP_Digest(sharedSecret.data(), sharedSecret.size(), MagmaEncryption::sessionMagmaKey.data(), &mdLen, EVP_sha256(), nullptr))
		throw std::runtime_error("OpenSSL: Ошибка KDF SHA-256");

	// === ДОБАВЛЕННЫЙ ЛОГ ГОТОВНОСТИ ===
	std::cout << " -> Ключ сессии Магма успешно сгенерирован!" << std::endl;
	std::cout << "[INFO] Размер сессионного ключа: " << MagmaEncryption::sessionMagmaKey.size() << " байт." << std::endl;

	// Выводим первые 4 байта ключа в HEX для отладки (чтобы убедиться, что он не нулевой)
	std::cout << "[INFO] Контрольный хэш ключа (HEX): ";
	for (int i = 0; i < 4 && i < MagmaEncryption::sessionMagmaKey.size(); i++) {
		printf("%02X", MagmaEncryption::sessionMagmaKey[i]);
	}
	std::cout << "..." << std::endl;
	// ==================================
	}
	catch (const std::exception& e) {
		std::cerr << "\n[КРИТ ИСКЛЮЧЕНИЕ] В функции DeriveMagmaKey произошло падение!" << std::endl;
		std::cerr << "[ДЕТАЛИ]: " << e.what() << std::endl;
	}
	catch (...) {
		std::cerr << "\n[КРИТ ИСКЛЮЧЕНИЕ] Неизвестная ошибка в DeriveMagmaKey!" << std::endl;
	}
}

void Functions::flushPendingIceCandidates() {
	std::lock_guard<std::mutex> lock(pendingIceMutex);
	if (!peerConnection) return;
	for (const auto& [candidateStr, mid] : pendingIceCandidates) {
		try {
			peerConnection->addRemoteCandidate(rtc::Candidate(candidateStr, mid));
		}
		catch (const std::exception& e) {
			std::cout << "[WebRTC] flush ICE: " << e.what() << std::endl;
		}
	}
	pendingIceCandidates.clear();
}