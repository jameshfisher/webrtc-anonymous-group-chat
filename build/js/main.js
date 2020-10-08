import {Realtime} from "../web_modules/ably/promises.js";
function assertUnreachable(x) {
  throw new Error(`Unhandled case: ${JSON.stringify(x)}`);
}
const msgsEl = document.getElementById("msgs");
const msgBufferInputEl = document.getElementById("msgBuffer");
const myClientId = Math.random().toString();
console.log("I am:", myClientId);
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
  publishSignalingMsg({kind: "hello", fromClientId: myClientId});
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
function handleSignalingMsgHello(signalingMsgHello) {
  if (signalingMsgHello.fromClientId === myClientId)
    return;
  const newUserClientId = signalingMsgHello.fromClientId;
  console.log("Received hello from", newUserClientId);
  const peerConn = newPeerConnection();
  peerConns.set(newUserClientId, peerConn);
  const dataChannel = peerConn.createDataChannel("myDataChannel");
  dataChannels.set(newUserClientId, dataChannel);
  dataChannel.onmessage = (ev) => show(ev.data);
  peerConn.createOffer({}).then((desc) => peerConn.setLocalDescription(desc)).then(() => {
  }).catch((err) => console.error(err));
  peerConn.onicecandidate = (ev) => {
    if (ev.candidate == null) {
      publishSignalingMsg({
        kind: "offer",
        fromClientId: myClientId,
        toClientId: newUserClientId,
        offer: peerConn.localDescription?.toJSON()
      });
    }
  };
}
function handleSignalingMsgOffer(signalingMsgOffer) {
  if (signalingMsgOffer.toClientId !== myClientId)
    return;
  if (signalingMsgOffer.fromClientId === myClientId)
    return;
  const fromClientId = signalingMsgOffer.fromClientId;
  console.log("Received offer from", fromClientId);
  const remotePeerConn = getOrCreatePeerConnection(fromClientId);
  remotePeerConn.ondatachannel = (dataChannelEv) => {
    const dataChannel = dataChannelEv.channel;
    dataChannels.set(fromClientId, dataChannel);
    dataChannel.onmessage = (msgEv) => show(msgEv.data);
  };
  remotePeerConn.onicecandidate = (ev) => {
    if (ev.candidate == null) {
      publishSignalingMsg({
        kind: "answer",
        fromClientId: myClientId,
        toClientId: signalingMsgOffer.fromClientId,
        answer: remotePeerConn.localDescription?.toJSON()
      });
    }
  };
  const offer = signalingMsgOffer.offer;
  const offerDesc = new RTCSessionDescription(offer);
  console.log("Setting offer");
  remotePeerConn.setRemoteDescription(offerDesc);
  remotePeerConn.createAnswer({}).then((answerDesc) => remotePeerConn.setLocalDescription(answerDesc)).catch((err) => console.warn("Couldn't create answer"));
}
function handleSignalingMsgAnswer(signalingMsgAnswer) {
  if (signalingMsgAnswer.toClientId !== myClientId)
    return;
  if (signalingMsgAnswer.fromClientId === myClientId)
    return;
  const fromClientId = signalingMsgAnswer.fromClientId;
  console.log("Received answer from", fromClientId);
  const answer = signalingMsgAnswer.answer;
  const peerConn = peerConns.get(fromClientId);
  if (peerConn === void 0) {
    throw new Error("Unexpected answer from a peer we never sent an offer to!");
  }
  console.log("Setting answer");
  peerConn.setRemoteDescription(new RTCSessionDescription(answer));
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
