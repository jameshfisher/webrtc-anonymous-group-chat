const peerConn = new RTCPeerConnection({'iceServers': [{'urls': ['stun:stun.l.google.com:19302']}]});
console.log('Call create(), or join("some offer")');

interface Window {
  say(s: string): void;
  gotAnswer(a: RTCSessionDescriptionInit): void;
}

function create() {
  console.log("Creating ...");
  const dataChannel = peerConn.createDataChannel('test');
  dataChannel.onopen = (e) => {
    window.say = (msg) => { dataChannel.send(msg); };
    console.log('Say things with say("hi")');
  };
  dataChannel.onmessage = (e) => { console.log('Got message:', e.data); };
  peerConn.createOffer({})
    .then((desc) => peerConn.setLocalDescription(desc))
    .then(() => {})
    .catch((err) => console.error(err));
  peerConn.onicecandidate = (e) => {
    if (e.candidate == null) {
      console.log("Get joiners to call: ", "join(", JSON.stringify(peerConn.localDescription), ")");
    }
  };
  window.gotAnswer = (answer) => {
    console.log("Initializing ...");
    peerConn.setRemoteDescription(new RTCSessionDescription(answer));
  };
}

function join(offer: RTCSessionDescriptionInit) {
  console.log("Joining ...");

  peerConn.ondatachannel = (e) => {
    const dataChannel = e.channel;
    dataChannel.onopen = (e) => {
      window.say = (msg) => { dataChannel.send(msg); };
      console.log('Say things with say("hi")');
    };
    dataChannel.onmessage = (e) => { console.log('Got message:', e.data); }
  };

  peerConn.onicecandidate = (e) => {
    if (e.candidate == null) {
      console.log("Get the creator to call: gotAnswer(", JSON.stringify(peerConn.localDescription), ")");
    }
  };

  const offerDesc = new RTCSessionDescription(offer);
  peerConn.setRemoteDescription(offerDesc);
  peerConn.createAnswer({})
    .then((answerDesc) => peerConn.setLocalDescription(answerDesc))
    .catch((err) => console.warn("Couldn't create answer"));
}