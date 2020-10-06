var RTCPeerConnection = window.RTCPeerConnection || webkitRTCPeerConnection || mozRTCPeerConnection;
var peerConn = new RTCPeerConnection({ 'iceServers': [{ 'urls': ['stun:stun.l.google.com:19302'] }] });
console.log('Call create(), or join("some offer")');
function create() {
    console.log("Creating ...");
    var dataChannel = peerConn.createDataChannel('test');
    dataChannel.onopen = function (e) {
        window.say = function (msg) { dataChannel.send(msg); };
        console.log('Say things with say("hi")');
    };
    dataChannel.onmessage = function (e) { console.log('Got message:', e.data); };
    peerConn.createOffer({})
        .then(function (desc) { return peerConn.setLocalDescription(desc); })
        .then(function () { })["catch"](function (err) { return console.error(err); });
    peerConn.onicecandidate = function (e) {
        if (e.candidate == null) {
            console.log("Get joiners to call: ", "join(", JSON.stringify(peerConn.localDescription), ")");
        }
    };
    window.gotAnswer = function (answer) {
        console.log("Initializing ...");
        peerConn.setRemoteDescription(new RTCSessionDescription(answer));
    };
}
function join(offer) {
    console.log("Joining ...");
    peerConn.ondatachannel = function (e) {
        var dataChannel = e.channel;
        dataChannel.onopen = function (e) {
            window.say = function (msg) { dataChannel.send(msg); };
            console.log('Say things with say("hi")');
        };
        dataChannel.onmessage = function (e) { console.log('Got message:', e.data); };
    };
    peerConn.onicecandidate = function (e) {
        if (e.candidate == null) {
            console.log("Get the creator to call: gotAnswer(", JSON.stringify(peerConn.localDescription), ")");
        }
    };
    var offerDesc = new RTCSessionDescription(offer);
    peerConn.setRemoteDescription(offerDesc);
    peerConn.createAnswer({})
        .then(function (answerDesc) { return peerConn.setLocalDescription(answerDesc); })["catch"](function (err) { return console.warn("Couldn't create answer"); });
}
