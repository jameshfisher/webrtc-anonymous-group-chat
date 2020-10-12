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
interface MsgHello {
  fromSessionId: SessionId
}

// FIXME should we combine SignalingMsgOffer and SignalingMsgAnswer?
// The RTCSessionDescriptionInit already contains this distinction

// 2) "Hi X, I'm Y. Here is my offer."
interface SignalingMsgOffer {
  kind: "offer",
  fromSessionId: SessionId,
  offer: RTCSessionDescriptionInit
}

// 3) "Hi Y. Thanks for the offer; I graciously accept."
interface SignalingMsgAnswer {
  kind: "answer",
  fromSessionId: SessionId,
  answer: RTCSessionDescriptionInit
}

interface SignalingMsgIceCandidate {
  kind: "ice-candidate",
  fromSessionId: SessionId,
  candidate: RTCIceCandidate
}

type SignalingMsg = SignalingMsgOffer | SignalingMsgAnswer | SignalingMsgIceCandidate;

function assertUnreachable(x: never): never {
  throw new Error(`Unhandled case: ${JSON.stringify(x)}`);
}

const localVideoEl = document.getElementById("localVideo") as HTMLVideoElement;
const remoteVideoContainerEl = document.getElementById("remoteVideos") as HTMLElement;
const msgsEl = document.getElementById("msgs");
const msgBufferInputEl = document.getElementById("msgBuffer") as HTMLInputElement;

const localMediaStreamPromise = navigator.mediaDevices.getUserMedia({
  video: {
    width: { ideal: 360 }
  },
  audio: false
});

(async () => {
  const mediaStream = await localMediaStreamPromise;
  localVideoEl.srcObject = mediaStream;
})();

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

  // This awful thing is due to https://stackoverflow.com/questions/38198751/domexception-error-processing-ice-candidate
  iceCandidateBuffer: Array<RTCIceCandidate>,

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
  key: 'IOh7bg.2hQ82w:DFd_OB1D2kVJBCag', // this key has subscribe and publish perms
  autoConnect: false
});

// For now we have one global chat room
let ablyChatRoomHelloChannel = ablyClient.channels.get('global');

let ablyMyPrivateChannel = ablyClient.channels.get(mySessionId);

function publishSignalingMsg(toSessionId: SessionId, signalingMsg: SignalingMsg) {
  console.log("Sending to", toSessionId, ":", signalingMsg);
  const remoteSessionAblyChannel = ablyClient.channels.get(toSessionId);
  // FIXME not sure if we need to wait until connected before publishing.
  remoteSessionAblyChannel.publish('signaling-msg', signalingMsg);
}

function newPeerConnection(): RTCPeerConnection {
  return new RTCPeerConnection({'iceServers': [{'urls': ['stun:stun.l.google.com:19302']}]});
}

function newPeer(sessionId: SessionId): Peer {
  if (peers.has(sessionId)) {
    throw new Error(`Error: we already have a peer with sessionId ${sessionId}`);
  }

  const peerConn = newPeerConnection();
  peerConn.onconnectionstatechange = ev => {
    console.log("State of connection to ", sessionId, ":", peerConn.connectionState);
    if (
      peerConn.connectionState === "closed" ||
      peerConn.connectionState === "disconnected" || 
      peerConn.connectionState === "failed"
    ) {
      console.log(`Cleaning up ${sessionId}`);
      peers.delete(sessionId);
    }
  };

  peerConn.onicecandidate = ev => {
    if (ev.candidate !== null) {
      publishSignalingMsg(
        sessionId,
        {
          kind: "ice-candidate",
          fromSessionId: mySessionId, 
          candidate: ev.candidate
        }
      );
    }
  };

  const peer = { id: sessionId, peerConn: peerConn, iceCandidateBuffer: [], dataChannel: undefined };
  peers.set(sessionId, peer);
  return peer;
}

function setUpDataChannel(dataChannel: RTCDataChannel, peer: Peer) {
  peer.dataChannel = dataChannel;
  dataChannel.onmessage = msgEv => show(`${peer.id} says: ${msgEv.data}`);
}

async function handleHello(remoteSessionId: SessionId) {
  if (remoteSessionId === mySessionId) return; // Expected; this is how Ably works

  if (peers.has(remoteSessionId)) {
    throw new Error("Received hello from existing peer!");
  }

  console.log("Received hello from", remoteSessionId);

  const peer = newPeer(remoteSessionId);

  const localMediaStream = await localMediaStreamPromise;

  for (const track of localMediaStream.getTracks()) {
    peer.peerConn.addTrack(track, localMediaStream);
  }

  setUpDataChannel(peer.peerConn.createDataChannel('myDataChannel'), peer);

  const desc = await peer.peerConn.createOffer();
  await peer.peerConn.setLocalDescription(desc);
  publishSignalingMsg(
    remoteSessionId, 
    {
      kind: "offer", 
      fromSessionId: mySessionId, 
      offer: desc
    }
  );
}

function getOrCreatePeer(remoteSessionId: SessionId): Peer {
  return peers.get(remoteSessionId) || newPeer(remoteSessionId);
}

async function setRemoteDescription(peer: Peer, description: RTCSessionDescriptionInit) {
  await peer.peerConn.setRemoteDescription(description);
  if (!peer.peerConn.remoteDescription) {
    throw new Error("remoteDescription not set after setting");
  }
  for (const candidate of peer.iceCandidateBuffer) {
    await peer.peerConn.addIceCandidate(candidate);
  }
  peer.iceCandidateBuffer = [];
}

async function handleSignalingMsgOffer(signalingMsgOffer: SignalingMsgOffer) {
  if (signalingMsgOffer.fromSessionId === mySessionId) return;

  const fromSessionId = signalingMsgOffer.fromSessionId;
  console.log("Received offer from", fromSessionId);

  const peer = getOrCreatePeer(fromSessionId);

  peer.peerConn.ondatachannel = dataChannelEv => {
    const dataChannel = dataChannelEv.channel;
    setUpDataChannel(dataChannel, peer);
  };

  peer.peerConn.ontrack = ev => {
    const remoteVideoEl = document.createElement("video");
    remoteVideoEl.autoplay = true;
    remoteVideoEl.muted = true;
    remoteVideoContainerEl.appendChild(remoteVideoEl);
    remoteVideoEl.srcObject = ev.streams[0];
    // FIXME we need to remove it when the connection dies
  };

  await setRemoteDescription(peer, signalingMsgOffer.offer);

  const answerDesc = await peer.peerConn.createAnswer();
  await peer.peerConn.setLocalDescription(answerDesc);

  publishSignalingMsg(
    signalingMsgOffer.fromSessionId, 
    {
      kind: "answer", 
      fromSessionId: mySessionId, 
      answer: answerDesc
    }
  );
}

async function handleSignalingMsgAnswer(signalingMsgAnswer: SignalingMsgAnswer) {
  if (signalingMsgAnswer.fromSessionId === mySessionId) return;

  const fromSessionId = signalingMsgAnswer.fromSessionId;
  console.log("Received answer from", fromSessionId);

  const peer = peers.get(fromSessionId);
  
  if (peer === undefined) {
    throw new Error("Unexpected answer from a peer we never sent an offer to!");
  }
  
  console.log("Setting answer");
  await setRemoteDescription(peer, signalingMsgAnswer.answer);
}

async function handleSignalingMsgIceCandidate(signalingMsgIceCandidate: SignalingMsgIceCandidate) {
  if (signalingMsgIceCandidate.fromSessionId === mySessionId) return;

  const fromSessionId = signalingMsgIceCandidate.fromSessionId;
  console.log("Received ICE candidate from", fromSessionId);

  const peer = getOrCreatePeer(fromSessionId);

  if (peer.peerConn.remoteDescription) {
    await peer.peerConn.addIceCandidate(signalingMsgIceCandidate.candidate);
  } else {
    peer.iceCandidateBuffer.push(signalingMsgIceCandidate.candidate);
  }
}

ablyClient.connect();

ablyClient.connection.on('connected', async () => {
  console.log("Connected to Ably");

  await Promise.all([
    ablyChatRoomHelloChannel.subscribe(ablyMessage => {
      if (!ablyMessage.data) return;
      const signalingMsg = ablyMessage.data as MsgHello;
      handleHello(signalingMsg.fromSessionId);
    }),
    ablyMyPrivateChannel.subscribe(ablyMessage => {
      const signalingMsg = ablyMessage.data as SignalingMsg;
    
      if (signalingMsg.kind === "offer") {
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
    })
  ]);

  console.log("Subscribed to all channels");

  // Wait until we're connected and subscribed before sending 'hello'.
  // Otherwise, peers might reply before we can receive their reply,
  // and so we'll never connect.

  const msg: MsgHello = { fromSessionId: mySessionId };
  console.log("Publishing hello", msg);
  ablyChatRoomHelloChannel.publish('hello', msg);
});

ablyClient.connection.on('failed', () => {
  console.error("Ably connection failed");
});