import { forwardToUser } from './wsController.js';

export async function handleCallOffer(payload) {
    const { Target, Sender, Sdp } = payload;
    console.log(`📞 [Сигналинг] ${Sender} звонит ${Target}`);

    forwardToUser(Target, {
        type: 'callOffer',
        Sender: Sender,
        Sdp: Sdp
    });
}

export async function handleAnswer(payload) {
    const { Target, Sender, Sdp } = payload;
    console.log(`🤙 [Сигналинг] ${Sender} принял звонок от ${Target}`);

    forwardToUser(Target, {
        type: 'callAnswer',
        Sender: Sender,
        Sdp: Sdp
    });
}

export async function handleIceCandidate(payload) {
    const { Target, Sender, Candidate } = payload;
    console.log(`[СЕРВЕР 📡] Маршрут от ${Sender}: ${Candidate.substring(0, 50)}...`);
    forwardToUser(Target, {
        type: 'iceCandidate',
        Sender: Sender,
        Candidate: Candidate
    });
}
