import {Realtime} from 'ably/promises';

declare global {
  interface Window {
    say(s: string): void;
  }
}

type SessionId = string;

// 1) "Hi everyone, I'm session X. Please send me your offer. 
//    (Also I pinky swear that I've never said hello with session id X before. 
//    But you should check anyway, and tear down any previous connections!)"
interface SignalingMsgHello {
  kind: "hello",
  fromSessionId: SessionId
}

// FIXME should we combine SignalingMsgOffer and SignalingMsgAnswer?
// The RTCSessionDescriptionInit already contains this distinction

// 2) "Hi X, I'm Y. Here is my offer."
interface SignalingMsgOffer {
  kind: "offer",
  fromSessionId: SessionId,
  toSessionId: SessionId,
  offer: RTCSessionDescriptionInit
}

// 3) "Hi Y. Thanks for the offer; I graciously accept."
interface SignalingMsgAnswer {
  kind: "answer",
  fromSessionId: SessionId,
  toSessionId: SessionId,
  answer: RTCSessionDescriptionInit
}

interface SignalingMsgIceCandidate {
  kind: "ice-candidate",
  fromSessionId: SessionId,
  toSessionId: SessionId,
  candidate: RTCIceCandidate
}

type SignalingMsg = SignalingMsgHello | SignalingMsgOffer | SignalingMsgAnswer | SignalingMsgIceCandidate;

function assertUnreachable(x: never): never {
  throw new Error(`Unhandled case: ${JSON.stringify(x)}`);
}

const msgsEl = document.getElementById("msgs");
const msgBufferInputEl = document.getElementById("msgBuffer") as HTMLInputElement;

// A session is one run of the webpage. A refresh gets a new session ID.
// This simplifies things:
// sessions can assume no previous connection with the client,
// and can assume a session will never come back after disappearing.
// (On top of this, we can build a mapping SessionId -> UserId.
// This will also allow for multiple simultaneous sessions per user.)
const mySessionId =  Math.random().toString();  // FIXME uuid
console.log("I am:", mySessionId);

type Peer = {
  id: SessionId,

  peerConn: RTCPeerConnection,

  // We may only get the data channel at some point later
  dataChannel: RTCDataChannel | undefined
}

// TODO clean up conns on state disconnected/failed
const peers: Map<SessionId, Peer> = new Map();

// @ts-ignore
window.peers = peers;

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
    for (const [sessionId, { dataChannel }] of peers.entries()) {
      if (dataChannel === undefined) {
        console.warn(`Could not send to ${sessionId}; no data channel`);
        continue;
      }
      try {
        dataChannel.send(msg);
      } catch (err) {
        console.error(`Error sending to ${sessionId}: ${err}`);
      }
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
  publishSignalingMsg({ kind: "hello", fromSessionId: mySessionId });
});

ablyClient.connection.on('failed', () => {
  console.error("Ably connection failed");
});

function newPeerConnection(): RTCPeerConnection {
  return new RTCPeerConnection({'iceServers': [{'urls': ['stun:stun.l.google.com:19302']}]});
}

function newPeer(sessionId: SessionId): Peer {
  if (peers.has(sessionId)) {
    throw new Error("Received hello/offer from existing peer!");
  }

  const peerConn = newPeerConnection();
  peerConn.onconnectionstatechange = ev => {
    console.log("State of connection to ", sessionId, ":", peerConn.connectionState);
  };
  const peer = { id: sessionId, peerConn: peerConn, dataChannel: undefined };
  peers.set(sessionId, peer);
  return peer;
}

function setUpDataChannel(dataChannel: RTCDataChannel, peer: Peer) {
  peer.dataChannel = dataChannel;
  dataChannel.onmessage = msgEv => show(`${peer.id} says: ${msgEv.data}`);
}

async function handleSignalingMsgHello(signalingMsgHello: SignalingMsgHello) {
  if (signalingMsgHello.fromSessionId === mySessionId) return;

  const remoteSessionId = signalingMsgHello.fromSessionId;
  console.log("Received hello from", remoteSessionId);

  const peer = newPeer(remoteSessionId);

  setUpDataChannel(peer.peerConn.createDataChannel('myDataChannel'), peer);

  peer.peerConn.onicecandidate = ev => {
    if (ev.candidate !== null) {
      publishSignalingMsg({
        kind: "ice-candidate",
        fromSessionId: mySessionId, 
        toSessionId: remoteSessionId, 
        candidate: ev.candidate
      });
    }
  };

  const desc = await peer.peerConn.createOffer();
  await peer.peerConn.setLocalDescription(desc);
  publishSignalingMsg({
    kind: "offer", 
    fromSessionId: mySessionId, 
    toSessionId: remoteSessionId, 
    offer: desc
  });
}

async function handleSignalingMsgOffer(signalingMsgOffer: SignalingMsgOffer) {
  if (signalingMsgOffer.toSessionId !== mySessionId) return;
  if (signalingMsgOffer.fromSessionId === mySessionId) return;

  const fromSessionId = signalingMsgOffer.fromSessionId;
  console.log("Received offer from", fromSessionId);

  const peer = newPeer(fromSessionId);

  peer.peerConn.ondatachannel = dataChannelEv => {
    const dataChannel = dataChannelEv.channel;
    setUpDataChannel(dataChannel, peer);
  };

  peer.peerConn.onicecandidate = ev => {
    if (ev.candidate !== null) {
      publishSignalingMsg({
        kind: "ice-candidate",
        fromSessionId: mySessionId, 
        toSessionId: fromSessionId, 
        candidate: ev.candidate
      });
    }
  };

  const offer = signalingMsgOffer.offer;

  await peer.peerConn.setRemoteDescription(offer);
  const answerDesc = await peer.peerConn.createAnswer();
  await peer.peerConn.setLocalDescription(answerDesc);

  publishSignalingMsg({
    kind: "answer", 
    fromSessionId: mySessionId, 
    toSessionId: signalingMsgOffer.fromSessionId, 
    answer: answerDesc
  });
}

async function handleSignalingMsgAnswer(signalingMsgAnswer: SignalingMsgAnswer) {
  if (signalingMsgAnswer.toSessionId !== mySessionId) return;
  if (signalingMsgAnswer.fromSessionId === mySessionId) return;

  const fromSessionId = signalingMsgAnswer.fromSessionId;
  console.log("Received answer from", fromSessionId);

  const peer = peers.get(fromSessionId);
  
  if (peer === undefined) {
    throw new Error("Unexpected answer from a peer we never sent an offer to!");
  }
  
  console.log("Setting answer");
  const answer = signalingMsgAnswer.answer;
  await peer.peerConn.setRemoteDescription(answer);
}

async function handleSignalingMsgIceCandidate(signalingMsgIceCandidate: SignalingMsgIceCandidate) {
  if (signalingMsgIceCandidate.toSessionId !== mySessionId) return;
  if (signalingMsgIceCandidate.fromSessionId === mySessionId) return;

  const fromSessionId = signalingMsgIceCandidate.fromSessionId;
  console.log("Received ICE candidate from", fromSessionId);

  const peer = peers.get(fromSessionId);
  
  if (peer === undefined) {
    // FIXME this could actually be possible?
    throw new Error("Unexpected ICE candidate from a peer we don't know about yet");
  }

  await peer.peerConn.addIceCandidate(signalingMsgIceCandidate.candidate);
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
  else if (signalingMsg.kind === "ice-candidate") {
    handleSignalingMsgIceCandidate(signalingMsg);
  }
  else {
    assertUnreachable(signalingMsg);
  }
});