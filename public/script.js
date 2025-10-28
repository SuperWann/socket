const socket = io();
let peer;
let stream;

async function init() {
  stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  document.getElementById("localVideo").srcObject = stream;
}

socket.on("matched", () => {
  console.log("Matched with a user!");
  startPeer(true);
});

socket.on("signal", data => {
  peer.signal(data);
});

socket.on("partner-disconnected", () => {
  alert("Partner disconnected. Searching new one...");
  startPeer(false);
});

function startPeer(initiator) {
  peer = new SimplePeer({ initiator, stream, trickle: false });

  peer.on("signal", data => {
    socket.emit("signal", data);
  });

  peer.on("stream", remoteStream => {
    document.getElementById("remoteVideo").srcObject = remoteStream;
  });
}

init();
