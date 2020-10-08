import {Realtime} from 'ably/promises';

declare global {
  interface Window {
    say(s: string): void;
  }
}

type Uid = string;

// 1) "Hi everyone, I'm X. Please send me your offer."
interface SignalingMsgHello {
  kind: "hello",
  fromUid: Uid
}

// FIXME should we combine SignalingMsgOffer and SignalingMsgAnswer?
// The RTCSessionDescriptionInit already contains this distinction

// 2) "Hi X, I'm Y. Here is my offer."
interface SignalingMsgOffer {
  kind: "offer",
  fromUid: Uid,
  toUid: Uid,
  offer: RTCSessionDescriptionInit
}

// 3) "Hi Y. Thanks for the offer; I graciously accept."
interface SignalingMsgAnswer {
  kind: "answer",
  fromUid: Uid,
  toUid: Uid,
  answer: RTCSessionDescriptionInit
}

type SignalingMsg = SignalingMsgHello | SignalingMsgOffer | SignalingMsgAnswer;

function assertUnreachable(x: never): never {
  throw new Error(`Unhandled case: ${JSON.stringify(x)}`);
}

const msgsEl = document.getElementById("msgs");
const msgBufferInputEl = document.getElementById("msgBuffer") as HTMLInputElement;

function getOrCreateMyUid(): Uid {
  const LOCAL_STORAGE_MY_UID_KEY = "myUid";
  let myUid = localStorage.getItem(LOCAL_STORAGE_MY_UID_KEY);
  if (myUid === null) {
    myUid = Math.random().toString();  // FIXME uuid
    localStorage.setItem(LOCAL_STORAGE_MY_UID_KEY, myUid);
  }
  return myUid;
}

const myUid = getOrCreateMyUid();
console.log("I am:", myUid);

const peerConns: Map<Uid, RTCPeerConnection> = new Map();
const dataChannels: Map<Uid, RTCDataChannel> = new Map();

msgBufferInputEl.onkeydown = ev => {
  if (ev.key === 'Enter') {
    const msg = msgBufferInputEl.value;
    msgBufferInputEl.value = '';
    for (const dataChannel of dataChannels.values()) {
      dataChannel.send(msg);
    }
  }
};

function show(msg: string) {
  const newMsgEl = document.createElement('div');
  newMsgEl.innerText = msg;
  msgsEl?.appendChild(newMsgEl);
}

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
  publishSignalingMsg({ kind: "hello", fromUid: myUid });
});

ablyClient.connection.on('failed', () => {
  console.error("Ably connection failed");
});

function newPeerConnection(): RTCPeerConnection {
  return new RTCPeerConnection({'iceServers': [{'urls': ['stun:stun.l.google.com:19302']}]});
}

function getOrCreatePeerConnection(uid: Uid): RTCPeerConnection {
  let peerConn = peerConns.get(uid);
  if (peerConn === undefined) {
    peerConn = newPeerConnection();
    peerConns.set(uid, peerConn);
  }
  return peerConn;
}

function handleSignalingMsgHello(signalingMsgHello: SignalingMsgHello) {
  if (signalingMsgHello.fromUid === myUid) return;

  const newUserUid = signalingMsgHello.fromUid;
  console.log("Received hello from", newUserUid);

  const peerConn = newPeerConnection();
  peerConns.set(newUserUid, peerConn);

  const dataChannel = peerConn.createDataChannel('myDataChannel');
  dataChannels.set(newUserUid, dataChannel);

  dataChannel.onopen = ev => {
  };
  dataChannel.onmessage = ev => show(ev.data);
  peerConn.createOffer({})
    .then(desc => peerConn.setLocalDescription(desc))
    .then(() => {})
    .catch(err => console.error(err));
  peerConn.onicecandidate = ev => {
    if (ev.candidate == null) {
      publishSignalingMsg({ 
        kind: "offer", 
        fromUid: myUid, 
        toUid: newUserUid, 
        offer: peerConn.localDescription?.toJSON()  // FIXME is this really an RTCSessionDescriptionInit
      });
    }
  };
}

function handleSignalingMsgOffer(signalingMsgOffer: SignalingMsgOffer) {
  if (signalingMsgOffer.toUid !== myUid) return;
  if (signalingMsgOffer.fromUid === myUid) return;

  const fromUid = signalingMsgOffer.fromUid;
  console.log("Received offer from", fromUid);

  const remotePeerConn = getOrCreatePeerConnection(fromUid);

  remotePeerConn.ondatachannel = dataChannelEv => {
    const dataChannel = dataChannelEv.channel;
    dataChannel.onopen = ev => {
      window.say = msg => { dataChannel.send(msg); };
    };
    dataChannel.onmessage = msgEv => show(msgEv.data);
  };

  remotePeerConn.onicecandidate = ev => {
    if (ev.candidate == null) {
      publishSignalingMsg({
        kind: "answer", 
        fromUid: myUid, 
        toUid: signalingMsgOffer.fromUid, 
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
  if (signalingMsgAnswer.toUid !== myUid) return;
  if (signalingMsgAnswer.fromUid === myUid) return;

  const fromUid = signalingMsgAnswer.fromUid;
  console.log("Received answer from", fromUid);

  const answer = signalingMsgAnswer.answer;
  const peerConn = peerConns.get(fromUid);

  if (peerConn === undefined) {
    throw new Error("Unexpected answer from a peer we never sent an offer to!");
  }

  console.log("Setting answer");
  peerConn.setRemoteDescription(new RTCSessionDescription(answer));
}

ablyChatRoomSignalingChannel.subscribe(ablyMessage => {
  const signalingMsg = ablyMessage.data as SignalingMsg;
  console.log("Rcv:", signalingMsg);
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