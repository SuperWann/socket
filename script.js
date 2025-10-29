// script.js
const NGROK_URL = 'https://superwann.github.io/socket/'; // Ganti dengan URL kamu

const socket = io(NGROK_URL, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: 10,
    timeout: 20000
});

let localStream;
let peerConnection;
let isInitiator = false;
let iceCandidatesQueue = [];
let isConnecting = false;
let isPaired = false;

// IMPROVED: Multiple TURN servers untuk reliability
const servers = {
    iceServers: [
        // Multiple STUN servers
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
        { urls: "stun:stun3.l.google.com:19302" },
        { urls: "stun:stun4.l.google.com:19302" },
        
        // Free TURN servers (lebih reliable)
        {
            urls: "turn:openrelay.metered.ca:80",
            username: "openrelayproject",
            credential: "openrelayproject"
        },
        {
            urls: "turn:openrelay.metered.ca:443",
            username: "openrelayproject",
            credential: "openrelayproject"
        },
        {
            urls: "turn:openrelay.metered.ca:443?transport=tcp",
            username: "openrelayproject",
            credential: "openrelayproject"
        },
        
        // Backup TURN server
        {
            urls: "turn:relay.metered.ca:80",
            username: "openai",
            credential: "openai123"
        },
        {
            urls: "turn:relay.metered.ca:443",
            username: "openai",
            credential: "openai123"
        }
    ],
    iceCandidatePoolSize: 10,
    // CRITICAL: Force TURN relay untuk testing
    iceTransportPolicy: 'all' // 'all' atau 'relay' (relay = paksa TURN)
};

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const nextBtn = document.getElementById("nextBtn");
const statusEl = document.getElementById('status');
const localWrapper = document.getElementById('localWrapper');
const remoteWrapper = document.getElementById('remoteWrapper');

function updateStatus(text, type = 'waiting') {
    statusEl.innerHTML = text;
    statusEl.className = `status ${type}`;
}

async function startCamera() {
    try {
        updateStatus('📹 Mengakses kamera...', 'waiting');
        
        localStream = await navigator.mediaDevices.getUserMedia({ 
            video: { 
                width: { ideal: 1280 },
                height: { ideal: 720 }
            }, 
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });
        
        localVideo.srcObject = localStream;
        localWrapper.classList.add('active');
        console.log("✅ Camera started");
        
        updateStatus('⏳ Mencari partner...', 'waiting');
        
        if (!isPaired && !isConnecting) {
            socket.emit("ready");
        }
    } catch (err) {
        console.error("❌ Camera error:", err);
        updateStatus('❌ Kamera gagal: ' + err.message, 'waiting');
        alert("Kamera tidak diizinkan: " + err.message);
    }
}

socket.on("partner-found", async ({ partnerId, initiator }) => {
    if (isConnecting || isPaired) {
        console.log("⚠️  Already connecting/paired, ignoring");
        return;
    }
    
    console.log("🎯 Partner found:", partnerId.slice(0, 8), "Initiator:", initiator);
    isInitiator = initiator;
    isConnecting = true;
    isPaired = true;
    updateStatus('✅ Partner ditemukan! Menghubungkan...', 'connected');
    
    iceCandidatesQueue = [];
    if (peerConnection) {
        peerConnection.close();
    }
    
    if (!localStream || localStream.getTracks().length === 0) {
        console.log("⏳ Starting camera...");
        await startCamera();
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    await createPeerConnection();

    if (isInitiator) {
        console.log("📤 Creating offer...");
        try {
            const offer = await peerConnection.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: true
            });
            await peerConnection.setLocalDescription(offer);
            
            socket.emit("signal", { 
                type: "offer", 
                offer: offer
            });
            console.log("📤 Offer sent");
        } catch (err) {
            console.error("❌ Error creating offer:", err);
            isConnecting = false;
        }
    }
    
    isConnecting = false;
});

socket.on("signal", async (data) => {
    console.log("📨 Signal received:", data.type);
    
    try {
        if (!peerConnection) {
            console.log("Creating peer connection for signal...");
            await createPeerConnection();
        }

        if (data.type === "offer") {
            console.log("📥 Processing offer...");
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
            
            for (const candidate of iceCandidatesQueue) {
                await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            }
            iceCandidatesQueue = [];
            
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            
            socket.emit("signal", { 
                type: "answer", 
                answer: answer
            });
            console.log("📤 Answer sent");
            
        } else if (data.type === "answer") {
            console.log("📥 Processing answer...");
            await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
            
            for (const candidate of iceCandidatesQueue) {
                await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            }
            iceCandidatesQueue = [];
            
        } else if (data.type === "candidate") {
            if (peerConnection.remoteDescription && peerConnection.remoteDescription.type) {
                await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
                console.log("🧊 ICE candidate added:", data.candidate.type || 'unknown');
            } else {
                iceCandidatesQueue.push(data.candidate);
                console.log("⏳ ICE candidate queued");
            }
        }
    } catch (err) {
        console.error("❌ Signal error:", err);
    }
});

socket.on("partner-disconnected", () => {
    console.log("🚫 Partner disconnected");
    updateStatus('👋 Partner disconnect', 'waiting');
    remoteWrapper.classList.remove('active');
    closePeerConnection();
    isPaired = false;
    isConnecting = false;
});

async function createPeerConnection() {
    console.log("🔧 Creating peer connection...");
    peerConnection = new RTCPeerConnection(servers);
    
    if (localStream) {
        localStream.getTracks().forEach((track) => {
            peerConnection.addTrack(track, localStream);
            console.log("➕ Track added:", track.kind);
        });
    }

    peerConnection.ontrack = (event) => {
        console.log("📹 Remote track:", event.track.kind);
        if (event.streams[0]) {
            remoteVideo.srcObject = event.streams[0];
            remoteWrapper.classList.add('active');
            updateStatus('🎉 Terhubung!', 'connected');
            
            // Force play jika video tidak autoplay
            remoteVideo.play().catch(e => console.log("Play error:", e));
        }
    };

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            const type = event.candidate.candidate.includes('relay') ? 'TURN' :
                        event.candidate.candidate.includes('srflx') ? 'STUN' : 'HOST';
            console.log(`🧊 ICE candidate sent (${type})`);
            
            socket.emit("signal", { 
                type: "candidate", 
                candidate: event.candidate
            });
        } else {
            console.log("🧊 All ICE candidates sent");
        }
    };

    // NEW: Tambahkan timeout untuk ICE checking
    let iceCheckingTimeout;
    
    peerConnection.oniceconnectionstatechange = () => {
        console.log("🧊 ICE connection state:", peerConnection.iceConnectionState);
        
        if (peerConnection.iceConnectionState === 'checking') {
            updateStatus('🔍 Mencari jalur koneksi...', 'waiting');
            
            // Set timeout 15 detik untuk checking state
            iceCheckingTimeout = setTimeout(() => {
                if (peerConnection && peerConnection.iceConnectionState === 'checking') {
                    console.warn("⚠️  ICE checking timeout - restarting ICE");
                    peerConnection.restartIce();
                }
            }, 15000);
            
        } else if (peerConnection.iceConnectionState === 'connected' || 
                   peerConnection.iceConnectionState === 'completed') {
            clearTimeout(iceCheckingTimeout);
            updateStatus('🎉 Terhubung!', 'connected');
            logConnectionDetails();
            
        } else if (peerConnection.iceConnectionState === 'failed') {
            clearTimeout(iceCheckingTimeout);
            console.error("❌ ICE connection failed!");
            updateStatus('❌ Gagal terhubung - coba Next', 'waiting');
            
            // Auto retry setelah 2 detik
            setTimeout(() => {
                if (peerConnection) {
                    console.log("🔄 Retrying with ICE restart...");
                    peerConnection.restartIce();
                }
            }, 2000);
            
        } else if (peerConnection.iceConnectionState === 'disconnected') {
            clearTimeout(iceCheckingTimeout);
            updateStatus('⚠️  Koneksi terputus', 'waiting');
        }
    };

    peerConnection.onconnectionstatechange = () => {
        console.log("🔌 Connection state:", peerConnection.connectionState);
        
        if (peerConnection.connectionState === 'connected') {
            updateStatus('🎉 Terhubung!', 'connected');
            // Force play remote video
            if (remoteVideo.srcObject) {
                remoteVideo.play().catch(e => console.log("Play error:", e));
            }
        } else if (peerConnection.connectionState === 'failed') {
            updateStatus('❌ Koneksi gagal - coba Next', 'waiting');
            setTimeout(() => {
                closePeerConnection();
                isPaired = false;
            }, 3000);
        } else if (peerConnection.connectionState === 'disconnected') {
            updateStatus('⚠️  Terputus...', 'waiting');
        }
    };

    peerConnection.onicegatheringstatechange = () => {
        console.log("🧊 ICE gathering state:", peerConnection.iceGatheringState);
    };
}

// NEW: Function to log connection details
async function logConnectionDetails() {
    if (!peerConnection) return;
    
    try {
        const stats = await peerConnection.getStats();
        stats.forEach(report => {
            if (report.type === 'candidate-pair' && report.state === 'succeeded') {
                console.log("✅ Connected using:", report);
                console.log("   Local candidate type:", report.localCandidateId);
                console.log("   Remote candidate type:", report.remoteCandidateId);
            }
        });
    } catch (err) {
        console.error("Error getting stats:", err);
    }
}

function closePeerConnection() {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    if (remoteVideo.srcObject) {
        remoteVideo.srcObject = null;
    }
    iceCandidatesQueue = [];
}

nextBtn.addEventListener("click", () => {
    console.log("👥 Next clicked");
    socket.emit("next");
    closePeerConnection();
    remoteWrapper.classList.remove('active');
    updateStatus('⏳ Mencari partner baru...', 'waiting');
    isPaired = false;
    isConnecting = false;
    
    setTimeout(() => {
        socket.emit("ready");
    }, 500);
});

socket.on("connect", () => {
    console.log("✅ Socket connected:", socket.id);
    isPaired = false;
    isConnecting = false;
});

socket.on("disconnect", () => {
    console.log("❌ Socket disconnected");
    updateStatus('❌ Terputus dari server', 'waiting');
    closePeerConnection();
    isPaired = false;
    isConnecting = false;
});

startCamera();