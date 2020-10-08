import {Realtime} from 'ably/promises';

declare global {
  interface Window {
    say(s: string): void;
  }
}

type ClientId = string;

// 1) "Hi everyone, I'm client X. Please send me your offer. 
//    (Also I pinky swear that I've never said hello with id X before. 
//    But you should check anyway, and tear down any previous connections!)"
interface SignalingMsgHello {
  kind: "hello",
  fromClientId: ClientId
}

// FIXME should we combine SignalingMsgOffer and SignalingMsgAnswer?
// The RTCSessionDescriptionInit already contains this distinction

// 2) "Hi X, I'm Y. Here is my offer."
interface SignalingMsgOffer {
  kind: "offer",
  fromClientId: ClientId,
  toClientId: ClientId,
  offer: RTCSessionDescriptionInit
}

// 3) "Hi Y. Thanks for the offer; I graciously accept."
interface SignalingMsgAnswer {
  kind: "answer",
  fromClientId: ClientId,
  toClientId: ClientId,
  answer: RTCSessionDescriptionInit
}

type SignalingMsg = SignalingMsgHello | SignalingMsgOffer | SignalingMsgAnswer;

function assertUnreachable(x: never): never {
  throw new Error(`Unhandled case: ${JSON.stringify(x)}`);
}

const msgsEl = document.getElementById("msgs");
const msgBufferInputEl = document.getElementById("msgBuffer") as HTMLInputElement;

// A client is one run of the webpage. A refresh gets a new client ID.
// This simplifies things:
// clients can assume no previous connection with the client,
// and can assume a client will never come back after disappearing.
// (On top of this, we can build a mapping ClientId -> UserId.
// This will also allow for multiple simultaneous clients per user.)
const myClientId =  Math.random().toString();  // FIXME uuid
console.log("I am:", myClientId);

const peerConns: Map<ClientId, RTCPeerConnection> = new Map();
const dataChannels: Map<ClientId, RTCDataChannel> = new Map();

// @ts-ignore
window.dataChannels = dataChannels;

function show(msg: string) {
  const newMsgEl = document.createElement('div');
  newMsgEl.innerText = msg;
  msgsEl?.appendChild(newMsgEl);
}

msgBufferInputEl.onkeydown = ev => {
  if (ev.key === 'Enter') {
    const msg = msgBufferInputEl.value;
    msgBufferInputEl.value = '';
    show(msg);
    for (const dataChannel of dataChannels.values()) {
      dataChannel.send(msg);
    }
  }
};

const ablyClient = new Realtime({
  key: 'IOh7bg.2hQ82w:DFd_OB1D2kVJBCag' // this key has subscribe and publish perms
});

// For now we have one global chat room
let ablyChatRoomSignalingChannel = ablyClient.channels.get('global');

function publishSignalingMsg(signalingMsg: SignalingMsg) {
  console.log("Publishing", signalingMsg);
  ablyChatRoomSignalingChannel.publish('signaling-msg', signalingMsg);
}

ablyClient.connection.on('connected', () => {
  console.log("Connected to Ably");
  // Note that we will also receive this after publishing it
  // Note: not sure if we need to wait until connected before publishing.
  publishSignalingMsg({ kind: "hello", fromClientId: myClientId });
});

ablyClient.connection.on('failed', () => {
  console.error("Ably connection failed");
});

function newPeerConnection(): RTCPeerConnection {
  return new RTCPeerConnection({'iceServers': [{'urls': ['stun:stun.l.google.com:19302']}]});
}

function getOrCreatePeerConnection(uid: ClientId): RTCPeerConnection {
  let peerConn = peerConns.get(uid);
  if (peerConn === undefined) {
    peerConn = newPeerConnection();
    peerConns.set(uid, peerConn);
  }
  return peerConn;
}

function handleSignalingMsgHello(signalingMsgHello: SignalingMsgHello) {
  if (signalingMsgHello.fromClientId === myClientId) return;

  const newClientId = signalingMsgHello.fromClientId;
  console.log("Received hello from", newClientId);

  const peerConn = newPeerConnection();
  peerConns.set(newClientId, peerConn);

  const dataChannel = peerConn.createDataChannel('myDataChannel');
  dataChannels.set(newClientId, dataChannel);

  dataChannel.onmessage = ev => show(ev.data);
  peerConn.createOffer({})
    .then(desc => peerConn.setLocalDescription(desc))
    .then(() => {})
    .catch(err => console.error(err));
  peerConn.onicecandidate = ev => {
    if (ev.candidate == null) {
      publishSignalingMsg({ 
        kind: "offer", 
        fromClientId: myClientId, 
        toClientId: newClientId, 
        offer: peerConn.localDescription?.toJSON()  // FIXME is this really an RTCSessionDescriptionInit
      });
    }
  };
}

function handleSignalingMsgOffer(signalingMsgOffer: SignalingMsgOffer) {
  if (signalingMsgOffer.toClientId !== myClientId) return;
  if (signalingMsgOffer.fromClientId === myClientId) return;

  const fromClientId = signalingMsgOffer.fromClientId;
  console.log("Received offer from", fromClientId);

  const remotePeerConn = getOrCreatePeerConnection(fromClientId);

  remotePeerConn.ondatachannel = dataChannelEv => {
    const dataChannel = dataChannelEv.channel;
    dataChannels.set(fromClientId, dataChannel);
    dataChannel.onmessage = msgEv => show(msgEv.data);
  };

  remotePeerConn.onicecandidate = ev => {
    if (ev.candidate == null) {
      publishSignalingMsg({
        kind: "answer", 
        fromClientId: myClientId, 
        toClientId: signalingMsgOffer.fromClientId, 
        answer: remotePeerConn.localDescription?.toJSON()  // FIXME
      });
    }
  };

  const offer = signalingMsgOffer.offer;

  const offerDesc = new RTCSessionDescription(offer);
  console.log("Setting offer");
  remotePeerConn.setRemoteDescription(offerDesc);
  remotePeerConn.createAnswer({})
    .then(answerDesc => remotePeerConn.setLocalDescription(answerDesc))
    .catch(err => console.warn("Couldn't create answer"));
}

function handleSignalingMsgAnswer(signalingMsgAnswer: SignalingMsgAnswer) {
  if (signalingMsgAnswer.toClientId !== myClientId) return;
  if (signalingMsgAnswer.fromClientId === myClientId) return;

  const fromClientId = signalingMsgAnswer.fromClientId;
  console.log("Received answer from", fromClientId);

  const answer = signalingMsgAnswer.answer;
  const peerConn = peerConns.get(fromClientId);

  if (peerConn === undefined) {
    throw new Error("Unexpected answer from a peer we never sent an offer to!");
  }

  console.log("Setting answer");
  peerConn.setRemoteDescription(new RTCSessionDescription(answer));
}

ablyChatRoomSignalingChannel.subscribe(ablyMessage => {
  const signalingMsg = ablyMessage.data as SignalingMsg;
  if (signalingMsg.kind === "hello") {
    handleSignalingMsgHello(signalingMsg);
  }
  else if (signalingMsg.kind === "offer") {
    handleSignalingMsgOffer(signalingMsg);
  }
  else if (signalingMsg.kind === "answer") {
    handleSignalingMsgAnswer(signalingMsg);
  }
  else {
    assertUnreachable(signalingMsg);
  }
});