import {Realtime} from "../web_modules/ably/promises.js";
function assertUnreachable(x) {
  throw new Error(`Unhandled case: ${JSON.stringify(x)}`);
}
const msgsEl = document.getElementById("msgs");
const msgBufferInputEl = document.getElementById("msgBuffer");
const mySessionId = Math.random().toString();
console.log("I am:", mySessionId);
const peerConns = new Map();
const dataChannels = new Map();
window.dataChannels = dataChannels;
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
    for (const dataChannel of dataChannels.values()) {
      dataChannel.send(msg);
    }
  }
};
const ablyClient = new Realtime({
  key: "IOh7bg.2hQ82w:DFd_OB1D2kVJBCag"
});
let ablyChatRoomSignalingChannel = ablyClient.channels.get("global");
function publishSignalingMsg(signalingMsg) {
  console.log("Publishing", signalingMsg);
  ablyChatRoomSignalingChannel.publish("signaling-msg", signalingMsg);
}
ablyClient.connection.on("connected", () => {
  console.log("Connected to Ably");
  publishSignalingMsg({kind: "hello", fromSessionId: mySessionId});
});
ablyClient.connection.on("failed", () => {
  console.error("Ably connection failed");
});
function newPeerConnection() {
  return new RTCPeerConnection({iceServers: [{urls: ["stun:stun.l.google.com:19302"]}]});
}
function getOrCreatePeerConnection(sessionId) {
  let peerConn = peerConns.get(sessionId);
  if (peerConn === void 0) {
    peerConn = newPeerConnection();
    peerConns.set(sessionId, peerConn);
  }
  return peerConn;
}
async function handleSignalingMsgHello(signalingMsgHello) {
  if (signalingMsgHello.fromSessionId === mySessionId)
    return;
  const newSessionId = signalingMsgHello.fromSessionId;
  console.log("Received hello from", newSessionId);
  const peerConn = newPeerConnection();
  peerConns.set(newSessionId, peerConn);
  const dataChannel = peerConn.createDataChannel("myDataChannel");
  dataChannels.set(newSessionId, dataChannel);
  dataChannel.onmessage = (ev) => show(ev.data);
  peerConn.onicecandidate = (ev) => {
    if (ev.candidate !== null) {
      publishSignalingMsg({
        kind: "ice-candidate",
        fromSessionId: mySessionId,
        toSessionId: newSessionId,
        candidate: ev.candidate
      });
    }
  };
  const desc = await peerConn.createOffer();
  await peerConn.setLocalDescription(desc);
  publishSignalingMsg({
    kind: "offer",
    fromSessionId: mySessionId,
    toSessionId: newSessionId,
    offer: desc
  });
}
async function handleSignalingMsgOffer(signalingMsgOffer) {
  if (signalingMsgOffer.toSessionId !== mySessionId)
    return;
  if (signalingMsgOffer.fromSessionId === mySessionId)
    return;
  const fromSessionId = signalingMsgOffer.fromSessionId;
  console.log("Received offer from", fromSessionId);
  const peerConn = getOrCreatePeerConnection(fromSessionId);
  peerConn.ondatachannel = (dataChannelEv) => {
    const dataChannel = dataChannelEv.channel;
    dataChannels.set(fromSessionId, dataChannel);
    dataChannel.onmessage = (msgEv) => show(msgEv.data);
  };
  peerConn.onicecandidate = (ev) => {
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
  await peerConn.setRemoteDescription(offer);
  const answerDesc = await peerConn.createAnswer();
  await peerConn.setLocalDescription(answerDesc);
  publishSignalingMsg({
    kind: "answer",
    fromSessionId: mySessionId,
    toSessionId: signalingMsgOffer.fromSessionId,
    answer: answerDesc
  });
}
async function handleSignalingMsgAnswer(signalingMsgAnswer) {
  if (signalingMsgAnswer.toSessionId !== mySessionId)
    return;
  if (signalingMsgAnswer.fromSessionId === mySessionId)
    return;
  const fromSessionId = signalingMsgAnswer.fromSessionId;
  console.log("Received answer from", fromSessionId);
  const peerConn = peerConns.get(fromSessionId);
  if (peerConn === void 0) {
    throw new Error("Unexpected answer from a peer we never sent an offer to!");
  }
  console.log("Setting answer");
  const answer = signalingMsgAnswer.answer;
  await peerConn.setRemoteDescription(answer);
}
async function handleSignalingMsgIceCandidate(signalingMsgIceCandidate) {
  if (signalingMsgIceCandidate.toSessionId !== mySessionId)
    return;
  if (signalingMsgIceCandidate.fromSessionId === mySessionId)
    return;
  const fromSessionId = signalingMsgIceCandidate.fromSessionId;
  console.log("Received ICE candidate from", fromSessionId);
  const peerConn = peerConns.get(fromSessionId);
  if (peerConn === void 0) {
    throw new Error("Unexpected ICE candidate from a peer we don't know about yet");
  }
  await peerConn.addIceCandidate(signalingMsgIceCandidate.candidate);
}
ablyChatRoomSignalingChannel.subscribe((ablyMessage) => {
  const signalingMsg = ablyMessage.data;
  if (signalingMsg.kind === "hello") {
    handleSignalingMsgHello(signalingMsg);
  } else if (signalingMsg.kind === "offer") {
    handleSignalingMsgOffer(signalingMsg);
  } else if (signalingMsg.kind === "answer") {
    handleSignalingMsgAnswer(signalingMsg);
  } else if (signalingMsg.kind === "ice-candidate") {
    handleSignalingMsgIceCandidate(signalingMsg);
  } else {
    assertUnreachable(signalingMsg);
  }
});
