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
function getOrCreatePeerConnection(uid) {
  let peerConn = peerConns.get(uid);
  if (peerConn === void 0) {
    peerConn = newPeerConnection();
    peerConns.set(uid, peerConn);
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
      ev.candidate;
      publishSignalingMsg({
        kind: "offer",
        fromSessionId: mySessionId,
        toSessionId: newSessionId,
        offer: peerConn.localDescription?.toJSON()
      });
    }
  };
  const desc = await peerConn.createOffer({});
  await peerConn.setLocalDescription(desc);
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
    if (ev.candidate == null) {
      publishSignalingMsg({
        kind: "answer",
        fromSessionId: mySessionId,
        toSessionId: signalingMsgOffer.fromSessionId,
        answer: peerConn.localDescription?.toJSON()
      });
    }
  };
  const offer = signalingMsgOffer.offer;
  const offerDesc = new RTCSessionDescription(offer);
  console.log("Setting offer");
  await peerConn.setRemoteDescription(offerDesc);
  const answerDesc = await peerConn.createAnswer({});
  await peerConn.setLocalDescription(answerDesc);
}
async function handleSignalingMsgAnswer(signalingMsgAnswer) {
  if (signalingMsgAnswer.toSessionId !== mySessionId)
    return;
  if (signalingMsgAnswer.fromSessionId === mySessionId)
    return;
  const fromSessionId = signalingMsgAnswer.fromSessionId;
  console.log("Received answer from", fromSessionId);
  const answer = signalingMsgAnswer.answer;
  const peerConn = peerConns.get(fromSessionId);
  if (peerConn === void 0) {
    throw new Error("Unexpected answer from a peer we never sent an offer to!");
  }
  console.log("Setting answer");
  await peerConn.setRemoteDescription(new RTCSessionDescription(answer));
}
ablyChatRoomSignalingChannel.subscribe((ablyMessage) => {
  const signalingMsg = ablyMessage.data;
  if (signalingMsg.kind === "hello") {
    handleSignalingMsgHello(signalingMsg);
  } else if (signalingMsg.kind === "offer") {
    handleSignalingMsgOffer(signalingMsg);
  } else if (signalingMsg.kind === "answer") {
    handleSignalingMsgAnswer(signalingMsg);
  } else {
    assertUnreachable(signalingMsg);
  }
});
