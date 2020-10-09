import {Realtime} from "../web_modules/ably/promises.js";
function assertUnreachable(x) {
  throw new Error(`Unhandled case: ${JSON.stringify(x)}`);
}
const localVideoEl = document.getElementById("localVideo");
const remoteVideoContainerEl = document.getElementById("remoteVideos");
const msgsEl = document.getElementById("msgs");
const msgBufferInputEl = document.getElementById("msgBuffer");
const localMediaStreamPromise = navigator.mediaDevices.getUserMedia({
  video: {
    width: {ideal: 360}
  },
  audio: false
});
(async () => {
  const mediaStream = await localMediaStreamPromise;
  localVideoEl.srcObject = mediaStream;
})();
const mySessionId = Math.random().toString();
console.log("I am:", mySessionId);
const peers = new Map();
window.peers = peers;
function show(msg) {
  const newMsgEl = document.createElement("div");
  newMsgEl.innerText = msg;
  msgsEl?.appendChild(newMsgEl);
}
msgBufferInputEl.onkeydown = (ev) => {
  if (ev.key === "Enter") {
    const msg = msgBufferInputEl.value;
    msgBufferInputEl.value = "";
    show(msg);
    for (const [sessionId, {dataChannel}] of peers.entries()) {
      if (dataChannel === void 0) {
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
  key: "IOh7bg.2hQ82w:DFd_OB1D2kVJBCag",
  autoConnect: false
});
let ablyChatRoomHelloChannel = ablyClient.channels.get("global");
let ablyMyPrivateChannel = ablyClient.channels.get(mySessionId);
function publishSignalingMsg(toSessionId, signalingMsg) {
  console.log("Sending to", toSessionId, ":", signalingMsg);
  const remoteSessionAblyChannel = ablyClient.channels.get(toSessionId);
  remoteSessionAblyChannel.publish("signaling-msg", signalingMsg);
}
function newPeerConnection() {
  return new RTCPeerConnection({iceServers: [{urls: ["stun:stun.l.google.com:19302"]}]});
}
function newPeer(sessionId) {
  if (peers.has(sessionId)) {
    throw new Error(`Error: we already have a peer with sessionId ${sessionId}`);
  }
  const peerConn = newPeerConnection();
  peerConn.onconnectionstatechange = (ev) => {
    console.log("State of connection to ", sessionId, ":", peerConn.connectionState);
    if (peerConn.connectionState === "closed" || peerConn.connectionState === "disconnected" || peerConn.connectionState === "failed") {
      console.log(`Cleaning up ${sessionId}`);
      peers.delete(sessionId);
    }
  };
  peerConn.onicecandidate = (ev) => {
    if (ev.candidate !== null) {
      publishSignalingMsg(sessionId, {
        kind: "ice-candidate",
        fromSessionId: mySessionId,
        candidate: ev.candidate
      });
    }
  };
  const peer = {id: sessionId, peerConn, dataChannel: void 0};
  peers.set(sessionId, peer);
  return peer;
}
function setUpDataChannel(dataChannel, peer) {
  peer.dataChannel = dataChannel;
  dataChannel.onmessage = (msgEv) => show(`${peer.id} says: ${msgEv.data}`);
}
async function handleHello(remoteSessionId) {
  if (remoteSessionId === mySessionId)
    return;
  if (peers.has(remoteSessionId)) {
    throw new Error("Received hello from existing peer!");
  }
  console.log("Received hello from", remoteSessionId);
  const peer = newPeer(remoteSessionId);
  const localMediaStream = await localMediaStreamPromise;
  for (const track of localMediaStream.getTracks()) {
    peer.peerConn.addTrack(track, localMediaStream);
  }
  setUpDataChannel(peer.peerConn.createDataChannel("myDataChannel"), peer);
  const desc = await peer.peerConn.createOffer();
  await peer.peerConn.setLocalDescription(desc);
  publishSignalingMsg(remoteSessionId, {
    kind: "offer",
    fromSessionId: mySessionId,
    offer: desc
  });
}
function getOrCreatePeer(remoteSessionId) {
  return peers.get(remoteSessionId) || newPeer(remoteSessionId);
}
async function handleSignalingMsgOffer(signalingMsgOffer) {
  if (signalingMsgOffer.fromSessionId === mySessionId)
    return;
  const fromSessionId = signalingMsgOffer.fromSessionId;
  console.log("Received offer from", fromSessionId);
  const peer = getOrCreatePeer(fromSessionId);
  peer.peerConn.ondatachannel = (dataChannelEv) => {
    const dataChannel = dataChannelEv.channel;
    setUpDataChannel(dataChannel, peer);
  };
  peer.peerConn.ontrack = (ev) => {
    const remoteVideoEl = document.createElement("video");
    remoteVideoEl.autoplay = true;
    remoteVideoEl.muted = true;
    remoteVideoContainerEl.appendChild(remoteVideoEl);
    remoteVideoEl.srcObject = ev.streams[0];
  };
  const offer = signalingMsgOffer.offer;
  await peer.peerConn.setRemoteDescription(offer);
  const answerDesc = await peer.peerConn.createAnswer();
  await peer.peerConn.setLocalDescription(answerDesc);
  publishSignalingMsg(signalingMsgOffer.fromSessionId, {
    kind: "answer",
    fromSessionId: mySessionId,
    answer: answerDesc
  });
}
async function handleSignalingMsgAnswer(signalingMsgAnswer) {
  if (signalingMsgAnswer.fromSessionId === mySessionId)
    return;
  const fromSessionId = signalingMsgAnswer.fromSessionId;
  console.log("Received answer from", fromSessionId);
  const peer = peers.get(fromSessionId);
  if (peer === void 0) {
    throw new Error("Unexpected answer from a peer we never sent an offer to!");
  }
  console.log("Setting answer");
  const answer = signalingMsgAnswer.answer;
  await peer.peerConn.setRemoteDescription(answer);
}
async function handleSignalingMsgIceCandidate(signalingMsgIceCandidate) {
  if (signalingMsgIceCandidate.fromSessionId === mySessionId)
    return;
  const fromSessionId = signalingMsgIceCandidate.fromSessionId;
  console.log("Received ICE candidate from", fromSessionId);
  const peer = getOrCreatePeer(fromSessionId);
  await peer.peerConn.addIceCandidate(signalingMsgIceCandidate.candidate);
}
ablyClient.connect();
ablyClient.connection.on("connected", async () => {
  console.log("Connected to Ably");
  await Promise.all([
    ablyChatRoomHelloChannel.subscribe((ablyMessage) => {
      if (!ablyMessage.data)
        return;
      const signalingMsg = ablyMessage.data;
      handleHello(signalingMsg.fromSessionId);
    }),
    ablyMyPrivateChannel.subscribe((ablyMessage) => {
      const signalingMsg = ablyMessage.data;
      if (signalingMsg.kind === "offer") {
        handleSignalingMsgOffer(signalingMsg);
      } else if (signalingMsg.kind === "answer") {
        handleSignalingMsgAnswer(signalingMsg);
      } else if (signalingMsg.kind === "ice-candidate") {
        handleSignalingMsgIceCandidate(signalingMsg);
      } else {
        assertUnreachable(signalingMsg);
      }
    })
  ]);
  console.log("Subscribed to all channels");
  const msg = {fromSessionId: mySessionId};
  console.log("Publishing hello", msg);
  ablyChatRoomHelloChannel.publish("hello", msg);
});
ablyClient.connection.on("failed", () => {
  console.error("Ably connection failed");
});
